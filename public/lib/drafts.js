import { SAMPLE_DATASETS } from "./config.js";
import { cloneJson, textLines } from "./utils.js";

export function applySampleData(doc, presetKey) {
  const preset = SAMPLE_DATASETS[presetKey] || SAMPLE_DATASETS["pm-ai"];
  Object.entries(preset.data).forEach(([key, value]) => {
    const target = doc.querySelector(`#${key}`);
    if (target) {
      target.value = value;
    }
  });
}

export function getFormPayload(doc) {
  return {
    productName: fieldValue(doc, "productName"),
    targetUsers: fieldValue(doc, "targetUsers"),
    productContext: fieldValue(doc, "productContext"),
    interviews: fieldValue(doc, "interviews"),
    feedback: fieldValue(doc, "feedback"),
    usageData: fieldValue(doc, "usageData"),
    implementationNotes: fieldValue(doc, "implementationNotes"),
    codexWorkspacePath: fieldValue(doc, "codexWorkspacePath")
  };
}

export function collectStageDraft(resultsRoot, workflow, stageKey) {
  const stage = workflow?.stages?.[stageKey];
  const stageData = stage?.draft || stage?.approved;
  if (!stageData) {
    return null;
  }

  if (stageKey === "opportunity") {
    return {
      ...stageData,
      executiveSummary: fieldValue(resultsRoot, "opportunity-executive-summary"),
      recommendedFeature: {
        ...stageData.recommendedFeature,
        title: fieldValue(resultsRoot, "opportunity-title"),
        whyNow: fieldValue(resultsRoot, "opportunity-why-now"),
        userProblem: fieldValue(resultsRoot, "opportunity-user-problem"),
        solutionBet: fieldValue(resultsRoot, "opportunity-solution-bet"),
        successMetrics: linesFromField(resultsRoot, "opportunity-success-metrics"),
        risks: linesFromField(resultsRoot, "opportunity-risks"),
        rolloutPlan: linesFromField(resultsRoot, "opportunity-rollout-plan")
      }
    };
  }

  if (stageKey === "spec") {
    return {
      problemStatement: fieldValue(resultsRoot, "spec-problem"),
      targetUsers: fieldValue(resultsRoot, "spec-target-users"),
      userStory: fieldValue(resultsRoot, "spec-user-story"),
      jobsToBeDone: linesFromField(resultsRoot, "spec-jtbd"),
      scopeIn: linesFromField(resultsRoot, "spec-scope-in"),
      scopeOut: linesFromField(resultsRoot, "spec-scope-out"),
      acceptanceCriteria: linesFromField(resultsRoot, "spec-acceptance"),
      openQuestions: linesFromField(resultsRoot, "spec-questions")
    };
  }

  if (stageKey === "wireframe") {
    return {
      vision: fieldValue(resultsRoot, "wireframe-vision"),
      interactionNotes: linesFromField(resultsRoot, "wireframe-interactions"),
      figmaPrompt: fieldValue(resultsRoot, "wireframe-prompt"),
      frames: collectFramesDraft(resultsRoot)
    };
  }

  if (stageKey === "tickets") {
    return collectTicketsDraft(resultsRoot);
  }

  if (stageKey === "codex") {
    return {
      objective: fieldValue(resultsRoot, "codex-objective"),
      architectureNotes: linesFromField(resultsRoot, "codex-architecture"),
      firstTasks: linesFromField(resultsRoot, "codex-first-tasks"),
      prompt: fieldValue(resultsRoot, "codex-prompt"),
      commandPreview: stageData.commandPreview
    };
  }

  return null;
}

export function collectFramesDraft(resultsRoot) {
  return Array.from(resultsRoot.querySelectorAll("[data-frame-index]")).map((frameElement) => {
    const components = Array.from(
      frameElement.querySelectorAll("[data-component-index]")
    ).map((componentElement) => ({
      name: fieldValue(componentElement, '[data-field="component-name"]'),
      description: fieldValue(componentElement, '[data-field="component-description"]'),
      note: fieldValue(componentElement, '[data-field="component-note"]')
    }));

    return {
      name: fieldValue(frameElement, '[data-field="frame-name"]'),
      purpose: fieldValue(frameElement, '[data-field="frame-purpose"]'),
      layout: fieldValue(frameElement, '[data-field="frame-layout"]'),
      components: components.filter((component) => component.name && component.description && component.note)
    };
  });
}

export function collectTicketsDraft(resultsRoot) {
  return Array.from(resultsRoot.querySelectorAll("[data-ticket-index]")).map((ticketElement) => ({
    title: fieldValue(ticketElement, '[data-field="ticket-title"]'),
    owner: fieldValue(ticketElement, '[data-field="ticket-owner"]'),
    description: fieldValue(ticketElement, '[data-field="ticket-description"]'),
    definitionOfDone: textLines(fieldValue(ticketElement, '[data-field="ticket-dod"]'))
  }));
}

export function defaultFrameDraft(index) {
  return {
    name: `Frame ${index}`,
    purpose: "Describe what the PM should review or decide in this frame.",
    layout: "Outline the key layout regions, hierarchy, and sticky controls.",
    components: [defaultComponentDraft()]
  };
}

export function defaultComponentDraft() {
  return {
    name: "New component",
    description: "Describe what this component should display or control.",
    note: "Add an implementation or UX note."
  };
}

export function defaultTicketDraft(index) {
  return {
    title: `New ticket ${index}`,
    owner: "Frontend + backend",
    description: "Describe the unit of work for this ticket.",
    definitionOfDone: ["Document the expected outcome and acceptance signal."]
  };
}

export function cloneStageData(workflow, stageKey) {
  const stage = workflow?.stages?.[stageKey];
  return cloneJson(stage?.draft || stage?.approved || null);
}

export function labelForTarget(targetId) {
  const labels = {
    interviews: "customer interviews",
    feedback: "feedback backlog",
    usageData: "usage data"
  };
  return labels[targetId] || targetId;
}

function linesFromField(root, selector) {
  return textLines(fieldValue(root, selector));
}

function fieldValue(root, selector) {
  const field = root.querySelector(selector.startsWith("#") || selector.startsWith("[") ? selector : `#${selector}`);
  return field ? field.value.trim() : "";
}
