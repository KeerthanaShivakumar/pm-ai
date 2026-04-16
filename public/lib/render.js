import { STAGE_ORDER } from "./config.js";
import { escapeHtml, linesToText, timeLabel } from "./utils.js";

const BUILD_PACK_STAGES = ["spec", "wireframe", "tickets", "codex"];
const LIVE_STREAM_TAB = "__live_stream__";
const WORKFLOW_SCREENS = [
  {
    key: "recommendation",
    label: "Recommendation",
    description: "Choose what to build next"
  },
  {
    key: "build-pack",
    label: "Build Pack",
    description: "Review the execution assets"
  },
  {
    key: "live-build",
    label: "Live Build",
    description: "Watch the first code stream back"
  }
];

export function renderWorkflowShell(appState) {
  const workflow = appState.workflow;
  const opportunity = preferredStageData(workflow, "opportunity");
  const warningsHtml = Array.isArray(workflow?.warnings) && workflow.warnings.length
    ? `<ul class="warning-list">${workflow.warnings
        .map((warning) => `<li>${escapeHtml(warning)}</li>`)
        .join("")}</ul>`
    : "";

  return `
    <article class="result-card workflow-frame">
      <div class="section-toolbar">
        <div>
          <p class="eyebrow">Workflow</p>
          <h3>${escapeHtml(opportunity?.recommendedFeature?.title || "Recommendation pending")}</h3>
          <p>${escapeHtml(opportunity?.executiveSummary || "Start with the opportunity stage.")}</p>
        </div>
        <div class="inline-actions">
          <button type="button" class="ghost-button" data-action="open-intake">New intake</button>
        </div>
      </div>
      ${warningsHtml}
      <div class="screen-tabs">
        ${WORKFLOW_SCREENS.map((screen) => renderScreenTab(workflow, appState, screen)).join("")}
      </div>
    </article>
    ${renderWorkflowScreen(workflow, appState)}
  `;
}

function renderWorkflowScreen(workflow, appState) {
  if (appState.screen === "live-build") {
    return `
      <div class="screen-grid screen-grid-live">
        <section class="screen-main">
          ${renderLiveBuildPrimary(workflow, appState)}
        </section>
        <aside class="screen-aside">
          <article class="result-card" id="codex-job-card">
            ${renderCodexJob(workflow?.codexJob)}
          </article>
          ${renderArtifactsCard(workflow)}
          ${renderHistoryCard(workflow)}
        </aside>
      </div>
    `;
  }

  if (appState.screen === "build-pack") {
    const stageKey = BUILD_PACK_STAGES.includes(appState.activeStage) ? appState.activeStage : firstBuildPackStage(workflow);
    return `
	      <div class="screen-grid screen-grid-build">
	        <section class="screen-main">
          <article class="result-card">
            <div class="section-toolbar">
              <div>
                <p class="eyebrow">Build Pack</p>
                <h3>Review each asset as its own screen</h3>
              </div>
              <p class="subtle-copy">Approve the spec, wireframe, tickets, and Codex brief in sequence.</p>
            </div>
            <div class="build-stage-tabs">
              ${BUILD_PACK_STAGES.map((buildStageKey) => renderBuildStageTab(workflow, appState, buildStageKey)).join("")}
            </div>
          </article>
	          ${renderStageCard(workflow, stageKey, appState)}
	        </section>
        <aside class="screen-aside">
          ${renderStageProgressCard(workflow, appState)}
          ${renderArtifactsCard(workflow)}
          ${renderHistoryCard(workflow)}
        </aside>
      </div>
    `;
  }

  return `
    <div class="screen-grid screen-grid-recommendation">
      <section class="screen-main">
	        ${renderStageCard(workflow, "opportunity", appState)}
      </section>
      <aside class="screen-aside">
        ${renderStageProgressCard(workflow, appState)}
        ${renderHistoryCard(workflow)}
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

function renderScreenTab(workflow, appState, screen) {
  return `
    <button
      type="button"
      class="screen-tab ${screen.key === appState.screen ? "active" : ""}"
      data-action="open-screen"
      data-screen="${screen.key}"
    >
      <strong>${escapeHtml(screen.label)}</strong>
      <span>${escapeHtml(screen.description)}</span>
      ${renderStatusChip(screenStatus(workflow, screen.key))}
    </button>
  `;
}

function renderBuildStageTab(workflow, appState, stageKey) {
  const stage = workflow.stages[stageKey];
  return `
    <button
      type="button"
      class="build-stage-tab ${stageKey === appState.activeStage ? "active" : ""}"
      data-action="open-stage"
      data-stage="${stageKey}"
    >
      <strong>${escapeHtml(stage.label)}</strong>
      ${renderStatusChip(stage.status)}
    </button>
  `;
}

function renderStageProgressCard(workflow, appState) {
  return `
    <article class="result-card">
      <div class="section-toolbar">
        <h3>Pipeline</h3>
        <span class="subtle-copy">${escapeHtml(`${approvedStageCount(workflow)}/${STAGE_ORDER.length} approved`)}</span>
      </div>
      <div class="stage-list compact-stage-list">
        ${STAGE_ORDER.map((stageKey) => renderStageNav(workflow, appState, stageKey)).join("")}
      </div>
    </article>
  `;
}

function renderLiveBuildPrimary(workflow, appState) {
  const codexStage = workflow?.stages?.codex;
  const codexReady = Boolean(codexStage?.approved) && !codexStage?.stale;
  const autoLaunchEnabled = isCodexAutoLaunchEnabled(workflow, appState);

  if (!workflow?.codexJob?.id) {
    return `
      <article class="result-card launchpad-card">
        <div class="section-toolbar">
          <div>
            <p class="eyebrow">Live Build</p>
            <h3>${escapeHtml(codexReady ? "Ready to start implementation" : "Codex is not ready yet")}</h3>
          </div>
          ${renderStatusChip(codexReady ? "ready" : screenStatus(workflow, "live-build"))}
        </div>
	        <p>
	          ${
	            codexReady
	              ? autoLaunchEnabled
	                ? "Auto-launch is enabled. Approving the final Codex brief starts implementation without a manual launch step."
	                : "The approved Codex brief is ready. Launch this screen when you want the implementation stream to take over the UI."
	              : "Finish the build-pack approvals first. The live build screen stays focused on implementation output, not authoring."
	          }
	        </p>
	        <div class="inline-actions">
	          ${
	            codexReady && !autoLaunchEnabled
	              ? `<button type="button" class="primary-button secondary-tone" data-action="launch-codex" data-stage="codex">Launch Codex</button>`
	              : `<button type="button" class="ghost-button" data-action="open-screen" data-screen="build-pack">Open build pack</button>`
	          }
	        </div>
      </article>
    `;
  }

  return renderCodeViewer(workflow.codexJob, appState.codexView);
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
    ${job.completionMessage ? `<p class="subtle-copy">${escapeHtml(job.completionMessage)}</p>` : ""}
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
  const selectedPath = normalizeSelectedViewerPath(job, codexView, files);
  const selectedFile = selectedPath === LIVE_STREAM_TAB
    ? null
    : files.find((file) => file.path === selectedPath) || files[0] || null;
  const rawOutput = codexView?.outputText || job.outputText || "";
  const viewerContent = selectedFile?.content || rawOutput || "Waiting for streamed output...";
  const fileSignature = buildFileSignature(files);
  const fileCountLabel = files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "streaming raw output";

  return `
    <article
      class="result-card code-viewer-card"
      id="code-viewer-card"
      data-mode="${escapeHtml(files.length ? "files" : "raw")}"
      data-file-signature="${escapeHtml(fileSignature)}"
      data-selected-path="${escapeHtml(selectedPath)}"
    >
      <div class="section-toolbar">
        <div>
          <h3>Live code viewer</h3>
          <p class="subtle-copy">Streaming from ${escapeHtml(job.model)} into the workflow UI.</p>
        </div>
        <div class="stage-meta">
          ${renderStatusChip(job.status)}
          <span class="meta-pill" data-role="file-count">${escapeHtml(fileCountLabel)}</span>
        </div>
      </div>
      ${
        files.length
          ? `
            <div class="code-viewer-shell">
              <div class="code-file-list" data-role="code-file-list">
                <button
                  type="button"
                  class="code-file-tab ${selectedPath === LIVE_STREAM_TAB ? "active" : ""}"
                  data-action="select-code-file"
                  data-path="${LIVE_STREAM_TAB}"
                >
                  Live stream
                </button>
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
                  <span data-role="code-primary-meta">${escapeHtml(selectedFile?.path || "Raw stream")}</span>
                  <span data-role="code-secondary-meta">${escapeHtml(selectedFile?.language || job.model)}</span>
                </div>
                <pre class="code-pane" data-role="code-pane">${escapeHtml(viewerContent)}</pre>
              </div>
            </div>
          `
          : `
            <div class="code-pane-shell raw-only">
              <div class="code-pane-meta">
                <span data-role="code-primary-meta">Raw stream</span>
                <span data-role="code-secondary-meta">${escapeHtml(job.model)}</span>
              </div>
              <pre class="code-pane" data-role="code-pane">${escapeHtml(viewerContent)}</pre>
            </div>
          `
      }
      ${
        rawOutput && selectedFile
          ? `
            <details class="stream-raw">
              <summary>Raw stream</summary>
              <pre class="job-log" data-role="raw-stream-log">${escapeHtml(rawOutput)}</pre>
            </details>
          `
          : ""
      }
    </article>
  `;
}

function normalizeSelectedViewerPath(job, codexView, files) {
  const selectedPath = codexView?.selectedPath || "";
  if (!selectedPath) {
    return job?.status === "running" ? LIVE_STREAM_TAB : files[0]?.path || LIVE_STREAM_TAB;
  }
  if (selectedPath === LIVE_STREAM_TAB) {
    return LIVE_STREAM_TAB;
  }
  return files.some((file) => file.path === selectedPath)
    ? selectedPath
    : job?.status === "running"
      ? LIVE_STREAM_TAB
      : files[0]?.path || LIVE_STREAM_TAB;
}

function buildFileSignature(files) {
  return files.map((file) => `${file.path}:${file.language || ""}`).join("|");
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

function renderStageCard(workflow, stageKey, appState) {
  const stage = workflow.stages[stageKey];
  const stageData = stage.draft || stage.approved;
  const autoLaunchEnabled = stageKey === "codex" && isCodexAutoLaunchEnabled(workflow, appState);
  const blockedText = stage.blockedBy.length
    ? `Approve ${stage.blockedBy.map((stageKey) => workflow.stages[stageKey]?.label || stageKey).join(", ")} before generating this stage.`
    : "";
  const staleNote = stage.stale
    ? `<p class="stage-note stale-note">${escapeHtml(stageStaleNote(stageKey))}</p>`
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
                  ? `<button type="button" class="primary-button" data-action="generate-stage" data-stage="${stageKey}">Generate ${escapeHtml(stage.label)}</button>`
                  : ""
              }
            </div>
          `
          : `
	            <div class="stage-actions">
	              <button type="button" class="ghost-button" data-action="save-stage" data-stage="${stageKey}">Save draft</button>
	              ${renderStageRefreshAction(stageKey, stage)}
	              <button type="button" class="primary-button" data-action="approve-stage" data-stage="${stageKey}">${escapeHtml(autoLaunchEnabled ? `Approve and auto-launch ${stage.label}` : `Approve ${stage.label}`)}</button>
	              ${
	                stageKey === "codex" && stage.approved && !stage.stale && !autoLaunchEnabled
	                  ? `<button type="button" class="primary-button secondary-tone" data-action="launch-codex" data-stage="codex">Launch Codex</button>`
	                  : ""
	              }
              ${
                stageKey === "codex" && stage.approved?.prompt
	                  ? `<button type="button" class="ghost-button" data-action="copy-prompt" data-stage="codex">Copy prompt</button>`
	                  : ""
	              }
	            </div>
	            ${
	              autoLaunchEnabled
	                ? `<p class="stage-note">Auto-launch is enabled for this workflow. Approving this stage starts live code generation automatically.</p>`
	                : ""
	            }
	            ${renderStageEditor(stageKey, stageData)}
	            ${renderStageHistory(stage)}
	          `
	      }
	    </article>
	  `;
}

function isCodexAutoLaunchEnabled(workflow, appState) {
  return Boolean(
    workflow?.input?.runCodex &&
      appState?.health?.codexAutoRunEnabled &&
      appState?.health?.mode === "openai"
  );
}

function renderStageRefreshAction(stageKey, stage) {
  if (stageKey === "opportunity") {
    return `<button type="button" class="ghost-button" data-action="generate-stage" data-stage="${stageKey}">Regenerate</button>`;
  }

  if (stage.stale) {
    return `<button type="button" class="ghost-button" data-action="generate-stage" data-stage="${stageKey}">Refresh from approvals</button>`;
  }

  return "";
}

function stageStaleNote(stageKey) {
  if (stageKey === "opportunity") {
    return "The recommendation changed. Regenerate or edit this draft before approving it.";
  }

  return "Upstream approvals changed. Refresh this draft from the approved inputs or edit it before relying on it downstream.";
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

function firstBuildPackStage(workflow) {
  return (
    BUILD_PACK_STAGES.find((stageKey) => workflow?.stages?.[stageKey]?.status !== "approved") ||
    BUILD_PACK_STAGES[0]
  );
}

function approvedStageCount(workflow) {
  return STAGE_ORDER.filter((stageKey) => workflow?.stages?.[stageKey]?.status === "approved").length;
}

function screenStatus(workflow, screenKey) {
  if (screenKey === "recommendation") {
    return workflow?.stages?.opportunity?.status || "ready";
  }

  if (screenKey === "live-build") {
    if (workflow?.codexJob?.id) {
      return workflow.codexJob.status;
    }
    return workflow?.stages?.codex?.approved ? "ready" : workflow?.stages?.codex?.status || "blocked";
  }

  const statuses = BUILD_PACK_STAGES.map((stageKey) => workflow?.stages?.[stageKey]?.status);
  if (statuses.every((status) => status === "approved")) {
    return "approved";
  }
  if (statuses.includes("stale")) {
    return "stale";
  }
  if (statuses.includes("draft")) {
    return "draft";
  }
  if (statuses.includes("blocked")) {
    return "blocked";
  }
  return "ready";
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
