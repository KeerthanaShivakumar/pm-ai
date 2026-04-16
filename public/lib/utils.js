export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function linesToText(items) {
  return Array.isArray(items) ? items.join("\n") : "";
}

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function logUi(event, meta = {}, level = "log") {
  const logger = typeof console[level] === "function" ? console[level] : console.log;
  const safeMeta = normalizeLogMeta(meta);
  if (safeMeta && (typeof safeMeta !== "object" || Object.keys(safeMeta).length > 0)) {
    logger("[pm-ai-ui]", event, safeMeta);
    return;
  }
  logger("[pm-ai-ui]", event);
}

export function timeLabel(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function textLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeLogMeta(value, depth = 0) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  }
  if (typeof value === "function") {
    return "[function]";
  }
  if (depth >= 2) {
    if (Array.isArray(value)) {
      return `[array:${value.length}]`;
    }
    return "[object]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => normalizeLogMeta(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 12)
        .map(([key, item]) => [key, normalizeLogMeta(item, depth + 1)])
        .filter(([, item]) => item !== undefined)
    );
  }
  return String(value);
}
