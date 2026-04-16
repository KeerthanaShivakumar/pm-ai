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
  jobs
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

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        mode: process.env.OPENAI_API_KEY ? "openai" : "demo",
        defaultOpenAiModel: DEFAULT_OPENAI_MODEL,
        defaultCodexModel: DEFAULT_CODEX_MODEL,
        codexAutoRunEnabled: process.env.ALLOW_CODEX_RUN === "1",
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
        return sendJson(res, 404, { error: "Job not found." });
      }
      return sendJson(res, 200, codexJobsService.serializeJob(job));
    }

    if (req.method === "GET" && url.pathname.startsWith("/artifacts/")) {
      return serveFile(res, `${ROOT_DIR}${url.pathname}`, ARTIFACTS_DIR);
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/public/"))) {
      const relativePath = url.pathname === "/" ? "/index.html" : url.pathname.replace("/public", "");
      return serveFile(res, `${PUBLIC_DIR}${relativePath}`, PUBLIC_DIR);
    }

    return sendJson(res, 404, { error: "Route not found." });
  } catch (error) {
    if ((error.statusCode || 500) >= 500) {
      console.error(error);
    } else {
      console.warn(`${req.method || "REQUEST"} ${req.url || ""} -> ${error.statusCode || 400}: ${error.publicMessage || error.message}`);
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
  if (!hasMinimumInput(input)) {
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
    prompt: analysis.codexKickoff.prompt,
    autoRequested: true
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
  if (!hasMinimumInput(input)) {
    return sendJson(res, 400, {
      error: "Add at least one meaningful customer signal or product context before starting a workflow."
    });
  }

  return sendJson(res, 201, serializeWorkflow(await createWorkflow(input)));
}

function handleGetWorkflow(res, workflowId) {
  return sendJson(res, 200, serializeWorkflow(readWorkflow(workflowId)));
}

async function handleGenerateWorkflowStage(res, workflowId, stageKey) {
  const workflow = await generateWorkflowStage(readWorkflow(workflowId), stageKey);
  saveWorkflow(workflow, `${WORKFLOW_STAGE_META[stageKey].label} draft regenerated.`);
  return sendJson(res, 200, serializeWorkflow(workflow));
}

async function handleUpdateWorkflowStage(req, res, workflowId, stageKey) {
  const payload = await readJsonBody(req);
  const workflow = updateWorkflowStage(readWorkflow(workflowId), stageKey, payload?.draft || payload);
  saveWorkflow(workflow, `${WORKFLOW_STAGE_META[stageKey].label} draft updated.`);
  return sendJson(res, 200, serializeWorkflow(workflow));
}

function handleApproveWorkflowStage(res, workflowId, stageKey) {
  const workflow = approveWorkflowStage(readWorkflow(workflowId), stageKey);
  saveWorkflow(workflow, `${WORKFLOW_STAGE_META[stageKey].label} approved.`);
  return sendJson(res, 200, serializeWorkflow(workflow));
}

function handleWorkflowCodexRun(res, workflowId) {
  const workflow = runWorkflowCodex(readWorkflow(workflowId));
  saveWorkflow(workflow, "Codex launch requested.");
  return sendJson(res, 200, serializeWorkflow(workflow));
}

function startServer() {
  server.listen(PORT, HOST, () => {
    console.log(`PM.ai is running at http://${HOST}:${PORT}`);
  });

  server.on("error", (error) => {
    console.error(`PM.ai could not start on ${HOST}:${PORT}: ${error.message}`);
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
