/**
 * One-shot backfill — turn the corrections table into seed opinions.
 *
 * The opinions system is forward-looking by default: it only auto-forms
 * positions on confusion events going forward. Months of accumulated
 * corrections (the highest-signal data we have) sit untouched.
 *
 * This module reads the corrections table, groups by extracted topic,
 * and runs formOpinion for every topic with >= MIN_CORRECTIONS_PER_TOPIC
 * corrections. Each opinion gets an evidence trail and confidence score
 * via the existing pipeline; nothing is bypassed.
 *
 * Safe to run multiple times: skips topics that already have an opinion
 * (formOpinion respects isUserOverride; for non-override existing opinions
 * we still skip to avoid wasting LLM cycles re-deriving what's already
 * there). Resumable — kill the script and re-run, it picks up the queue.
 *
 * Modeled on the SQLite migration pattern: count before, run with
 * progress, count after, log every action so you can audit what changed.
 */

import { logger } from "./logger.js";

const MIN_CORRECTIONS_PER_TOPIC = 2;
const MAX_TOPICS_PER_RUN = 50; // bounded so a runaway corpus doesn't pin Ollama

export interface BackfillProgress {
  totalCorrections: number;
  totalTopics: number;
  qualifyingTopics: number;
  skippedExisting: number;
  attempted: number;
  formed: number;
  failed: number;
  topicsFormed: string[];
  topicsFailed: Array<{ topic: string; reason: string }>;
}

/**
 * Walk corrections, group by extracted topics, form opinions for the
 * frequent ones. Returns a structured report of what happened.
 *
 * @param dryRun if true, identifies + counts but doesn't actually call
 *               formOpinion. Use this first to preview the scope.
 */
export async function backfillOpinionsFromCorrections(
  options: { dryRun?: boolean; minCorrections?: number; maxTopics?: number } = {},
): Promise<BackfillProgress> {
  const dryRun = options.dryRun ?? false;
  const minCorrections = options.minCorrections ?? MIN_CORRECTIONS_PER_TOPIC;
  const maxTopics = options.maxTopics ?? MAX_TOPICS_PER_RUN;

  await logger.info(
    "opinionBackfill",
    `Starting${dryRun ? " (DRY RUN)" : ""} — minCorrections=${minCorrections} maxTopics=${maxTopics}`,
  );

  // Step 1: read every correction. listCorrections caps at 50 by default —
  // override with a generous limit since we want the full set.
  const { listCorrections } = await import("./activeLearning.js");
  const corrections = listCorrections(100_000);
  const totalCorrections = corrections.length;
  await logger.info("opinionBackfill", `Read ${totalCorrections} corrections from DB`);

  // Step 2: extract topics. topicTags can be JSON array, comma-separated,
  // or empty. Handle all three.
  const topicCounts = new Map<string, number>();
  const topicSamples = new Map<string, Array<{ original: string; corrected: string }>>();

  for (const c of corrections) {
    const topics = parseTopicTags(c.topicTags);
    if (topics.length === 0) {
      // Fall back to extracting from userFeedback or correctedResponse — but
      // only if we can produce a clean candidate (single noun-ish phrase).
      const fallback = guessTopicFromText(c.correctedResponse) ?? guessTopicFromText(c.userFeedback);
      if (fallback) topics.push(fallback);
    }
    for (const topic of topics) {
      const norm = normalizeTopicForBackfill(topic);
      if (!norm || norm.length < 3) continue;
      topicCounts.set(norm, (topicCounts.get(norm) ?? 0) + 1);
      const samples = topicSamples.get(norm) ?? [];
      if (samples.length < 3) {
        samples.push({ original: c.originalResponse.slice(0, 200), corrected: c.correctedResponse.slice(0, 200) });
      }
      topicSamples.set(norm, samples);
    }
  }

  await logger.info(
    "opinionBackfill",
    `Identified ${topicCounts.size} unique topics across ${totalCorrections} corrections`,
  );

  // Step 3: filter to topics with enough corrections, sorted by frequency
  const qualifying = Array.from(topicCounts.entries())
    .filter(([, count]) => count >= minCorrections)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTopics);

  await logger.info(
    "opinionBackfill",
    `${qualifying.length} topics meet the threshold (>=${minCorrections}); will ${dryRun ? "preview" : "process"}`,
  );

  const progress: BackfillProgress = {
    totalCorrections,
    totalTopics: topicCounts.size,
    qualifyingTopics: qualifying.length,
    skippedExisting: 0,
    attempted: 0,
    formed: 0,
    failed: 0,
    topicsFormed: [],
    topicsFailed: [],
  };

  if (dryRun) {
    // Preview only — log the qualifying list and bail.
    for (const [topic, count] of qualifying.slice(0, 20)) {
      console.log(`  ${count.toString().padStart(3)} corrections: "${topic}"`);
    }
    if (qualifying.length > 20) console.log(`  … and ${qualifying.length - 20} more`);
    return progress;
  }

  // Step 4: import opinions module + iterate
  const { formOpinion, getOpinion } = await import("./opinions.js");

  for (const [topic, count] of qualifying) {
    // Skip if an opinion already exists (locked or just present) — we don't
    // want to overwrite accumulated state. formOpinion would also skip
    // user-overrides but we want explicit logging here.
    const existing = getOpinion(topic);
    if (existing) {
      progress.skippedExisting++;
      continue;
    }

    progress.attempted++;
    try {
      await logger.info(
        "opinionBackfill",
        `Forming opinion #${progress.attempted}/${qualifying.length}: "${topic}" (${count} corrections)`,
      );
      const op = await formOpinion(topic);
      if (op) {
        progress.formed++;
        progress.topicsFormed.push(topic);
      } else {
        progress.failed++;
        progress.topicsFailed.push({ topic, reason: "formOpinion returned null (no evidence?)" });
      }
    } catch (err) {
      progress.failed++;
      progress.topicsFailed.push({ topic, reason: String(err).slice(0, 200) });
      await logger.warn("opinionBackfill", `Failed for "${topic}": ${String(err).slice(0, 200)}`);
    }
  }

  await logger.info(
    "opinionBackfill",
    `Done. formed=${progress.formed} skipped=${progress.skippedExisting} failed=${progress.failed}`,
  );
  return progress;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTopicTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  // Try JSON first
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
  } catch { /* fall through */ }
  // Fall back to comma-separated
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function normalizeTopicForBackfill(topic: string): string {
  return topic
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Heuristic: pull the dominant noun-phrase out of free text. Used when
 * topicTags is empty. Picks the longest 2-4 word capitalized run, falls
 * back to the first sentence's first noun-ish word. Crude — that's why
 * we only use it as a fallback.
 */
function guessTopicFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length < 4) return null;
  // Look for the first multi-word capitalized phrase
  const m = trimmed.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/);
  if (m) return m[1];
  // Fall back to the first 2-3 word phrase
  const words = trimmed.split(/\s+/).filter((w) => w.length > 2 && /^[a-zA-Z]/.test(w));
  if (words.length >= 2) return words.slice(0, 3).join(" ");
  return null;
}
