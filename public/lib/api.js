import { logUi } from "./utils.js";

export async function apiJson(url, options = {}) {
  const method = options.method || "GET";
  logUi("api.request", {
    method,
    url
  });
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    logUi("api.response", {
      method,
      url,
      status: response.status,
      ok: response.ok
    });
    if (!response.ok) {
      logUi(
        "api.response_failed",
        {
          method,
          url,
          status: response.status,
          message: data.error || "PM.ai request failed."
        },
        "warn"
      );
      throw new Error(data.error || "PM.ai request failed.");
    }
    return data;
  } catch (error) {
    logUi(
      "api.request_exception",
      {
        method,
        url,
        message: error.message
      },
      "warn"
    );
    throw error;
  }
}

export function subscribeToJobStream(jobId, handlers = {}) {
  logUi("job.stream_subscribe", {
    jobId
  });
  const stream = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/stream`);
  const listen = (eventName, callback) => {
    if (!callback) {
      return;
    }

    stream.addEventListener(eventName, (event) => {
      try {
        if (eventName !== "delta") {
          logUi("job.stream_event", {
            jobId,
            eventName
          });
        }
        callback(JSON.parse(event.data));
      } catch (error) {
        logUi(
          "job.stream_parse_failed",
          {
            jobId,
            eventName,
            message: error.message
          },
          "warn"
        );
        callback(null, error);
      }
    });
  };

  listen("snapshot", handlers.onSnapshot);
  listen("delta", handlers.onDelta);
  listen("update", handlers.onUpdate);
  listen("done", handlers.onDone);
  listen("failed", handlers.onFailed);

  stream.onopen = () => {
    logUi("job.stream_open", {
      jobId
    });
  };

  stream.onerror = (event) => {
    logUi(
      "job.stream_error",
      {
        jobId
      },
      "warn"
    );
    if (handlers.onError) {
      handlers.onError(event);
    }
  };

  return stream;
}
