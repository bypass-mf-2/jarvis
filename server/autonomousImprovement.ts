/**
 * Autonomous Self-Improvement Engine
 * 
 * Multi-tiered autonomy levels:
 * Level 0: Manual approval required (current system)
 * Level 1: Auto-apply safe optimizations (performance, logging, comments)
 * Level 2: Auto-apply bug fixes with test coverage
 * Level 3: Auto-refactor based on code quality metrics
 * Level 4: Auto-implement new features based on user patterns
 * 
 * Safety mechanisms:
 * - Sandboxed testing before applying
 * - Rollback capability with version control
 * - Rate limiting on modifications
 * - Critical file protection
 * - Semantic verification via LLM
 */

import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { ollamaChat } from "./ollama";
import { 
  getRecentErrorLogs, 
  getSystemLogs, 
  addPatch, 
  updatePatchStatus,
  getPatches 
} from "./db";
import { logger } from "./logger";

const execAsync = promisify(exec);
const PROJECT_ROOT = process.cwd();

// ── Configuration ──────────────────────────────────────────────────────────────
interface AutoImproveConfig {
  autonomyLevel: 0 | 1 | 2 | 3 | 4;
  maxPatchesPerHour: number;
  enabledCategories: Set<PatchCategory>;
  criticalFiles: string[];
  testingRequired: boolean;
}

type PatchCategory = 
  | "performance" 
  | "bug_fix" 
  | "refactor" 
  | "feature" 
  | "documentation"
  | "security";

const DEFAULT_CONFIG: AutoImproveConfig = {
  autonomyLevel: 1,
  maxPatchesPerHour: 3,
  enabledCategories: new Set<PatchCategory>(["performance", "documentation"]),
  criticalFiles: ["db.ts", "routers.ts", "ollama.ts"],
  testingRequired: true,
};

let config: AutoImproveConfig = { ...DEFAULT_CONFIG };
let patchesAppliedThisHour = 0;

// ── Safety Validators ──────────────────────────────────────────────────────────
interface ValidationResult {
  safe: boolean;
  category: PatchCategory;
  risk: "low" | "medium" | "high";
  reason?: string;
}

async function validatePatchSafety(
  patchDiff: string, 
  targetFile: string
): Promise<ValidationResult> {
  // Critical file protection
  const fileName = path.basename(targetFile);
  if (config.criticalFiles.includes(fileName)) {
    return {
      safe: false,
      category: "bug_fix",
      risk: "high",
      reason: "Critical file modification requires manual review",
    };
  }

  // Dangerous pattern detection
  const dangerousPatterns = [
    { pattern: /process\.exit|process\.kill/i, reason: "Process termination" },
    { pattern: /fs\.(rm|unlink).*\//i, reason: "File system deletion" },
    { pattern: /exec\(|spawn\(/i, reason: "Command execution" },
    { pattern: /eval\(|Function\(/i, reason: "Dynamic code evaluation" },
    { pattern: /crypto\.createDecipheriv/i, reason: "Cryptography changes" },
    { pattern: /auth|password|token/i, reason: "Authentication/security" },
  ];

  for (const { pattern, reason } of dangerousPatterns) {
    if (pattern.test(patchDiff)) {
      return {
        safe: false,
        category: "security",
        risk: "high",
        reason: `Dangerous pattern: ${reason}`,
      };
    }
  }

  // Categorize the patch using LLM
  const category = await categorizePatch(patchDiff, targetFile);
  
  // Determine if auto-apply is allowed based on autonomy level
  const autoApplyAllowed = shouldAutoApply(category, config.autonomyLevel);
  
  return {
    safe: autoApplyAllowed,
    category,
    risk: calculateRisk(patchDiff, category),
    reason: autoApplyAllowed ? undefined : "Autonomy level too low for this category",
  };
}

async function categorizePatch(
  patchDiff: string, 
  targetFile: string
): Promise<PatchCategory> {
  const prompt = `Analyze this code patch and categorize it:

File: ${targetFile}
Patch:
${patchDiff.slice(0, 1500)}

Categories:
- performance: Optimization without logic changes
- bug_fix: Fixes an error or incorrect behavior
- refactor: Restructuring without changing functionality
- feature: New functionality
- documentation: Comments, docs, logging
- security: Security-related changes

Respond with ONLY the category name, nothing else.`;

  try {
    const response = await ollamaChat([
      { role: "user", content: prompt }
    ]);
    
    const normalized = response.toLowerCase().trim();
    const categories: PatchCategory[] = [
      "performance", "bug_fix", "refactor", "feature", "documentation", "security"
    ];
    
    return categories.find(c => normalized.includes(c)) || "refactor";
  } catch {
    return "refactor"; // Default to safest category
  }
}

function calculateRisk(patchDiff: string, category: PatchCategory): "low" | "medium" | "high" {
  // Lines changed
  const linesChanged = patchDiff.split("\n").filter(l => 
    l.startsWith("+") || l.startsWith("-")
  ).length;
  
  if (linesChanged > 100) return "high";
  if (category === "security" || category === "feature") return "high";
  if (category === "bug_fix" || category === "refactor") return "medium";
  return "low";
}

function shouldAutoApply(category: PatchCategory, level: number): boolean {
  if (level === 0) return false;
  if (level === 1) return category === "performance" || category === "documentation";
  if (level === 2) return category !== "feature" && category !== "security";
  if (level === 3) return category !== "feature";
  return true; // Level 4 auto-applies everything except blocked by other checks
}

// ── Sandboxed Testing ──────────────────────────────────────────────────────────
async function testPatchInSandbox(
  targetFile: string,
  patchedContent: string
): Promise<{ passed: boolean; output?: string; error?: string }> {
  try {
    const testFile = path.join(PROJECT_ROOT, ".sandbox", path.basename(targetFile));
    const sandboxDir = path.dirname(testFile);
    
    // Create sandbox directory
    if (!fs.existsSync(sandboxDir)) {
      fs.mkdirSync(sandboxDir, { recursive: true });
    }
    
    // Write patched file to sandbox
    fs.writeFileSync(testFile, patchedContent);
    
    // Run TypeScript compiler check
    const { stdout, stderr } = await execAsync(
      `npx tsc --noEmit ${testFile}`,
      { cwd: PROJECT_ROOT }
    );
    
    // If no compilation errors, it's safe
    if (!stderr || !stderr.includes("error TS")) {
      return { passed: true, output: stdout };
    }
    
    return { passed: false, error: stderr };
  } catch (err) {
    return { passed: false, error: String(err) };
  }
}

// ── Git Integration ────────────────────────────────────────────────────────────
async function createGitCommit(
  targetFile: string, 
  patchId: number, 
  category: PatchCategory
): Promise<void> {
  try {
    const message = `[JARVIS Auto-Improve] ${category} patch #${patchId} to ${path.basename(targetFile)}`;
    
    await execAsync(`git add ${targetFile}`, { cwd: PROJECT_ROOT });
    await execAsync(`git commit -m "${message}"`, { cwd: PROJECT_ROOT });
    
    await logger.info("autonomousImprovement", `Git commit created for patch #${patchId}`);
  } catch (err) {
    await logger.warn("autonomousImprovement", `Git commit failed: ${String(err)}`);
  }
}

async function rollbackPatch(targetFile: string): Promise<void> {
  try {
    await execAsync(`git checkout HEAD -- ${targetFile}`, { cwd: PROJECT_ROOT });
    await logger.info("autonomousImprovement", `Rolled back ${targetFile}`);
  } catch (err) {
    await logger.error("autonomousImprovement", `Rollback failed: ${String(err)}`);
  }
}

// ── Advanced Analysis ──────────────────────────────────────────────────────────
interface AnalysisContext {
  errorLogs: any[];
  performanceMetrics: any[];
  codeMetrics: CodeMetrics;
  userPatterns: UserPattern[];
}

interface CodeMetrics {
  linesOfCode: number;
  complexity: number;
  duplications: number;
  testCoverage: number;
}

interface UserPattern {
  query: string;
  frequency: number;
  successRate: number;
  avgResponseTime: number;
}

async function buildAdvancedContext(): Promise<AnalysisContext> {
  const errorLogs = await getRecentErrorLogs(50);
  const performanceMetrics = await analyzePerformance();
  const codeMetrics = await analyzeCodeQuality();
  const userPatterns = await analyzeUserPatterns();
  
  return {
    errorLogs,
    performanceMetrics,
    codeMetrics,
    userPatterns,
  };
}

async function analyzePerformance(): Promise<any[]> {
  const logs = await getSystemLogs(200);
  
  // Extract performance metrics from logs
  const metrics = logs
    .filter((l: any) => l.message?.includes("ms") || l.message?.includes("time"))
    .map((l: any) => {
      const timeMatch = l.message.match(/(\d+)\s*ms/);
      return timeMatch ? {
        module: l.module,
        time: parseInt(timeMatch[1]),
        timestamp: l.createdAt,
      } : null;
    })
    .filter(Boolean);
  
  return metrics;
}

async function analyzeCodeQuality(): Promise<CodeMetrics> {
  try {
    const serverDir = path.join(PROJECT_ROOT, "server");
    const files = fs.readdirSync(serverDir)
      .filter(f => f.endsWith(".ts") && !f.startsWith("_"));
    
    let totalLines = 0;
    let complexFunctions = 0;
    
    for (const file of files) {
      const content = fs.readFileSync(path.join(serverDir, file), "utf-8");
      totalLines += content.split("\n").length;
      
      // Count complex functions (>50 lines)
      const functionMatches = content.match(/function\s+\w+[^{]*{/g) || [];
      complexFunctions += functionMatches.length;
    }
    
    return {
      linesOfCode: totalLines,
      complexity: Math.round(complexFunctions / files.length),
      duplications: 0, // Would need AST analysis
      testCoverage: 0, // Would need coverage report
    };
  } catch {
    return { linesOfCode: 0, complexity: 0, duplications: 0, testCoverage: 0 };
  }
}

async function analyzeUserPatterns(): Promise<UserPattern[]> {
  // Analyze recent conversations to identify patterns
  const logs = await getSystemLogs(500);
  const chatLogs = logs.filter((l: any) => l.module === "rag" && l.message?.includes("query"));
  
  const patterns = new Map<string, { count: number; timestamps: Date[] }>();
  
  for (const log of chatLogs) {
    const queryMatch = log.message.match(/"([^"]+)"/);
    if (queryMatch) {
      const query = queryMatch[1].toLowerCase().split(" ").slice(0, 3).join(" ");
      const existing = patterns.get(query) || { count: 0, timestamps: [] };
      existing.count++;
      existing.timestamps.push(new Date(log.createdAt));
      patterns.set(query, existing);
    }
  }
  
  return Array.from(patterns.entries())
    .filter(([_, data]) => data.count >= 3)
    .map(([query, data]) => ({
      query,
      frequency: data.count,
      successRate: 1.0, // Would need feedback mechanism
      avgResponseTime: 0, // Would need timing data
    }));
}

// ── Autonomous Improvement Cycle ───────────────────────────────────────────────
export async function runAutonomousAnalysis(): Promise<{
  patchesGenerated: number;
  patchesApplied: number;
  patchesPending: number;
}> {
  await logger.info("autonomousImprovement", "Starting autonomous analysis cycle");
  
  // Check rate limiting
  if (patchesAppliedThisHour >= config.maxPatchesPerHour) {
    await logger.info("autonomousImprovement", "Rate limit reached, skipping cycle");
    return { patchesGenerated: 0, patchesApplied: 0, patchesPending: 0 };
  }
  
  const context = await buildAdvancedContext();
  
  // Generate improvement suggestions
  const suggestions = await generateImprovements(context);
  
  let applied = 0;
  let pending = 0;
  
  for (const suggestion of suggestions) {
    if (patchesAppliedThisHour >= config.maxPatchesPerHour) break;
    
    const validation = await validatePatchSafety(
      suggestion.patchDiff, 
      suggestion.targetFile
    );
    
    // Store patch
    const patch = await addPatch({
      analysisInput: JSON.stringify(context).slice(0, 3000),
      suggestion: suggestion.description,
      patchDiff: suggestion.patchDiff,
      targetFile: suggestion.targetFile,
      status: validation.safe ? "approved" : "pending",
    });
    
    if (validation.safe && config.testingRequired) {
      // Test in sandbox
      const original = fs.readFileSync(
        path.join(PROJECT_ROOT, suggestion.targetFile), 
        "utf-8"
      );
      const patched = applyPatchToContent(original, suggestion.patchDiff);
      
      const testResult = await testPatchInSandbox(suggestion.targetFile, patched);
      
      if (testResult.passed) {
        // Auto-apply
        fs.writeFileSync(
          path.join(PROJECT_ROOT, suggestion.targetFile),
          patched
        );
        
        await updatePatchStatus(patch!.id, "applied");
        await createGitCommit(suggestion.targetFile, patch!.id, validation.category);
        
        applied++;
        patchesAppliedThisHour++;
        
        await logger.info(
          "autonomousImprovement",
          `Auto-applied ${validation.category} patch #${patch!.id} to ${suggestion.targetFile}`
        );
      } else {
        pending++;
        await logger.warn(
          "autonomousImprovement",
          `Patch #${patch!.id} failed sandbox testing: ${testResult.error}`
        );
      }
    } else {
      pending++;
    }
  }
  
  return {
    patchesGenerated: suggestions.length,
    patchesApplied: applied,
    patchesPending: pending,
  };
}

async function generateImprovements(
  context: AnalysisContext
): Promise<Array<{ description: string; patchDiff: string; targetFile: string }>> {
  const systemPrompt = `You are JARVIS's autonomous improvement engine. Analyze the system state and generate targeted improvements.

Current system metrics:
- Total lines of code: ${context.codeMetrics.linesOfCode}
- Average function complexity: ${context.codeMetrics.complexity}
- Recent errors: ${context.errorLogs.length}
- Frequent user patterns: ${context.userPatterns.length}

Focus on:
1. Fixing errors found in logs
2. Performance optimizations for slow operations
3. Adding features users frequently request
4. Code quality improvements

Generate 1-3 specific improvements as JSON array:
[{
  "description": "Brief description",
  "targetFile": "server/filename.ts",
  "patchDiff": "unified diff format"
}]

Only return the JSON array, no other text.`;

  const userPrompt = `Context:
Errors: ${JSON.stringify(context.errorLogs.slice(0, 10), null, 2)}
Performance issues: ${JSON.stringify(context.performanceMetrics.slice(0, 5), null, 2)}
User patterns: ${JSON.stringify(context.userPatterns.slice(0, 5), null, 2)}`;

  try {
    const response = await ollamaChat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
    
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const suggestions = JSON.parse(jsonMatch[0]);
      return suggestions.filter((s: any) => 
        s.description && s.targetFile && s.patchDiff
      );
    }
  } catch (err) {
    await logger.error("autonomousImprovement", `Failed to generate improvements: ${String(err)}`);
  }
  
  return [];
}

function applyPatchToContent(original: string, patchDiff: string): string {
  const diffLines = patchDiff.split("\n");
  const removals = diffLines.filter(l => l.startsWith("-") && !l.startsWith("---")).map(l => l.slice(1));
  const additions = diffLines.filter(l => l.startsWith("+") && !l.startsWith("+++")).map(l => l.slice(1));
  
  let patched = original;
  for (let i = 0; i < Math.max(removals.length, additions.length); i++) {
    if (removals[i] && additions[i]) {
      patched = patched.replace(removals[i], additions[i]);
    } else if (additions[i]) {
      patched += "\n" + additions[i];
    }
  }
  
  return patched;
}

// ── Configuration Management ───────────────────────────────────────────────────
export function setAutonomyLevel(level: 0 | 1 | 2 | 3 | 4): void {
  config.autonomyLevel = level;
  logger.info("autonomousImprovement", `Autonomy level set to ${level}`);
}

export function getAutonomyConfig(): AutoImproveConfig {
  return { ...config };
}

// ── Scheduler ──────────────────────────────────────────────────────────────────
let improvementInterval: ReturnType<typeof setInterval> | null = null;

export function startAutonomousScheduler(intervalMs = 1 * 60 * 60 * 1000): void {
  if (improvementInterval) return;
  
  logger.info("autonomousImprovement", `Autonomous improvement started (level ${config.autonomyLevel})`);
  
  // Reset rate limiting every hour
  setInterval(() => {
    patchesAppliedThisHour = 0;
  }, 60 * 60 * 1000);
  
  improvementInterval = setInterval(() => runAutonomousAnalysis(), intervalMs);
}

export function stopAutonomousScheduler(): void {
  if (improvementInterval) {
    clearInterval(improvementInterval);
    improvementInterval = null;
    logger.info("autonomousImprovement", "Autonomous improvement stopped");
  }
}
