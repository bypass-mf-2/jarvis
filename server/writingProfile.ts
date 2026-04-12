/**
 * Writing Profile — personal voice analyzer.
 *
 * Separate from regular file ingestion: documents uploaded here are NEVER
 * embedded into the vector store, NEVER retrieved by RAG, and NEVER appear
 * in chat context as reference material. Their sole purpose is to teach
 * Jarvis how the user writes — sentence length, vocabulary, tone, voice,
 * verbal tics — so the chat system prompt can mirror that voice.
 *
 * Pipeline:
 *   upload → extract text (via fileIngestion.processFile)
 *          → store row in writing_samples
 *          → ask Ollama JSON mode for per-sample style features
 *          → regenerate aggregate writing_profile row
 *
 * The aggregate profile is what chat reads from.
 */

import * as fs from "fs";
import * as path from "path";
import { ollamaChatJson } from "./ollama.js";
import {
  addWritingSample,
  listWritingSamples,
  updateWritingSampleFeatures,
  deleteWritingSample as dbDeleteWritingSample,
  getWritingProfile as dbGetWritingProfile,
  setWritingProfile,
  clearWritingProfile,
  type WritingSample,
} from "./db.js";
import { processFile } from "./fileIngestion.js";
import { logger } from "./logger.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type WritingCategory =
  | "essay"
  | "lab_report"
  | "book_report"
  | "resume"
  | "book"
  | "article"
  | "other";

/** Per-sample style features extracted by Ollama. */
export interface SampleStyleFeatures {
  voice: string;               // "formal" | "informal" | "academic" | "conversational" | "technical"
  person: string;              // "first" | "second" | "third" | "mixed"
  avgSentenceLength: number;
  tone: string[];              // ["analytical", "descriptive", ...]
  vocabulary: string;          // "simple" | "moderate" | "advanced" | "specialized"
  commonPhrases: string[];
  verbalTics: string[];
  hedging: string;             // "low" | "medium" | "high"
  certaintyMarkers: string[];
  paragraphStyle: string;      // "short-punchy" | "long-flowing" | "mixed"
  citationStyle: string;       // "APA" | "MLA" | "Chicago" | "none" | "other"
  domainVocabulary: string[];
  /** Free-form 1-2 sentence summary of how this sample reads. */
  summary: string;
}

/** Aggregated profile — the "mirror this voice" summary the chat prompt uses. */
export interface AggregatedWritingProfile {
  sampleCount: number;
  totalWords: number;
  /** Dominant voice across all samples (most common value). */
  dominantVoice: string;
  dominantPerson: string;
  dominantVocabulary: string;
  avgSentenceLength: number;
  tones: string[];                 // union, sorted by frequency
  commonPhrases: string[];         // union, deduped
  verbalTics: string[];            // union, deduped
  hedging: string;                 // average bucket
  certaintyMarkers: string[];      // union, deduped
  paragraphStyle: string;
  citationStyles: string[];        // union
  domainVocabulary: string[];      // top N by frequency
  categories: Record<string, number>; // {"essay": 3, "resume": 1}
  /** Human-readable 3-5 sentence narrative of the user's writing voice. */
  narrative: string;
}

// ── Text extraction (reuses fileIngestion.processFile) ─────────────────────

/**
 * Extract plain text from an uploaded file. Supports PDFs, Word docs, plain
 * text, markdown, and code via fileIngestion.processFile. For writing samples
 * we want ONLY the text — we don't want OCR'd images, transcribed audio, etc.
 * as those skew voice analysis.
 */
async function extractText(filepath: string): Promise<string> {
  const ext = path.extname(filepath).toLowerCase();

  // Plain text and markdown: read directly
  if (ext === ".txt" || ext === ".md" || ext === ".markdown" || ext === ".rst") {
    return fs.readFileSync(filepath, "utf-8");
  }

  // PDF: use the pdf-parse v2 API. IMPORTANT: pdf-parse v2.x is an ESM
  // module that exports a `PDFParse` class — the old v1 pattern
  // `const p = require("pdf-parse"); p(buffer)` silently fails with
  // "pdfParse is not a function". That was the root cause of writing-sample
  // PDF uploads showing up on disk but never in the DB.
  if (ext === ".pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      const dataBuffer = fs.readFileSync(filepath);
      const parser = new PDFParse({ data: dataBuffer });
      const result = await parser.getText();
      return String(result.text || "");
    } catch (err) {
      await logger.warn("writingProfile", `PDF parse failed for ${filepath}: ${err}`);
      return "";
    }
  }

  // Everything else: run through fileIngestion.processFile and join chunks.
  // This covers .docx, .doc, .rtf, code files, etc.
  try {
    const result = await processFile(filepath);
    return (result.chunks || []).join("\n\n");
  } catch (err) {
    await logger.warn("writingProfile", `processFile failed for ${filepath}: ${err}`);
    return "";
  }
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ── Ollama style analyzer ──────────────────────────────────────────────────

/**
 * Analyze one writing sample's style features. Uses the JSON-mode helper
 * so we get structured output reliably instead of parsing freeform text.
 * Caps input to the first ~4000 characters because (a) style is apparent
 * in the first few paragraphs, (b) longer inputs kill throughput.
 */
async function analyzeSampleStyle(
  text: string,
  category: WritingCategory,
  description: string | null = null
): Promise<SampleStyleFeatures | null> {
  const excerpt = text.slice(0, 4000);
  if (excerpt.trim().length < 200) {
    await logger.warn("writingProfile", "Skipping style analysis — sample too short");
    return null;
  }

  // If the user provided context (assignment prompt, class, audience),
  // include it so the LLM can distinguish style choices forced by the
  // assignment (e.g. "formal because it's a history paper") from the
  // author's underlying voice tendencies.
  const contextBlock = description && description.trim()
    ? `\nUser-provided context about this sample:\n${description.trim()}\n`
    : "";

  const prompt = `You are a writing-style analyst. Read the following ${category} sample and return a compact JSON object describing its style. Be specific and honest; do not flatter.
${contextBlock}
WRITING SAMPLE:
"""
${excerpt}
"""

Return ONLY a valid JSON object with exactly these keys:
{
  "voice": one of "formal" | "informal" | "academic" | "conversational" | "technical",
  "person": one of "first" | "second" | "third" | "mixed",
  "avgSentenceLength": number (estimated average words per sentence),
  "tone": array of 1-4 strings from ["analytical", "descriptive", "persuasive", "narrative", "reflective", "critical", "humorous", "emotive"],
  "vocabulary": one of "simple" | "moderate" | "advanced" | "specialized",
  "commonPhrases": array of 3-8 characteristic phrases (exact quotes from the sample),
  "verbalTics": array of 0-5 recurring filler/transition words the author uses,
  "hedging": one of "low" | "medium" | "high" (how much the author qualifies claims),
  "certaintyMarkers": array of 0-5 phrases signaling certainty ("clearly", "I believe", "obviously"),
  "paragraphStyle": one of "short-punchy" | "long-flowing" | "mixed",
  "citationStyle": one of "APA" | "MLA" | "Chicago" | "IEEE" | "none" | "other",
  "domainVocabulary": array of 5-15 technical or domain-specific terms the author uses,
  "summary": one or two sentences describing how this sample reads
}`;

  try {
    const raw = await ollamaChatJson([{ role: "user", content: prompt }]);
    if (!raw) return null;

    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

    // Defensive normalization: LLMs sometimes return strings where arrays
    // are expected or vice versa. Coerce everything to the expected shape
    // so downstream code can rely on consistent types.
    const toArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : [];

    return {
      voice: String(parsed.voice ?? "conversational"),
      person: String(parsed.person ?? "first"),
      avgSentenceLength: Number(parsed.avgSentenceLength ?? 15) || 15,
      tone: toArray(parsed.tone),
      vocabulary: String(parsed.vocabulary ?? "moderate"),
      commonPhrases: toArray(parsed.commonPhrases),
      verbalTics: toArray(parsed.verbalTics),
      hedging: String(parsed.hedging ?? "medium"),
      certaintyMarkers: toArray(parsed.certaintyMarkers),
      paragraphStyle: String(parsed.paragraphStyle ?? "mixed"),
      citationStyle: String(parsed.citationStyle ?? "none"),
      domainVocabulary: toArray(parsed.domainVocabulary),
      summary: String(parsed.summary ?? ""),
    };
  } catch (err) {
    await logger.warn("writingProfile", `Style analysis failed: ${String(err)}`);
    return null;
  }
}

// ── Profile aggregator ─────────────────────────────────────────────────────

function mode(values: string[]): string {
  if (values.length === 0) return "";
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

function topNByFrequency(values: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

function averageHedging(values: string[]): string {
  // low=0, medium=1, high=2 → round to the nearest bucket
  const score = (v: string) => (v === "low" ? 0 : v === "high" ? 2 : 1);
  if (values.length === 0) return "medium";
  const avg = values.reduce((s, v) => s + score(v), 0) / values.length;
  return avg < 0.67 ? "low" : avg > 1.33 ? "high" : "medium";
}

/**
 * Build a narrative paragraph describing the user's voice. This is the
 * string that gets pasted into the chat system prompt so Jarvis knows
 * what voice to mirror. Deterministic so we don't pay an LLM call every
 * regeneration — the Ollama call already happened at the per-sample stage.
 */
function buildNarrative(p: Omit<AggregatedWritingProfile, "narrative">): string {
  const parts: string[] = [];

  parts.push(
    `The user writes in a ${p.dominantVoice} voice, primarily from the ${p.dominantPerson}-person perspective, with a ${p.dominantVocabulary} vocabulary.`
  );

  if (p.tones.length > 0) {
    parts.push(`Their dominant tone tendencies are ${p.tones.slice(0, 3).join(", ")}.`);
  }

  parts.push(
    `Average sentence length is about ${Math.round(p.avgSentenceLength)} words; paragraph style is ${p.paragraphStyle}; hedging is ${p.hedging}.`
  );

  if (p.verbalTics.length > 0) {
    parts.push(`Recurring phrases and tics: ${p.verbalTics.slice(0, 5).map((t) => `"${t}"`).join(", ")}.`);
  }

  if (p.domainVocabulary.length > 0) {
    parts.push(`Domain vocabulary includes: ${p.domainVocabulary.slice(0, 8).join(", ")}.`);
  }

  if (p.citationStyles.length > 0 && !p.citationStyles.every((c) => c === "none")) {
    const live = p.citationStyles.filter((c) => c !== "none");
    if (live.length > 0) parts.push(`When citing sources, they use ${live.join(" / ")}.`);
  }

  return parts.join(" ");
}

/**
 * Aggregate all stored per-sample style analyses into a single profile.
 * Called after every upload/delete, and on demand via the "regenerate"
 * tRPC mutation.
 */
export async function regenerateWritingProfile(userId: number = 1): Promise<AggregatedWritingProfile | null> {
  const samples = await listWritingSamples(userId);
  if (samples.length === 0) {
    await clearWritingProfile(userId);
    return null;
  }

  const features: SampleStyleFeatures[] = [];
  for (const s of samples) {
    if (!s.styleFeatures) continue;
    try {
      features.push(JSON.parse(s.styleFeatures));
    } catch {
      // malformed — skip
    }
  }

  if (features.length === 0) {
    // No analyzed samples yet (uploads are still pending). Don't write an
    // empty profile, leave the table alone.
    return null;
  }

  const categories: Record<string, number> = {};
  for (const s of samples) {
    categories[s.category] = (categories[s.category] ?? 0) + 1;
  }

  const base: Omit<AggregatedWritingProfile, "narrative"> = {
    sampleCount: samples.length,
    totalWords: samples.reduce((s, x) => s + (x.wordCount ?? 0), 0),
    dominantVoice: mode(features.map((f) => f.voice)),
    dominantPerson: mode(features.map((f) => f.person)),
    dominantVocabulary: mode(features.map((f) => f.vocabulary)),
    avgSentenceLength:
      features.reduce((s, f) => s + (f.avgSentenceLength || 0), 0) / features.length,
    tones: topNByFrequency(features.flatMap((f) => f.tone), 6),
    commonPhrases: topNByFrequency(features.flatMap((f) => f.commonPhrases), 12),
    verbalTics: topNByFrequency(features.flatMap((f) => f.verbalTics), 8),
    hedging: averageHedging(features.map((f) => f.hedging)),
    certaintyMarkers: topNByFrequency(features.flatMap((f) => f.certaintyMarkers), 6),
    paragraphStyle: mode(features.map((f) => f.paragraphStyle)),
    citationStyles: Array.from(new Set(features.map((f) => f.citationStyle))),
    domainVocabulary: topNByFrequency(features.flatMap((f) => f.domainVocabulary), 20),
    categories,
  };

  const aggregate: AggregatedWritingProfile = {
    ...base,
    narrative: buildNarrative(base),
  };

  await setWritingProfile({
    profileJson: JSON.stringify(aggregate),
    sampleCount: samples.length,
    totalWords: aggregate.totalWords,
    userId,
  });

  await logger.info(
    "writingProfile",
    `Profile regenerated: ${samples.length} samples, ${features.length} analyzed, ${aggregate.totalWords} total words`
  );

  return aggregate;
}

// ── Public entry point: ingest a new uploaded sample ──────────────────────

/**
 * Ingest an uploaded file: extract text → store in writing_samples → run
 * style analysis → regenerate the aggregate profile.
 *
 * Safe to call in the background — the HTTP response can be sent before
 * this finishes since style analysis is the slow part.
 */
export async function ingestWritingSample(
  filepath: string,
  originalName: string,
  category: WritingCategory = "other",
  description: string | null = null
): Promise<{ sampleId: number; wordCount: number; analyzed: boolean }> {
  await logger.info("writingProfile", `Ingesting writing sample: ${originalName} (${category})`);

  const text = await extractText(filepath);
  if (!text || text.trim().length < 100) {
    throw new Error(`No usable text extracted from ${originalName}`);
  }

  const wordCount = countWords(text);

  // Insert with no features yet — we'll update after Ollama returns.
  const sampleId = await addWritingSample({
    originalName,
    storedPath: filepath,
    category,
    description,
    rawText: text,
    wordCount,
  });

  // Style analysis (the slow part). Retries once on failure since the most
  // common cause is an Ollama timeout when the queue is backed up with
  // scraper embeddings — a second attempt 15s later usually succeeds because
  // the queue has drained by then. The user's description is passed in so
  // the LLM can factor in context (assignment prompt, class, audience).
  let analyzed = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const features = await analyzeSampleStyle(text, category, description);
      if (features) {
        await updateWritingSampleFeatures(sampleId, JSON.stringify(features));
        analyzed = true;
        break;
      }
    } catch (err) {
      await logger.warn(
        "writingProfile",
        `Style analysis attempt ${attempt}/2 failed for sample ${sampleId}: ${err}`
      );
      if (attempt < 2) {
        // Wait 15s before retry — gives the Ollama queue time to drain
        await new Promise((r) => setTimeout(r, 15_000));
      }
    }
  }

  // Regenerate the aggregate profile so the chat prompt picks up the new
  // sample on the next message.
  try {
    await regenerateWritingProfile();
  } catch (err) {
    await logger.warn("writingProfile", `Profile regeneration failed: ${err}`);
  }

  return { sampleId, wordCount, analyzed };
}

// ── Delete + re-aggregate ──────────────────────────────────────────────────

export async function deleteWritingSample(id: number): Promise<void> {
  // Also unlink the file on disk if it's still in the writing-uploads dir.
  // Best-effort: if the file is gone, we don't care.
  try {
    const row = (
      (await listWritingSamples()).find((s) => s.id === id)
    );
    if (row?.storedPath && fs.existsSync(row.storedPath)) {
      fs.unlinkSync(row.storedPath);
    }
  } catch { /* non-fatal */ }

  await dbDeleteWritingSample(id);
  await regenerateWritingProfile();
}

// ── Read side: used by tRPC router + chat system prompt builder ────────────

export async function listSamples(): Promise<WritingSample[]> {
  return listWritingSamples();
}

export async function getProfile(): Promise<AggregatedWritingProfile | null> {
  const row = await dbGetWritingProfile();
  if (!row) return null;
  try {
    return JSON.parse(row.profileJson) as AggregatedWritingProfile;
  } catch {
    return null;
  }
}

/**
 * Format the profile as a section of the chat system prompt. Returns an
 * empty string if no profile exists yet. rag.ts calls this and splices
 * the result into the system prompt on every chat request so Jarvis
 * mirrors the user's voice.
 */
export async function getWritingProfileSystemPrompt(): Promise<string> {
  const profile = await getProfile();
  if (!profile) return "";

  return `
=== USER VOICE PROFILE ===
The user has uploaded ${profile.sampleCount} writing sample(s) totaling ~${profile.totalWords} words. When responding to this user, mirror their voice. Summary of how they write:

${profile.narrative}

Concrete style rules to follow when writing in their voice:
- Voice: ${profile.dominantVoice}
- Person: ${profile.dominantPerson}-person when appropriate
- Vocabulary level: ${profile.dominantVocabulary}
- Target sentence length: ~${Math.round(profile.avgSentenceLength)} words
- Paragraph style: ${profile.paragraphStyle}
- Hedging level: ${profile.hedging}
${profile.tones.length > 0 ? `- Tones to lean into: ${profile.tones.slice(0, 3).join(", ")}` : ""}
${profile.verbalTics.length > 0 ? `- Characteristic phrases the user uses (weave in naturally, don't force): ${profile.verbalTics.slice(0, 5).map((t) => `"${t}"`).join(", ")}` : ""}

Do NOT quote the user's writing samples as source material — they are style references only, not knowledge. Match the voice; generate the content yourself.
=== END USER VOICE PROFILE ===
`.trim();
}
