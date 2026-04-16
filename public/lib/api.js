export async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "PM.ai request failed.");
  }
  return data;
}

export function subscribeToJobStream(jobId, handlers = {}) {
  const stream = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/stream`);
  const listen = (eventName, callback) => {
    if (!callback) {
      return;
    }

    stream.addEventListener(eventName, (event) => {
      try {
        callback(JSON.parse(event.data));
      } catch (error) {
        callback(null, error);
      }
    });
  };

  listen("snapshot", handlers.onSnapshot);
  listen("delta", handlers.onDelta);
  listen("update", handlers.onUpdate);
  listen("done", handlers.onDone);
  listen("failed", handlers.onFailed);

  stream.onerror = (event) => {
    if (handlers.onError) {
      handlers.onError(event);
    }
  };

  return stream;
}
