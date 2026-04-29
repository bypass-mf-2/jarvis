/**
 * Business ideas weekly researcher.
 *
 * Reads `business-ideas.md` at the project root, parses it into a list of
 * ideas, and for each idea runs a research pipeline that produces a
 * structured markdown report saved under `reports/business-ideas/`.
 *
 * The user owns the input file — they edit it directly with new ideas,
 * change status to "killed" to skip, etc. JARVIS only writes the reports;
 * the source list is theirs.
 *
 * Scheduling: a weekly recurring task in scheduler.ts fires
 * `runWeeklyResearch()`. Manual triggers via the `businessIdeas.*` tRPC
 * router. A phone notification (general category) lands when the cycle
 * completes with the count of researched ideas + a summary.
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger.js";
import { searchWeb } from "./webSearch.js";
import { multiHopRetrieval } from "./inferenceEngine.js";
import { smartChat } from "./ollama.js";

const IDEAS_FILE = path.join(process.cwd(), "business-ideas.md");
const REPORTS_DIR = path.join(process.cwd(), "reports", "business-ideas");

// ── Types ────────────────────────────────────────────────────────────────────

export type IdeaStatus = "exploring" | "backlog" | "active" | "shelved" | "killed";

export interface BusinessIdea {
  /** Slug used in report filenames + lookup. Auto-derived from title. */
  id: string;
  title: string;
  description: string;
  tags: string[];
  status: IdeaStatus;
}

export interface IdeaReport {
  ideaId: string;
  ideaTitle: string;
  generatedAt: number;
  searches: Array<{ query: string; resultCount: number }>;
  retrievedChunks: number;
  /** Full markdown report body. */
  markdown: string;
  /** Path to the saved file (relative to project root). */
  filePath: string;
  /** What changed since the previous report for this idea, if any. */
  diffFromLast: string | null;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse business-ideas.md. Each top-level `## Heading` starts an idea.
 * Optional metadata lines `Tags: ...` and `Status: ...` may follow on the
 * next line(s); everything else is description. Headings without bodies
 * are skipped. The "How to use this file" / "What research does" sections
 * at the top of the template don't trigger research because their
 * status is implicitly "killed" via the special heading prefixes
 * "How to" / "What" — see the regex below.
 */
export function parseIdeasFile(): BusinessIdea[] {
  if (!fs.existsSync(IDEAS_FILE)) return [];
  const text = fs.readFileSync(IDEAS_FILE, "utf-8");
  // Split on `\n## ` (the leading newline avoids matching a top-of-file `# Title`).
  // Drop the head — anything before the first `## ` is preamble.
  const sections = text.split(/\n## /);
  const ideas: BusinessIdea[] = [];

  // Skip section[0] — it's the file preamble. Rest are idea sections.
  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const newlineIdx = section.indexOf("\n");
    const title = (newlineIdx === -1 ? section : section.slice(0, newlineIdx)).trim();
    const body = newlineIdx === -1 ? "" : section.slice(newlineIdx + 1);
    if (!title) continue;
    // Skip explanatory subsections in the template
    if (/^how to use|^what "?research"?|^how it works/i.test(title)) continue;

    // Pull optional Tags: + Status: lines from the head of the body
    const lines = body.split("\n");
    const tags: string[] = [];
    let status: IdeaStatus = "exploring";
    let descStart = 0;
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j].trim();
      const tagsMatch = line.match(/^Tags:\s*(.+)$/i);
      const statusMatch = line.match(/^Status:\s*(\w+)/i);
      if (tagsMatch) {
        tags.push(...tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean));
        descStart = j + 1;
        continue;
      }
      if (statusMatch) {
        const s = statusMatch[1].toLowerCase() as IdeaStatus;
        if (["exploring", "backlog", "active", "shelved", "killed"].includes(s)) {
          status = s;
        }
        descStart = j + 1;
        continue;
      }
      // First non-metadata line — start of description
      if (line) break;
      descStart = j + 1;
    }
    const description = lines.slice(descStart).join("\n").trim();
    if (!description) continue; // skip empty stubs

    ideas.push({
      id: slugify(title),
      title,
      description,
      tags,
      status,
    });
  }

  return ideas;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

// ── Research pipeline ────────────────────────────────────────────────────────

/**
 * Run the per-idea research pipeline. Web search across a few angles +
 * local multi-hop retrieval + LLM synthesis. Returns a structured report
 * and writes the markdown to disk.
 */
export async function researchIdea(idea: BusinessIdea): Promise<IdeaReport> {
  const generatedAt = Date.now();
  const searches: IdeaReport["searches"] = [];
  const searchQueries = buildSearchQueries(idea);
  const allResults: Array<{ angle: string; query: string; results: Array<{ title: string; url: string; snippet: string }> }> = [];

  for (const { angle, query } of searchQueries) {
    try {
      const results = await searchWeb(query, 6);
      searches.push({ query, resultCount: results.length });
      allResults.push({ angle, query, results });
    } catch (err) {
      await logger.warn("businessIdeas", `search "${query}" failed: ${String(err)}`);
      searches.push({ query, resultCount: 0 });
    }
  }

  // Multi-hop retrieval against the user's own knowledge graph
  let chunks: Array<{ content: string; metadata?: any }> = [];
  try {
    const result = await multiHopRetrieval(idea.title + " " + idea.tags.join(" "));
    chunks = (result?.chunks ?? []).slice(0, 8);
  } catch (err) {
    await logger.warn("businessIdeas", `multi-hop retrieval for "${idea.title}" failed: ${String(err)}`);
  }

  const evidenceBlocks = allResults.map((g) =>
    `### ${g.angle}\nQuery: \`${g.query}\`\n\n${g.results
      .slice(0, 4)
      .map((r) => `- [${r.title}](${r.url})\n  ${r.snippet.slice(0, 240)}`)
      .join("\n")}`,
  );
  const localContext = chunks.length > 0
    ? chunks.map((c, i) => `[KB${i + 1}] ${String(c.content ?? "").slice(0, 400)}`).join("\n\n")
    : "(no relevant chunks in your knowledge base for this idea — the corpus may not cover this domain)";

  const prompt: Array<{ role: "system" | "user"; content: string }> = [
    {
      role: "system",
      content:
        "You are JARVIS, helping Trevor evaluate his own business ideas. " +
        "You're synthesizing a weekly research brief. Be specific, opinionated, and concrete — " +
        "Trevor reads these to decide whether to pursue or kill an idea. Hedge minimally; " +
        "say what you actually think. The brief MUST follow the markdown headings exactly as " +
        "shown in the user prompt. Each section ~3-6 sentences. Total length ~800-1200 words.",
    },
    {
      role: "user",
      content: [
        `Idea: **${idea.title}**`,
        idea.tags.length > 0 ? `Tags: ${idea.tags.join(", ")}` : null,
        `Status in Trevor's list: ${idea.status}`,
        ``,
        `## Trevor's description`,
        idea.description,
        ``,
        `## Web evidence (gathered just now)`,
        evidenceBlocks.join("\n\n"),
        ``,
        `## Trevor's own knowledge base (multi-hop retrieval)`,
        localContext,
        ``,
        `---`,
        ``,
        `Write the brief now. Use these headings verbatim:`,
        ``,
        `### Market signal`,
        `(Is anyone talking about this? Where? What's the temperature — hot, lukewarm, dead? Cite specific URLs from above where relevant.)`,
        ``,
        `### Competitors`,
        `(Who's doing this or close to it? Are they winning? What's the gap? List 3-7 by name with URLs.)`,
        ``,
        `### Recent news / signals`,
        `(Anything new in the last 6 months that shifts the calculus — funding rounds, regulation, tech availability, demand surge?)`,
        ``,
        `### Feasibility for Trevor specifically`,
        `(Trevor is a solo founder with strong full-stack + AI engineering, deep but narrow domain breadth, ~10-20 hrs/week available, no outside funding, USAFA path constraining timeline. Honest read on whether HE can pull this off, not whether someone could.)`,
        ``,
        `### Recommended next 1-2 steps`,
        `(Concrete actions for THIS week or month. "Talk to 5 X" beats "do market research". If the right answer is "kill it" or "shelve it", say so explicitly.)`,
        ``,
        `### One-line verdict`,
        `(Pursue / Validate further / Shelve / Kill — pick one. Plus a short reason.)`,
      ].filter((x) => x !== null).join("\n"),
    },
  ];

  let body: string;
  try {
    body = await smartChat(prompt as any, "self_evaluate");
  } catch (err) {
    body = `_Research synthesis failed: ${String(err)}._\n\nWeb-search results above are still useful as raw input.`;
  }

  // Compose final markdown
  const dateStr = new Date(generatedAt).toISOString().slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `${dateStr}-${idea.id}.md`);
  const fullMarkdown = [
    `# ${idea.title} — research brief`,
    `_Generated ${new Date(generatedAt).toISOString()} · status: **${idea.status}** · tags: ${idea.tags.join(", ") || "—"}_`,
    ``,
    `## Trevor's idea (verbatim)`,
    `> ${idea.description.split("\n").join("\n> ")}`,
    ``,
    `## Brief`,
    body.trim(),
    ``,
    `---`,
    ``,
    `## Raw web evidence`,
    evidenceBlocks.join("\n\n"),
    ``,
  ].join("\n");

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(filePath, fullMarkdown, "utf-8");

  // Compute diff from last report (if any) — we just diff the verdict + market
  // signal sections at a high level so the user gets a "what changed" pointer.
  const diffFromLast = computeDiffFromLast(idea.id, body);

  return {
    ideaId: idea.id,
    ideaTitle: idea.title,
    generatedAt,
    searches,
    retrievedChunks: chunks.length,
    markdown: fullMarkdown,
    filePath: path.relative(process.cwd(), filePath),
    diffFromLast,
  };
}

function buildSearchQueries(idea: BusinessIdea): Array<{ angle: string; query: string }> {
  const t = idea.title;
  return [
    { angle: "Market signal", query: `${t} startup` },
    { angle: "Competitors", query: `${t} competitors OR alternatives` },
    { angle: "Recent news", query: `${t} 2026` },
    { angle: "Reddit/HN demand", query: `${t} site:reddit.com OR site:news.ycombinator.com` },
    { angle: "Adjacent patterns", query: idea.tags.length > 0 ? `${idea.tags[0]} ${t}` : `${t} idea` },
  ];
}

function computeDiffFromLast(ideaId: string, currentBody: string): string | null {
  if (!fs.existsSync(REPORTS_DIR)) return null;
  // Find the second-most-recent report for this idea (most recent IS the one
  // we just wrote, since researchIdea writes before computeDiffFromLast runs).
  const files = fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(`-${ideaId}.md`))
    .sort()
    .reverse();
  if (files.length < 2) return null; // no prior report
  const priorPath = path.join(REPORTS_DIR, files[1]);
  let priorBody: string;
  try {
    priorBody = fs.readFileSync(priorPath, "utf-8");
  } catch {
    return null;
  }
  // Extract the "One-line verdict" line from each, compare
  const verdictRe = /###\s*One-line verdict\s*\n([\s\S]+?)(?:\n###|$)/i;
  const priorMatch = priorBody.match(verdictRe);
  const curMatch = currentBody.match(verdictRe);
  const priorVerdict = priorMatch?.[1]?.trim().split("\n")[0] ?? "(no prior verdict)";
  const curVerdict = curMatch?.[1]?.trim().split("\n")[0] ?? "(no current verdict)";
  if (priorVerdict === curVerdict) return `Verdict unchanged from ${files[1].slice(0, 10)}: ${curVerdict}`;
  return `Verdict shifted from ${files[1].slice(0, 10)} → today: "${priorVerdict}" → "${curVerdict}"`;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export interface WeeklyRunResult {
  startedAt: number;
  completedAt: number;
  totalIdeas: number;
  researched: number;
  skipped: number;
  failed: number;
  reports: IdeaReport[];
  errors: Array<{ ideaId: string; error: string }>;
}

/**
 * Walk the ideas file and research every idea whose status isn't `killed`.
 * Returns a structured result; also fires a phone notification on completion.
 */
export async function runWeeklyResearch(
  options: { onlyId?: string } = {},
): Promise<WeeklyRunResult> {
  const startedAt = Date.now();
  const ideas = parseIdeasFile();
  const targetIdeas = options.onlyId
    ? ideas.filter((i) => i.id === options.onlyId)
    : ideas.filter((i) => i.status !== "killed");

  await logger.info(
    "businessIdeas",
    `Starting research run — ${targetIdeas.length} ideas (${ideas.length} total in file, ${ideas.length - targetIdeas.length} skipped/killed)`,
  );

  const reports: IdeaReport[] = [];
  const errors: Array<{ ideaId: string; error: string }> = [];
  let failed = 0;

  for (const idea of targetIdeas) {
    try {
      await logger.info("businessIdeas", `Researching: "${idea.title}"`);
      const report = await researchIdea(idea);
      reports.push(report);
    } catch (err) {
      failed++;
      errors.push({ ideaId: idea.id, error: String(err).slice(0, 300) });
      await logger.warn("businessIdeas", `Research failed for "${idea.title}": ${String(err).slice(0, 200)}`);
    }
  }

  const completedAt = Date.now();

  // Phone notification — best-effort, don't block on it
  try {
    const { notify } = await import("./phoneNotify.js");
    const verdictSummary = reports
      .map((r) => {
        const m = r.markdown.match(/###\s*One-line verdict\s*\n([\s\S]+?)(?:\n|$)/i);
        return `• ${r.ideaTitle}: ${(m?.[1] ?? "?").trim().slice(0, 80)}`;
      })
      .slice(0, 6)
      .join("\n");
    await notify(
      `Weekly idea research: ${reports.length}/${targetIdeas.length} done`,
      verdictSummary || "(no verdicts captured — check the reports/ folder)",
      { category: "general", priority: 2 },
    );
  } catch (err) {
    await logger.warn("businessIdeas", `Phone notify failed (non-fatal): ${String(err)}`);
  }

  return {
    startedAt,
    completedAt,
    totalIdeas: ideas.length,
    researched: reports.length,
    skipped: ideas.length - targetIdeas.length,
    failed,
    reports,
    errors,
  };
}

// ── Helpers for the UI / router ──────────────────────────────────────────────

/** List recent reports for browsing. Sorted newest first. */
export function listAllReports(limit = 50): Array<{ filename: string; ideaId: string; date: string }> {
  if (!fs.existsSync(REPORTS_DIR)) return [];
  return fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((filename) => {
      // Filename format: YYYY-MM-DD-<slug>.md
      const m = filename.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
      return {
        filename,
        ideaId: m?.[2] ?? filename,
        date: m?.[1] ?? "",
      };
    });
}

export function readReport(filename: string): string | null {
  // Defend against path traversal — only allow flat filenames in REPORTS_DIR
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return null;
  const fullPath = path.join(REPORTS_DIR, filename);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf-8");
}
