const http = require("http");
const { URL } = require("url");

const {
  ROOT_DIR,
  PUBLIC_DIR,
  ARTIFACTS_DIR,
  PORT,
  HOST,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_CODEX_MODEL,
  WORKFLOW_STAGE_ORDER,
  WORKFLOW_STAGE_META,
  readJsonBody,
  serveFile,
  sendJson,
  resolveWorkspacePath,
  buildRunId,
  jobs,
  logInfo,
  logWarn,
  logError,
  summarizeInputForLogs
} = require("./server/common");
const {
  generateAnalysisBundle,
  normalizeInput,
  hasMinimumInput,
  buildDemoAnalysis,
  normalizeAnalysis,
  writeArtifacts
} = require("./server/analysis");
const {
  renderBriefMarkdown,
  renderCodexPrompt,
  renderWireframeMarkdown
} = require("./server/render");
const { createCodexJobsService } = require("./server/codex-jobs");
const { createWorkflowService } = require("./server/workflow");

let workflowService = null;

const codexJobsService = createCodexJobsService({
  readWorkflow: (workflowId) => workflowService.readWorkflow(workflowId),
  saveWorkflow: (workflow, message) => workflowService.saveWorkflow(workflow, message),
  getWorkflowRunDir: (workflowId) => workflowService.getWorkflowRunDir(workflowId)
});

workflowService = createWorkflowService({
  generateAnalysisBundle,
  startCodexResponsesJob: codexJobsService.startCodexResponsesJob,
  serializeJob: codexJobsService.serializeJob
});

const {
  createWorkflow,
  generateWorkflowStage,
  updateWorkflowStage,
  approveWorkflowStage,
  runWorkflowCodex,
  readWorkflow,
  saveWorkflow,
  serializeWorkflow
} = workflowService;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const routes = matchRoutes(url.pathname);
    logInfo("http.request", {
      method: req.method,
      path: url.pathname
    });

    if (req.method === "GET" && url.pathname === "/api/health") {
      logInfo("health.check", {
        mode: process.env.OPENAI_API_KEY ? "openai" : "demo"
      });
      return sendJson(res, 200, {
        ok: true,
        mode: process.env.OPENAI_API_KEY ? "openai" : "demo",
        defaultOpenAiModel: DEFAULT_OPENAI_MODEL,
        defaultCodexModel: DEFAULT_CODEX_MODEL,
        suggestedCodexWorkspace: resolveWorkspacePath(""),
        workflowStages: WORKFLOW_STAGE_ORDER
      });
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      return handleAnalyze(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/workflows") {
      return handleCreateWorkflow(req, res);
    }

    if (req.method === "GET" && routes.workflowId) {
      return handleGetWorkflow(res, routes.workflowId);
    }

    if (req.method === "POST" && routes.stageGenerate) {
      return handleGenerateWorkflowStage(res, routes.stageGenerate.workflowId, routes.stageGenerate.stageKey);
    }

    if (req.method === "PATCH" && routes.stage) {
      return handleUpdateWorkflowStage(req, res, routes.stage.workflowId, routes.stage.stageKey);
    }

    if (req.method === "POST" && routes.stageApprove) {
      return handleApproveWorkflowStage(res, routes.stageApprove.workflowId, routes.stageApprove.stageKey);
    }

    if (req.method === "POST" && routes.codexRun) {
      return handleWorkflowCodexRun(res, routes.codexRun.workflowId);
    }

    if (req.method === "GET" && routes.jobStream) {
      return codexJobsService.handleJobStream(req, res, routes.jobStream.jobId);
    }

    if (req.method === "GET" && routes.job) {
      const job = jobs.get(routes.job.jobId);
      if (!job) {
        logWarn("codex.job.lookup_missing", {
          jobId: routes.job.jobId
        });
        return sendJson(res, 404, { error: "Job not found." });
      }
      logInfo("codex.job.lookup", {
        jobId: routes.job.jobId,
        status: job.status
      });
      return sendJson(res, 200, codexJobsService.serializeJob(job));
    }

    if (req.method === "GET" && url.pathname.startsWith("/artifacts/")) {
      return serveFile(res, `${ROOT_DIR}${url.pathname}`, ARTIFACTS_DIR);
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/public/"))) {
      const relativePath = url.pathname === "/" ? "/index.html" : url.pathname.replace("/public", "");
      return serveFile(res, `${PUBLIC_DIR}${relativePath}`, PUBLIC_DIR);
    }

    logWarn("http.route_not_found", {
      method: req.method,
      path: url.pathname
    });
    return sendJson(res, 404, { error: "Route not found." });
  } catch (error) {
    if ((error.statusCode || 500) >= 500) {
      logError("http.request_failed", {
        method: req.method,
        url: req.url,
        statusCode: error.statusCode || 500,
        message: error.message
      });
    } else {
      logWarn("http.request_rejected", {
        method: req.method || "REQUEST",
        url: req.url || "",
        statusCode: error.statusCode || 400,
        message: error.publicMessage || error.message
      });
    }
    return sendJson(res, error.statusCode || 500, {
      error: error.publicMessage || "Unexpected server error.",
      detail: error.message
    });
  }
});

function matchRoutes(pathname) {
  const match = (pattern) => pathname.match(pattern);
  const decode = (value) => decodeURIComponent(value);

  const workflowMatch = match(/^\/api\/workflows\/([^/]+)$/);
  const stageGenerateMatch = match(/^\/api\/workflows\/([^/]+)\/stages\/([^/]+)\/generate$/);
  const stageMatch = match(/^\/api\/workflows\/([^/]+)\/stages\/([^/]+)$/);
  const stageApproveMatch = match(/^\/api\/workflows\/([^/]+)\/stages\/([^/]+)\/approve$/);
  const codexRunMatch = match(/^\/api\/workflows\/([^/]+)\/codex\/run$/);
  const jobStreamMatch = match(/^\/api\/jobs\/([^/]+)\/stream$/);
  const jobMatch = match(/^\/api\/jobs\/([^/]+)$/);

  return {
    workflowId: workflowMatch ? decode(workflowMatch[1]) : "",
    stageGenerate: stageGenerateMatch
      ? {
          workflowId: decode(stageGenerateMatch[1]),
          stageKey: decode(stageGenerateMatch[2])
        }
      : null,
    stage: stageMatch
      ? {
          workflowId: decode(stageMatch[1]),
          stageKey: decode(stageMatch[2])
        }
      : null,
    stageApprove: stageApproveMatch
      ? {
          workflowId: decode(stageApproveMatch[1]),
          stageKey: decode(stageApproveMatch[2])
        }
      : null,
    codexRun: codexRunMatch
      ? {
          workflowId: decode(codexRunMatch[1])
        }
      : null,
    jobStream: jobStreamMatch
      ? {
          jobId: decode(jobStreamMatch[1])
        }
      : null,
    job: jobMatch
      ? {
          jobId: decode(jobMatch[1])
        }
      : null
  };
}

async function handleAnalyze(req, res) {
  const input = normalizeInput(await readJsonBody(req));
  logInfo("analysis.request_received", summarizeInputForLogs(input));
  if (!hasMinimumInput(input)) {
    logWarn("analysis.request_rejected", {
      reason: "missing_minimum_input"
    });
    return sendJson(res, 400, {
      error: "Add at least one meaningful customer signal or product context before running PM.ai."
    });
  }

  const runId = buildRunId(input.productName);
  const { analysis, mode, warnings } = await generateAnalysisBundle(input);
  const artifactBundle = writeArtifacts(runId, input, analysis, { mode, warnings });
  const codexJob = codexJobsService.startCodexResponsesJob({
    input,
    runId,
    artifactBundle,
    prompt: analysis.codexKickoff.prompt
  });
  logInfo("analysis.request_completed", {
    runId,
    mode,
    warnings: warnings.length,
    artifacts: artifactBundle.files.length,
    codexJobStatus: codexJob?.status || "unknown"
  });

  return sendJson(res, 200, {
    ok: true,
    runId,
    mode,
    warnings,
    analysis,
    artifacts: artifactBundle.files,
    codexJob
  });
}

async function handleCreateWorkflow(req, res) {
  const input = normalizeInput(await readJsonBody(req));
  logInfo("workflow.create_request", summarizeInputForLogs(input));
  if (!hasMinimumInput(input)) {
    logWarn("workflow.create_rejected", {
      reason: "missing_minimum_input"
    });
    return sendJson(res, 400, {
      error: "Add at least one meaningful customer signal or product context before starting a workflow."
    });
  }

  const workflow = await createWorkflow(input);
  logInfo("workflow.created", {
    workflowId: workflow.id
  });
  return sendJson(res, 201, serializeWorkflow(workflow));
}

function handleGetWorkflow(res, workflowId) {
  logInfo("workflow.fetch", {
    workflowId
  });
  return sendJson(res, 200, serializeWorkflow(readWorkflow(workflowId)));
}

async function handleGenerateWorkflowStage(res, workflowId, stageKey) {
  logInfo("workflow.stage_generate_request", {
    workflowId,
    stageKey
  });
  const workflow = await generateWorkflowStage(readWorkflow(workflowId), stageKey);
  saveWorkflow(workflow, `${WORKFLOW_STAGE_META[stageKey].label} draft regenerated.`);
  logInfo("workflow.stage_generated", {
    workflowId,
    stageKey,
    version: workflow.stages?.[stageKey]?.version || 0
  });
  return sendJson(res, 200, serializeWorkflow(workflow));
}

async function handleUpdateWorkflowStage(req, res, workflowId, stageKey) {
  const payload = await readJsonBody(req);
  logInfo("workflow.stage_update_request", {
    workflowId,
    stageKey
  });
  const workflow = updateWorkflowStage(readWorkflow(workflowId), stageKey, payload?.draft || payload);
  saveWorkflow(workflow, `${WORKFLOW_STAGE_META[stageKey].label} draft updated.`);
  logInfo("workflow.stage_updated", {
    workflowId,
    stageKey,
    version: workflow.stages?.[stageKey]?.version || 0
  });
  return sendJson(res, 200, serializeWorkflow(workflow));
}

function handleApproveWorkflowStage(res, workflowId, stageKey) {
  logInfo("workflow.stage_approve_request", {
    workflowId,
    stageKey
  });
  const workflow = approveWorkflowStage(readWorkflow(workflowId), stageKey);
  saveWorkflow(workflow, `${WORKFLOW_STAGE_META[stageKey].label} approved.`);
  logInfo("workflow.stage_approved", {
    workflowId,
    stageKey,
    approvedVersion: workflow.stages?.[stageKey]?.approvedVersion || null
  });
  return sendJson(res, 200, serializeWorkflow(workflow));
}

function handleWorkflowCodexRun(res, workflowId) {
  logInfo("workflow.codex_run_request", {
    workflowId
  });
  const workflow = runWorkflowCodex(readWorkflow(workflowId));
  saveWorkflow(workflow, "Codex launch requested.");
  logInfo("workflow.codex_run_started", {
    workflowId,
    jobId: workflow.codexJob?.id || "",
    status: workflow.codexJob?.status || "unknown"
  });
  return sendJson(res, 200, serializeWorkflow(workflow));
}

function startServer() {
  server.listen(PORT, HOST, () => {
    logInfo("server.started", {
      host: HOST,
      port: PORT,
      url: `http://${HOST}:${PORT}`
    });
  });

  server.on("error", (error) => {
    logError("server.failed_to_start", {
      host: HOST,
      port: PORT,
      message: error.message
    });
    process.exit(1);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  buildDemoAnalysis,
  normalizeAnalysis,
  normalizeInput,
  createWorkflow,
  generateWorkflowStage,
  updateWorkflowStage,
  approveWorkflowStage,
  runWorkflowCodex,
  readWorkflow,
  saveWorkflow,
  serializeWorkflow,
  renderCodexPrompt,
  renderWireframeMarkdown,
  renderBriefMarkdown,
  writeArtifacts,
  resolveWorkspacePath,
  buildRunId,
  startServer,
  serializeJob: codexJobsService.serializeJob,
  parseGeneratedFiles: codexJobsService.parseGeneratedFiles,
  jobs
};
