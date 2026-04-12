/**
 * Improvement Feed
 * ----------------
 * A focused, append-only event log of high-signal "things worth fixing"
 * captured from across Jarvis. Distinct from the noisy `system_logs` table
 * (info-level chatter, scrape progress, etc.) — this file only contains
 * actionable signals: parse failures, auto-disabled sources, validator
 * rejections, repeated errors.
 *
 * Format: newline-delimited JSON (JSONL) at `logs/improvement-feed.jsonl`.
 * One event per line, easy to append, easy to tail, easy to read with any
 * tool. Survives DB resets and migrations because it lives in the repo's
 * working directory, not in SQLite.
 *
 * Two consumers in mind:
 *   1. Claude Code (this assistant) — the user can ask "review the
 *      improvement feed" and Claude reads the file directly with the Read
 *      tool. No DB access needed.
 *   2. Jarvis itself — `analyzeSelfForImprovements()` in selfImprovement.ts
 *      can be wired to consume this feed in a follow-up commit, so the AI
 *      gradually starts proposing patches based on its own pain points.
 *
 * The file is automatically rotated when it exceeds MAX_FEED_BYTES so it
 * doesn't grow without bound. Older events are kept in `.1` for one cycle.
 */

import * as fs from "fs";
import * as path from "path";

const FEED_DIR = path.join(process.cwd(), "logs");
const FEED_PATH = path.join(FEED_DIR, "improvement-feed.jsonl");
const FEED_BACKUP = FEED_PATH + ".1";
const MAX_FEED_BYTES = 2 * 1024 * 1024; // 2 MB before rotation

export type ImprovementEventType =
  | "scrape_auto_disable"
  | "scrape_parse_failure"
  | "autotrain_parse_failure"
  | "discovery_validation_rejected"
  | "repeated_error"
  | "manual_note";

export interface ImprovementEvent {
  /** Set automatically — never pass this in. */
  ts?: number;
  /** Stable category for filtering / aggregation. */
  type: ImprovementEventType;
  /** Source module ("scraper", "autoTrain", etc.) */
  module: string;
  /** One-line human summary. Keep it terse. */
  summary: string;
  /** Optional structured details — anything JSON-serializable. */
  details?: Record<string, unknown>;
}

function ensureDir(): void {
  if (!fs.existsSync(FEED_DIR)) {
    fs.mkdirSync(FEED_DIR, { recursive: true });
  }
}

function maybeRotate(): void {
  try {
    const stat = fs.statSync(FEED_PATH);
    if (stat.size < MAX_FEED_BYTES) return;
    // Move current to .1, replacing any prior backup. Keeps one generation.
    if (fs.existsSync(FEED_BACKUP)) fs.unlinkSync(FEED_BACKUP);
    fs.renameSync(FEED_PATH, FEED_BACKUP);
  } catch {
    // No file yet or rotate failed — caller will recreate via append.
  }
}

/**
 * Append a high-signal event to the improvement feed. Best-effort: never
 * throws to the caller, since logging failures shouldn't crash the thing
 * being logged about.
 */
export function recordEvent(event: ImprovementEvent): void {
  try {
    ensureDir();
    maybeRotate();
    const line = JSON.stringify({ ...event, ts: Date.now() }) + "\n";
    fs.appendFileSync(FEED_PATH, line, "utf8");
  } catch (err) {
    // Surface to console but never propagate.
    console.warn("[improvementFeed] Failed to write event:", err);
  }
}

/**
 * Read the most recent N events from the feed (newest first). Returns an
 * empty array if the file doesn't exist yet. Used by the future Jarvis
 * self-analysis loop and by manual reviews.
 */
export function readRecentEvents(limit = 100): ImprovementEvent[] {
  try {
    if (!fs.existsSync(FEED_PATH)) return [];
    const content = fs.readFileSync(FEED_PATH, "utf8");
    const lines = content.split("\n").filter(Boolean);
    const tail = lines.slice(-limit).reverse();
    const events: ImprovementEvent[] = [];
    for (const line of tail) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // Skip corrupted lines rather than failing the whole read.
      }
    }
    return events;
  } catch (err) {
    console.warn("[improvementFeed] Failed to read feed:", err);
    return [];
  }
}

export function getFeedPath(): string {
  return FEED_PATH;
}
