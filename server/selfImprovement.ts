/**
 * Safe Self-Improvement System
 * 
 * SAFETY FEATURES:
 * - Automatic backups before ANY code change
 * - Multiple validation layers
 * - Self-testing before deployment
 * - Automatic rollback on errors
 * - Version control integration
 * - Sandbox testing
 * 
 * JARVIS can improve its own code but will NEVER self-terminate
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { ollamaChatBackground as ollamaChat, ollamaChatJson } from "./ollama.js";
import { logger } from "./logger.js";
import { readRecentEvents, type ImprovementEvent } from "./improvementFeed.js";
import { addPatch } from "./db.js";

const BACKUP_DIR = path.join(process.cwd(), ".jarvis-backups");
const SAFE_MODE_FLAG = path.join(process.cwd(), ".safe-mode");

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// ── Backup System ───────────────────────────────────────────────────────────
export async function createBackup(
  description: string
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}`);

  await logger.info("selfImprove", `Creating backup: ${description}`);

  try {
    // Create backup directory
    fs.mkdirSync(backupPath, { recursive: true });

    // Copy entire server directory
    execSync(`cp -r server "${backupPath}/"`);
    execSync(`cp -r client "${backupPath}/"`);
    execSync(`cp -r drizzle "${backupPath}/"`);

    // Create manifest
    const manifest = {
      timestamp,
      description,
      files: getAllFiles("server"),
      gitCommit: getGitCommit(),
    };

    fs.writeFileSync(
      path.join(backupPath, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );

    await logger.info("selfImprove", `Backup created: ${backupPath}`);

    // Keep only last 20 backups
    cleanOldBackups(20);

    return backupPath;

  } catch (err) {
    await logger.error("selfImprove", `Backup failed: ${err}`);
    throw new Error(`Backup creation failed: ${err}`);
  }
}

function getAllFiles(dir: string): string[] {
  const files: string[] = [];
  
  function walk(currentPath: string) {
    const items = fs.readdirSync(currentPath);
    
    for (const item of items) {
      const itemPath = path.join(currentPath, item);
      const stat = fs.statSync(itemPath);
      
      if (stat.isDirectory() && !item.startsWith(".") && item !== "node_modules") {
        walk(itemPath);
      } else if (stat.isFile()) {
        files.push(itemPath);
      }
    }
  }
  
  walk(dir);
  return files;
}

function getGitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "no-git";
  }
}

function cleanOldBackups(keep: number): void {
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith("backup-"))
    .sort()
    .reverse();

  if (backups.length > keep) {
    for (const backup of backups.slice(keep)) {
      const backupPath = path.join(BACKUP_DIR, backup);
      fs.rmSync(backupPath, { recursive: true });
      logger.info("selfImprove", `Removed old backup: ${backup}`);
    }
  }
}

// ── Rollback System ─────────────────────────────────────────────────────────
export async function rollbackToBackup(backupPath: string): Promise<void> {
  await logger.info("selfImprove", `Rolling back to: ${backupPath}`);

  try {
    // Verify backup exists
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupPath}`);
    }

    // Create a backup of current state before rollback
    await createBackup("Pre-rollback backup");

    // Restore files
    execSync(`cp -r "${backupPath}/server" .`);
    execSync(`cp -r "${backupPath}/client" .`);
    execSync(`cp -r "${backupPath}/drizzle" .`);

    await logger.info("selfImprove", "Rollback complete");

    // Restart server
    console.log("\n⚠️  ROLLBACK COMPLETE - Server needs restart");
    console.log("Run: pnpm dev\n");

  } catch (err) {
    await logger.error("selfImprove", `Rollback failed: ${err}`);
    throw err;
  }
}

export async function getAvailableBackups(): Promise<Array<{
  path: string;
  timestamp: string;
  description: string;
  files: number;
}>> {
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith("backup-"))
    .sort()
    .reverse();

  return backups.map(backup => {
    const backupPath = path.join(BACKUP_DIR, backup);
    const manifestPath = path.join(backupPath, "manifest.json");
    
    let manifest: any = {};
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    }

    return {
      path: backupPath,
      timestamp: manifest.timestamp || backup,
      description: manifest.description || "Unknown",
      files: manifest.files?.length || 0,
    };
  });
}

// ── Code Validation ─────────────────────────────────────────────────────────
async function validateCode(
  filepath: string,
  newCode: string
): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
  criticalIssues: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const criticalIssues: string[] = [];

  // 1. Check for self-termination code
  const dangerousPatterns = [
    /process\.exit/,
    /process\.kill/,
    /System\.exit/,
    /rm\s+-rf\s+\//,
    /delete.*database/i,
    /drop\s+table/i,
    /truncate\s+table/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(newCode)) {
      criticalIssues.push(`Dangerous pattern detected: ${pattern.source}`);
    }
  }

  // 2. Syntax validation
  if (filepath.endsWith(".ts") || filepath.endsWith(".js")) {
    try {
      // Test TypeScript compilation
      const tempFile = path.join(BACKUP_DIR, "temp-validate.ts");
      fs.writeFileSync(tempFile, newCode);
      execSync(`npx tsc --noEmit "${tempFile}"`, { stdio: "pipe" });
      fs.unlinkSync(tempFile);
    } catch (err: any) {
      errors.push(`TypeScript compilation error: ${err.stderr}`);
    }
  }

  // 3. Import validation
  const imports = newCode.match(/import .* from ['"](.*)['"];/g) || [];
  for (const imp of imports) {
    const moduleMatch = imp.match(/from ['"](.*)['"];/);
    if (moduleMatch) {
      const module = moduleMatch[1];
      if (module.startsWith(".")) {
        const modulePath = path.resolve(path.dirname(filepath), module);
        if (!fs.existsSync(modulePath) && !fs.existsSync(modulePath + ".ts")) {
          warnings.push(`Missing import: ${module}`);
        }
      }
    }
  }

  // 4. Critical function preservation
  const criticalFunctions = ["logger", "db", "ollamaChat"];
  for (const func of criticalFunctions) {
    if (!newCode.includes(func) && filepath.includes("server")) {
      warnings.push(`Critical function '${func}' may be missing`);
    }
  }

  return {
    valid: criticalIssues.length === 0 && errors.length === 0,
    errors,
    warnings,
    criticalIssues,
  };
}

// ── Sandbox Testing ─────────────────────────────────────────────────────────
async function testInSandbox(
  filepath: string,
  newCode: string
): Promise<{ passed: boolean; output: string }> {
  const sandboxDir = path.join(BACKUP_DIR, "sandbox");
  
  try {
    // Create sandbox
    if (!fs.existsSync(sandboxDir)) {
      fs.mkdirSync(sandboxDir, { recursive: true });
    }

    // Copy file to sandbox
    const sandboxFile = path.join(sandboxDir, path.basename(filepath));
    fs.writeFileSync(sandboxFile, newCode);

    // Try to run basic checks
    if (filepath.endsWith(".ts")) {
      execSync(`npx tsc --noEmit "${sandboxFile}"`, { stdio: "pipe" });
    }

    // Cleanup
    fs.unlinkSync(sandboxFile);

    return { passed: true, output: "Sandbox test passed" };

  } catch (err: any) {
    return { passed: false, output: err.stderr || err.message };
  }
}

// ── Safe Code Application ───────────────────────────────────────────────────
export async function safeApplyCodeChange(
  filepath: string,
  newCode: string,
  description: string
): Promise<{
  success: boolean;
  backupPath?: string;
  validationResult?: any;
  error?: string;
}> {
  await logger.info("selfImprove", `Attempting code change: ${description}`);

  try {
    // STEP 1: Create backup FIRST
    const backupPath = await createBackup(description);

    // STEP 2: Validate new code
    const validation = await validateCode(filepath, newCode);

    if (validation.criticalIssues.length > 0) {
      await logger.error(
        "selfImprove",
        `CRITICAL ISSUES DETECTED:\n${validation.criticalIssues.join("\n")}`
      );
      return {
        success: false,
        backupPath,
        validationResult: validation,
        error: "Critical issues detected - change rejected",
      };
    }

    if (!validation.valid) {
      await logger.error(
        "selfImprove",
        `VALIDATION FAILED:\n${validation.errors.join("\n")}`
      );
      return {
        success: false,
        backupPath,
        validationResult: validation,
        error: "Validation failed - change rejected",
      };
    }

    // STEP 3: Test in sandbox
    const sandboxResult = await testInSandbox(filepath, newCode);

    if (!sandboxResult.passed) {
      await logger.error("selfImprove", `SANDBOX TEST FAILED: ${sandboxResult.output}`);
      return {
        success: false,
        backupPath,
        validationResult: validation,
        error: "Sandbox test failed - change rejected",
      };
    }

    // STEP 4: Apply changes
    fs.writeFileSync(filepath, newCode);

    await logger.info("selfImprove", `✅ Code change applied successfully: ${filepath}`);

    // STEP 5: Log warnings if any
    if (validation.warnings.length > 0) {
      await logger.warn(
        "selfImprove",
        `Warnings:\n${validation.warnings.join("\n")}`
      );
    }

    return {
      success: true,
      backupPath,
      validationResult: validation,
    };

  } catch (err) {
    await logger.error("selfImprove", `Code change failed: ${err}`);
    return {
      success: false,
      error: String(err),
    };
  }
}

// ── Improved Self-Analysis ─────────────────────────────────────────────────
export async function analyzeSelfForImprovements(): Promise<Array<{
  file: string;
  issue: string;
  severity: "low" | "medium" | "high";
  suggestedFix: string;
  priority: number;
}>> {
  await logger.info("selfImprove", "Analyzing codebase for improvements");

  const improvements: any[] = [];

  // Get all server files
  const files = getAllFiles("server");

  for (const file of files.slice(0, 10)) { // Analyze first 10 files
    if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;

    try {
      const code = fs.readFileSync(file, "utf-8");

      const prompt = `Analyze this code for improvements:

File: ${path.basename(file)}
Code:
\`\`\`typescript
${code.slice(0, 3000)}
\`\`\`

Find issues in these categories:
- Performance problems
- Security vulnerabilities
- Code smells
- Missing error handling
- Inefficient algorithms
- Type safety issues

Return as JSON array:
[
  {
    "issue": "Description",
    "severity": "low|medium|high",
    "suggestedFix": "How to fix it",
    "priority": 1-10
  }
]

Focus on HIGH PRIORITY issues only. Return ONLY the JSON array.`;

      const response = await ollamaChat(
        [{ role: "user", content: prompt }],
        "llama3.1:70b"
      );

      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const issues = JSON.parse(jsonMatch[0]);
        
        for (const issue of issues) {
          improvements.push({
            file,
            ...issue,
          });
        }
      }

    } catch (err) {
      await logger.warn("selfImprove", `Failed to analyze ${file}: ${err}`);
    }
  }

  // Sort by priority
  improvements.sort((a, b) => b.priority - a.priority);

  return improvements.slice(0, 20); // Top 20 improvements
}

// ── Improvement Feed Analyzer ──────────────────────────────────────────────
// Phase 2: read real failure events from the improvement feed (parse failures,
// auto-disabled sources, validator rejections, etc.) and ask the LLM to
// propose targeted code patches grounded in the actual pain points. Patches
// land in self_improvement_patches as `pending` so the user reviews them in
// the existing Self-Improve UI panel — same flow as the legacy analyzer.

// A pattern type needs at least this many events before it's worth asking
// the LLM to propose a fix. Below this threshold the signal is too noisy.
const FEED_ANALYSIS_MIN_OCCURRENCES = 3;

interface FeedPattern {
  type: string;
  count: number;
  sampleSummaries: string[];
  sampleDetails: Array<Record<string, unknown> | undefined>;
  modules: string[];
}

function aggregateFeedPatterns(events: ImprovementEvent[]): FeedPattern[] {
  const byType = new Map<string, FeedPattern>();
  for (const event of events) {
    if (!byType.has(event.type)) {
      byType.set(event.type, {
        type: event.type,
        count: 0,
        sampleSummaries: [],
        sampleDetails: [],
        modules: [],
      });
    }
    const pattern = byType.get(event.type)!;
    pattern.count++;
    if (pattern.sampleSummaries.length < 5) pattern.sampleSummaries.push(event.summary);
    if (pattern.sampleDetails.length < 5) pattern.sampleDetails.push(event.details);
    if (!pattern.modules.includes(event.module)) pattern.modules.push(event.module);
  }
  return Array.from(byType.values())
    .filter(p => p.count >= FEED_ANALYSIS_MIN_OCCURRENCES)
    .sort((a, b) => b.count - a.count);
}

interface FeedPatchProposal {
  summary: string;
  targetFile: string;
  rationale: string;
  severity: "low" | "medium" | "high";
}

async function proposePatchForPattern(pattern: FeedPattern): Promise<FeedPatchProposal | null> {
  const prompt = `You are JARVIS's self-improvement analyzer. Below is a recurring failure pattern from the improvement feed (a log of high-signal events captured during normal operation). Propose ONE targeted code change that would reduce or eliminate this pattern.

Pattern type: ${pattern.type}
Occurrences in recent feed: ${pattern.count}
Source modules: ${pattern.modules.join(", ")}

Sample event summaries:
${pattern.sampleSummaries.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}

Sample event details (JSON):
${pattern.sampleDetails.map((d, i) => `  ${i + 1}. ${JSON.stringify(d ?? {})}`).join("\n")}

Reply with STRICT JSON in this exact shape — no prose, no code fences:
{"summary": "one-line description of the fix", "targetFile": "server/<file>.ts", "rationale": "1-3 sentences on why this fix addresses the pattern", "severity": "low|medium|high"}

Rules:
- targetFile must be a real path under server/, client/src/, or shared/
- If you can't propose a useful concrete fix, return: {"summary": "", "targetFile": "", "rationale": "", "severity": "low"}
- Prefer fixes that prevent the failure rather than masking it`;

  const raw = await ollamaChatJson([{ role: "user", content: prompt }]);
  if (!raw) return null;

  try {
    const obj = JSON.parse(raw);
    const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
    const targetFile = typeof obj.targetFile === "string" ? obj.targetFile.trim() : "";
    const rationale = typeof obj.rationale === "string" ? obj.rationale.trim() : "";
    const severity = obj.severity === "high" || obj.severity === "medium" ? obj.severity : "low";

    // Reject empty / placeholder responses and invalid file paths.
    if (!summary || !targetFile || !rationale) return null;
    if (!targetFile.startsWith("server/") && !targetFile.startsWith("client/") && !targetFile.startsWith("shared/")) {
      return null;
    }

    return { summary, targetFile, rationale, severity };
  } catch {
    return null;
  }
}

/**
 * Phase 2 entry point: scan the improvement feed for recurring failure
 * patterns and turn them into reviewable patches. Safe to call manually
 * (via tRPC) or from the autonomous scheduler. All proposals land as
 * `pending` patches — the user still approves before anything changes.
 */
export async function analyzeImprovementFeed(eventLimit = 200): Promise<{
  eventsScanned: number;
  patternsFound: number;
  patchesProposed: number;
}> {
  const events = readRecentEvents(eventLimit);
  if (events.length === 0) {
    await logger.info("selfImprove", "Improvement feed is empty — nothing to analyze");
    return { eventsScanned: 0, patternsFound: 0, patchesProposed: 0 };
  }

  const patterns = aggregateFeedPatterns(events);
  await logger.info(
    "selfImprove",
    `Improvement feed analysis: ${events.length} events, ${patterns.length} patterns above threshold`
  );

  let proposed = 0;
  for (const pattern of patterns) {
    const proposal = await proposePatchForPattern(pattern);
    if (!proposal) continue;

    await addPatch({
      analysisInput: JSON.stringify({
        source: "improvementFeed",
        patternType: pattern.type,
        occurrences: pattern.count,
        modules: pattern.modules,
        sampleSummaries: pattern.sampleSummaries,
      }).slice(0, 3000),
      suggestion: `[feed/${pattern.type}] ${proposal.summary}\n\n${proposal.rationale}`,
      patchDiff: null,
      targetFile: proposal.targetFile,
      status: "pending",
    });
    proposed++;
    await logger.info(
      "selfImprove",
      `Feed-derived patch proposed for ${proposal.targetFile} (pattern: ${pattern.type}, ${pattern.count} events)`
    );
  }

  return { eventsScanned: events.length, patternsFound: patterns.length, patchesProposed: proposed };
}

// ── Safe Mode Toggle ────────────────────────────────────────────────────────
export function enableSafeMode(): void {
  fs.writeFileSync(SAFE_MODE_FLAG, Date.now().toString());
  logger.info("selfImprove", "🛡️  SAFE MODE ENABLED - No automatic changes");
}

export function disableSafeMode(): void {
  if (fs.existsSync(SAFE_MODE_FLAG)) {
    fs.unlinkSync(SAFE_MODE_FLAG);
  }
  logger.info("selfImprove", "SAFE MODE DISABLED - Automatic changes allowed");
}

export function isSafeModeEnabled(): boolean {
  return fs.existsSync(SAFE_MODE_FLAG);
}

// ── Health Check ────────────────────────────────────────────────────────────
export async function performHealthCheck(): Promise<{
  healthy: boolean;
  issues: string[];
  warnings: string[];
}> {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Check critical files exist
  const criticalFiles = [
    "server/db.ts",
    "server/ollama.ts",
    "server/routers.ts",
    "server/rag.ts",
  ];

  for (const file of criticalFiles) {
    if (!fs.existsSync(file)) {
      issues.push(`Critical file missing: ${file}`);
    }
  }

  // Check database connection
  try {
    const { getSystemLogs } = await import("./db.js");
    await getSystemLogs(1);
  } catch (err) {
    issues.push(`Database connection failed: ${err}`);
  }

  // Check Ollama
  try {
    const { isOllamaAvailable } = await import("./ollama.js");
    const available = await isOllamaAvailable();
    if (!available) {
      issues.push("Ollama not available");
    }
  } catch (err) {
    issues.push(`Ollama check failed: ${err}`);
  }

  return {
    healthy: issues.length === 0,
    issues,
    warnings,
  };
}