/**
 * Knowledge-Backed Self-Evaluation
 *
 * Uses JARVIS's own knowledge base (68k+ chunks about programming, security,
 * AI, architecture, etc.) to evaluate its own source code. Instead of asking
 * a generic LLM "find issues", it:
 *
 *   1. Reads each source file
 *   2. Identifies what technologies/patterns the file uses (from imports)
 *   3. Runs multi-hop inference to retrieve relevant best-practice chunks
 *   4. Sends (code + retrieved knowledge) to Ollama: "Based on what you know
 *      about these technologies, what should change in this code?"
 *   5. Collects proposals into a structured plan
 *   6. User reviews the plan (accept/reject/modify each item)
 *   7. Accepted items go through backup → validate → sandbox → apply
 *
 * This takes 30-90 minutes on CPU. It runs in the background at priority 1
 * (background) so user chat isn't blocked. Progress is tracked and pollable.
 */

import * as fs from "fs";
import * as path from "path";
import { nanoid } from "nanoid";
import { ollamaChatBackground } from "./ollama.js";
import { multiHopRetrieval, buildInferenceContext } from "./inferenceEngine.js";
import { logger } from "./logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EvaluationPlanItem {
  id: string;
  file: string;
  category: "performance" | "security" | "architecture" | "reliability" | "feature" | "quality";
  title: string;
  description: string;
  rationale: string;
  /** Chunks from the knowledge base that support this recommendation. */
  knowledgeSources: Array<{ title: string; excerpt: string }>;
  severity: "low" | "medium" | "high";
  status: "pending" | "accepted" | "rejected" | "modified";
  userNotes: string | null;
}

export interface EvaluationPlan {
  id: string;
  createdAt: number;
  completedAt: number | null;
  status: "running" | "completed" | "failed" | "cancelled";
  progress: {
    currentFile: string;
    filesProcessed: number;
    totalFiles: number;
    itemsFound: number;
  };
  items: EvaluationPlanItem[];
  error: string | null;
}

// ─── State ──────────────────────────────────────────────────────────────────

let _currentPlan: EvaluationPlan | null = null;
let _cancelled = false;

// Also persist to disk so a page refresh doesn't lose the plan
const PLAN_PATH = path.join(process.cwd(), "self-evaluation-plan.json");

function savePlanToDisk(): void {
  if (!_currentPlan) return;
  try {
    fs.writeFileSync(PLAN_PATH + ".tmp", JSON.stringify(_currentPlan, null, 2));
    fs.renameSync(PLAN_PATH + ".tmp", PLAN_PATH);
  } catch { /* non-critical */ }
}

function loadPlanFromDisk(): void {
  try {
    if (fs.existsSync(PLAN_PATH)) {
      _currentPlan = JSON.parse(fs.readFileSync(PLAN_PATH, "utf-8"));
    }
  } catch { /* corrupt file — ignore */ }
}

// Load on module init so a restart preserves the last plan
loadPlanFromDisk();

// ─── Technology extraction from imports ─────────────────────────────────────

function extractTechnologies(code: string, filename: string): string[] {
  const techs: string[] = [];

  // Parse import statements
  const imports = code.matchAll(/import\s+.*?from\s+['"]([^'"]+)['"]/g);
  for (const m of imports) {
    const mod = m[1];
    // Map known modules to searchable technology names
    if (mod.includes("express")) techs.push("Express.js middleware security");
    if (mod.includes("trpc")) techs.push("tRPC API design patterns");
    if (mod.includes("playwright")) techs.push("Playwright browser automation best practices");
    if (mod.includes("sql") || mod.includes("sqlite")) techs.push("SQLite performance optimization");
    if (mod.includes("chroma")) techs.push("ChromaDB vector database");
    if (mod.includes("ollama")) techs.push("Ollama LLM API optimization");
    if (mod.includes("react")) techs.push("React component patterns");
    if (mod.includes("vite")) techs.push("Vite build optimization");
    if (mod.includes("multer")) techs.push("file upload security Node.js");
    if (mod.includes("crypto")) techs.push("Node.js cryptography best practices");
    if (mod.includes("child_process") || mod.includes("exec")) techs.push("Node.js subprocess security command injection");
  }

  // Infer from filename
  if (filename.includes("scraper")) techs.push("web scraping best practices", "rate limiting");
  if (filename.includes("rag")) techs.push("RAG retrieval augmented generation optimization");
  if (filename.includes("auth")) techs.push("authentication security Node.js");
  if (filename.includes("queue")) techs.push("priority queue concurrency patterns");
  if (filename.includes("navigator")) techs.push("browser automation safety Playwright");
  if (filename.includes("vector")) techs.push("vector similarity search optimization");
  if (filename.includes("entity")) techs.push("named entity recognition NER performance");

  // Infer from code patterns
  if (code.includes("execSync") || code.includes("exec(")) techs.push("command injection prevention");
  if (code.includes("fs.writeFileSync")) techs.push("Node.js file I/O atomic writes");
  if (code.includes("setInterval") || code.includes("setTimeout")) techs.push("Node.js timer memory leak prevention");
  if (code.includes("async") && code.includes("for")) techs.push("async iteration performance Node.js");
  if (code.includes("Promise.all")) techs.push("parallel async concurrency patterns");
  if (code.includes("WebSocket") || code.includes("SSE")) techs.push("real-time streaming best practices");

  return [...new Set(techs)]; // deduplicate
}

// ─── Single file evaluation ─────────────────────────────────────────────────

async function evaluateFile(
  filepath: string,
  code: string
): Promise<EvaluationPlanItem[]> {
  const filename = path.basename(filepath);
  const techs = extractTechnologies(code, filename);

  if (techs.length === 0) {
    techs.push("Node.js TypeScript best practices");
  }

  // Run multi-hop inference for each technology to pull relevant knowledge
  const allKnowledgeChunks: Array<{ title: string; content: string; score: number }> = [];

  for (const tech of techs.slice(0, 5)) { // cap at 5 queries per file
    try {
      const result = await multiHopRetrieval(tech);
      for (const chunk of result.chunks.slice(0, 3)) { // top 3 per query
        allKnowledgeChunks.push({
          title: chunk.sourceTitle || chunk.sourceUrl || "Unknown",
          content: chunk.content.slice(0, 500),
          score: chunk.score,
        });
      }
    } catch {
      // inference failed for this tech — skip
    }
  }

  // Deduplicate knowledge by title
  const seenTitles = new Set<string>();
  const uniqueKnowledge = allKnowledgeChunks.filter((k) => {
    if (seenTitles.has(k.title)) return false;
    seenTitles.add(k.title);
    return true;
  });

  // Build the prompt with code + relevant knowledge
  const knowledgeBlock = uniqueKnowledge.length > 0
    ? `\n\nRELEVANT KNOWLEDGE FROM YOUR DATABASE:\n${uniqueKnowledge.map((k, i) => `[${i + 1}] ${k.title}:\n${k.content}`).join("\n\n")}`
    : "";

  const codeExcerpt = code.length > 6000 ? code.slice(0, 6000) + "\n... (truncated)" : code;

  const prompt = `You are JARVIS's self-evaluation engine. Analyze this source file using the knowledge retrieved from your own database.

FILE: ${filepath}
TECHNOLOGIES DETECTED: ${techs.join(", ")}

CODE:
\`\`\`typescript
${codeExcerpt}
\`\`\`
${knowledgeBlock}

Based on the code AND the retrieved knowledge, identify 1-5 specific, actionable improvements. For each improvement, explain:
1. What to change
2. Why (reference the knowledge sources by [N] number if applicable)
3. The expected impact

Return STRICT JSON array — no prose, no code fences:
[
  {
    "category": "performance|security|architecture|reliability|feature|quality",
    "title": "Short title (under 80 chars)",
    "description": "What specifically to change (2-3 sentences)",
    "rationale": "Why this matters, citing knowledge sources where applicable",
    "severity": "low|medium|high"
  }
]

Rules:
- Only suggest changes you're confident about based on the code AND knowledge
- Don't suggest changes that are already implemented correctly
- Prefer security and reliability over cosmetic improvements
- If the code looks solid, return an empty array []`;

  try {
    const raw = await ollamaChatBackground(
      [{ role: "user", content: prompt }]
    );
    if (!raw) return [];

    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const items: any[] = JSON.parse(jsonMatch[0]);

    return items
      .filter((item) => item.title && item.description)
      .map((item) => ({
        id: nanoid(8),
        file: filepath,
        category: ["performance", "security", "architecture", "reliability", "feature", "quality"]
          .includes(item.category) ? item.category : "quality",
        title: String(item.title).slice(0, 100),
        description: String(item.description),
        rationale: String(item.rationale ?? ""),
        knowledgeSources: uniqueKnowledge.slice(0, 5).map((k) => ({
          title: k.title,
          excerpt: k.content.slice(0, 200),
        })),
        severity: item.severity === "high" || item.severity === "medium" ? item.severity : "low",
        status: "pending" as const,
        userNotes: null,
      }));
  } catch (err) {
    await logger.warn("selfEvaluate", `Failed to evaluate ${filename}: ${String(err)}`);
    return [];
  }
}

// ─── Full evaluation ────────────────────────────────────────────────────────

/**
 * Start a full self-evaluation. Processes all server/*.ts files through
 * the knowledge-backed analyzer. Takes 30-90 minutes on CPU.
 * Returns immediately — poll getPlan() for progress.
 */
export function startSelfEvaluation(): string {
  if (_currentPlan?.status === "running") {
    return _currentPlan.id; // already running
  }

  _cancelled = false;
  const planId = nanoid(10);

  _currentPlan = {
    id: planId,
    createdAt: Date.now(),
    completedAt: null,
    status: "running",
    progress: { currentFile: "", filesProcessed: 0, totalFiles: 0, itemsFound: 0 },
    items: [],
    error: null,
  };
  savePlanToDisk();

  // Run in background
  runEvaluation(planId).catch((err) => {
    if (_currentPlan?.id === planId) {
      _currentPlan.status = "failed";
      _currentPlan.error = String(err);
      _currentPlan.completedAt = Date.now();
      savePlanToDisk();
    }
  });

  return planId;
}

async function runEvaluation(planId: string): Promise<void> {
  // Collect all server .ts files
  const serverDir = path.join(process.cwd(), "server");
  const files = fs.readdirSync(serverDir)
    .filter((f) => f.endsWith(".ts") && !f.startsWith("_") && !f.endsWith(".test.ts"))
    .map((f) => path.join(serverDir, f))
    .sort();

  if (!_currentPlan || _currentPlan.id !== planId) return;
  _currentPlan.progress.totalFiles = files.length;
  savePlanToDisk();

  await logger.info("selfEvaluate", `Starting evaluation of ${files.length} files`);

  for (let i = 0; i < files.length; i++) {
    if (_cancelled || _currentPlan?.id !== planId) {
      if (_currentPlan) {
        _currentPlan.status = "cancelled";
        _currentPlan.completedAt = Date.now();
        savePlanToDisk();
      }
      return;
    }

    const filepath = files[i];
    const filename = path.basename(filepath);

    _currentPlan.progress.currentFile = filename;
    _currentPlan.progress.filesProcessed = i;
    savePlanToDisk();

    await logger.info("selfEvaluate", `Evaluating [${i + 1}/${files.length}]: ${filename}`);

    try {
      const code = fs.readFileSync(filepath, "utf-8");
      const items = await evaluateFile(filepath, code);

      for (const item of items) {
        _currentPlan.items.push(item);
        _currentPlan.progress.itemsFound = _currentPlan.items.length;
      }

      savePlanToDisk(); // checkpoint after every file
    } catch (err) {
      await logger.warn("selfEvaluate", `Error evaluating ${filename}: ${String(err)}`);
    }
  }

  if (_currentPlan?.id === planId) {
    _currentPlan.status = "completed";
    _currentPlan.progress.filesProcessed = files.length;
    _currentPlan.completedAt = Date.now();
    savePlanToDisk();

    const duration = ((Date.now() - _currentPlan.createdAt) / 60_000).toFixed(1);
    await logger.info(
      "selfEvaluate",
      `Evaluation complete: ${_currentPlan.items.length} suggestions from ${files.length} files (${duration} min)`
    );
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function getPlan(): EvaluationPlan | null {
  return _currentPlan;
}

export function cancelEvaluation(): void {
  _cancelled = true;
  if (_currentPlan?.status === "running") {
    _currentPlan.status = "cancelled";
    _currentPlan.completedAt = Date.now();
    savePlanToDisk();
  }
}

export function updatePlanItem(
  itemId: string,
  update: { status?: "accepted" | "rejected" | "modified"; userNotes?: string }
): boolean {
  if (!_currentPlan) return false;
  const item = _currentPlan.items.find((i) => i.id === itemId);
  if (!item) return false;

  if (update.status) item.status = update.status;
  if (update.userNotes !== undefined) item.userNotes = update.userNotes;

  savePlanToDisk();
  return true;
}

export function getAcceptedItems(): EvaluationPlanItem[] {
  if (!_currentPlan) return [];
  return _currentPlan.items.filter((i) => i.status === "accepted" || i.status === "modified");
}

export function clearPlan(): void {
  _currentPlan = null;
  try { fs.unlinkSync(PLAN_PATH); } catch { /* noop */ }
}
