const {
  fs,
  path,
  jobs,
  OPENAI_RESPONSES_URL,
  DEFAULT_CODEX_MODEL,
  ensureDir,
  resolveWorkspacePath,
  asString,
  mergeArtifacts,
  sendJson,
  logInfo,
  logWarn,
  logError
} = require("./common");
const { renderCodexCommandPreview } = require("./render");
const { safelyExtractResponseText } = require("./analysis");

function createCodexJobsService({ readWorkflow, saveWorkflow, getWorkflowRunDir }) {
  return {
    handleJobStream,
    startCodexResponsesJob,
    serializeJob,
    parseGeneratedFiles
  };

  function handleJobStream(req, res, jobId) {
    const job = jobs.get(jobId);
    if (!job) {
      logWarn("codex.stream_missing_job", {
        jobId
      });
      return sendJson(res, 404, { error: "Job not found." });
    }

    logInfo("codex.stream_opened", {
      jobId,
      runId: job.runId,
      status: job.status
    });
    const closeStream = openSseStream(res);
    writeSseEvent(res, "snapshot", serializeJob(job));

    if (job.status !== "running") {
      writeSseEvent(res, "done", serializeJob(job));
      logInfo("codex.stream_closed_immediately", {
        jobId,
        runId: job.runId,
        status: job.status
      });
      closeStream();
      return undefined;
    }

    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000);

    job.clients.add(res);
    req.on("close", () => {
      clearInterval(keepAlive);
      job.clients.delete(res);
      logInfo("codex.stream_closed", {
        jobId,
        runId: job.runId,
        status: job.status
      });
      closeStream();
    });
    return undefined;
  }

  function startCodexResponsesJob({ input, runId, artifactBundle, prompt }) {
    logInfo("codex.job_requested", {
      runId,
      hasApiKey: Boolean(process.env.OPENAI_API_KEY)
    });
    if (!process.env.OPENAI_API_KEY) {
      logWarn("codex.job_disabled", {
        runId,
        reason: "missing_openai_api_key"
      });
      return {
        status: "disabled",
        reason: "Set OPENAI_API_KEY to stream implementation output from the Responses API."
      };
    }

    const workspacePath = resolveWorkspacePath(input.codexWorkspacePath);
    const codexDir = path.join(artifactBundle.runDir, "codex");
    ensureDir(codexDir);

    const job = {
      id: `job-${Date.now()}`,
      runId,
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      completionMessage: "",
      model: DEFAULT_CODEX_MODEL,
      command: renderCodexCommandPreview(),
      workspacePath,
      responseId: "",
      error: "",
      usage: null,
      tail: [],
      outputText: "",
      files: [],
      clients: new Set(),
      logPath: path.join(codexDir, "stream.log"),
      logUrl: `/artifacts/${runId}/codex/stream.log`,
      outputPath: path.join(codexDir, "output.md"),
      outputUrl: `/artifacts/${runId}/codex/output.md`,
      filesPath: path.join(codexDir, "files.json"),
      filesUrl: `/artifacts/${runId}/codex/files.json`,
      statePath: path.join(codexDir, "job.json"),
      stateUrl: `/artifacts/${runId}/codex/job.json`
    };

    jobs.set(job.id, job);
    fs.writeFileSync(job.logPath, "", "utf8");
    persistCodexJobArtifacts(job);
    logInfo("codex.job_started", {
      jobId: job.id,
      runId,
      model: job.model,
      workspacePath
    });

    void performCodexResponsesRun(job, {
      prompt,
      workspacePath
    }).catch((error) => {
      logError("codex.job_unhandled_failure", {
        jobId: job.id,
        runId: job.runId,
        message: error.message
      });
      failCodexJob(job, error.message);
    });

    return serializeJob(job);
  }

  async function performCodexResponsesRun(job, { prompt, workspacePath }) {
    logInfo("codex.responses_request_started", {
      jobId: job.id,
      runId: job.runId,
      model: job.model,
      workspacePath,
      promptChars: asString(prompt).length
    });
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: job.model,
        stream: true,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: buildCodexSystemPrompt(workspacePath)
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: prompt
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      logWarn("codex.responses_request_failed", {
        jobId: job.id,
        runId: job.runId,
        status: response.status
      });
      throw new Error(await extractOpenAIErrorMessage(response));
    }
    if (!response.body) {
      throw new Error("OpenAI returned no streaming body for the coding run.");
    }
    logInfo("codex.responses_stream_connected", {
      jobId: job.id,
      runId: job.runId,
      status: response.status
    });

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      buffer = consumeResponsesSseBuffer(job, buffer);
    }

    if (buffer.trim()) {
      consumeResponsesSseBuffer(job, `${buffer}\n\n`);
    }

    if (job.status === "running") {
      finishCodexJob(job, buildCompletionMessage(job, "stream_closed"));
    }
  }

  function consumeResponsesSseBuffer(job, buffer) {
    let working = buffer;
    while (true) {
      const boundaryMatch = working.match(/\r?\n\r?\n/);
      if (!boundaryMatch || typeof boundaryMatch.index !== "number") {
        return working;
      }

      const rawEvent = working.slice(0, boundaryMatch.index);
      working = working.slice(boundaryMatch.index + boundaryMatch[0].length);
      processResponsesSseEvent(job, rawEvent);
    }
  }

  function processResponsesSseEvent(job, rawEvent) {
    const lines = rawEvent.split(/\r?\n/);
    let eventName = "message";
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    const rawData = dataLines.join("\n").trim();
    if (!rawData || rawData === "[DONE]") {
      if (rawData === "[DONE]" && job.status === "running") {
        finishCodexJob(job, buildCompletionMessage(job, "done_signal"));
      }
      return;
    }

    let payload = null;
    try {
      payload = JSON.parse(rawData);
    } catch (error) {
      payload = { raw: rawData };
    }

    const type = asString(payload?.type) || eventName;
    const responseData =
      payload?.response && typeof payload.response === "object" ? payload.response : payload;
    const responseId = asString(responseData?.id) || asString(payload?.response_id);
    if (responseId) {
      job.responseId = responseId;
    }

    const delta = extractResponsesTextDelta(type, payload);
    if (delta) {
      appendCodexDelta(job, delta);
    }

    if (payload?.usage && typeof payload.usage === "object") {
      job.usage = payload.usage;
    }
    if (responseData?.usage && typeof responseData.usage === "object") {
      job.usage = responseData.usage;
    }

    if (type === "response.completed") {
      const completedText = safelyExtractResponseText(responseData);
      if (completedText && completedText.length > job.outputText.length) {
        replaceCodexOutput(job, completedText);
      }
      logInfo("codex.responses_completed_event", {
        jobId: job.id,
        runId: job.runId,
        responseId: job.responseId
      });
      finishCodexJob(job, buildCompletionMessage(job, "response_completed"));
      return;
    }

    if (type === "response.failed" || type === "response.error" || type === "error") {
      const message =
        payload?.error?.message || payload?.message || payload?.raw || "The coding stream failed.";
      logWarn("codex.responses_failed_event", {
        jobId: job.id,
        runId: job.runId,
        type,
        message
      });
      failCodexJob(job, message);
    }
  }

  function appendCodexDelta(job, delta) {
    if (!delta) {
      return;
    }

    job.outputText += delta;
    fs.appendFileSync(job.logPath, delta, "utf8");
    updateCodexDerivedState(job);
    pushJobEvent(job, "delta", {
      id: job.id,
      delta,
      files: job.files,
      tail: job.tail
    });
  }

  function replaceCodexOutput(job, nextOutput) {
    job.outputText = nextOutput;
    fs.writeFileSync(job.logPath, nextOutput, "utf8");
    updateCodexDerivedState(job);
    pushJobEvent(job, "update", serializeJob(job));
  }

  function updateCodexDerivedState(job) {
    job.files = parseGeneratedFiles(job.outputText);
    job.tail = job.outputText
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(-40);
    persistCodexJobArtifacts(job);
  }

  function finishCodexJob(job, completionMessage) {
    if (job.status !== "running") {
      return;
    }

    job.status = "completed";
    job.completedAt = new Date().toISOString();
    job.completionMessage = asString(completionMessage) || buildCompletionMessage(job, "completed");
    persistCodexJobArtifacts(job);
    syncJobIntoWorkflow(job);
    logInfo("codex.job_completed", {
      jobId: job.id,
      runId: job.runId,
      responseId: job.responseId,
      files: job.files.length,
      outputChars: job.outputText.length,
      completionMessage: job.completionMessage
    });
    closeCodexJobStreams(job, "done");
  }

  function failCodexJob(job, message) {
    if (job.status !== "running") {
      return;
    }

    job.status = "failed";
    job.error = asString(message) || "The coding stream failed.";
    job.completedAt = new Date().toISOString();
    job.completionMessage = `Code generation stopped: ${job.error}`;
    job.tail.push(`error: ${job.error}`);
    job.tail = job.tail.slice(-40);
    fs.appendFileSync(job.logPath, `\n\n[error] ${job.error}\n`, "utf8");
    persistCodexJobArtifacts(job);
    syncJobIntoWorkflow(job);
    logError("codex.job_failed", {
      jobId: job.id,
      runId: job.runId,
      message: job.error,
      completionMessage: job.completionMessage
    });
    closeCodexJobStreams(job, "failed");
  }

  function persistCodexJobArtifacts(job) {
    fs.writeFileSync(job.outputPath, job.outputText || "", "utf8");
    fs.writeFileSync(job.filesPath, `${JSON.stringify(job.files, null, 2)}\n`, "utf8");
    fs.writeFileSync(job.statePath, `${JSON.stringify(serializeJob(job), null, 2)}\n`, "utf8");
  }

  function syncJobIntoWorkflow(job) {
    const workflowPath = path.join(getWorkflowRunDir(job.runId), "workflow.json");
    if (!fs.existsSync(workflowPath)) {
      logWarn("codex.job_workflow_missing", {
        jobId: job.id,
        runId: job.runId
      });
      return;
    }

    const workflow = readWorkflow(job.runId);
    workflow.codexJob = serializeJob(job);
    workflow.artifacts = mergeArtifacts(workflow.artifacts || [], [
      {
        name: "codex/stream.log",
        path: job.logPath,
        url: job.logUrl
      },
      {
        name: "codex/output.md",
        path: job.outputPath,
        url: job.outputUrl
      },
      {
        name: "codex/files.json",
        path: job.filesPath,
        url: job.filesUrl
      },
      {
        name: "codex/job.json",
        path: job.statePath,
        url: job.stateUrl
      }
    ]);
    saveWorkflow(workflow);
    logInfo("codex.job_synced_to_workflow", {
      jobId: job.id,
      runId: job.runId,
      artifacts: workflow.artifacts.length
    });
  }

  function closeCodexJobStreams(job, eventName) {
    const snapshot = serializeJob(job);
    for (const res of job.clients) {
      writeSseEvent(res, eventName, snapshot);
      res.end();
    }
    job.clients.clear();
  }
}

function openSseStream(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  return () => {
    if (!res.writableEnded) {
      res.end();
    }
  };
}

function pushJobEvent(job, eventName, payload) {
  for (const res of job.clients) {
    writeSseEvent(res, eventName, payload);
  }
}

function writeSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function serializeJob(job) {
  return {
    id: job.id,
    runId: job.runId,
    status: job.status,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    model: job.model,
    responseId: job.responseId,
    command: job.command,
    workspacePath: job.workspacePath,
    logPath: job.logPath,
    logUrl: job.logUrl,
    outputPath: job.outputPath,
    outputUrl: job.outputUrl,
    filesPath: job.filesPath,
    filesUrl: job.filesUrl,
    statePath: job.statePath,
    stateUrl: job.stateUrl,
    streamUrl: `/api/jobs/${job.id}/stream`,
    error: job.error,
    completionMessage: job.completionMessage,
    usage: job.usage,
    tail: job.tail,
    outputText: job.outputText,
    files: job.files
  };
}

function buildCompletionMessage(job, mode) {
  const fileCount = Array.isArray(job.files) ? job.files.length : 0;
  const fileLabel = `${fileCount} file${fileCount === 1 ? "" : "s"}`;

  if (mode === "response_completed" || mode === "done_signal" || mode === "completed") {
    return `Code generation completed. Parsed ${fileLabel}.`;
  }

  if (mode === "stream_closed") {
    return `Code generation stream ended. Parsed ${fileLabel}.`;
  }

  return `Code generation finished. Parsed ${fileLabel}.`;
}

function buildCodexSystemPrompt(workspacePath) {
  return [
    "You are PM.ai's implementation finisher.",
    "Return implementation output that can be rendered live in a code viewer.",
    "After a short plan, emit one or more file blocks in this exact shape:",
    "FILE: relative/path",
    "```language",
    "<full file contents>",
    "```",
    "Finish with SUMMARY: and a few concise bullets.",
    "Do not emit shell commands, diff hunks, or patch markers.",
    workspacePath ? `Assume the target repo root is ${workspacePath}.` : null
  ]
    .filter(Boolean)
    .join("\n");
}

function extractResponsesTextDelta(type, payload) {
  if (type === "response.output_text.delta" && typeof payload?.delta === "string") {
    return payload.delta;
  }
  if (type === "response.output_text.done") {
    return "";
  }
  if (typeof payload?.delta === "string" && /output_text|message|content/i.test(type)) {
    return payload.delta;
  }
  if (typeof payload?.text === "string" && /output_text/i.test(type)) {
    return payload.text;
  }
  return "";
}

function parseGeneratedFiles(outputText) {
  const files = [];
  const pattern = /(?:^|\n)FILE:\s*([^\n]+)\n```([^\n]*)\n([\s\S]*?)```/g;
  let match = pattern.exec(outputText);

  while (match) {
    files.push({
      path: asString(match[1]),
      language: asString(match[2]),
      content: match[3].replace(/\s+$/, "")
    });
    match = pattern.exec(outputText);
  }

  return files.filter((file) => file.path && file.content);
}

async function extractOpenAIErrorMessage(response) {
  const raw = await response.text();
  try {
    const data = JSON.parse(raw);
    return data?.error?.message || `Request failed with status ${response.status}`;
  } catch (error) {
    return raw || `Request failed with status ${response.status}`;
  }
}

module.exports = {
  createCodexJobsService
};
