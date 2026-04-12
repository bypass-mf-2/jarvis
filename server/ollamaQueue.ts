/**
 * Ollama Priority Queue
 *
 * Ensures user chat requests always go first.
 * Background tasks (embeddings, analysis) yield when a user request is pending.
 *
 * Priority levels:
 *   0 = CRITICAL (user chat) — runs immediately, preempts background work
 *   1 = NORMAL   (memory extraction, model routing)
 *   2 = LOW      (embeddings, source discovery)
 */

type QueuedRequest<T> = {
  priority: number;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
  createdAt: number;
};

const _queue: QueuedRequest<any>[] = [];
let _activeCount = 0;
// Track how many priority-0 (user chat) requests are currently executing so
// we can hold back background embed work until chat finishes. Mixing chat
// and embed on Ollama forces it to swap models in/out of VRAM, which blows
// the 120s chat timeout.
let _activeUserCount = 0;

// How many concurrent Ollama requests to allow.
// Ollama serializes at the model level internally, but we want a user chat
// (priority 0) to be able to ALSO hold an HTTP slot while a priority-2
// embedding runs, so Ollama picks up the chat immediately when the embed
// finishes instead of waiting for our queue to re-dispatch.
const MAX_CONCURRENT = 4;

// Any priority >= this is treated as "background" and held back whenever
// a user chat (priority 0) is pending or executing. Set to 1 so that
// autoTrain's priority-1 JSON chat calls ALSO yield — previously those
// were slipping through and hammering Ollama during user chats, causing
// the 120s chat timeout to fire and fall back to the Forge LLM.
const BACKGROUND_PRIORITY_THRESHOLD = 1;

function processQueue(): void {
  // Dispatch up to MAX_CONCURRENT items in parallel. Previously this used
  // `await item.execute()` inside a while loop, which serialized everything
  // — priority was effectively meaningless because a priority-2 task in
  // flight would block a priority-0 chat for the entire embed duration.
  while (_queue.length > 0 && _activeCount < MAX_CONCURRENT) {
    // Always pick highest priority (lowest number)
    _queue.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
    const next = _queue[0];

    // If the next candidate is background and a user chat is pending or
    // currently executing, hold the background task back. This prevents
    // Ollama from being forced to swap between llama3.2 and the embed
    // model mid-chat, which was blowing the 120s chat timeout.
    if (
      next.priority >= BACKGROUND_PRIORITY_THRESHOLD &&
      (_activeUserCount > 0 || _queue.some((r) => r.priority === 0))
    ) {
      break;
    }

    _queue.shift();
    _activeCount++;
    if (next.priority === 0) _activeUserCount++;

    // Fire-and-forget — do NOT await here, otherwise the loop degenerates
    // to serial execution and MAX_CONCURRENT is ignored.
    const isUser = next.priority === 0;
    Promise.resolve()
      .then(() => next.execute())
      .then(
        (result) => next.resolve(result),
        (err) => next.reject(err)
      )
      .finally(() => {
        _activeCount--;
        if (isUser) _activeUserCount--;
        processQueue();
      });
  }
}

/**
 * Enqueue an Ollama request with priority.
 * Priority 0 = user chat (highest), 1 = normal, 2 = background (lowest)
 */
export function enqueueOllama<T>(priority: number, execute: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    _queue.push({ priority, execute, resolve, reject, createdAt: Date.now() });
    processQueue();
  });
}

/** Check if a user (priority 0) request is currently queued or active */
export function hasUserRequestPending(): boolean {
  return _queue.some((r) => r.priority === 0);
}

/** Get queue stats for debugging */
export function getQueueStats() {
  return {
    queued: _queue.length,
    active: _activeCount,
    byPriority: {
      critical: _queue.filter((r) => r.priority === 0).length,
      normal: _queue.filter((r) => r.priority === 1).length,
      low: _queue.filter((r) => r.priority === 2).length,
    },
  };
}
