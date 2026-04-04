/**
 * Self-Improvement Module
 * Analyzes system logs, identifies issues, uses LLM reflection to generate
 * code improvement suggestions, and can apply approved patches to the codebase.
 *
 * Safety model: patches are NEVER auto-applied — they require explicit approval
 * via the UI. This prevents runaway self-modification.
 */

import * as fs from "fs";
import * as path from "path";
import { ollamaChat } from "./ollama";
import { getRecentErrorLogs, getSystemLogs, addPatch, updatePatchStatus, getPatches } from "./db";
import { logger } from "./logger";

const PROJECT_ROOT = process.cwd();

// ── Collect analysis context ──────────────────────────────────────────────────
async function buildAnalysisContext(): Promise<string> {
  const errorLogs = await getRecentErrorLogs(30);
  const recentLogs = await getSystemLogs(50);

  const errorSummary = errorLogs
    .map((l: any) => `[${l.module}] ${l.message}`)
    .join("\n");

  const logSummary = recentLogs
    .map((l: any) => `[${(l.level ?? 'info').toUpperCase()}][${l.module}] ${l.message}`)
    .join("\n");

  return `=== RECENT ERROR LOGS (last 30) ===\n${errorSummary || "No errors"}\n\n=== RECENT SYSTEM LOGS (last 50) ===\n${logSummary || "No logs"}`;
}

// ── Read a source file safely ─────────────────────────────────────────────────
function readSourceFile(relativePath: string): string | null {
  try {
    const fullPath = path.join(PROJECT_ROOT, relativePath);
    // Safety: only allow reading server/ files
    if (!fullPath.startsWith(path.join(PROJECT_ROOT, "server"))) return null;
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, "utf-8").slice(0, 4000);
  } catch {
    return null;
  }
}

// ── List server source files ──────────────────────────────────────────────────
function listServerFiles(): string[] {
  try {
    const serverDir = path.join(PROJECT_ROOT, "server");
    return fs
      .readdirSync(serverDir)
      .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
      .map((f) => `server/${f}`);
  } catch {
    return [];
  }
}

// ── Run LLM analysis ──────────────────────────────────────────────────────────
export async function runSelfAnalysis(): Promise<{
  suggestion: string;
  patchDiff?: string;
  targetFile?: string;
  patchId?: number;
}> {
  await logger.info("selfImprovement", "Starting self-analysis cycle");

  const context = await buildAnalysisContext();
  const serverFiles = listServerFiles();

  const systemPrompt = `You are JARVIS's self-improvement engine. Your job is to analyze system logs, identify bugs or inefficiencies, and suggest concrete code improvements.

Available server files: ${serverFiles.join(", ")}

Rules:
1. Focus on real errors found in logs
2. Suggest ONE specific, actionable improvement
3. If you propose a code change, format it as a unified diff (--- old +++ new)
4. Be conservative — prefer small, safe changes
5. Never suggest changes to _core/ files
6. If no issues found, suggest a performance optimization or new feature`;

  const userPrompt = `Analyze the following system context and suggest one improvement:\n\n${context}`;

  const response = await ollamaChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]
  );

  // Extract diff if present
  const diffMatch = response.match(/```diff\n([\s\S]*?)```/);
  const patchDiff = diffMatch?.[1];

  // Extract target file from diff
  const targetFileMatch = patchDiff?.match(/---\s+([^\s]+)/);
  const targetFile = targetFileMatch?.[1]?.replace(/^a\//, "");

  // Store as pending patch
  const patch = await addPatch({
    analysisInput: context.slice(0, 3000),
    suggestion: response,
    patchDiff: patchDiff ?? null,
    targetFile: targetFile ?? null,
    status: "pending",
  });

  await logger.info("selfImprovement", `Analysis complete, patch #${patch?.id} created`);

  return {
    suggestion: response,
    patchDiff,
    targetFile,
    patchId: patch?.id,
  };
}

// ── Validate patch syntax before applying ────────────────────────────────────
function validatePatchSyntax(patchDiff: string, targetFile: string): { valid: boolean; error?: string } {
  // Check for dangerous patterns
  const dangerousPatterns = [
    /process\.exit/i,
    /process\.kill/i,
    /fs\.rm.*\/.*\//i,
    /exec\(/i,
    /spawn\(/i,
    /eval\(/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(patchDiff)) {
      return { valid: false, error: `Dangerous pattern detected: ${pattern}` };
    }
  }

  // Ensure patch is modifying the right file
  if (!patchDiff.includes(targetFile.replace(/^server\//, ""))) {
    return { valid: false, error: `Patch doesn't match target file: ${targetFile}` };
  }

  // Check for balanced braces/brackets
  const additions = patchDiff.split("\n").filter((l) => l.startsWith("+")).join("\n");
  const openBraces = (additions.match(/{/g) || []).length;
  const closeBraces = (additions.match(/}/g) || []).length;
  const openBrackets = (additions.match(/\[/g) || []).length;
  const closeBrackets = (additions.match(/\]/g) || []).length;

  if (openBraces !== closeBraces || openBrackets !== closeBrackets) {
    return { valid: false, error: "Unbalanced braces or brackets in patch" };
  }

  return { valid: true };
}

// ── Test patch in isolation ──────────────────────────────────────────────────
async function testPatchApplication(original: string, patchDiff: string): Promise<{ valid: boolean; result?: string; error?: string }> {
  try {
    // Apply patch
    const diffLines = patchDiff.split("\n");
    const removals = diffLines.filter((l) => l.startsWith("-")).map((l) => l.slice(1));
    const additions = diffLines.filter((l) => l.startsWith("+")).map((l) => l.slice(1));

    let patched = original;
    for (let i = 0; i < removals.length; i++) {
      if (removals[i] && additions[i]) {
        if (!original.includes(removals[i])) {
          return { valid: false, error: `Removal pattern not found in file: ${removals[i].slice(0, 50)}...` };
        }
        patched = patched.replace(removals[i], additions[i]);
      }
    }

    // Basic syntax check: ensure TypeScript is still valid
    // (This is a simple heuristic, not a full parser)
    const hasUnclosedString = (patched.match(/"/g) || []).length % 2 !== 0;
    if (hasUnclosedString) {
      return { valid: false, error: "Unclosed string in patched file" };
    }

    return { valid: true, result: patched };
  } catch (err) {
    return { valid: false, error: `Test failed: ${String(err)}` };
  }
}

// ── Apply an approved patch ───────────────────────────────────────────────────
export async function applyPatch(patchId: number): Promise<{ success: boolean; message: string }> {
  const patches = await getPatches(50);
  const patch = patches.find((p: any) => p.id === patchId);

  if (!patch) return { success: false, message: "Patch not found" };
  if (patch.status !== "approved") {
    return { success: false, message: "Patch must be approved before applying" };
  }
  if (!patch.patchDiff || !patch.targetFile) {
    return { success: false, message: "Patch has no diff or target file" };
  }

  // Safety check: path traversal
  const fullPath = path.join(PROJECT_ROOT, patch.targetFile);
  if (!fullPath.startsWith(path.join(PROJECT_ROOT, "server"))) {
    return { success: false, message: "Safety violation: can only patch server/ files" };
  }

  // Validate patch syntax
  const syntaxCheck = validatePatchSyntax(patch.patchDiff, patch.targetFile);
  if (!syntaxCheck.valid) {
    await logger.error("selfImprovement", `Patch #${patchId} failed syntax validation: ${syntaxCheck.error}`);
    return { success: false, message: `Syntax validation failed: ${syntaxCheck.error}` };
  }

  try {
    const original = fs.readFileSync(fullPath, "utf-8");

    // Test patch application before committing
    const testResult = await testPatchApplication(original, patch.patchDiff);
    if (!testResult.valid) {
      await logger.error("selfImprovement", `Patch #${patchId} test failed: ${testResult.error}`);
      return { success: false, message: `Patch test failed: ${testResult.error}` };
    }

    // Create backup
    const backupPath = `${fullPath}.backup.${Date.now()}`;
    fs.writeFileSync(backupPath, original);

    // Apply patch (we know it works from test)
    const patched = testResult.result!;
    fs.writeFileSync(fullPath, patched);
    await updatePatchStatus(patchId, "applied");
    await logger.info("selfImprovement", `Patch #${patchId} applied to ${patch.targetFile} (backup: ${backupPath})`);

    return { success: true, message: `Patch applied to ${patch.targetFile}. Backup saved at ${backupPath}` };
  } catch (err) {
    await logger.error("selfImprovement", `Failed to apply patch #${patchId}: ${String(err)}`);
    return { success: false, message: `Apply failed: ${String(err)}` };
  }
}

// ── Scheduled self-improvement ────────────────────────────────────────────────
let improvementInterval: ReturnType<typeof setInterval> | null = null;

export function startSelfImprovementScheduler(intervalMs = 6 * 60 * 60 * 1000): void {
  if (improvementInterval) return;
  logger.info("selfImprovement", `Self-improvement scheduler started (every ${intervalMs / 3600000}h)`);
  improvementInterval = setInterval(() => runSelfAnalysis(), intervalMs);
}

export function stopSelfImprovementScheduler(): void {
  if (improvementInterval) {
    clearInterval(improvementInterval);
    improvementInterval = null;
  }
}
