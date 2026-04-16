import { SAMPLE_DATASETS, STAGE_ORDER } from "./config.js";
import { apiJson, subscribeToJobStream } from "./api.js";
import {
  applySampleData,
  cloneStageData,
  collectStageDraft,
  defaultComponentDraft,
  defaultFrameDraft,
  defaultTicketDraft,
  getFormPayload,
  labelForTarget
} from "./drafts.js";
import { cloneJson } from "./utils.js";
import { renderCodeViewer, renderCodexJob, renderRunMeta, renderWorkflowShell } from "./render.js";

const BUILD_PACK_STAGES = ["spec", "wireframe", "tickets", "codex"];

export function bootPmApp(doc = document) {
  const dom = getDom(doc);
  const state = createState();

  syncLayoutState(dom, state);
  bindFileImports(doc, dom.statusBanner);
  bindTopLevelActions(doc, dom, state);
  bindWorkflowActions(dom, state);

  applySampleData(doc, dom.samplePreset.value);
  void loadHealth(dom, state);
}

function createState() {
  return {
    health: null,
    workflow: null,
    activeStage: "opportunity",
    screen: "intake",
    lastWorkflowScreen: "recommendation",
    latestPrompt: "",
    jobStream: null,
    codexView: {
      jobId: "",
      selectedPath: "",
      outputText: "",
      files: [],
      connection: "idle"
    }
  };
}

function getDom(doc) {
  return {
    doc,
    workspace: doc.querySelector("#workspace"),
    form: doc.querySelector("#pm-form"),
    workflowPanel: doc.querySelector("#workflow-panel"),
    emptyState: doc.querySelector("#empty-state"),
    results: doc.querySelector("#results"),
    statusBanner: doc.querySelector("#status-banner"),
    modeHint: doc.querySelector("#mode-hint"),
    runMeta: doc.querySelector("#run-meta"),
    samplePreset: doc.querySelector("#samplePreset"),
    sampleButton: doc.querySelector("#sample-button"),
    resumeWorkflowButton: doc.querySelector("#resume-workflow-button"),
    clearButton: doc.querySelector("#clear-button"),
    runButton: doc.querySelector("#run-button")
  };
}

function bindFileImports(doc, statusBanner) {
  doc.querySelectorAll('input[type="file"][data-target]').forEach((input) => {
    input.addEventListener("change", async (event) => {
      const targetId = event.target.dataset.target;
      const files = Array.from(event.target.files || []);
      if (!files.length) {
        return;
      }

      const contents = await Promise.all(
        files.map(async (file) => `\n\n[${file.name}]\n${await file.text()}`)
      );

      const target = doc.querySelector(`#${targetId}`);
      target.value = `${target.value}${contents.join("")}`.trim();
      event.target.value = "";
      showBanner(
        statusBanner,
        `Imported ${files.length} file${files.length === 1 ? "" : "s"} into ${labelForTarget(targetId)}.`,
        false
      );
    });
  });
}

function bindTopLevelActions(doc, dom, state) {
  dom.sampleButton.addEventListener("click", () => {
    applySampleData(doc, dom.samplePreset.value);
    showBanner(dom.statusBanner, `Loaded the ${SAMPLE_DATASETS[dom.samplePreset.value].label} preset.`, false);
  });

  dom.resumeWorkflowButton.addEventListener("click", () => {
    if (!state.workflow) {
      return;
    }
    state.screen = state.lastWorkflowScreen || "recommendation";
    renderWorkflow(dom, state, state.workflow);
  });

  dom.clearButton.addEventListener("click", () => {
    dom.form.reset();
    if (state.health?.suggestedCodexWorkspace) {
      doc.querySelector("#codexWorkspacePath").value = state.health.suggestedCodexWorkspace;
    }
    showBanner(dom.statusBanner, "Cleared the form.", false);
  });

  dom.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setLoading(dom, true);
    disconnectJobStream(state);

    try {
      const workflow = await apiJson("/api/workflows", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(getFormPayload(doc))
      });

      state.activeStage = "opportunity";
      state.screen = "recommendation";
      renderWorkflow(dom, state, workflow);
      showBanner(dom.statusBanner, "Workflow created. Review and approve the opportunity before moving downstream.", false);
    } catch (error) {
      showBanner(dom.statusBanner, error.message, true);
    } finally {
      setLoading(dom, false);
    }
  });
}

function bindWorkflowActions(dom, state) {
  dom.results.addEventListener("click", async (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget || !state.workflow) {
      return;
    }

    const action = actionTarget.dataset.action;
    const stageKey = actionTarget.dataset.stage || state.activeStage;

    try {
      if (action === "open-screen") {
        state.screen = actionTarget.dataset.screen || state.screen;
        normalizeScreenState(state);
        renderWorkflow(dom, state, state.workflow);
        return;
      }

      if (action === "open-intake") {
        state.lastWorkflowScreen = state.screen;
        state.screen = "intake";
        syncLayoutState(dom, state);
        return;
      }

      if (action === "open-stage") {
        state.activeStage = stageKey;
        state.screen = screenForStage(stageKey);
        normalizeScreenState(state);
        renderWorkflow(dom, state, state.workflow);
        return;
      }

      if (action === "select-code-file") {
        state.codexView.selectedPath = actionTarget.dataset.path || "";
        state.screen = "live-build";
        renderLiveCodexPanels(dom, state);
        return;
      }

      if (action === "add-frame") {
        const draft = collectStageDraft(dom.results, state.workflow, "wireframe") || cloneStageData(state.workflow, "wireframe");
        draft.frames.push(defaultFrameDraft(draft.frames.length + 1));
        const workflow = await persistStageDraft(state, "wireframe", draft);
        state.activeStage = "wireframe";
        renderWorkflow(dom, state, workflow);
        showBanner(dom.statusBanner, "Added a wireframe frame.", false);
        return;
      }

      if (action === "remove-frame") {
        const frameIndex = Number(actionTarget.dataset.frameIndex);
        const draft = collectStageDraft(dom.results, state.workflow, "wireframe") || cloneStageData(state.workflow, "wireframe");
        if (draft.frames.length <= 1) {
          throw new Error("Keep at least one frame in the wireframe stage.");
        }
        draft.frames.splice(frameIndex, 1);
        const workflow = await persistStageDraft(state, "wireframe", draft);
        state.activeStage = "wireframe";
        renderWorkflow(dom, state, workflow);
        showBanner(dom.statusBanner, "Removed the frame.", false);
        return;
      }

      if (action === "add-component") {
        const frameIndex = Number(actionTarget.dataset.frameIndex);
        const draft = collectStageDraft(dom.results, state.workflow, "wireframe") || cloneStageData(state.workflow, "wireframe");
        draft.frames[frameIndex].components.push(defaultComponentDraft());
        const workflow = await persistStageDraft(state, "wireframe", draft);
        state.activeStage = "wireframe";
        renderWorkflow(dom, state, workflow);
        showBanner(dom.statusBanner, "Added a component to the frame.", false);
        return;
      }

      if (action === "remove-component") {
        const frameIndex = Number(actionTarget.dataset.frameIndex);
        const componentIndex = Number(actionTarget.dataset.componentIndex);
        const draft = collectStageDraft(dom.results, state.workflow, "wireframe") || cloneStageData(state.workflow, "wireframe");
        if (draft.frames[frameIndex].components.length <= 1) {
          throw new Error("Keep at least one component in each frame.");
        }
        draft.frames[frameIndex].components.splice(componentIndex, 1);
        const workflow = await persistStageDraft(state, "wireframe", draft);
        state.activeStage = "wireframe";
        renderWorkflow(dom, state, workflow);
        showBanner(dom.statusBanner, "Removed the component.", false);
        return;
      }

      if (action === "add-ticket") {
        const draft = collectStageDraft(dom.results, state.workflow, "tickets") || cloneStageData(state.workflow, "tickets");
        draft.push(defaultTicketDraft(draft.length + 1));
        const workflow = await persistStageDraft(state, "tickets", draft);
        state.activeStage = "tickets";
        renderWorkflow(dom, state, workflow);
        showBanner(dom.statusBanner, "Added a ticket.", false);
        return;
      }

      if (action === "remove-ticket") {
        const ticketIndex = Number(actionTarget.dataset.ticketIndex);
        const draft = collectStageDraft(dom.results, state.workflow, "tickets") || cloneStageData(state.workflow, "tickets");
        if (draft.length <= 1) {
          throw new Error("Keep at least one implementation ticket.");
        }
        draft.splice(ticketIndex, 1);
        const workflow = await persistStageDraft(state, "tickets", draft);
        state.activeStage = "tickets";
        renderWorkflow(dom, state, workflow);
        showBanner(dom.statusBanner, "Removed the ticket.", false);
        return;
      }

      if (action === "load-history-snapshot") {
        const historyIndex = Number(actionTarget.dataset.historyIndex);
        const historyEntry = state.workflow.stages[stageKey]?.history?.[historyIndex];
        const snapshot = cloneJson(historyEntry?.approved || historyEntry?.draft);
        if (!snapshot) {
          throw new Error("This history entry does not contain a reusable snapshot.");
        }
        const workflow = await persistStageDraft(state, stageKey, snapshot);
        state.activeStage = stageKey;
        renderWorkflow(dom, state, workflow);
        showBanner(dom.statusBanner, `Loaded ${state.workflow.stages[stageKey].label} from version history.`, false);
        return;
      }

      if (action === "generate-stage") {
        setStageBusy(dom, stageKey, true);
        const workflow = await apiJson(
          `/api/workflows/${encodeURIComponent(state.workflow.workflowId)}/stages/${encodeURIComponent(stageKey)}/generate`,
          { method: "POST" }
        );
        state.activeStage = stageKey;
        state.screen = screenForStage(stageKey);
        renderWorkflow(dom, state, workflow);
        showBanner(dom.statusBanner, `${workflow.stages[stageKey].label} draft generated.`, false);
        return;
      }

      if (action === "save-stage") {
        const workflow = await persistCurrentStageDraft(dom, state, stageKey);
        renderWorkflow(dom, state, workflow);
        showBanner(dom.statusBanner, `${workflow.stages[stageKey].label} draft saved.`, false);
        return;
      }

      if (action === "approve-stage") {
        await persistCurrentStageDraft(dom, state, stageKey);
        const workflow = await apiJson(
          `/api/workflows/${encodeURIComponent(state.workflow.workflowId)}/stages/${encodeURIComponent(stageKey)}/approve`,
          { method: "POST" }
        );
        state.activeStage = nextStageKey(stageKey) || stageKey;
        state.screen = screenAfterApproval(stageKey, workflow);
        renderWorkflow(dom, state, workflow);
        showBanner(dom.statusBanner, `${workflow.stages[stageKey].label} approved.`, false);
        return;
      }

      if (action === "launch-codex") {
        const codexStage = state.workflow?.stages?.codex;
        if (!codexStage?.approved || codexStage.stale) {
          showBanner(
            dom.statusBanner,
            codexStage?.stale
              ? "Regenerate and re-approve the Codex stage before launching implementation."
              : "Approve the Codex kickoff stage before launching implementation.",
            true
          );
          return;
        }

        if (state.activeStage === "codex") {
          await persistCurrentStageDraft(dom, state, "codex");
        }
        const workflow = await apiJson(
          `/api/workflows/${encodeURIComponent(state.workflow.workflowId)}/codex/run`,
          { method: "POST" }
        );
        state.screen = "live-build";
        state.activeStage = "codex";
        renderWorkflow(dom, state, workflow);
        showBanner(dom.statusBanner, "Codex kickoff launched.", false);
        return;
      }

      if (action === "copy-prompt") {
        await navigator.clipboard.writeText(state.latestPrompt);
        showBanner(dom.statusBanner, "Copied the approved Codex prompt.", false);
      }
    } catch (error) {
      showBanner(dom.statusBanner, error.message, true);
    } finally {
      setStageBusy(dom, stageKey, false);
    }
  });
}

async function loadHealth(dom, state) {
  try {
    const data = await apiJson("/api/health");
    state.health = data;
    dom.modeHint.textContent =
      data.mode === "openai"
        ? `Live OpenAI mode is active with ${data.defaultOpenAiModel}.`
        : "Demo mode is active. Add OPENAI_API_KEY for live synthesis.";

    const workspaceInput = dom.doc.querySelector("#codexWorkspacePath");
    if (!workspaceInput.value) {
      workspaceInput.value = data.suggestedCodexWorkspace;
    }
  } catch (error) {
    dom.modeHint.textContent = "Runtime check failed. The app can still run locally if the server is healthy.";
  }
}

function renderWorkflow(dom, state, workflow) {
  state.workflow = workflow;
  state.latestPrompt = workflow?.stages?.codex?.approved?.prompt || workflow?.stages?.codex?.draft?.prompt || "";
  normalizeScreenState(state);
  if (state.screen !== "intake") {
    state.lastWorkflowScreen = state.screen;
  }
  syncCodexView(state, workflow.codexJob);
  syncLayoutState(dom, state);
  dom.emptyState.classList.add("hidden");
  dom.results.classList.remove("hidden");
  dom.runMeta.innerHTML = renderRunMeta(workflow, state.activeStage);
  dom.results.innerHTML = renderWorkflowShell(state);
  trackJobStream(dom, state, workflow.codexJob);
}

function renderLiveCodexPanels(dom, state) {
  const jobCard = dom.doc.querySelector("#codex-job-card");
  if (jobCard) {
    jobCard.innerHTML = renderCodexJob(state.workflow?.codexJob);
  }

  const viewerCard = dom.doc.querySelector("#code-viewer-card");
  if (viewerCard) {
    viewerCard.outerHTML = renderCodeViewer(state.workflow?.codexJob, state.codexView);
  }
}

function syncCodexView(state, job) {
  if (!job?.id) {
    state.codexView = {
      jobId: "",
      selectedPath: "",
      outputText: "",
      files: [],
      connection: "idle"
    };
    return;
  }

  state.codexView.jobId = job.id;
  state.codexView.outputText = job.outputText || "";
  state.codexView.files = Array.isArray(job.files) ? job.files : [];
  state.codexView.connection = job.status === "running" ? "streaming" : job.status;

  if (!state.codexView.files.some((file) => file.path === state.codexView.selectedPath)) {
    state.codexView.selectedPath = state.codexView.files[0]?.path || "";
  }
}

function trackJobStream(dom, state, job) {
  if (!job?.id || job.status !== "running") {
    disconnectJobStream(state);
    return;
  }

  if (state.jobStream && state.codexView.jobId === job.id) {
    return;
  }

  disconnectJobStream(state);
  state.codexView.connection = "connecting";

  state.jobStream = subscribeToJobStream(job.id, {
    onSnapshot: (snapshot) => updateLiveJob(dom, state, snapshot),
    onUpdate: (snapshot) => updateLiveJob(dom, state, snapshot),
    onDelta: (payload) => updateLiveJobDelta(dom, state, payload),
    onDone: (snapshot) => {
      updateLiveJob(dom, state, snapshot);
      disconnectJobStream(state);
      void refreshWorkflow(dom, state);
    },
    onFailed: (snapshot) => {
      updateLiveJob(dom, state, snapshot);
      disconnectJobStream(state);
      void refreshWorkflow(dom, state);
    },
    onError: () => {
      state.codexView.connection = "reconnecting";
      renderLiveCodexPanels(dom, state);
    }
  });
}

function disconnectJobStream(state) {
  if (state.jobStream) {
    state.jobStream.close();
    state.jobStream = null;
  }
}

function syncLayoutState(dom, state) {
  const intakeMode = state.screen === "intake" || !state.workflow;
  dom.workspace.classList.toggle("mode-intake", intakeMode);
  dom.workspace.classList.toggle("mode-workflow", !intakeMode);
  dom.form.classList.toggle("hidden", !intakeMode);
  dom.workflowPanel.classList.toggle("hidden", intakeMode);
  dom.resumeWorkflowButton.classList.toggle("hidden", !state.workflow || !intakeMode);
}

function updateLiveJob(dom, state, job) {
  if (!state.workflow || !job) {
    return;
  }

  state.workflow.codexJob = job;
  syncCodexView(state, job);
  renderLiveCodexPanels(dom, state);
}

function updateLiveJobDelta(dom, state, payload) {
  if (!state.workflow?.codexJob || !payload) {
    return;
  }

  const job = state.workflow.codexJob;
  job.outputText = `${job.outputText || ""}${payload.delta || ""}`;
  job.files = Array.isArray(payload.files) ? payload.files : job.files || [];
  job.tail = Array.isArray(payload.tail) ? payload.tail : job.tail || [];
  job.status = "running";

  syncCodexView(state, job);
  renderLiveCodexPanels(dom, state);
}

async function refreshWorkflow(dom, state) {
  if (!state.workflow?.workflowId) {
    return;
  }

  try {
    const workflow = await apiJson(`/api/workflows/${encodeURIComponent(state.workflow.workflowId)}`);
    renderWorkflow(dom, state, workflow);
  } catch (error) {
    return;
  }
}

async function persistCurrentStageDraft(dom, state, stageKey) {
  const draft = collectStageDraft(dom.results, state.workflow, stageKey);
  return persistStageDraft(state, stageKey, draft);
}

async function persistStageDraft(state, stageKey, draftOverride) {
  const draft = draftOverride || collectStageDraft(document.querySelector("#results"), state.workflow, stageKey);
  if (!draft) {
    return state.workflow;
  }

  const workflow = await apiJson(
    `/api/workflows/${encodeURIComponent(state.workflow.workflowId)}/stages/${encodeURIComponent(stageKey)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ draft })
    }
  );
  state.workflow = workflow;
  return workflow;
}

function setLoading(dom, loading) {
  dom.runButton.disabled = loading;
  dom.runButton.textContent = loading ? "Starting..." : "Start workflow";
}

function setStageBusy(dom, stageKey, busy) {
  dom.results.querySelectorAll(`[data-stage="${stageKey}"]`).forEach((element) => {
    if (element.tagName === "BUTTON") {
      element.disabled = busy;
    }
  });
}

function nextStageKey(stageKey) {
  const index = STAGE_ORDER.indexOf(stageKey);
  return index >= 0 ? STAGE_ORDER[index + 1] || null : null;
}

function normalizeScreenState(state) {
  if (!state.workflow) {
    state.screen = "intake";
    state.activeStage = "opportunity";
    return;
  }

  if (state.screen === "recommendation") {
    state.activeStage = "opportunity";
    return;
  }

  if (state.screen === "build-pack") {
    if (!BUILD_PACK_STAGES.includes(state.activeStage)) {
      state.activeStage = firstBuildPackStage(state.workflow);
    }
    return;
  }

  if (state.screen === "live-build") {
    state.activeStage = "codex";
    return;
  }

  state.screen = screenForStage(state.activeStage);
}

function firstBuildPackStage(workflow) {
  return (
    BUILD_PACK_STAGES.find((stageKey) => workflow?.stages?.[stageKey]?.status !== "approved") ||
    BUILD_PACK_STAGES[0]
  );
}

function screenForStage(stageKey) {
  return stageKey === "opportunity" ? "recommendation" : "build-pack";
}

function screenAfterApproval(stageKey, workflow) {
  if (stageKey === "opportunity") {
    return "build-pack";
  }

  if (stageKey === "codex" && workflow?.codexJob?.id) {
    return "live-build";
  }

  return screenForStage(nextStageKey(stageKey) || stageKey);
}

function showBanner(statusBanner, message, isError) {
  statusBanner.classList.remove("hidden");
  statusBanner.style.background = isError
    ? "rgba(166, 51, 37, 0.12)"
    : "rgba(208, 92, 46, 0.12)";
  statusBanner.style.borderColor = isError
    ? "rgba(166, 51, 37, 0.2)"
    : "rgba(208, 92, 46, 0.18)";
  statusBanner.textContent = message;
}
