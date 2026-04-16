import { STAGE_ORDER } from "./config.js";
import { escapeHtml, linesToText, timeLabel } from "./utils.js";

export function renderWorkflowShell(appState) {
  const workflow = appState.workflow;
  const activeStage = workflow?.stages?.[appState.activeStage] || workflow?.stages?.opportunity;
  const opportunity = preferredStageData(workflow, "opportunity");
  const nextStage = firstOpenStage(workflow);
  const warningsHtml = Array.isArray(workflow?.warnings) && workflow.warnings.length
    ? `<ul class="warning-list">${workflow.warnings
        .map((warning) => `<li>${escapeHtml(warning)}</li>`)
        .join("")}</ul>`
    : "";

  return `
    <article class="result-card workflow-summary">
      <div class="summary-top">
        <div>
          <p class="eyebrow">Workflow state</p>
          <h3>${escapeHtml(opportunity?.recommendedFeature?.title || "Recommendation pending")}</h3>
          <p>${escapeHtml(opportunity?.executiveSummary || "Start with the opportunity stage.")}</p>
        </div>
        <div class="summary-metrics">
          <div class="metric">
            <span class="metric-label">Current stage</span>
            <span class="metric-value">${escapeHtml(activeStage?.label || "Opportunity")}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Next required action</span>
            <span class="metric-value metric-compact">${escapeHtml(nextStage?.label || "Codex ready")}</span>
          </div>
        </div>
      </div>
      ${warningsHtml}
    </article>
    <div class="workflow-layout">
      <aside class="result-card stage-sidebar">
        <h3>Stages</h3>
        <div class="stage-list">
          ${STAGE_ORDER.map((stageKey) => renderStageNav(workflow, appState, stageKey)).join("")}
        </div>
      </aside>
      <section class="stage-main">
        ${renderActiveStage(workflow, appState)}
      </section>
      <aside class="workflow-aside">
        ${renderEvidenceCard(workflow)}
        ${renderCodeViewer(workflow?.codexJob, appState.codexView)}
        ${renderArtifactsCard(workflow)}
        ${renderHistoryCard(workflow)}
        <article class="result-card" id="codex-job-card">
          ${renderCodexJob(workflow?.codexJob)}
        </article>
      </aside>
    </div>
  `;
}

export function renderRunMeta(workflow, activeStage) {
  const opportunity = preferredStageData(workflow, "opportunity");
  return [
    renderMetaPill(`Mode: ${escapeHtml(workflow.mode)}`),
    renderMetaPill(`Workflow: ${escapeHtml(workflow.workflowId)}`),
    renderMetaPill(
      opportunity?.recommendedFeature?.title
        ? `Focus: ${escapeHtml(opportunity.recommendedFeature.title)}`
        : `Stage: ${escapeHtml(workflow.stages[activeStage]?.label || activeStage)}`
    )
  ].join("");
}

export function renderCodexJob(job) {
  if (!job) {
    return `
      <h3>Codex handoff</h3>
      <p>No Codex status is available for this workflow.</p>
    `;
  }

  if (!job.id) {
    return `
      <h3>Codex handoff</h3>
      <p>${escapeHtml(job.reason || job.status || "idle")}</p>
    `;
  }

  return `
    <div class="section-toolbar">
      <h3>Codex handoff</h3>
      ${renderStatusChip(job.status)}
    </div>
    <ul class="list">
      <li><strong>Model:</strong> ${escapeHtml(job.model)}</li>
      <li><strong>Target workspace:</strong> ${escapeHtml(job.workspacePath)}</li>
      ${job.responseId ? `<li><strong>Response:</strong> ${escapeHtml(job.responseId)}</li>` : ""}
      ${job.error ? `<li><strong>Error:</strong> ${escapeHtml(job.error)}</li>` : ""}
    </ul>
    <div class="job-links">
      <a href="${escapeHtml(job.logUrl)}" target="_blank" rel="noreferrer">Open stream log</a>
      <a href="${escapeHtml(job.outputUrl)}" target="_blank" rel="noreferrer">Open full output</a>
      <a href="${escapeHtml(job.filesUrl)}" target="_blank" rel="noreferrer">Open parsed files</a>
    </div>
    ${job.tail?.length ? `<div class="job-log">${escapeHtml(job.tail.join("\n"))}</div>` : ""}
  `;
}

export function renderCodeViewer(job, codexView) {
  if (!job?.id) {
    return `
      <article class="result-card code-viewer-card" id="code-viewer-card">
        <div class="section-toolbar">
          <h3>Live code viewer</h3>
          ${renderStatusChip(job?.status || "idle")}
        </div>
        <p>${escapeHtml(job?.reason || "Launch the approved Codex stage to stream code into the UI.")}</p>
      </article>
    `;
  }

  const files = Array.isArray(codexView?.files) ? codexView.files : [];
  const selectedPath = codexView?.selectedPath || files[0]?.path || "";
  const selectedFile = files.find((file) => file.path === selectedPath) || files[0] || null;
  const rawOutput = codexView?.outputText || job.outputText || "";
  const viewerContent = selectedFile?.content || rawOutput || "Waiting for streamed output...";

  return `
    <article class="result-card code-viewer-card" id="code-viewer-card">
      <div class="section-toolbar">
        <div>
          <h3>Live code viewer</h3>
          <p class="subtle-copy">Streaming from ${escapeHtml(job.model)} into the workflow UI.</p>
        </div>
        <div class="stage-meta">
          ${renderStatusChip(job.status)}
          <span class="meta-pill">${escapeHtml(files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "streaming raw output")}</span>
        </div>
      </div>
      ${
        files.length
          ? `
            <div class="code-viewer-shell">
              <div class="code-file-list">
                ${files
                  .map(
                    (file) => `
                      <button
                        type="button"
                        class="code-file-tab ${file.path === selectedPath ? "active" : ""}"
                        data-action="select-code-file"
                        data-path="${escapeHtml(file.path)}"
                      >
                        ${escapeHtml(file.path)}
                      </button>
                    `
                  )
                  .join("")}
              </div>
              <div class="code-pane-shell">
                <div class="code-pane-meta">
                  <span>${escapeHtml(selectedFile?.path || "Raw output")}</span>
                  ${selectedFile?.language ? `<span>${escapeHtml(selectedFile.language)}</span>` : ""}
                </div>
                <pre class="code-pane">${escapeHtml(viewerContent)}</pre>
              </div>
            </div>
          `
          : `
            <div class="code-pane-shell raw-only">
              <div class="code-pane-meta">
                <span>Raw stream</span>
                <span>${escapeHtml(job.model)}</span>
              </div>
              <pre class="code-pane">${escapeHtml(viewerContent)}</pre>
            </div>
          `
      }
      ${
        rawOutput && selectedFile
          ? `
            <details class="stream-raw">
              <summary>Raw stream</summary>
              <pre class="job-log">${escapeHtml(rawOutput)}</pre>
            </details>
          `
          : ""
      }
    </article>
  `;
}

function renderStageNav(workflow, appState, stageKey) {
  const stage = workflow.stages[stageKey];
  return `
    <button type="button" class="stage-nav-item ${stageKey === appState.activeStage ? "active" : ""}" data-action="open-stage" data-stage="${stageKey}">
      <div>
        <strong>${escapeHtml(stage.label)}</strong>
        <p>${escapeHtml(stage.description)}</p>
      </div>
      ${renderStatusChip(stage.status)}
    </button>
  `;
}

function renderActiveStage(workflow, appState) {
  const stage = workflow.stages[appState.activeStage];
  const stageData = stage.draft || stage.approved;
  const blockedText = stage.blockedBy.length
    ? `Approve ${stage.blockedBy.map((stageKey) => workflow.stages[stageKey]?.label || stageKey).join(", ")} before generating this stage.`
    : "";
  const staleNote = stage.stale
    ? `<p class="stage-note stale-note">Upstream approvals changed. Regenerate or edit this draft before relying on it downstream.</p>`
    : "";

  return `
    <article class="result-card stage-card">
      <div class="stage-card-top">
        <div>
          <p class="eyebrow">Current stage</p>
          <h3>${escapeHtml(stage.label)}</h3>
          <p>${escapeHtml(stage.description)}</p>
        </div>
        <div class="stage-meta">
          ${renderStatusChip(stage.status)}
          <span class="meta-pill">v${escapeHtml(String(stage.version || 0))}</span>
          ${stage.approvedVersion ? `<span class="meta-pill">Approved v${escapeHtml(String(stage.approvedVersion))}</span>` : ""}
          ${stage.approvedAt ? `<span class="meta-pill">Approved ${escapeHtml(timeLabel(stage.approvedAt))}</span>` : ""}
        </div>
      </div>
      ${staleNote}
      ${
        !stageData
          ? `
            <div class="stage-empty">
              <p>${escapeHtml(blockedText || "This stage is ready to generate.")}</p>
              ${
                stage.status !== "blocked"
                  ? `<button type="button" class="primary-button" data-action="generate-stage" data-stage="${appState.activeStage}">Generate ${escapeHtml(stage.label)}</button>`
                  : ""
              }
            </div>
          `
          : `
            <div class="stage-actions">
              <button type="button" class="ghost-button" data-action="save-stage" data-stage="${appState.activeStage}">Save draft</button>
              <button type="button" class="ghost-button" data-action="generate-stage" data-stage="${appState.activeStage}">Regenerate</button>
              <button type="button" class="primary-button" data-action="approve-stage" data-stage="${appState.activeStage}">Approve ${escapeHtml(stage.label)}</button>
              ${
                appState.activeStage === "codex" && stage.approved && !stage.stale
                  ? `<button type="button" class="primary-button secondary-tone" data-action="launch-codex" data-stage="codex">Launch Codex</button>`
                  : ""
              }
              ${
                appState.activeStage === "codex" && appState.latestPrompt
                  ? `<button type="button" class="ghost-button" data-action="copy-prompt" data-stage="codex">Copy prompt</button>`
                  : ""
              }
            </div>
            ${renderStageEditor(appState.activeStage, stageData)}
            ${renderStageHistory(stage)}
          `
      }
    </article>
  `;
}

function renderStageEditor(stageKey, stageData) {
  if (stageKey === "opportunity") {
    return renderOpportunityEditor(stageData);
  }
  if (stageKey === "spec") {
    return renderSpecEditor(stageData);
  }
  if (stageKey === "wireframe") {
    return renderWireframeEditor(stageData);
  }
  if (stageKey === "tickets") {
    return renderTicketsEditor(stageData);
  }
  return renderCodexEditor(stageData);
}

function renderOpportunityEditor(stageData) {
  return `
    <div class="editor-grid">
      <label class="field">
        <span>Recommendation title</span>
        <input id="opportunity-title" value="${escapeHtml(stageData.recommendedFeature.title)}" />
      </label>
      <label class="field field-span">
        <span>Executive summary</span>
        <textarea id="opportunity-executive-summary" rows="4">${escapeHtml(stageData.executiveSummary)}</textarea>
      </label>
      <label class="field field-span">
        <span>Why now</span>
        <textarea id="opportunity-why-now" rows="4">${escapeHtml(stageData.recommendedFeature.whyNow)}</textarea>
      </label>
      <label class="field field-span">
        <span>User problem</span>
        <textarea id="opportunity-user-problem" rows="4">${escapeHtml(stageData.recommendedFeature.userProblem)}</textarea>
      </label>
      <label class="field field-span">
        <span>Solution bet</span>
        <textarea id="opportunity-solution-bet" rows="4">${escapeHtml(stageData.recommendedFeature.solutionBet)}</textarea>
      </label>
      <label class="field">
        <span>Success metrics</span>
        <textarea id="opportunity-success-metrics" rows="5">${escapeHtml(linesToText(stageData.recommendedFeature.successMetrics))}</textarea>
      </label>
      <label class="field">
        <span>Risks</span>
        <textarea id="opportunity-risks" rows="5">${escapeHtml(linesToText(stageData.recommendedFeature.risks))}</textarea>
      </label>
      <label class="field field-span">
        <span>Rollout plan</span>
        <textarea id="opportunity-rollout-plan" rows="5">${escapeHtml(linesToText(stageData.recommendedFeature.rolloutPlan))}</textarea>
      </label>
    </div>
    <div class="detail-grid">
      <section class="detail-card">
        <h4>Candidate ranking</h4>
        <div class="candidate-grid compact-grid">
          ${stageData.featureCandidates.map(renderCandidateCard).join("")}
        </div>
      </section>
      <section class="detail-card">
        <h4>Evidence</h4>
        <ul class="list">
          ${stageData.evidence
            .map(
              (item) =>
                `<li><strong>${escapeHtml(item.title)}</strong> <span>(${escapeHtml(item.source)})</span>: ${escapeHtml(item.detail)}</li>`
            )
            .join("")}
        </ul>
      </section>
    </div>
  `;
}

function renderSpecEditor(stageData) {
  return `
    <div class="editor-grid">
      <label class="field field-span">
        <span>Problem statement</span>
        <textarea id="spec-problem" rows="4">${escapeHtml(stageData.problemStatement)}</textarea>
      </label>
      <label class="field">
        <span>Target users</span>
        <input id="spec-target-users" value="${escapeHtml(stageData.targetUsers)}" />
      </label>
      <label class="field field-span">
        <span>User story</span>
        <textarea id="spec-user-story" rows="3">${escapeHtml(stageData.userStory)}</textarea>
      </label>
      <label class="field">
        <span>Jobs to be done</span>
        <textarea id="spec-jtbd" rows="5">${escapeHtml(linesToText(stageData.jobsToBeDone))}</textarea>
      </label>
      <label class="field">
        <span>Scope in</span>
        <textarea id="spec-scope-in" rows="5">${escapeHtml(linesToText(stageData.scopeIn))}</textarea>
      </label>
      <label class="field">
        <span>Scope out</span>
        <textarea id="spec-scope-out" rows="5">${escapeHtml(linesToText(stageData.scopeOut))}</textarea>
      </label>
      <label class="field">
        <span>Acceptance criteria</span>
        <textarea id="spec-acceptance" rows="6">${escapeHtml(linesToText(stageData.acceptanceCriteria))}</textarea>
      </label>
      <label class="field field-span">
        <span>Open questions</span>
        <textarea id="spec-questions" rows="5">${escapeHtml(linesToText(stageData.openQuestions))}</textarea>
      </label>
    </div>
  `;
}

function renderWireframeEditor(stageData) {
  return `
    <div class="editor-grid">
      <label class="field field-span">
        <span>Vision</span>
        <textarea id="wireframe-vision" rows="4">${escapeHtml(stageData.vision)}</textarea>
      </label>
      <label class="field">
        <span>Interaction notes</span>
        <textarea id="wireframe-interactions" rows="6">${escapeHtml(linesToText(stageData.interactionNotes))}</textarea>
      </label>
      <label class="field">
        <span>Figma prompt</span>
        <textarea id="wireframe-prompt" rows="6">${escapeHtml(stageData.figmaPrompt)}</textarea>
      </label>
    </div>
    <div class="section-toolbar">
      <h4>Frames</h4>
      <button type="button" class="ghost-button" data-action="add-frame" data-stage="wireframe">Add frame</button>
    </div>
    <div class="stack-list">
      ${stageData.frames
        .map((frame, frameIndex) => renderFrameEditor(frame, frameIndex, stageData.frames.length))
        .join("")}
    </div>
  `;
}

function renderFrameEditor(frame, frameIndex, totalFrames) {
  return `
    <section class="detail-card" data-frame-index="${frameIndex}">
      <div class="subsection-heading">
        <h4>Frame ${frameIndex + 1}</h4>
        <div class="inline-actions">
          <button type="button" class="ghost-button" data-action="add-component" data-stage="wireframe" data-frame-index="${frameIndex}">Add component</button>
          <button type="button" class="ghost-button" data-action="remove-frame" data-stage="wireframe" data-frame-index="${frameIndex}" ${totalFrames <= 1 ? "disabled" : ""}>Remove frame</button>
        </div>
      </div>
      <div class="editor-grid">
        <label class="field">
          <span>Name</span>
          <input data-field="frame-name" value="${escapeHtml(frame.name)}" />
        </label>
        <label class="field field-span">
          <span>Purpose</span>
          <textarea data-field="frame-purpose" rows="3">${escapeHtml(frame.purpose)}</textarea>
        </label>
        <label class="field field-span">
          <span>Layout</span>
          <textarea data-field="frame-layout" rows="3">${escapeHtml(frame.layout)}</textarea>
        </label>
      </div>
      <div class="stack-list compact-stack">
        ${frame.components
          .map(
            (component, componentIndex) =>
              renderComponentEditor(component, frameIndex, componentIndex, frame.components.length)
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderComponentEditor(component, frameIndex, componentIndex, totalComponents) {
  return `
    <section class="nested-card" data-component-index="${componentIndex}">
      <div class="subsection-heading compact-subsection">
        <h4>Component ${componentIndex + 1}</h4>
        <button type="button" class="ghost-button" data-action="remove-component" data-stage="wireframe" data-frame-index="${frameIndex}" data-component-index="${componentIndex}" ${totalComponents <= 1 ? "disabled" : ""}>Remove</button>
      </div>
      <div class="editor-grid">
        <label class="field">
          <span>Component</span>
          <input data-field="component-name" value="${escapeHtml(component.name)}" />
        </label>
        <label class="field field-span">
          <span>Description</span>
          <textarea data-field="component-description" rows="2">${escapeHtml(component.description)}</textarea>
        </label>
        <label class="field field-span">
          <span>Note</span>
          <textarea data-field="component-note" rows="2">${escapeHtml(component.note)}</textarea>
        </label>
      </div>
    </section>
  `;
}

function renderTicketsEditor(stageData) {
  return `
    <div class="section-toolbar">
      <h4>Implementation tickets</h4>
      <button type="button" class="ghost-button" data-action="add-ticket" data-stage="tickets">Add ticket</button>
    </div>
    <div class="stack-list">
      ${stageData.map((ticket, index) => renderTicketEditor(ticket, index, stageData.length)).join("")}
    </div>
  `;
}

function renderTicketEditor(ticket, index, totalTickets) {
  return `
    <section class="detail-card" data-ticket-index="${index}">
      <div class="subsection-heading">
        <h4>Ticket ${index + 1}</h4>
        <button type="button" class="ghost-button" data-action="remove-ticket" data-stage="tickets" data-ticket-index="${index}" ${totalTickets <= 1 ? "disabled" : ""}>Remove ticket</button>
      </div>
      <div class="editor-grid">
        <label class="field">
          <span>Title</span>
          <input data-field="ticket-title" value="${escapeHtml(ticket.title)}" />
        </label>
        <label class="field">
          <span>Owner</span>
          <input data-field="ticket-owner" value="${escapeHtml(ticket.owner)}" />
        </label>
        <label class="field field-span">
          <span>Description</span>
          <textarea data-field="ticket-description" rows="3">${escapeHtml(ticket.description)}</textarea>
        </label>
        <label class="field field-span">
          <span>Definition of done</span>
          <textarea data-field="ticket-dod" rows="5">${escapeHtml(linesToText(ticket.definitionOfDone))}</textarea>
        </label>
      </div>
    </section>
  `;
}

function renderStageHistory(stage) {
  const history = Array.isArray(stage.history) ? stage.history.slice(0, 8) : [];
  if (!history.length) {
    return "";
  }

  return `
    <section class="detail-card">
      <div class="section-toolbar">
        <h4>Version history</h4>
        <span class="subtle-copy">${escapeHtml(`${history.length} recent snapshots`)}</span>
      </div>
      <div class="stack-list compact-stack">
        ${history
          .map(
            (entry, historyIndex) => `
              <article class="history-entry">
                <div class="history-entry-top">
                  <div>
                    <strong>v${escapeHtml(String(entry.version || 0))}</strong>
                    ${renderStatusChip(entry.kind || "draft")}
                  </div>
                  <span class="subtle-copy">${escapeHtml(timeLabel(entry.at))}</span>
                </div>
                <p>${escapeHtml(entry.summary || "Snapshot saved.")}</p>
                ${
                  entry.draft || entry.approved
                    ? `<button type="button" class="ghost-button" data-action="load-history-snapshot" data-stage="${stage.key}" data-history-index="${historyIndex}">Load snapshot</button>`
                    : ""
                }
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderCodexEditor(stageData) {
  return `
    <div class="editor-grid">
      <label class="field field-span">
        <span>Objective</span>
        <textarea id="codex-objective" rows="4">${escapeHtml(stageData.objective)}</textarea>
      </label>
      <label class="field">
        <span>Architecture notes</span>
        <textarea id="codex-architecture" rows="6">${escapeHtml(linesToText(stageData.architectureNotes))}</textarea>
      </label>
      <label class="field">
        <span>First tasks</span>
        <textarea id="codex-first-tasks" rows="6">${escapeHtml(linesToText(stageData.firstTasks))}</textarea>
      </label>
      <label class="field field-span">
        <span>Codex prompt</span>
        <textarea id="codex-prompt" rows="18">${escapeHtml(stageData.prompt)}</textarea>
      </label>
    </div>
    <section class="detail-card">
      <h4>Streaming kickoff</h4>
      <div class="code-block">${escapeHtml(stageData.commandPreview)}</div>
    </section>
  `;
}

function renderEvidenceCard(workflow) {
  const opportunity = preferredStageData(workflow, "opportunity");
  return `
    <article class="result-card">
      <h3>Evidence</h3>
      ${
        opportunity?.evidence?.length
          ? `<ul class="list">${opportunity.evidence
              .map(
                (item) =>
                  `<li><strong>${escapeHtml(item.title)}</strong> <span>(${escapeHtml(item.source)})</span>: ${escapeHtml(item.detail)}</li>`
              )
              .join("")}</ul>`
          : "<p>No evidence has been synthesized yet.</p>"
      }
    </article>
  `;
}

function renderArtifactsCard(workflow) {
  return `
    <article class="result-card">
      <h3>Artifacts</h3>
      <div class="artifact-list">
        ${(workflow.artifacts || []).map(renderArtifact).join("")}
      </div>
    </article>
  `;
}

function renderHistoryCard(workflow) {
  return `
    <article class="result-card">
      <h3>Audit history</h3>
      <ul class="list history-list">
        ${(workflow.events || [])
          .slice()
          .reverse()
          .map((event) => `<li><strong>${escapeHtml(timeLabel(event.at))}</strong>: ${escapeHtml(event.message)}</li>`)
          .join("")}
      </ul>
    </article>
  `;
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

function renderArtifact(artifact) {
  return `
    <section class="artifact-row">
      <div>
        <strong>${escapeHtml(artifact.name)}</strong>
        <p>${escapeHtml(artifact.path)}</p>
      </div>
      <a href="${escapeHtml(artifact.url)}" target="_blank" rel="noreferrer">Open</a>
    </section>
  `;
}

function preferredStageData(workflow, stageKey) {
  const stage = workflow?.stages?.[stageKey];
  return stage?.approved || stage?.draft || null;
}

function firstOpenStage(workflow) {
  return STAGE_ORDER.map((stageKey) => workflow?.stages?.[stageKey]).find((stage) => stage?.status !== "approved") || null;
}

function renderScore(label, value) {
  return `<span class="score-chip">${escapeHtml(label)} ${escapeHtml(String(value))}/10</span>`;
}

function renderMetaPill(text) {
  return `<span class="meta-pill">${text}</span>`;
}

function renderStatusChip(status) {
  return `<span class="status-chip status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}
