/**
 * Auto-Training Pipeline
 *
 * Continuously improves JARVIS by:
 * 1. Collecting highly-rated responses
 * 2. Fine-tuning model weekly
 * 3. A/B testing new vs old model
 * 4. Deploying best performer
 * 5. Building specialized models
 *
 * JARVIS gets smarter every week!
 */

import * as fs from "fs";
import * as path from "path";
import { execSync, execFileSync } from "child_process";
import { getDatabase, markDbDirty } from "./sqlite-init.js";

function isReadOnlySql(sql: string): boolean {
  const trimmed = sql.trimStart().toUpperCase();
  return trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA") || trimmed.startsWith("EXPLAIN");
}
import { logger } from "./logger.js";
import { ollamaChatBackground as ollamaChat, ollamaChatJson, JSON_MODEL } from "./ollama.js";
import { recordEvent as recordImprovementEvent } from "./improvementFeed.js";
import { isScraperEnabled } from "./scraper.js";

const USE_MYSQL = !!process.env.DATABASE_URL;

const TRAINING_DATA_DIR = path.join(process.cwd(), "training-data");
const MODELS_DIR = path.join(process.cwd(), "custom-models");

// Ensure directories exist
if (!fs.existsSync(TRAINING_DATA_DIR)) {
  fs.mkdirSync(TRAINING_DATA_DIR, { recursive: true });
}
if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

// ── SQLite helpers ──────────────────────────────────────────────────────────
// Dirty-flag model: mark the DB dirty on writes, let the autosave tick
// persist. See db.ts comment for the full rationale.
function sqliteRun(sql: string, params: any[] = []): any[] {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results: any[] = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  if (!isReadOnlySql(sql)) markDbDirty();
  return results;
}

function sqliteInsert(sql: string, params: any[] = []): number {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  markDbDirty();
  return (db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] as number) ?? 1;
}

// ── MySQL Drizzle lazy loader ───────────────────────────────────────────────
let _drizzle: any = null;
async function getDrizzle() {
  if (!_drizzle) {
    const orm = await import("drizzle-orm");
    const schema = await import("../drizzle/schema.js");
    const { drizzle } = await import("drizzle-orm/mysql2");
    const db = drizzle(process.env.DATABASE_URL!);
    _drizzle = { db, orm, schema };
  }
  return _drizzle;
}

// ── Collect Training Data ───────────────────────────────────────────────────
export async function collectTrainingExample(
  conversationId: number,
  userPrompt: string,
  assistantResponse: string,
  userRating: number,
  category?: "ios" | "web" | "data" | "general"
): Promise<void> {
  if (userRating < 4) return;

  const cat = category || detectCategory(userPrompt);

  if (USE_MYSQL) {
    const { db, schema } = await getDrizzle();
    await db.insert(schema.trainingExamples).values({
      conversationId,
      instruction: userPrompt,
      output: assistantResponse,
      rating: userRating,
      category: cat,
      createdAt: new Date(),
    });
  } else {
    sqliteInsert(
      "INSERT INTO training_examples (conversationId, instruction, output, rating, category, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      [conversationId, userPrompt, assistantResponse, userRating, cat, Date.now()]
    );
  }

  await logger.info(
    "autoTrain",
    `Collected training example (${userRating}⭐): ${userPrompt.slice(0, 50)}...`
  );
}

// ── Synthetic Training Data From Knowledge Chunks ──────────────────────────
// Turns scraped knowledge chunks into {instruction, output} pairs by asking
// the local LLM to generate a realistic Q/A grounded in each passage.
// Chunks that have already been converted (chunkId present in training_examples)
// are skipped so we don't re-train on the same source twice.

type RawChunk = {
  id: number;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceType: string | null;
  content: string;
};

function parseQAJson(raw: string): { instruction: string; output: string } | null {
  if (!raw) return null;

  // Try direct parse first — when called via ollamaChatJson the model output
  // is grammar-constrained so this should work cleanly. Fall back to regex
  // extraction for any callers that don't use format=json.
  const candidates: string[] = [raw];
  const match = raw.match(/\{[\s\S]*\}/);
  if (match && match[0] !== raw) candidates.push(match[0]);

  // Small models stubbornly use {question, answer} no matter how clearly
  // the prompt asks for {instruction, output} — both shapes are accepted.
  // Field aliases observed in production logs (see logs/improvement-feed.jsonl):
  //   instruction ← question | prompt | input
  //   output      ← answer | response | result | completion
  const pickField = (obj: any, names: string[]): string => {
    for (const n of names) {
      if (typeof obj?.[n] === "string") return obj[n].trim();
    }
    return "";
  };

  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate);
      const instruction = pickField(obj, ["instruction", "question", "prompt", "input"]);
      const output = pickField(obj, ["output", "answer", "response", "result", "completion"]);
      // Output minimum lowered from 20 → 5 chars: short factual answers
      // ("300 seconds", "60 regions", "Yes") are valid training data and
      // were the only failure mode left after the format=json fix.
      if (instruction.length >= 5 && output.length >= 5) {
        return { instruction, output };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function generateQAFromChunk(
  chunk: RawChunk,
  model: string
): Promise<{ instruction: string; output: string } | null> {
  const sourceLabel = chunk.sourceTitle || chunk.sourceUrl || "an article";
  const prompt = `You are generating training data for an AI assistant.

Below is a passage from ${sourceLabel}. Create ONE realistic question a user might ask that this passage would answer, and the ideal answer grounded entirely in the passage. Do NOT invent facts outside the passage.

Respond with STRICT JSON ONLY in this exact shape, no prose, no code fences:
{"instruction": "...", "output": "..."}

Passage:
"""
${chunk.content.slice(0, 3000)}
"""`;

  // ollamaChatJson sets format=json on the Ollama API, which grammar-constrains
  // output to valid JSON. Without it, small models like llama3.2 routinely
  // wrap responses in prose ("Here's the JSON:...") and every parse fails.
  const raw = await ollamaChatJson([{ role: "user", content: prompt }], model);
  const parsed = parseQAJson(raw);
  if (!parsed) {
    // Surface what the model actually returned so future regressions are
    // visible instead of silently producing 0/N skipped batches.
    const preview = raw.slice(0, 200) || "<empty>";
    await logger.warn(
      "autoTrain",
      `parseQAJson failed for chunk ${chunk.id}; raw response (first 200 chars): ${preview}`
    );
    recordImprovementEvent({
      type: "autotrain_parse_failure",
      module: "autoTrain",
      summary: `LLM produced unparseable JSON for chunk ${chunk.id} using model ${model}`,
      details: {
        chunkId: chunk.id,
        model,
        rawPreview: preview,
        sourceUrl: chunk.sourceUrl,
      },
    });
  }
  return parsed;
}

export async function generateTrainingFromChunks(
  limit = 50,
  model: string = JSON_MODEL
): Promise<{ attempted: number; inserted: number; skipped: number }> {
  await logger.info(
    "autoTrain",
    `Generating synthetic training data from up to ${limit} knowledge chunks`
  );

  // Pull chunks that haven't already been turned into training examples.
  // Prefer chunks from higher-quality domains when the domain_scores table has data.
  let rows: RawChunk[];
  if (USE_MYSQL) {
    // MySQL path: drizzle doesn't have all these tables wired, so do a raw query.
    const { db } = await getDrizzle();
    const result: any = await db.execute(
      `SELECT kc.id, kc.sourceUrl, kc.sourceTitle, kc.sourceType, kc.content
         FROM knowledge_chunks kc
         LEFT JOIN training_examples te ON te.chunkId = kc.id
        WHERE te.id IS NULL
          AND LENGTH(kc.content) >= 200
        ORDER BY kc.createdAt DESC
        LIMIT ?`,
      [limit]
    );
    rows = (result?.[0] ?? result ?? []) as RawChunk[];
  } else {
    rows = sqliteRun(
      `SELECT kc.id, kc.sourceUrl, kc.sourceTitle, kc.sourceType, kc.content
         FROM knowledge_chunks kc
         LEFT JOIN training_examples te ON te.chunkId = kc.id
        WHERE te.id IS NULL
          AND LENGTH(kc.content) >= 200
        ORDER BY kc.createdAt DESC
        LIMIT ?`,
      [limit]
    ) as RawChunk[];
  }

  if (rows.length === 0) {
    await logger.info("autoTrain", "No new knowledge chunks to convert");
    return { attempted: 0, inserted: 0, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;

  // If the user turned the scraper off while this loop is running, bail
  // out immediately. Each iteration hits Ollama with a JSON chat call that
  // blocks the model for 30-60s, so a 50-chunk loop can saturate Ollama
  // for half an hour.
  if (!isScraperEnabled()) {
    await logger.info("autoTrain", "Skipping synthetic generation (scraper disabled)");
    return { attempted: 0, inserted: 0, skipped: 0 };
  }

  for (const chunk of rows) {
    if (!isScraperEnabled()) {
      await logger.info("autoTrain", "Aborting synthetic generation mid-loop (scraper disabled)");
      break;
    }
    try {
      const qa = await generateQAFromChunk(chunk, model);
      if (!qa) {
        skipped++;
        continue;
      }

      const category = detectCategory(qa.instruction + " " + (chunk.sourceTitle ?? ""));
      // Synthetic examples are pinned at rating=4: good enough to feed training,
      // but distinguishable from genuine 5-star user feedback.
      const SYNTH_RATING = 4;

      if (USE_MYSQL) {
        const { db, schema } = await getDrizzle();
        await db.insert(schema.trainingExamples).values({
          conversationId: null,
          chunkId: chunk.id,
          source: "synthetic",
          instruction: qa.instruction,
          output: qa.output,
          rating: SYNTH_RATING,
          category,
          createdAt: new Date(),
        });
      } else {
        sqliteInsert(
          `INSERT INTO training_examples
             (conversationId, chunkId, source, instruction, output, rating, category, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [null, chunk.id, "synthetic", qa.instruction, qa.output, SYNTH_RATING, category, Date.now()]
        );
      }
      inserted++;
    } catch (err) {
      skipped++;
      await logger.warn("autoTrain", `Failed to convert chunk ${chunk.id}: ${err}`);
    }
  }

  await logger.info(
    "autoTrain",
    `Synthetic training generation complete: ${inserted} inserted, ${skipped} skipped of ${rows.length} attempted`
  );
  return { attempted: rows.length, inserted, skipped };
}

function detectCategory(prompt: string): "ios" | "web" | "data" | "general" {
  const lower = prompt.toLowerCase();
  if (lower.match(/swift|ios|swiftui|uikit|xcode|iphone|ipad/)) return "ios";
  if (lower.match(/react|vue|angular|html|css|javascript|typescript|website|frontend|backend/)) return "web";
  if (lower.match(/data|analyze|pandas|numpy|matplotlib|csv|excel|chart|graph/)) return "data";
  return "general";
}

// ── Export Training Data ────────────────────────────────────────────────────
export async function exportTrainingData(
  category?: "ios" | "web" | "data" | "general",
  minRating = 4,
  limit = 10000
): Promise<string> {
  await logger.info("autoTrain", `Exporting training data (category: ${category || "all"})`);

  let examples: any[];
  if (USE_MYSQL) {
    const { db, schema, orm } = await getDrizzle();
    let query = db
      .select()
      .from(schema.trainingExamples)
      .where(orm.gte(schema.trainingExamples.rating, minRating))
      .orderBy(orm.desc(schema.trainingExamples.createdAt))
      .limit(limit);
    if (category) {
      query = query.where(orm.eq(schema.trainingExamples.category, category));
    }
    examples = await query;
  } else {
    if (category) {
      examples = sqliteRun(
        "SELECT * FROM training_examples WHERE rating >= ? AND category = ? ORDER BY createdAt DESC LIMIT ?",
        [minRating, category, limit]
      );
    } else {
      examples = sqliteRun(
        "SELECT * FROM training_examples WHERE rating >= ? ORDER BY createdAt DESC LIMIT ?",
        [minRating, limit]
      );
    }
  }

  if (examples.length === 0) {
    throw new Error("No training examples found. Need at least 100 examples.");
  }

  const jsonlData = examples.map((ex: any) =>
    JSON.stringify({ instruction: ex.instruction, output: ex.output })
  ).join("\n");

  const filename = category
    ? `training-${category}-${Date.now()}.jsonl`
    : `training-general-${Date.now()}.jsonl`;

  const filepath = path.join(TRAINING_DATA_DIR, filename);
  fs.writeFileSync(filepath, jsonlData);

  await logger.info("autoTrain", `Exported ${examples.length} examples to ${filename}`);
  return filepath;
}

// ── Fine-Tune Model ─────────────────────────────────────────────────────────
export async function trainNewModel(
  trainingDataPath: string,
  baseModel = "llama3.2",
  modelName?: string
): Promise<string> {
  const timestamp = Date.now();
  const newModelName = modelName || `trevor-llama-${timestamp}`;

  await logger.info("autoTrain", `Starting training: ${newModelName}`);

  try {
    // Python on Windows accepts forward slashes in paths, and this avoids
    // having to escape backslashes inside Python string literals (e.g. the
    // "\U" in "C:\Users" which Python treats as a unicode escape). We also
    // drop the "./" prefix that used to be glued onto MODELS_DIR — MODELS_DIR
    // is already absolute, so "./" + "C:\..." produced nonsense paths.
    const pyPath = (p: string) => p.replace(/\\/g, "/");
    const trainingDataPathPy = pyPath(trainingDataPath);
    const outputDirPy = pyPath(path.join(MODELS_DIR, newModelName));

    const trainScript = `
import json
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from peft import LoraConfig, get_peft_model, TaskType
from datasets import load_dataset
from trl import SFTTrainer

model_name = "${baseModel}"
model = AutoModelForCausalLM.from_pretrained(model_name, load_in_8bit=True, device_map="auto")
tokenizer = AutoTokenizer.from_pretrained(model_name)
tokenizer.pad_token = tokenizer.eos_token

lora_config = LoraConfig(r=16, lora_alpha=32, target_modules=["q_proj", "v_proj"], lora_dropout=0.05, bias="none", task_type=TaskType.CAUSAL_LM)
model = get_peft_model(model, lora_config)

dataset = load_dataset("json", data_files="${trainingDataPathPy}")

def format_prompt(example):
    return f"### Instruction:\\n{example['instruction']}\\n\\n### Response:\\n{example['output']}"

training_args = TrainingArguments(
    output_dir="${outputDirPy}",
    num_train_epochs=3, per_device_train_batch_size=4, gradient_accumulation_steps=4,
    learning_rate=2e-4, logging_steps=10, save_steps=100, warmup_steps=50, fp16=True,
)

trainer = SFTTrainer(model=model, train_dataset=dataset["train"], args=training_args,
    peft_config=lora_config, formatting_func=format_prompt, max_seq_length=512)
trainer.train()
model.save_pretrained("${outputDirPy}")
tokenizer.save_pretrained("${outputDirPy}")
print("Training complete!")
`;

    const scriptPath = path.join(MODELS_DIR, "train.py");
    fs.writeFileSync(scriptPath, trainScript);

    console.log("\n🚀 Starting model training...");
    // Use execFileSync with args-as-array so paths containing spaces
    // (e.g. "jarvis-ai v6") don't get split by the shell. Previously this
    // used a template-string command which broke on any Windows install
    // whose project directory had a space in it.
    execFileSync("python", [scriptPath], { stdio: "inherit" });

    await logger.info("autoTrain", "Converting model to GGUF format");
    execFileSync(
      "python",
      [
        "-m",
        "llama_cpp.convert",
        "--model",
        path.join(MODELS_DIR, newModelName),
        "--outfile",
        path.join(MODELS_DIR, `${newModelName}.gguf`),
      ],
      { stdio: "inherit" }
    );

    const modelfile = `
FROM ./${MODELS_DIR}/${newModelName}.gguf
PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER top_k 40
SYSTEM """You are JARVIS, Trevor's personal AI assistant."""
`;
    const modelfilePath = path.join(MODELS_DIR, `${newModelName}.Modelfile`);
    fs.writeFileSync(modelfilePath, modelfile);

    execFileSync("ollama", ["create", newModelName, "-f", modelfilePath], { stdio: "inherit" });

    // Save to database
    if (USE_MYSQL) {
      const { db, schema } = await getDrizzle();
      await db.insert(schema.modelVersions).values({
        modelName: newModelName,
        baseModel,
        trainingExamples: fs.readFileSync(trainingDataPath, "utf-8").split("\n").length,
        status: "trained",
        createdAt: new Date(),
      });
    } else {
      sqliteInsert(
        "INSERT INTO model_versions (modelName, baseModel, trainingExamples, status, createdAt) VALUES (?, ?, ?, ?, ?)",
        [newModelName, baseModel, fs.readFileSync(trainingDataPath, "utf-8").split("\n").length, "trained", Date.now()]
      );
    }

    await logger.info("autoTrain", `✅ Model trained and deployed: ${newModelName}`);
    return newModelName;

  } catch (err) {
    await logger.error("autoTrain", `Training failed: ${err}`);
    throw err;
  }
}

// ── A/B Test Models ─────────────────────────────────────────────────────────
export async function abTestModels(
  modelA: string,
  modelB: string,
  testQueries: string[]
): Promise<{ winner: string; scores: { modelA: number; modelB: number } }> {
  await logger.info("autoTrain", `A/B testing: ${modelA} vs ${modelB}`);
  const scores = { modelA: 0, modelB: 0 };

  for (const query of testQueries) {
    const responseA = await ollamaChat([{ role: "user", content: query }], modelA);
    const responseB = await ollamaChat([{ role: "user", content: query }], modelB);

    const judgePrompt = `Compare these two AI responses and choose the better one:
Query: ${query}
Response A: ${responseA}
Response B: ${responseB}
Which response is better? Reply with ONLY "A" or "B".`;

    const judgment = await ollamaChat([{ role: "user", content: judgePrompt }], "llama3.1:70b");
    if (judgment.trim().toUpperCase() === "A") scores.modelA++;
    else if (judgment.trim().toUpperCase() === "B") scores.modelB++;
  }

  const winner = scores.modelA > scores.modelB ? modelA : modelB;
  await logger.info("autoTrain", `A/B test complete. Winner: ${winner} (${scores.modelA}:${scores.modelB})`);
  return { winner, scores };
}

// ── Get Current Model ───────────────────────────────────────────────────────
async function getCurrentModel(): Promise<string> {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getDrizzle();
    const current = await db.select().from(schema.modelVersions)
      .where(orm.eq(schema.modelVersions.status, "deployed"))
      .orderBy(orm.desc(schema.modelVersions.createdAt))
      .limit(1);
    return current[0]?.modelName || "llama3.2";
  }
  const current = sqliteRun("SELECT * FROM model_versions WHERE status = 'deployed' ORDER BY createdAt DESC LIMIT 1");
  return current[0]?.modelName || "llama3.2";
}

async function deployModel(modelName: string): Promise<void> {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getDrizzle();
    await db.update(schema.modelVersions).set({ status: "archived" }).where(orm.eq(schema.modelVersions.status, "deployed"));
    await db.update(schema.modelVersions).set({ status: "deployed" }).where(orm.eq(schema.modelVersions.modelName, modelName));
  } else {
    sqliteRun("UPDATE model_versions SET status = 'archived' WHERE status = 'deployed'");
    sqliteRun("UPDATE model_versions SET status = 'deployed' WHERE modelName = ?", [modelName]);
  }

  const { setSetting } = await import("./llmSettings.js");
  await setSetting("default_model", modelName);
}

// ── Weekly Auto-Update ──────────────────────────────────────────────────────
export async function weeklyModelUpdate(): Promise<void> {
  await logger.info("autoTrain", "🔄 Starting weekly model update");

  try {
    // Before the gate, convert any fresh knowledge chunks into synthetic training
    // examples. This lets newly scraped sources feed the pipeline automatically.
    try {
      await generateTrainingFromChunks(50);
    } catch (err) {
      await logger.warn("autoTrain", `Synthetic chunk generation failed (non-fatal): ${err}`);
    }

    let exampleCount: number;
    if (USE_MYSQL) {
      const { db, schema, orm } = await getDrizzle();
      const newExamples = await db.select().from(schema.trainingExamples)
        .where(orm.gte(schema.trainingExamples.rating, 4))
        .limit(1000);
      exampleCount = newExamples.length;
    } else {
      const newExamples = sqliteRun("SELECT id FROM training_examples WHERE rating >= 4 LIMIT 1000");
      exampleCount = newExamples.length;
    }

    if (exampleCount < 100) {
      await logger.info("autoTrain", `Not enough new examples (${exampleCount}/100). Skipping update.`);
      return;
    }

    const trainingDataPath = await exportTrainingData("general", 4, 1000);
    const newModel = await trainNewModel(trainingDataPath);
    const currentModel = await getCurrentModel();

    const testQueries = [
      "Write a SwiftUI button component",
      "Create a React form with validation",
      "Analyze this dataset and create a chart",
      "Fix this bug in my code",
      "Explain how MVVM works",
    ];

    const { winner } = await abTestModels(currentModel, newModel, testQueries);

    if (winner === newModel) {
      await deployModel(newModel);
      await logger.info("autoTrain", `✅ New model deployed: ${newModel}`);
    } else {
      await logger.info("autoTrain", `Current model still best: ${currentModel}`);
    }
  } catch (err) {
    await logger.error("autoTrain", `Weekly update failed: ${err}`);
  }
}

// ── Specialized Model Training ──────────────────────────────────────────────
export async function trainSpecializedModel(
  specialty: "ios" | "web" | "data"
): Promise<string> {
  await logger.info("autoTrain", `Training specialized model: ${specialty}`);
  const trainingDataPath = await exportTrainingData(specialty, 4, 5000);
  const modelName = `trevor-${specialty}`;
  return await trainNewModel(trainingDataPath, "llama3.2", modelName);
}

// ── Smart Model Router ──────────────────────────────────────────────────────
export async function smartRouteModel(query: string): Promise<string> {
  const lower = query.toLowerCase();

  // Use cached model list instead of blocking execSync
  const { listOllamaModels } = await import("./ollama.js");
  const models = await listOllamaModels();
  const modelSet = new Set(models.map(m => m.replace(/:latest$/, "")));

  if (lower.match(/swift|ios|swiftui|uikit|xcode|iphone|ipad|macos/) && modelSet.has("trevor-ios")) {
    return "trevor-ios";
  }
  if (lower.match(/react|vue|angular|html|css|javascript|typescript|website|frontend|backend|node/) && modelSet.has("trevor-web")) {
    return "trevor-web";
  }
  if (lower.match(/data|analyze|pandas|numpy|matplotlib|csv|excel|chart|graph|visualiz/) && modelSet.has("trevor-data")) {
    return "trevor-data";
  }

  return await getCurrentModel();
}

// ── Start Auto-Training Scheduler ───────────────────────────────────────────
let trainingInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoTraining(intervalMs = 7 * 24 * 60 * 60 * 1000): void {
  if (trainingInterval) return;
  logger.info("autoTrain", "🤖 Auto-training enabled (runs weekly)");

  // Do NOT kick off weeklyModelUpdate() on startup. The pipeline runs up to
  // 50 sequential Ollama JSON calls for synthetic Q/A generation (pinning
  // Ollama for 25-50 min) and then shells out to a Python training script
  // that currently fails fast on most machines — boots would appear stuck
  // for tens of minutes before any error surfaced. The interval timer below
  // still runs it weekly, and weeklyModelUpdate() remains callable manually.
  trainingInterval = setInterval(async () => {
    await weeklyModelUpdate();
  }, intervalMs);
}

export function stopAutoTraining(): void {
  if (trainingInterval) {
    clearInterval(trainingInterval);
    trainingInterval = null;
    logger.info("autoTrain", "Auto-training disabled");
  }
}

// ── Get Training Stats ──────────────────────────────────────────────────────
export async function getTrainingStats(): Promise<{
  totalExamples: number;
  byCategory: Record<string, number>;
  byRating: Record<number, number>;
  lastTrained: Date | null;
  currentModel: string;
}> {
  let examples: any[];
  let lastModel: any[];

  if (USE_MYSQL) {
    const { db, schema, orm } = await getDrizzle();
    examples = await db.select().from(schema.trainingExamples);
    lastModel = await db.select().from(schema.modelVersions).orderBy(orm.desc(schema.modelVersions.createdAt)).limit(1);
  } else {
    examples = sqliteRun("SELECT * FROM training_examples");
    lastModel = sqliteRun("SELECT * FROM model_versions ORDER BY createdAt DESC LIMIT 1");
  }

  const byCategory: Record<string, number> = {};
  const byRating: Record<number, number> = {};

  for (const ex of examples) {
    byCategory[ex.category] = (byCategory[ex.category] || 0) + 1;
    byRating[ex.rating] = (byRating[ex.rating] || 0) + 1;
  }

  return {
    totalExamples: examples.length,
    byCategory,
    byRating,
    lastTrained: lastModel[0]?.createdAt ? new Date(lastModel[0].createdAt) : null,
    currentModel: await getCurrentModel(),
  };
}
