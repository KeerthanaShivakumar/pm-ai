const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
loadLocalEnvFiles(ROOT_DIR);

const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const ARTIFACTS_DIR = path.join(ROOT_DIR, "artifacts");
const DEFAULT_WORKSPACE_DIR = path.join(ROOT_DIR, "generated", "pm-ai-target");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const DEFAULT_CODEX_MODEL = process.env.CODEX_MODEL || "gpt-5.3-codex";
const jobs = new Map();
const LOG_PREFIX = "[pm-ai]";

const WORKFLOW_STAGE_ORDER = ["opportunity", "spec", "wireframe", "tickets", "codex"];
const WORKFLOW_STAGE_META = {
  opportunity: {
    label: "Opportunity",
    description: "Choose and justify the feature to build next."
  },
  spec: {
    label: "Spec",
    description: "Turn the recommendation into an editable feature spec."
  },
  wireframe: {
    label: "Wireframe",
    description: "Generate a Figma-style UX brief from the approved spec."
  },
  tickets: {
    label: "Tickets",
    description: "Break the approved scope into an initial build slice."
  },
  codex: {
    label: "Codex",
    description: "Prepare the final implementation kickoff and launch step."
  }
};
const WORKFLOW_STAGE_DEPENDENCIES = {
  opportunity: [],
  spec: ["opportunity"],
  wireframe: ["opportunity", "spec"],
  tickets: ["opportunity", "spec", "wireframe"],
  codex: ["opportunity", "spec", "wireframe", "tickets"]
};

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

ensureDir(ARTIFACTS_DIR);

function logInfo(event, meta) {
  writeLog("log", event, meta);
}

function logWarn(event, meta) {
  writeLog("warn", event, meta);
}

function logError(event, meta) {
  writeLog("error", event, meta);
}

function writeLog(method, event, meta) {
  const logger = typeof console[method] === "function" ? console[method] : console.log;
  const safeMeta = normalizeLogMeta(meta);
  if (safeMeta && (typeof safeMeta !== "object" || Object.keys(safeMeta).length > 0)) {
    logger(LOG_PREFIX, event, JSON.stringify(safeMeta));
    return;
  }
  logger(LOG_PREFIX, event);
}

function normalizeLogMeta(value, depth = 0, seen = new WeakSet()) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > 240 ? `${value.slice(0, 237)}...` : value;
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "function") {
    return "[function]";
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message
    };
  }
  if (value instanceof Set) {
    return {
      type: "Set",
      size: value.size
    };
  }
  if (value instanceof Map) {
    return {
      type: "Map",
      size: value.size
    };
  }
  if (depth >= 2) {
    if (Array.isArray(value)) {
      return `[array:${value.length}]`;
    }
    return "[object]";
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => normalizeLogMeta(item, depth + 1, seen));
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 16)
      .map(([key, item]) => [key, normalizeLogMeta(item, depth + 1, seen)])
      .filter(([, item]) => item !== undefined)
  );
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let totalBytes = 0;

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        logWarn("http.body_too_large", {
          maxBytes: MAX_BODY_BYTES,
          method: req.method,
          url: req.url
        });
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        logWarn("http.invalid_json_body", {
          method: req.method,
          url: req.url,
          message: error.message
        });
        reject(new Error("Request body must be valid JSON."));
      }
    });

    req.on("error", (error) => {
      logWarn("http.request_stream_error", {
        method: req.method,
        url: req.url,
        message: error.message
      });
      reject(error);
    });
  });
}

function serveFile(res, requestedPath, allowedRoot) {
  const safePath = path.resolve(requestedPath);
  const safeRoot = path.resolve(allowedRoot);
  if (!isPathInsideRoot(safePath, safeRoot)) {
    logWarn("static.access_denied", {
      requestedPath: safePath,
      allowedRoot: safeRoot
    });
    return sendJson(res, 403, { error: "Access denied." });
  }

  if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
    logWarn("static.not_found", {
      requestedPath: safePath
    });
    return sendJson(res, 404, { error: "File not found." });
  }

  const extension = path.extname(safePath).toLowerCase();
  const mimeType = MIME_TYPES[extension] || "application/octet-stream";
  res.writeHead(200, {
    ...buildBaseHeaders(),
    "Content-Type": mimeType
  });
  fs.createReadStream(safePath).pipe(res);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    ...buildBaseHeaders(),
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function buildBaseHeaders() {
  return {
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadLocalEnvFiles(rootDir) {
  const merged = {};
  for (const fileName of [".env", ".env.local"]) {
    const filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const parsed = parseDotEnv(fs.readFileSync(filePath, "utf8"));
    Object.assign(merged, parsed);
  }

  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseDotEnv(content) {
  const parsed = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function resolveWorkspacePath(value) {
  if (!value) {
    return DEFAULT_WORKSPACE_DIR;
  }
  return path.isAbsolute(value) ? value : path.resolve(ROOT_DIR, value);
}

function isPathInsideRoot(candidatePath, rootPath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function buildRunId(productName) {
  const slug = slugify(productName || "pm-ai");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${slug}-${stamp}`;
}

function slugify(value) {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "pm-ai";
}

function uniqueStrings(items) {
  return Array.from(new Set((items || []).map(asString).filter(Boolean)));
}

function stringArray(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const clean = value.map(asString).filter(Boolean);
  return clean.length ? clean : fallback;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function appendStageHistory(stage, kind, summary) {
  stage.history = Array.isArray(stage.history) ? stage.history : [];
  stage.history.push({
    version: Number(stage.version || 0),
    kind,
    at: new Date().toISOString(),
    summary,
    stale: Boolean(stage.stale),
    draft: stage.draft ? cloneJson(stage.draft) : null,
    approved: stage.approved ? cloneJson(stage.approved) : null
  });
  stage.history = stage.history.slice(-12);
}

function firstUsefulLine(value) {
  const lines = asString(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 20);
  return lines.length ? truncate(lines[0], 180) : "";
}

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 5;
  }
  return Math.max(1, Math.min(10, Math.round(numeric)));
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(value, maxLength) {
  const input = asString(value);
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength - 3)}...`;
}

function stripCodeFence(value) {
  return asString(value).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}

function mergeArtifacts(existingArtifacts, nextArtifacts) {
  const byName = new Map();
  [...existingArtifacts, ...nextArtifacts].forEach((artifact) => {
    if (artifact?.name) {
      byName.set(artifact.name, artifact);
    }
  });
  return Array.from(byName.values());
}

function summarizeInputForLogs(input) {
  return {
    productName: asString(input?.productName) || "PM.ai",
    hasTargetUsers: Boolean(asString(input?.targetUsers)),
    productContextChars: asString(input?.productContext).length,
    interviewsChars: asString(input?.interviews).length,
    feedbackChars: asString(input?.feedback).length,
    usageDataChars: asString(input?.usageData).length,
    implementationNotesChars: asString(input?.implementationNotes).length,
    runCodex: Boolean(input?.runCodex),
    hasWorkspacePath: Boolean(asString(input?.codexWorkspacePath))
  };
}

module.exports = {
  fs,
  path,
  ROOT_DIR,
  PUBLIC_DIR,
  ARTIFACTS_DIR,
  DEFAULT_WORKSPACE_DIR,
  PORT,
  HOST,
  OPENAI_RESPONSES_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_CODEX_MODEL,
  LOG_PREFIX,
  jobs,
  WORKFLOW_STAGE_ORDER,
  WORKFLOW_STAGE_META,
  WORKFLOW_STAGE_DEPENDENCIES,
  MIME_TYPES,
  readJsonBody,
  serveFile,
  sendJson,
  buildBaseHeaders,
  ensureDir,
  resolveWorkspacePath,
  isPathInsideRoot,
  buildRunId,
  uniqueStrings,
  stringArray,
  cloneJson,
  appendStageHistory,
  firstUsefulLine,
  clampScore,
  asString,
  truncate,
  stripCodeFence,
  escapeRegExp,
  createHttpError,
  mergeArtifacts,
  logInfo,
  logWarn,
  logError,
  summarizeInputForLogs
};
