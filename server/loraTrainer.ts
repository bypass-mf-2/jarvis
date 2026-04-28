/**
 * LoRA Training Orchestrator
 *
 * End-to-end weekly training cycle:
 *   1. Export weighted training data (corrections 3× + high-rated examples)
 *      — reuses `exportTrainingData` from autoTrain.ts which already merges
 *      corrections with upsampling.
 *   2. Check for GPU (nvidia-smi). If missing, run in mock mode: skip the
 *      actual Python training, log a notice, proceed to eval against the
 *      baseline-vs-itself. This verifies the pipeline end-to-end without
 *      requiring GPU hardware.
 *   3. Train (real) or stub (mock) → produces a new adapter.
 *   4. Run A/B eval via `loraEval.evaluateAdapter` — confidence-gate scoring
 *      plus optional LLM-as-judge on a held-out test set.
 *   5. Deploy gate: only replace the current brain if the adapter beats the
 *      baseline by at least MIN_WIN_MARGIN (default 10pp). Otherwise archive.
 *   6. Record status so the UI can show what happened.
 *
 * Status is persisted in `lora_training_runs`. The router exposes these so
 * you can see a history of every training attempt, its eval verdict, and
 * whether it got deployed.
 */

import * as fs from "fs";
import { execFileSync } from "child_process";
import { getDatabase, markDbDirty } from "./sqlite-init.js";
import { logger } from "./logger.js";
import { exportTrainingData, trainNewModel } from "./autoTrain.js";
import { evaluateAdapter, type EvalResult } from "./loraEval.js";
import { recordEvent } from "./improvementFeed.js";

const DEFAULT_BASE_MODEL = process.env.LORA_BASE_MODEL ?? "llama3.2";
const MIN_WIN_MARGIN = Number(process.env.LORA_MIN_WIN_MARGIN ?? "0.10");
const MIN_EXAMPLES_FOR_REAL_TRAINING = 100;

export type TrainingStatus =
  | "pending"
  | "exporting"
  | "training"
  | "training-mocked"
  | "evaluating"
  | "deployed"
  | "archived-no-improvement"
  | "skipped-insufficient-data"
  | "failed";

export interface TrainingRun {
  id?: number;
  baseModel: string;
  adapterName: string | null;
  trainingExamples: number;
  status: TrainingStatus;
  errorMessage: string | null;
  evalResultId: number | null;
  evalMargin: number | null;
  deployed: boolean;
  mockMode: boolean;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
}

// ── Persistence ──────────────────────────────────────────────────────────────

function ensureRunsTable(): void {
  try {
    const db = getDatabase();
    db.run(
      `CREATE TABLE IF NOT EXISTS lora_training_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        baseModel TEXT NOT NULL,
        adapterName TEXT,
        trainingExamples INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        errorMessage TEXT,
        evalResultId INTEGER,
        evalMargin REAL,
        deployed INTEGER NOT NULL DEFAULT 0,
        mockMode INTEGER NOT NULL DEFAULT 0,
        startedAt INTEGER NOT NULL,
        completedAt INTEGER,
        durationMs INTEGER
      )`
    );
    db.run(`CREATE INDEX IF NOT EXISTS idx_lora_runs_status ON lora_training_runs(status)`);
    markDbDirty();
  } catch (err) {
    logger.warn("loraTrainer", `ensureRunsTable failed: ${String(err)}`).catch(() => {});
  }
}

function insertRun(row: Omit<TrainingRun, "id">): number {
  ensureRunsTable();
  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT INTO lora_training_runs
       (baseModel, adapterName, trainingExamples, status, errorMessage,
        evalResultId, evalMargin, deployed, mockMode, startedAt,
        completedAt, durationMs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.bind([
    row.baseModel,
    row.adapterName,
    row.trainingExamples,
    row.status,
    row.errorMessage,
    row.evalResultId,
    row.evalMargin,
    row.deployed ? 1 : 0,
    row.mockMode ? 1 : 0,
    row.startedAt,
    row.completedAt,
    row.durationMs,
  ]);
  stmt.step();
  stmt.free();
  const idRow = db.exec("SELECT last_insert_rowid() as id");
  markDbDirty();
  return (idRow[0]?.values[0]?.[0] as number) ?? 0;
}

function updateRun(id: number, patch: Partial<TrainingRun>): void {
  try {
    const db = getDatabase();
    const keys = Object.keys(patch).filter((k) => k !== "id");
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => {
      const v = (patch as any)[k];
      if (typeof v === "boolean") return v ? 1 : 0;
      return v ?? null;
    });
    const stmt = db.prepare(`UPDATE lora_training_runs SET ${sets} WHERE id = ?`);
    stmt.bind([...values, id]);
    stmt.step();
    stmt.free();
    markDbDirty();
  } catch (err) {
    logger.warn("loraTrainer", `updateRun failed: ${String(err)}`).catch(() => {});
  }
}

// ── GPU detection ────────────────────────────────────────────────────────────

function hasGpu(): boolean {
  if (process.env.LORA_MOCK === "true") return false;
  if (process.env.LORA_FORCE_REAL === "true") return true;
  try {
    execFileSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

// ── Deploy ───────────────────────────────────────────────────────────────────

async function deployModel(modelName: string): Promise<void> {
  try {
    const db = getDatabase();
    db.run("UPDATE model_versions SET status = 'archived' WHERE status = 'deployed'");
    const up = db.prepare("UPDATE model_versions SET status = 'deployed' WHERE modelName = ?");
    up.bind([modelName]);
    up.step();
    up.free();
    markDbDirty();
  } catch { /* model_versions may not exist — non-fatal */ }

  try {
    const { setSetting } = await import("./llmSettings.js");
    await setSetting("default_model", modelName);
  } catch (err) {
    await logger.warn("loraTrainer", `deployModel: setting update failed: ${String(err)}`);
  }

  // Hot-swap the in-memory default so already-running chat picks up the new
  // model without a server restart. Without this, llmSettings is updated but
  // ollama.ts's cached _defaultModel keeps serving the old model.
  try {
    const { setDefaultModel } = await import("./ollama.js");
    setDefaultModel(modelName);
  } catch (err) {
    await logger.warn("loraTrainer", `deployModel: ollama hot-swap failed: ${String(err)}`);
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export interface RunTrainingCycleOptions {
  baseModel?: string;
  useLlmJudge?: boolean;
  force?: boolean;              // bypass the "not enough examples" gate (mock only)
}

export interface RunTrainingCycleResult {
  runId: number;
  status: TrainingStatus;
  adapterName: string | null;
  mockMode: boolean;
  eval: EvalResult | null;
  deployed: boolean;
  reason: string;
}

/**
 * Runs one complete training cycle. Call this weekly (via scheduler) or
 * on-demand from the router. Always returns — never throws to the caller;
 * failures are captured in the status.
 */
export async function runTrainingCycle(
  opts: RunTrainingCycleOptions = {}
): Promise<RunTrainingCycleResult> {
  const baseModel = opts.baseModel ?? DEFAULT_BASE_MODEL;
  const mockMode = !hasGpu();
  const startedAt = Date.now();

  const runId = insertRun({
    baseModel,
    adapterName: null,
    trainingExamples: 0,
    status: "pending",
    errorMessage: null,
    evalResultId: null,
    evalMargin: null,
    deployed: false,
    mockMode,
    startedAt,
    completedAt: null,
    durationMs: null,
  });

  await logger.info(
    "loraTrainer",
    `Cycle #${runId} starting (base=${baseModel}, mockMode=${mockMode})`
  );

  // ── Step 1: Export training data ────────────────────────────────────────
  updateRun(runId, { status: "exporting" });
  let trainingDataPath: string | null = null;
  let exampleCount = 0;
  try {
    trainingDataPath = await exportTrainingData(undefined, 4, 10000);
    if (trainingDataPath) {
      const content = fs.readFileSync(trainingDataPath, "utf-8");
      exampleCount = content.split("\n").filter((l) => l.trim()).length;
    }
    updateRun(runId, { trainingExamples: exampleCount });
  } catch (err) {
    const msg = String(err);
    await logger.warn("loraTrainer", `Export failed: ${msg}`);
    // No export = no data. In mock mode we still proceed (eval only); in real
    // mode we bail, since there's nothing to train on.
    if (!mockMode) {
      updateRun(runId, {
        status: "failed",
        errorMessage: `export failed: ${msg}`,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
      });
      return {
        runId,
        status: "failed",
        adapterName: null,
        mockMode,
        eval: null,
        deployed: false,
        reason: `export failed: ${msg}`,
      };
    }
  }

  if (exampleCount < MIN_EXAMPLES_FOR_REAL_TRAINING && !mockMode && !opts.force) {
    const reason = `Only ${exampleCount} training examples (<${MIN_EXAMPLES_FOR_REAL_TRAINING} minimum). Skipping real training.`;
    await logger.info("loraTrainer", reason);
    updateRun(runId, {
      status: "skipped-insufficient-data",
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
    });
    return {
      runId,
      status: "skipped-insufficient-data",
      adapterName: null,
      mockMode,
      eval: null,
      deployed: false,
      reason,
    };
  }

  // ── Step 2: Train (or mock) ─────────────────────────────────────────────
  let adapterName: string | null = null;
  try {
    if (mockMode) {
      updateRun(runId, { status: "training-mocked" });
      await logger.info(
        "loraTrainer",
        "Mock mode: skipping Python training step (no GPU detected or LORA_MOCK=true). " +
        "Pipeline will run eval on baseline-vs-itself to verify orchestration."
      );
      // Use the baseline name as the "adapter" so eval runs baseline-vs-baseline
      // and produces a near-tie result — proving the pipeline end-to-end.
      adapterName = baseModel;
    } else {
      updateRun(runId, { status: "training" });
      await logger.info("loraTrainer", `Real training: ${baseModel} on ${trainingDataPath}`);
      if (!trainingDataPath) throw new Error("No training data path");
      adapterName = await trainNewModel(trainingDataPath, baseModel);
    }
    updateRun(runId, { adapterName });
  } catch (err) {
    const msg = String(err);
    await logger.error("loraTrainer", `Training failed: ${msg}`);
    updateRun(runId, {
      status: "failed",
      errorMessage: `training failed: ${msg}`,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
    });
    return {
      runId,
      status: "failed",
      adapterName: null,
      mockMode,
      eval: null,
      deployed: false,
      reason: `training failed: ${msg}`,
    };
  }

  // ── Step 3: Evaluate ────────────────────────────────────────────────────
  updateRun(runId, { status: "evaluating" });
  let evalResult: EvalResult | null = null;
  try {
    evalResult = await evaluateAdapter({
      adapter: adapterName,
      baseline: baseModel,
      useLlmJudge: opts.useLlmJudge ?? false,
      saveToDb: true,
    });
    updateRun(runId, {
      evalResultId: evalResult.id ?? null,
      evalMargin: evalResult.marginOverBaseline,
    });
  } catch (err) {
    const msg = String(err);
    await logger.warn("loraTrainer", `Eval failed: ${msg}`);
    updateRun(runId, {
      status: "failed",
      errorMessage: `eval failed: ${msg}`,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
    });
    return {
      runId,
      status: "failed",
      adapterName,
      mockMode,
      eval: null,
      deployed: false,
      reason: `eval failed: ${msg}`,
    };
  }

  // ── Step 4: Deploy gate ─────────────────────────────────────────────────
  const margin = evalResult.marginOverBaseline;
  let deployed = false;
  let finalStatus: TrainingStatus;
  let reason: string;

  if (mockMode) {
    // In mock mode the "adapter" IS the baseline, so margin is near zero and
    // we deliberately don't deploy. The success signal is that we got here.
    finalStatus = "archived-no-improvement";
    reason = "mock mode — pipeline verified end-to-end, no real adapter to deploy";
  } else if (margin >= MIN_WIN_MARGIN) {
    await deployModel(adapterName);
    deployed = true;
    finalStatus = "deployed";
    reason = `adapter beat baseline by ${(margin * 100).toFixed(1)}pp (>= ${(MIN_WIN_MARGIN * 100).toFixed(0)}pp threshold) — deployed`;
    await logger.info("loraTrainer", `✅ Deployed ${adapterName}: ${reason}`);
  } else {
    finalStatus = "archived-no-improvement";
    reason = `adapter margin ${(margin * 100).toFixed(1)}pp < ${(MIN_WIN_MARGIN * 100).toFixed(0)}pp threshold — archived`;
    await logger.info("loraTrainer", `⏸ Archived ${adapterName}: ${reason}`);
  }

  updateRun(runId, {
    status: finalStatus,
    deployed,
    completedAt: Date.now(),
    durationMs: Date.now() - startedAt,
  });

  try {
    recordEvent({
      type: "manual_note",
      module: "loraTrainer",
      summary: `Training cycle #${runId}: ${finalStatus} (${reason})`,
      details: {
        runId,
        baseModel,
        adapterName,
        mockMode,
        trainingExamples: exampleCount,
        evalMargin: margin,
        deployed,
      },
    });
  } catch { /* non-critical */ }

  return {
    runId,
    status: finalStatus,
    adapterName,
    mockMode,
    eval: evalResult,
    deployed,
    reason,
  };
}

// ── History ─────────────────────────────────────────────────────────────────

export function listTrainingRuns(limit = 20): TrainingRun[] {
  try {
    ensureRunsTable();
    const db = getDatabase();
    const stmt = db.prepare(
      `SELECT * FROM lora_training_runs ORDER BY startedAt DESC LIMIT ?`
    );
    stmt.bind([limit]);
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows.map((r) => ({
      id: r.id,
      baseModel: r.baseModel,
      adapterName: r.adapterName ?? null,
      trainingExamples: r.trainingExamples ?? 0,
      status: r.status as TrainingStatus,
      errorMessage: r.errorMessage ?? null,
      evalResultId: r.evalResultId ?? null,
      evalMargin: r.evalMargin ?? null,
      deployed: Boolean(r.deployed),
      mockMode: Boolean(r.mockMode),
      startedAt: r.startedAt,
      completedAt: r.completedAt ?? null,
      durationMs: r.durationMs ?? null,
    }));
  } catch (err) {
    logger.warn("loraTrainer", `listTrainingRuns failed: ${String(err)}`).catch(() => {});
    return [];
  }
}

export function getLoraConfig(): {
  baseModel: string;
  minWinMargin: number;
  minExamples: number;
  mockMode: boolean;
} {
  return {
    baseModel: DEFAULT_BASE_MODEL,
    minWinMargin: MIN_WIN_MARGIN,
    minExamples: MIN_EXAMPLES_FOR_REAL_TRAINING,
    mockMode: !hasGpu(),
  };
}
