const SAMPLE_DATA = {
  productName: "PM.ai",
  targetUsers: "Product managers at seed to Series B SaaS companies",
  productContext:
    "PM.ai is a Cursor-native copilot for product managers. It ingests customer signals, recommends what to build next with reasoning, generates a feature spec plus Figma-style wireframe description, and then hands the work to Codex so engineering gets an implementation kickoff instead of another doc.",
  interviews: `- "I spend half my week stitching together interview notes, support tickets, and analytics screenshots before I can even write a spec."
- "The hardest part is choosing one thing with conviction. Everything sounds important when the evidence is scattered."
- "Once I finally decide, I still have to rewrite the whole story for design and engineering."
- "I want a tool that preserves the quotes and metrics so I can defend the roadmap decision in front of leadership."`,
  feedback: `- Top support request cluster: "Can you help us understand which customer problems are coming up most often?"
- Sales call note: "Prospects like the insight synthesis, but they want something that gets them all the way to an execution brief."
- Churn interview: "The recommendations looked smart, but it still felt like another polished doc we had to operationalize ourselves."
- Internal beta feedback: "The magic moment is seeing a recommendation, spec, and engineering-ready task list appear from the same input."`,
  usageData: `- 78% of test users complete an upload flow, but only 34% create a follow-on implementation ticket.
- The most retained users are the ones who export or copy the generated spec within the first session.
- Average time from first upload to roadmap decision today: 2.8 days.
- 61% of sessions include multiple signal sources, suggesting users want cross-source synthesis rather than single-note analysis.`,
  implementationNotes:
    "Initial MVP can be a lightweight local web app. Keep artifacts auditable on disk. Optimize for a fast vertical slice over enterprise workflows. The differentiated step is a Codex kickoff, not full PM suite breadth."
};

const state = {
  health: null,
  jobPoller: null,
  latestPrompt: ""
};

const form = document.querySelector("#pm-form");
const emptyState = document.querySelector("#empty-state");
const results = document.querySelector("#results");
const statusBanner = document.querySelector("#status-banner");
const modeHint = document.querySelector("#mode-hint");
const runMeta = document.querySelector("#run-meta");
const sampleButton = document.querySelector("#sample-button");
const clearButton = document.querySelector("#clear-button");
const runButton = document.querySelector("#run-button");

document.querySelectorAll('input[type="file"][data-target]').forEach((input) => {
  input.addEventListener("change", async (event) => {
    const targetId = event.target.dataset.target;
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      return;
    }

    const contents = await Promise.all(
      files.map(async (file) => `\n\n[${file.name}]\n${await file.text()}`)
    );

    const target = document.querySelector(`#${targetId}`);
    target.value = `${target.value}${contents.join("")}`.trim();
    event.target.value = "";
    showBanner(`Imported ${files.length} file${files.length === 1 ? "" : "s"} into ${labelForTarget(targetId)}.`, false);
  });
});

sampleButton.addEventListener("click", () => {
  applySampleData();
  showBanner("Loaded the PM.ai sample dataset so you can test the full loop immediately.", false);
});

clearButton.addEventListener("click", () => {
  form.reset();
  if (state.health?.suggestedCodexWorkspace) {
    document.querySelector("#codexWorkspacePath").value = state.health.suggestedCodexWorkspace;
  }
  showBanner("Cleared the form.", false);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoading(true);
  clearJobPolling();

  try {
    const payload = {
      productName: valueOf("productName"),
      targetUsers: valueOf("targetUsers"),
      productContext: valueOf("productContext"),
      interviews: valueOf("interviews"),
      feedback: valueOf("feedback"),
      usageData: valueOf("usageData"),
      implementationNotes: valueOf("implementationNotes"),
      codexWorkspacePath: valueOf("codexWorkspacePath"),
      runCodex: document.querySelector("#runCodex").checked
    };

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "PM.ai could not finish the analysis.");
    }

    renderResult(data);
    if (data.codexJob?.id && data.codexJob.status === "running") {
      startJobPolling(data.codexJob.id);
    }
  } catch (error) {
    showBanner(error.message, true);
  } finally {
    setLoading(false);
  }
});

window.addEventListener("load", async () => {
  applySampleData();
  await loadHealth();
});

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    state.health = data;
    modeHint.textContent =
      data.mode === "openai"
        ? `Live OpenAI mode is active with ${data.defaultOpenAiModel}.`
        : "Demo mode is active. Add OPENAI_API_KEY for live synthesis.";

    const workspaceInput = document.querySelector("#codexWorkspacePath");
    if (!workspaceInput.value) {
      workspaceInput.value = data.suggestedCodexWorkspace;
    }
  } catch (error) {
    modeHint.textContent = "Runtime check failed. The app can still run locally if the server is healthy.";
  }
}

function applySampleData() {
  Object.entries(SAMPLE_DATA).forEach(([key, value]) => {
    const target = document.querySelector(`#${key}`);
    if (target) {
      target.value = value;
    }
  });
}

function renderResult(data) {
  emptyState.classList.add("hidden");
  results.classList.remove("hidden");
  runMeta.innerHTML = [
    renderMetaPill(`Mode: ${escapeHtml(data.mode)}`),
    renderMetaPill(`Run: ${escapeHtml(data.runId)}`)
  ].join("");

  const warningsHtml = Array.isArray(data.warnings) && data.warnings.length
    ? `<ul class="warning-list">${data.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
    : "";

  state.latestPrompt = data.analysis.codexKickoff.prompt || "";
  results.innerHTML = `
    <article class="result-card">
      <h3>${escapeHtml(data.analysis.recommendedFeature.title)}</h3>
      <p>${escapeHtml(data.analysis.executiveSummary)}</p>
      <div class="metric-row">
        <div class="metric">
          <span class="metric-label">Impact</span>
          <span class="metric-value">${escapeHtml(
            String(data.analysis.featureCandidates[0]?.impactScore || "--")
          )}/10</span>
        </div>
        <div class="metric">
          <span class="metric-label">Confidence</span>
          <span class="metric-value">${escapeHtml(
            String(data.analysis.featureCandidates[0]?.confidenceScore || "--")
          )}/10</span>
        </div>
        <div class="metric">
          <span class="metric-label">Effort</span>
          <span class="metric-value">${escapeHtml(
            String(data.analysis.featureCandidates[0]?.effortScore || "--")
          )}/10</span>
        </div>
      </div>
      ${warningsHtml}
    </article>

    <article class="result-card">
      <h3>Evidence and opportunity ranking</h3>
      <div class="candidate-grid">
        ${data.analysis.featureCandidates.map(renderCandidateCard).join("")}
      </div>
      <ul class="list">
        ${data.analysis.evidence
          .map(
            (item) =>
              `<li><strong>${escapeHtml(item.title)}</strong> <span>(${escapeHtml(item.source)})</span>: ${escapeHtml(item.detail)}</li>`
          )
          .join("")}
      </ul>
    </article>

    <article class="result-card">
      <h3>Feature spec</h3>
      <div class="spec-grid">
        ${renderSpecBlock("Problem", [data.analysis.spec.problemStatement])}
        ${renderSpecBlock("User story", [data.analysis.spec.userStory])}
        ${renderSpecBlock("Scope in", data.analysis.spec.scopeIn)}
        ${renderSpecBlock("Scope out", data.analysis.spec.scopeOut)}
        ${renderSpecBlock("Acceptance criteria", data.analysis.spec.acceptanceCriteria)}
        ${renderSpecBlock("Open questions", data.analysis.spec.openQuestions)}
      </div>
    </article>

    <article class="result-card">
      <h3>Figma-style wireframe brief</h3>
      <p>${escapeHtml(data.analysis.wireframe.vision)}</p>
      <div class="wireframe-grid">
        ${data.analysis.wireframe.frames.map(renderWireframeFrame).join("")}
      </div>
      <ul class="list">
        ${data.analysis.wireframe.interactionNotes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
      <div class="code-block">${escapeHtml(data.analysis.wireframe.figmaPrompt)}</div>
    </article>

    <article class="result-card">
      <h3>Implementation kickoff</h3>
      <div class="ticket-grid">
        ${data.analysis.tickets.map(renderTicket).join("")}
      </div>
      <div class="code-actions">
        <button type="button" class="ghost-button" id="copy-prompt-button">Copy Codex prompt</button>
      </div>
      <div class="code-block">${escapeHtml(data.analysis.codexKickoff.prompt)}</div>
    </article>

    <article class="result-card">
      <h3>Artifacts</h3>
      <div class="artifacts-row">
        ${data.artifacts.map(renderArtifact).join("")}
      </div>
    </article>

    <article class="result-card" id="codex-job-card">
      ${renderCodexJob(data.codexJob)}
    </article>
  `;

  const copyButton = document.querySelector("#copy-prompt-button");
  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(state.latestPrompt);
      showBanner("Copied the Codex kickoff prompt.", false);
    });
  }

  showBanner("PM.ai finished the run.", false);
}

function renderCandidateCard(candidate) {
  return `
    <section class="candidate">
      <div class="candidate-top">
        <div>
          <h4>${escapeHtml(candidate.title)}</h4>
          <p>${escapeHtml(candidate.summary)}</p>
        </div>
      </div>
      <div class="score-group">
        ${renderScore("Impact", candidate.impactScore)}
        ${renderScore("Confidence", candidate.confidenceScore)}
        ${renderScore("Effort", candidate.effortScore)}
      </div>
      <ul class="list">
        <li>${escapeHtml(candidate.userProblem)}</li>
        <li>${escapeHtml(candidate.reasoning)}</li>
      </ul>
    </section>
  `;
}

function renderSpecBlock(title, items) {
  return `
    <section class="spec-block">
      <h4>${escapeHtml(title)}</h4>
      <ul class="list">
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function renderWireframeFrame(frame) {
  return `
    <section class="wireframe-frame">
      <h4>${escapeHtml(frame.name)}</h4>
      <p>${escapeHtml(frame.purpose)}</p>
      <ul class="list">
        <li>${escapeHtml(frame.layout)}</li>
      </ul>
      <div class="frame-components">
        ${frame.components
          .map(
            (component) => `
            <div class="component-chip">
              <strong>${escapeHtml(component.name)}</strong>
              <div>${escapeHtml(component.description)}</div>
              <small>${escapeHtml(component.note)}</small>
            </div>
          `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderTicket(ticket) {
  return `
    <section class="ticket">
      <h4>${escapeHtml(ticket.title)}</h4>
      <p><strong>${escapeHtml(ticket.owner)}</strong></p>
      <p>${escapeHtml(ticket.description)}</p>
      <ul class="list">
        ${ticket.definitionOfDone.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function renderArtifact(artifact) {
  return `
    <section class="artifact">
      <div class="artifact-top">
        <div>
          <h4>${escapeHtml(artifact.name)}</h4>
          <p>${escapeHtml(artifact.path)}</p>
        </div>
      </div>
      <a href="${escapeHtml(artifact.url)}" target="_blank" rel="noreferrer">Open artifact</a>
    </section>
  `;
}

function renderCodexJob(job) {
  if (!job) {
    return `
      <h3>Codex handoff</h3>
      <p>No Codex status is available for this run.</p>
    `;
  }

  const header = `
    <h3>Codex handoff</h3>
    <p>${escapeHtml(job.reason || job.status || "idle")}</p>
  `;

  if (!job.id) {
    return header;
  }

  const links = `
    <div class="job-links">
      <a href="${escapeHtml(job.logUrl)}" target="_blank" rel="noreferrer">Open log</a>
      <span> | </span>
      <a href="${escapeHtml(job.lastMessageUrl)}" target="_blank" rel="noreferrer">Open final message</a>
    </div>
  `;

  return `
    <h3>Codex handoff</h3>
    <p>Status: <strong>${escapeHtml(job.status)}</strong></p>
    <ul class="list">
      <li>${escapeHtml(job.command)}</li>
      <li>${escapeHtml(job.workspacePath)}</li>
    </ul>
    ${links}
    ${job.tail?.length ? `<div class="job-log">${escapeHtml(job.tail.join("\n"))}</div>` : ""}
  `;
}

function renderScore(label, value) {
  return `<span class="score-chip">${escapeHtml(label)} ${escapeHtml(String(value))}/10</span>`;
}

function renderMetaPill(text) {
  return `<span class="meta-pill">${escapeHtml(text)}</span>`;
}

function showBanner(message, isError) {
  statusBanner.classList.remove("hidden");
  statusBanner.style.background = isError
    ? "rgba(166, 51, 37, 0.12)"
    : "rgba(208, 92, 46, 0.12)";
  statusBanner.style.borderColor = isError
    ? "rgba(166, 51, 37, 0.2)"
    : "rgba(208, 92, 46, 0.18)";
  statusBanner.textContent = message;
}

function setLoading(loading) {
  runButton.disabled = loading;
  runButton.textContent = loading ? "Synthesizing..." : "Run PM.ai";
}

function startJobPolling(jobId) {
  clearJobPolling();
  state.jobPoller = window.setInterval(async () => {
    try {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) {
        clearJobPolling();
        return;
      }

      const job = await response.json();
      const card = document.querySelector("#codex-job-card");
      if (card) {
        card.innerHTML = renderCodexJob(job);
      }

      if (job.status !== "running") {
        clearJobPolling();
      }
    } catch (error) {
      clearJobPolling();
    }
  }, 3000);
}

function clearJobPolling() {
  if (state.jobPoller) {
    window.clearInterval(state.jobPoller);
    state.jobPoller = null;
  }
}

function valueOf(id) {
  return document.querySelector(`#${id}`).value.trim();
}

function labelForTarget(targetId) {
  const labels = {
    interviews: "customer interviews",
    feedback: "feedback backlog",
    usageData: "usage data"
  };
  return labels[targetId] || targetId;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
