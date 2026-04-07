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
let _processing = false;
let _activeCount = 0;

// How many concurrent Ollama requests to allow
// Ollama serializes internally, but we allow 1 active + 1 queued to pipeline
const MAX_CONCURRENT = 1;

async function processQueue(): Promise<void> {
  if (_processing) return;
  _processing = true;

  try {
    while (_queue.length > 0 && _activeCount < MAX_CONCURRENT) {
      // Always pick highest priority (lowest number)
      _queue.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
      const item = _queue.shift()!;
      _activeCount++;

      try {
        const result = await item.execute();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      } finally {
        _activeCount--;
      }
    }
  } finally {
    _processing = false;
    // If more items queued, continue
    if (_queue.length > 0) {
      setImmediate(() => processQueue());
    }
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
  return _queue.some((r) => r.priority === 0) || (_activeCount > 0);
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
