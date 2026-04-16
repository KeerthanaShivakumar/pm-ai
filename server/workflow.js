const {
  fs,
  path,
  jobs,
  ARTIFACTS_DIR,
  WORKFLOW_STAGE_ORDER,
  WORKFLOW_STAGE_META,
  WORKFLOW_STAGE_DEPENDENCIES,
  ensureDir,
  buildRunId,
  uniqueStrings,
  stringArray,
  cloneJson,
  appendStageHistory,
  asString,
  createHttpError,
  mergeArtifacts,
  logInfo,
  logWarn,
  summarizeInputForLogs
} = require("./common");
const {
  buildDemoAnalysis,
  normalizeSpec,
  normalizeWireframe,
  normalizeTickets,
  normalizeRecommendedFeature,
  normalizeFeatureCandidates,
  normalizeEvidence
} = require("./analysis");
const {
  renderWorkflowAudit,
  renderBriefMarkdown,
  renderStageMarkdown,
  renderCodexPrompt,
  renderCodexCommandPreview
} = require("./render");

function createWorkflowService({ generateAnalysisBundle, startCodexResponsesJob, serializeJob }) {
  return {
    createWorkflow,
    createEmptyWorkflowStages,
    readWorkflow,
    saveWorkflow,
    generateWorkflowStage,
    updateWorkflowStage,
    approveWorkflowStage,
    runWorkflowCodex,
    serializeWorkflow,
    getWorkflowRunDir
  };

  async function createWorkflow(input) {
    logInfo("workflow.create_started", summarizeInputForLogs(input));
    const workflow = {
      id: buildRunId(input.productName),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      input,
      mode: "demo",
      warnings: [],
      stages: createEmptyWorkflowStages(),
      events: [],
      artifacts: [],
      codexJob: {
        status: "idle",
        reason: "Codex will stay idle until the final kickoff is approved."
      },
      seedAnalysis: null
    };

    const nextWorkflow = await generateWorkflowStage(workflow, "opportunity");
    saveWorkflow(nextWorkflow, "Workflow created and opportunity draft generated.");
    logInfo("workflow.create_completed", {
      workflowId: nextWorkflow.id,
      mode: nextWorkflow.mode
    });
    return nextWorkflow;
  }

  function createEmptyWorkflowStages() {
    return WORKFLOW_STAGE_ORDER.reduce((stages, key) => {
      stages[key] = {
        key,
        label: WORKFLOW_STAGE_META[key].label,
        description: WORKFLOW_STAGE_META[key].description,
        draft: null,
        approved: null,
        stale: false,
        generatedAt: null,
        approvedAt: null,
        approvedVersion: null,
        editedAt: null,
        version: 0,
        history: []
      };
      return stages;
    }, {});
  }

  function readWorkflow(workflowId) {
    const filePath = path.join(getWorkflowRunDir(workflowId), "workflow.json");
    if (!fs.existsSync(filePath)) {
      logWarn("workflow.read_missing", {
        workflowId
      });
      throw createHttpError(404, `Workflow ${workflowId} was not found.`);
    }

    const workflow = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const emptyStages = createEmptyWorkflowStages();
    workflow.stages = {
      ...emptyStages,
      ...(workflow.stages || {})
    };

    for (const stageKey of WORKFLOW_STAGE_ORDER) {
      workflow.stages[stageKey] = {
        ...emptyStages[stageKey],
        ...(workflow.stages[stageKey] || {}),
        history: Array.isArray(workflow.stages[stageKey]?.history)
          ? workflow.stages[stageKey].history
          : []
      };
    }

    workflow.events = Array.isArray(workflow.events) ? workflow.events : [];
    workflow.artifacts = Array.isArray(workflow.artifacts) ? workflow.artifacts : [];
    workflow.warnings = Array.isArray(workflow.warnings) ? workflow.warnings : [];
    if (!workflow.codexJob) {
      workflow.codexJob = {
        status: "idle",
        reason: "Codex has not been launched for this workflow."
      };
    }
    logInfo("workflow.read_completed", {
      workflowId,
      events: workflow.events.length,
      artifacts: workflow.artifacts.length
    });
    return workflow;
  }

  function saveWorkflow(workflow, message) {
    const runDir = getWorkflowRunDir(workflow.id);
    ensureDir(runDir);
    workflow.updatedAt = new Date().toISOString();

    if (message) {
      workflow.events = Array.isArray(workflow.events) ? workflow.events : [];
      workflow.events.push({
        at: workflow.updatedAt,
        message
      });
      workflow.events = workflow.events.slice(-60);
    }

    const artifacts = mergeArtifacts(syncWorkflowArtifacts(workflow), workflow.artifacts || []);
    const workflowPath = path.join(runDir, "workflow.json");
    workflow.artifacts = mergeArtifacts(artifacts, [
      {
        name: "workflow.json",
        path: workflowPath,
        url: `/artifacts/${workflow.id}/workflow.json`
      }
    ]);
    fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
    logInfo("workflow.saved", {
      workflowId: workflow.id,
      message,
      artifacts: workflow.artifacts.length,
      stages: summarizeWorkflowStages(workflow)
    });
  }

  function syncWorkflowArtifacts(workflow) {
    const runDir = getWorkflowRunDir(workflow.id);
    ensureDir(runDir);
    const files = [];

    const writeFile = (name, content) => {
      const absolutePath = path.join(runDir, name);
      fs.writeFileSync(absolutePath, content, "utf8");
      files.push({
        name,
        path: absolutePath,
        url: `/artifacts/${workflow.id}/${name}`
      });
    };

    writeFile("input.json", `${JSON.stringify(workflow.input, null, 2)}\n`);
    writeFile("audit.log", renderWorkflowAudit(workflow));

    const overviewAnalysis = buildAnalysisFromWorkflow(workflow);
    if (overviewAnalysis) {
      writeFile(
        "brief.md",
        renderBriefMarkdown(workflow.input, overviewAnalysis, {
          mode: workflow.mode,
          warnings: workflow.warnings
        })
      );
    }

    for (const stageKey of WORKFLOW_STAGE_ORDER) {
      const stage = workflow.stages[stageKey];
      if (stage?.draft) {
        writeFile(`${stageKey}.draft.json`, `${JSON.stringify(stage.draft, null, 2)}\n`);
        writeFile(`${stageKey}.md`, renderStageMarkdown(stageKey, stage.draft));
      }
      if (stage?.approved) {
        writeFile(`${stageKey}.approved.json`, `${JSON.stringify(stage.approved, null, 2)}\n`);
      }
    }

    if (workflow.stages.codex?.draft?.prompt) {
      writeFile("codex-prompt.md", workflow.stages.codex.draft.prompt);
    }

    return files;
  }

  async function generateWorkflowStage(workflow, stageKey) {
    assertKnownStage(stageKey);
    assertStageDependencies(workflow, stageKey);
    logInfo("workflow.stage_generate_started", {
      workflowId: workflow.id,
      stageKey
    });

    const nextWorkflow = cloneJson(workflow);
    const stage = nextWorkflow.stages[stageKey];

    if (stageKey === "opportunity") {
      const bundle = await generateAnalysisBundle(nextWorkflow.input);
      nextWorkflow.mode = bundle.mode;
      nextWorkflow.warnings = bundle.warnings;
      nextWorkflow.seedAnalysis = bundle.analysis;
      stage.draft = normalizeOpportunityStage(
        buildOpportunityStage(bundle.analysis),
        nextWorkflow.input,
        bundle.analysis
      );
    } else if (stageKey === "spec") {
      stage.draft = buildSpecStageDraft(nextWorkflow);
    } else if (stageKey === "wireframe") {
      stage.draft = buildWireframeStageDraft(nextWorkflow);
    } else if (stageKey === "tickets") {
      stage.draft = buildTicketsStageDraft(nextWorkflow);
    } else if (stageKey === "codex") {
      stage.draft = buildCodexStageDraft(nextWorkflow);
    }

    stage.stale = false;
    stage.generatedAt = new Date().toISOString();
    stage.editedAt = stage.generatedAt;
    stage.approved = null;
    stage.approvedAt = null;
    stage.approvedVersion = null;
    stage.version = Number(stage.version || 0) + 1;
    appendStageHistory(stage, "generated", `Generated ${stage.label.toLowerCase()} draft.`);

    markDownstreamStagesStale(nextWorkflow, stageKey);
    if (stageKey !== "codex") {
      nextWorkflow.codexJob = {
        status: "idle",
        reason: "Codex kickoff will refresh after downstream approvals."
      };
    }
    logInfo("workflow.stage_generate_completed", {
      workflowId: nextWorkflow.id,
      stageKey,
      version: stage.version,
      summary: summarizeStageDraft(stageKey, stage.draft)
    });
    return nextWorkflow;
  }

  function updateWorkflowStage(workflow, stageKey, draftInput) {
    assertKnownStage(stageKey);
    logInfo("workflow.stage_update_started", {
      workflowId: workflow.id,
      stageKey
    });
    const nextWorkflow = cloneJson(workflow);
    const stage = nextWorkflow.stages[stageKey];
    const fallback = stage.draft || stage.approved || buildStageFallback(nextWorkflow, stageKey);
    stage.draft = normalizeStageDraft(stageKey, draftInput, nextWorkflow.input, fallback);
    stage.editedAt = new Date().toISOString();
    stage.approved = null;
    stage.approvedAt = null;
    stage.approvedVersion = null;
    stage.stale = false;
    stage.version = Number(stage.version || 0) + 1;
    appendStageHistory(stage, "edited", `Edited ${stage.label.toLowerCase()} draft.`);

    markDownstreamStagesStale(nextWorkflow, stageKey);
    if (stageKey !== "codex") {
      nextWorkflow.codexJob = {
        status: "idle",
        reason: "Codex launch was cleared because an upstream stage changed."
      };
    }
    logInfo("workflow.stage_update_completed", {
      workflowId: nextWorkflow.id,
      stageKey,
      version: stage.version,
      summary: summarizeStageDraft(stageKey, stage.draft)
    });
    return nextWorkflow;
  }

  function approveWorkflowStage(workflow, stageKey) {
    assertKnownStage(stageKey);
    assertStageDependencies(workflow, stageKey);
    logInfo("workflow.stage_approve_started", {
      workflowId: workflow.id,
      stageKey
    });
    const nextWorkflow = cloneJson(workflow);
    const stage = nextWorkflow.stages[stageKey];
    if (!stage?.draft) {
      throw new Error(`Generate or save a ${stage.label.toLowerCase()} draft before approving it.`);
    }

    stage.approved = cloneJson(stage.draft);
    stage.approvedAt = new Date().toISOString();
    stage.approvedVersion = stage.version || 0;
    stage.stale = false;
    appendStageHistory(stage, "approved", `Approved ${stage.label.toLowerCase()} v${stage.approvedVersion}.`);

    markDownstreamStagesStale(nextWorkflow, stageKey);
    logInfo("workflow.stage_approve_completed", {
      workflowId: nextWorkflow.id,
      stageKey,
      approvedVersion: stage.approvedVersion
    });
    return nextWorkflow;
  }

  function runWorkflowCodex(workflow) {
    logInfo("workflow.codex_run_started", {
      workflowId: workflow.id
    });
    const nextWorkflow = cloneJson(workflow);
    const codexStage = nextWorkflow.stages.codex;
    if (!codexStage?.approved) {
      throw createHttpError(400, "Approve the Codex kickoff stage before launching implementation.");
    }
    if (codexStage.stale) {
      throw createHttpError(400, "Refresh and re-approve the Codex kickoff stage before launching implementation.");
    }
    if (nextWorkflow.codexJob?.id) {
      const existingJob = jobs.get(nextWorkflow.codexJob.id);
      if (existingJob?.status === "running") {
        throw createHttpError(409, "A live Codex run is already in progress for this workflow.");
      }
    }

    nextWorkflow.codexJob = startCodexResponsesJob({
      input: nextWorkflow.input,
      runId: nextWorkflow.id,
      artifactBundle: {
        runDir: getWorkflowRunDir(nextWorkflow.id),
        files: nextWorkflow.artifacts || []
      },
      prompt: codexStage.approved.prompt
    });
    logInfo("workflow.codex_run_completed", {
      workflowId: nextWorkflow.id,
      jobId: nextWorkflow.codexJob?.id || "",
      status: nextWorkflow.codexJob?.status || "unknown"
    });
    return nextWorkflow;
  }

  function serializeWorkflow(workflow) {
    const currentJob =
      workflow.codexJob?.id && jobs.has(workflow.codexJob.id)
        ? serializeJob(jobs.get(workflow.codexJob.id))
        : workflow.codexJob;

    const serializedStages = {};
    for (const stageKey of WORKFLOW_STAGE_ORDER) {
      serializedStages[stageKey] = serializeWorkflowStage(workflow, stageKey);
    }

    return {
      ok: true,
      workflowId: workflow.id,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
      mode: workflow.mode,
      warnings: workflow.warnings || [],
      input: workflow.input,
      artifacts: workflow.artifacts || [],
      events: workflow.events || [],
      codexJob: currentJob,
      stages: serializedStages
    };
  }

  function serializeWorkflowStage(workflow, stageKey) {
    const stage = workflow.stages[stageKey];
    const blockedBy = WORKFLOW_STAGE_DEPENDENCIES[stageKey].filter(
      (dependency) => !workflow.stages[dependency]?.approved
    );

    return {
      key: stageKey,
      label: stage.label,
      description: stage.description,
      status: getWorkflowStageStatus(stage, blockedBy),
      blockedBy,
      dependencies: WORKFLOW_STAGE_DEPENDENCIES[stageKey],
      draft: stage.draft,
      approved: stage.approved,
      stale: Boolean(stage.stale),
      generatedAt: stage.generatedAt,
      approvedAt: stage.approvedAt,
      approvedVersion: stage.approvedVersion || null,
      editedAt: stage.editedAt,
      version: stage.version || 0,
      history: (stage.history || []).slice().reverse()
    };
  }

  function getWorkflowStageStatus(stage, blockedBy) {
    if (stage.stale) {
      return "stale";
    }
    if (stage.approved) {
      return "approved";
    }
    if (stage.draft) {
      return "draft";
    }
    return blockedBy.length ? "blocked" : "ready";
  }

  function assertKnownStage(stageKey) {
    if (!WORKFLOW_STAGE_META[stageKey]) {
      throw createHttpError(400, `Unknown workflow stage: ${stageKey}`);
    }
  }

  function assertStageDependencies(workflow, stageKey) {
    const blockedBy = WORKFLOW_STAGE_DEPENDENCIES[stageKey].filter(
      (dependency) => !workflow.stages[dependency]?.approved
    );
    if (blockedBy.length) {
      throw createHttpError(
        400,
        `${WORKFLOW_STAGE_META[stageKey].label} is blocked until ${blockedBy
          .map((dependency) => WORKFLOW_STAGE_META[dependency].label.toLowerCase())
          .join(", ")} is approved.`
      );
    }
  }

  function markDownstreamStagesStale(workflow, stageKey) {
    const startIndex = WORKFLOW_STAGE_ORDER.indexOf(stageKey);
    const affectedStages = [];
    for (let index = startIndex + 1; index < WORKFLOW_STAGE_ORDER.length; index += 1) {
      const downstreamStage = workflow.stages[WORKFLOW_STAGE_ORDER[index]];
      if (downstreamStage.draft || downstreamStage.approved) {
        downstreamStage.stale = true;
        affectedStages.push(downstreamStage.key);
        if (downstreamStage.key !== "codex") {
          downstreamStage.approved = null;
          downstreamStage.approvedAt = null;
          downstreamStage.approvedVersion = null;
        }
        appendStageHistory(
          downstreamStage,
          "stale",
          `${downstreamStage.label} needs review because ${WORKFLOW_STAGE_META[stageKey].label.toLowerCase()} changed.`
        );
      }
    }
    if (affectedStages.length) {
      logInfo("workflow.downstream_marked_stale", {
        workflowId: workflow.id,
        stageKey,
        affectedStages
      });
    }
  }
}

function getWorkflowRunDir(workflowId) {
  return path.join(ARTIFACTS_DIR, workflowId);
}

function buildOpportunityStage(analysis) {
  return {
    executiveSummary: analysis.executiveSummary,
    evidence: analysis.evidence,
    featureCandidates: analysis.featureCandidates,
    recommendedFeature: analysis.recommendedFeature
  };
}

function buildSpecStageDraft(workflow) {
  const opportunity = getApprovedStage(workflow, "opportunity");
  const seed = workflow.seedAnalysis || buildDemoAnalysis(workflow.input);
  const base = seed.spec || buildDemoAnalysis(workflow.input).spec;
  const featureTitle = opportunity?.recommendedFeature?.title || seed.recommendedFeature.title;
  const userProblem = opportunity?.recommendedFeature?.userProblem || base.problemStatement;
  return normalizeSpec(
    {
      problemStatement: userProblem || base.problemStatement,
      targetUsers: workflow.input.targetUsers || base.targetUsers,
      userStory:
        `As ${workflow.input.targetUsers || "a product manager"}, I want ${featureTitle} so I can move from evidence to an approved build plan without rewriting context.`,
      jobsToBeDone: uniqueStrings([
        ...(base.jobsToBeDone || []),
        "Edit and approve the spec before it moves downstream"
      ]),
      scopeIn: uniqueStrings([
        `${featureTitle} recommendation and approval flow`,
        ...((base.scopeIn || []).filter(Boolean))
      ]).slice(0, 6),
      scopeOut: base.scopeOut,
      acceptanceCriteria: uniqueStrings([
        ...(opportunity?.recommendedFeature?.successMetrics || []),
        ...(base.acceptanceCriteria || [])
      ]).slice(0, 6),
      openQuestions: uniqueStrings([
        ...(opportunity?.recommendedFeature?.risks || []),
        ...(base.openQuestions || [])
      ]).slice(0, 6)
    },
    base
  );
}

function buildWireframeStageDraft(workflow) {
  const opportunity = getApprovedStage(workflow, "opportunity");
  const spec = getApprovedStage(workflow, "spec");
  const seed = workflow.seedAnalysis || buildDemoAnalysis(workflow.input);
  const base = seed.wireframe || buildDemoAnalysis(workflow.input).wireframe;
  const featureTitle = opportunity?.recommendedFeature?.title || seed.recommendedFeature.title;
  const scopeIn = spec?.scopeIn || [];
  return normalizeWireframe(
    {
      vision:
        `${featureTitle} should feel like a guided review flow where a PM can inspect evidence, edit the spec, and approve the handoff with confidence.`,
      frames: (base.frames || []).map((frame, index) => ({
        ...frame,
        name: index === 1 ? "Approval Workspace" : frame.name,
        purpose: index === 2 ? `Translate ${featureTitle} into implementation-ready assets.` : frame.purpose,
        components: frame.components.map((component, componentIndex) => ({
          ...component,
          description:
            index === 2 && scopeIn[componentIndex]
              ? scopeIn[componentIndex]
              : component.description
        }))
      })),
      interactionNotes: uniqueStrings([
        ...(base.interactionNotes || []),
        "Visibly mark downstream stages as stale when an upstream approval changes"
      ]).slice(0, 6),
      figmaPrompt:
        `Design a staged approval workspace for ${featureTitle}. Emphasize evidence traceability, editability, and a clear path from recommendation to engineering kickoff.`
    },
    base
  );
}

function buildTicketsStageDraft(workflow) {
  const opportunity = getApprovedStage(workflow, "opportunity");
  const spec = getApprovedStage(workflow, "spec");
  const wireframe = getApprovedStage(workflow, "wireframe");
  const seed = workflow.seedAnalysis || buildDemoAnalysis(workflow.input);
  const base = seed.tickets || buildDemoAnalysis(workflow.input).tickets;
  const featureTitle = opportunity?.recommendedFeature?.title || seed.recommendedFeature.title;
  const frameNames = (wireframe?.frames || []).map((frame) => frame.name);
  const acceptanceCriteria = spec?.acceptanceCriteria || [];

  return normalizeTickets(
    [
      {
        title: `Implement ${featureTitle} review flow`,
        owner: "Frontend + backend",
        description:
          `Build the staged workflow so PMs can generate, edit, and approve ${featureTitle} before handing work to engineering.`,
        definitionOfDone: uniqueStrings([
          ...(acceptanceCriteria.slice(0, 3) || []),
          "The UI blocks downstream generation until upstream approvals exist"
        ])
      },
      {
        title: "Persist workflow state and artifacts",
        owner: "Platform",
        description:
          "Write workflow drafts, approvals, audit history, and markdown artifacts to disk for every run.",
        definitionOfDone: uniqueStrings([
          "Each workflow writes workflow.json plus stage draft and approved files",
          "Audit history is visible in the UI and persisted on disk",
          ...(base[1]?.definitionOfDone || [])
        ]).slice(0, 5)
      },
      {
        title: "Prepare final Codex kickoff",
        owner: "Developer experience",
        description:
          `Use the approved spec, wireframe, and ticket plan to create the final Codex prompt for ${featureTitle}.`,
        definitionOfDone: uniqueStrings([
          ...(frameNames.slice(0, 2).map((name) => `Prompt references the ${name} frame`) || []),
          ...(base[2]?.definitionOfDone || []),
          "Codex only launches from the approved final kickoff"
        ]).slice(0, 5)
      }
    ],
    base
  );
}

function buildCodexStageDraft(workflow) {
  const opportunity = getApprovedStage(workflow, "opportunity");
  const spec = getApprovedStage(workflow, "spec");
  const wireframe = getApprovedStage(workflow, "wireframe");
  const tickets = getApprovedStage(workflow, "tickets");
  const seed = workflow.seedAnalysis || buildDemoAnalysis(workflow.input);
  const base = seed.codexKickoff || buildDemoAnalysis(workflow.input).codexKickoff;
  const assembledAnalysis = {
    executiveSummary: opportunity?.executiveSummary || seed.executiveSummary,
    evidence: opportunity?.evidence || seed.evidence,
    featureCandidates: opportunity?.featureCandidates || seed.featureCandidates,
    recommendedFeature: opportunity?.recommendedFeature || seed.recommendedFeature,
    spec: spec || seed.spec,
    wireframe: wireframe || seed.wireframe,
    tickets: tickets || seed.tickets,
    codexKickoff: {
      objective: base.objective.replace(
        seed.recommendedFeature.title,
        opportunity?.recommendedFeature?.title || seed.recommendedFeature.title
      ),
      architectureNotes: base.architectureNotes,
      firstTasks: uniqueStrings([
        ...(base.firstTasks || []),
        "Respect approvals as the source of truth for this kickoff"
      ]).slice(0, 5)
    }
  };

  const prompt = renderCodexPrompt(workflow.input, assembledAnalysis);
  return normalizeCodexStage(
    {
      objective: assembledAnalysis.codexKickoff.objective,
      architectureNotes: assembledAnalysis.codexKickoff.architectureNotes,
      firstTasks: assembledAnalysis.codexKickoff.firstTasks,
      prompt,
      commandPreview: renderCodexCommandPreview()
    },
    {
      ...base,
      prompt,
      commandPreview: renderCodexCommandPreview()
    }
  );
}

function buildStageFallback(workflow, stageKey) {
  if (stageKey === "opportunity") {
    const fallback = workflow.seedAnalysis || buildDemoAnalysis(workflow.input);
    return normalizeOpportunityStage(buildOpportunityStage(fallback), workflow.input, fallback);
  }
  if (stageKey === "spec") {
    return buildSpecStageDraft(workflow);
  }
  if (stageKey === "wireframe") {
    return buildWireframeStageDraft(workflow);
  }
  if (stageKey === "tickets") {
    return buildTicketsStageDraft(workflow);
  }
  return buildCodexStageDraft(workflow);
}

function normalizeStageDraft(stageKey, value, input, fallback) {
  if (stageKey === "opportunity") {
    return normalizeOpportunityStage(value, input, fallback);
  }
  if (stageKey === "spec") {
    return normalizeSpec(value, fallback);
  }
  if (stageKey === "wireframe") {
    return normalizeWireframe(value, fallback);
  }
  if (stageKey === "tickets") {
    return normalizeTickets(value, fallback);
  }
  return normalizeCodexStage(value, fallback);
}

function normalizeOpportunityStage(value, input, fallback) {
  const baseAnalysis = fallback || buildDemoAnalysis(input);
  const stage = value || {};
  return {
    executiveSummary: asString(stage.executiveSummary) || baseAnalysis.executiveSummary,
    evidence: normalizeEvidence(stage.evidence, baseAnalysis.evidence),
    featureCandidates: normalizeFeatureCandidates(stage.featureCandidates, baseAnalysis.featureCandidates),
    recommendedFeature: normalizeRecommendedFeature(stage.recommendedFeature, baseAnalysis.recommendedFeature)
  };
}

function normalizeCodexStage(value, fallback) {
  const stage = value || {};
  return {
    objective: asString(stage.objective) || fallback.objective,
    architectureNotes: stringArray(stage.architectureNotes, fallback.architectureNotes),
    firstTasks: stringArray(stage.firstTasks, fallback.firstTasks),
    prompt: asString(stage.prompt) || fallback.prompt,
    commandPreview: asString(stage.commandPreview) || fallback.commandPreview || renderCodexCommandPreview()
  };
}

function getApprovedStage(workflow, stageKey) {
  return workflow.stages[stageKey]?.approved || null;
}

function buildAnalysisFromWorkflow(workflow) {
  const opportunity = workflow.stages.opportunity?.approved || workflow.stages.opportunity?.draft;
  if (!opportunity) {
    return null;
  }

  const seed = workflow.seedAnalysis || buildDemoAnalysis(workflow.input);
  const spec = workflow.stages.spec?.approved || workflow.stages.spec?.draft || seed.spec;
  const wireframe = workflow.stages.wireframe?.approved || workflow.stages.wireframe?.draft || seed.wireframe;
  const tickets = workflow.stages.tickets?.approved || workflow.stages.tickets?.draft || seed.tickets;
  const codexKickoff = workflow.stages.codex?.approved || workflow.stages.codex?.draft || {
    ...seed.codexKickoff,
    prompt: renderCodexPrompt(workflow.input, {
      executiveSummary: opportunity.executiveSummary,
      evidence: opportunity.evidence,
      featureCandidates: opportunity.featureCandidates,
      recommendedFeature: opportunity.recommendedFeature,
      spec,
      wireframe,
      tickets,
      codexKickoff: seed.codexKickoff
    }),
    commandPreview: renderCodexCommandPreview()
  };

  return {
    executiveSummary: opportunity.executiveSummary,
    evidence: opportunity.evidence,
    featureCandidates: opportunity.featureCandidates,
    recommendedFeature: opportunity.recommendedFeature,
    spec,
    wireframe,
    tickets,
    codexKickoff
  };
}

function summarizeWorkflowStages(workflow) {
  return WORKFLOW_STAGE_ORDER.reduce((summary, stageKey) => {
    const stage = workflow.stages?.[stageKey];
    summary[stageKey] = {
      version: Number(stage?.version || 0),
      hasDraft: Boolean(stage?.draft),
      hasApproved: Boolean(stage?.approved),
      stale: Boolean(stage?.stale)
    };
    return summary;
  }, {});
}

function summarizeStageDraft(stageKey, draft) {
  if (!draft) {
    return {
      empty: true
    };
  }
  if (stageKey === "opportunity") {
    return {
      evidence: Array.isArray(draft.evidence) ? draft.evidence.length : 0,
      featureCandidates: Array.isArray(draft.featureCandidates) ? draft.featureCandidates.length : 0,
      recommendedFeature: asString(draft.recommendedFeature?.title)
    };
  }
  if (stageKey === "spec") {
    return {
      jobsToBeDone: Array.isArray(draft.jobsToBeDone) ? draft.jobsToBeDone.length : 0,
      scopeIn: Array.isArray(draft.scopeIn) ? draft.scopeIn.length : 0,
      acceptanceCriteria: Array.isArray(draft.acceptanceCriteria) ? draft.acceptanceCriteria.length : 0
    };
  }
  if (stageKey === "wireframe") {
    return {
      frames: Array.isArray(draft.frames) ? draft.frames.length : 0,
      components:
        Array.isArray(draft.frames) ?
          draft.frames.reduce(
            (total, frame) => total + (Array.isArray(frame?.components) ? frame.components.length : 0),
            0
          )
        : 0
    };
  }
  if (stageKey === "tickets") {
    return {
      tickets: Array.isArray(draft) ? draft.length : 0
    };
  }
  return {
    architectureNotes: Array.isArray(draft.architectureNotes) ? draft.architectureNotes.length : 0,
    firstTasks: Array.isArray(draft.firstTasks) ? draft.firstTasks.length : 0,
    promptChars: asString(draft.prompt).length
  };
}

module.exports = {
  createWorkflowService
};
