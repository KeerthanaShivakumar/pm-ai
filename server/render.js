const {
  DEFAULT_CODEX_MODEL,
  DEFAULT_WORKSPACE_DIR
} = require("./common");

function renderWorkflowAudit(workflow) {
  return (workflow.events || [])
    .map((event) => `[${event.at}] ${event.message}`)
    .join("\n");
}

function renderStageMarkdown(stageKey, payload) {
  if (stageKey === "opportunity") {
    return [
      `# ${payload.recommendedFeature.title}`,
      "",
      payload.executiveSummary,
      "",
      "## Why now",
      payload.recommendedFeature.whyNow,
      "",
      "## User problem",
      payload.recommendedFeature.userProblem,
      "",
      "## Solution bet",
      payload.recommendedFeature.solutionBet,
      "",
      "## Success metrics",
      ...payload.recommendedFeature.successMetrics.map((item) => `- ${item}`),
      "",
      "## Risks",
      ...payload.recommendedFeature.risks.map((item) => `- ${item}`)
    ].join("\n");
  }

  if (stageKey === "spec") {
    return renderSpecMarkdown(payload);
  }

  if (stageKey === "wireframe") {
    return renderWireframeMarkdown(payload);
  }

  if (stageKey === "tickets") {
    return renderTicketsMarkdown(payload);
  }

  return [
    "# Codex kickoff",
    "",
    `Objective: ${payload.objective}`,
    "",
    "## Architecture notes",
    ...payload.architectureNotes.map((item) => `- ${item}`),
    "",
    "## First tasks",
    ...payload.firstTasks.map((item) => `- ${item}`),
    "",
    "## Streaming kickoff",
    payload.commandPreview,
    "",
    "## Prompt",
    payload.prompt
  ].join("\n");
}

function renderBriefMarkdown(input, analysis, meta) {
  return [
    `# ${input.productName} build brief`,
    "",
    `Mode: ${meta.mode}`,
    meta.warnings.length ? `Warnings: ${meta.warnings.join(" | ")}` : null,
    "",
    "## Executive summary",
    analysis.executiveSummary,
    "",
    `## Build next: ${analysis.recommendedFeature.title}`,
    analysis.recommendedFeature.whyNow,
    "",
    "### User problem",
    analysis.recommendedFeature.userProblem,
    "",
    "### Solution bet",
    analysis.recommendedFeature.solutionBet,
    "",
    "### Success metrics",
    ...analysis.recommendedFeature.successMetrics.map((item) => `- ${item}`),
    "",
    "## Evidence",
    ...analysis.evidence.map((item) => `- ${item.title} (${item.source}): ${item.detail}`),
    "",
    "## Acceptance criteria",
    ...analysis.spec.acceptanceCriteria.map((item) => `- ${item}`),
    "",
    "## Tickets",
    ...analysis.tickets.flatMap((ticket) => [
      `### ${ticket.title}`,
      `Owner: ${ticket.owner}`,
      ticket.description,
      ...ticket.definitionOfDone.map((item) => `- ${item}`),
      ""
    ]),
    "## Codex kickoff",
    "See `codex-prompt.md` for the full implementation prompt."
  ]
    .filter(Boolean)
    .join("\n");
}

function renderSpecMarkdown(spec) {
  return [
    "# Feature spec",
    "",
    "## Problem statement",
    spec.problemStatement,
    "",
    "## Target users",
    spec.targetUsers,
    "",
    "## User story",
    spec.userStory,
    "",
    "## Jobs to be done",
    ...spec.jobsToBeDone.map((item) => `- ${item}`),
    "",
    "## Scope in",
    ...spec.scopeIn.map((item) => `- ${item}`),
    "",
    "## Scope out",
    ...spec.scopeOut.map((item) => `- ${item}`),
    "",
    "## Acceptance criteria",
    ...spec.acceptanceCriteria.map((item) => `- ${item}`),
    "",
    "## Open questions",
    ...spec.openQuestions.map((item) => `- ${item}`)
  ].join("\n");
}

function renderWireframeMarkdown(wireframe) {
  return [
    "# Figma-style wireframe brief",
    "",
    wireframe.vision,
    "",
    ...wireframe.frames.flatMap((frame) => [
      `## ${frame.name}`,
      `Purpose: ${frame.purpose}`,
      `Layout: ${frame.layout}`,
      ...frame.components.map(
        (component) => `- ${component.name}: ${component.description} (${component.note})`
      ),
      ""
    ]),
    "## Interaction notes",
    ...wireframe.interactionNotes.map((note) => `- ${note}`),
    "",
    "## Figma prompt",
    wireframe.figmaPrompt
  ].join("\n");
}

function renderTicketsMarkdown(tickets) {
  return [
    "# Implementation tickets",
    "",
    ...tickets.flatMap((ticket) => [
      `## ${ticket.title}`,
      `Owner: ${ticket.owner}`,
      ticket.description,
      ...ticket.definitionOfDone.map((item) => `- ${item}`),
      ""
    ])
  ].join("\n");
}

function renderCodexCommandPreview() {
  return `Responses API -> ${DEFAULT_CODEX_MODEL} -> stream=true -> FILE: <path> fenced code blocks`;
}

function renderCodexPrompt(input, analysis) {
  return [
    `You are kicking off implementation for ${input.productName}.`,
    "",
    "Build the smallest production-minded vertical slice that proves the winning feature.",
    "",
    `Recommended feature: ${analysis.recommendedFeature.title}`,
    `Objective: ${analysis.codexKickoff.objective}`,
    "",
    "Product context:",
    input.productContext || "No extra product context provided.",
    "",
    "Target users:",
    input.targetUsers || "Not specified.",
    "",
    "Why now:",
    analysis.recommendedFeature.whyNow,
    "",
    "Problem statement:",
    analysis.spec.problemStatement,
    "",
    "User story:",
    analysis.spec.userStory,
    "",
    "Scope in:",
    ...analysis.spec.scopeIn.map((item) => `- ${item}`),
    "",
    "Acceptance criteria:",
    ...analysis.spec.acceptanceCriteria.map((item) => `- ${item}`),
    "",
    "Architecture notes:",
    ...analysis.codexKickoff.architectureNotes.map((item) => `- ${item}`),
    "",
    "First tasks:",
    ...analysis.codexKickoff.firstTasks.map((item) => `- ${item}`),
    "",
    "Tickets:",
    ...analysis.tickets.flatMap((ticket) => [
      `- ${ticket.title} [${ticket.owner}]`,
      `  ${ticket.description}`,
      ...ticket.definitionOfDone.map((item) => `  - ${item}`)
    ]),
    "",
    "Wireframe frames:",
    ...analysis.wireframe.frames.flatMap((frame) => [
      `- ${frame.name}: ${frame.purpose}`,
      `  Layout: ${frame.layout}`,
      ...frame.components.map((component) => `  - ${component.name}: ${component.description}`)
    ]),
    "",
    "Implementation notes from PM:",
    input.implementationNotes || "None provided.",
    "",
    "Implementation output requirements:",
    `- Assume the target workspace is ${input.codexWorkspacePath || DEFAULT_WORKSPACE_DIR}`,
    "- Emit a short plan, then one or more file blocks.",
    "- Each file block must start with `FILE: relative/path` on its own line.",
    "- Immediately follow each file header with a fenced code block containing the full file contents.",
    "- End with a short SUMMARY section.",
    "- Do not emit shell commands, patch hunks, or placeholder pseudocode.",
    "",
    "Please scaffold the smallest production-minded vertical slice that proves the winning feature. Favor simple, maintainable structure over over-engineering."
  ].join("\n");
}

module.exports = {
  renderWorkflowAudit,
  renderStageMarkdown,
  renderBriefMarkdown,
  renderSpecMarkdown,
  renderWireframeMarkdown,
  renderTicketsMarkdown,
  renderCodexCommandPreview,
  renderCodexPrompt
};
