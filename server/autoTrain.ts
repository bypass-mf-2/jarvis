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
import { execSync } from "child_process";
import { getDatabase, saveDatabase } from "./sqlite-init.js";
import { logger } from "./logger.js";
import { ollamaChat } from "./ollama.js";

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
function sqliteRun(sql: string, params: any[] = []): any[] {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results: any[] = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  saveDatabase();
  return results;
}

function sqliteInsert(sql: string, params: any[] = []): number {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  saveDatabase();
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

dataset = load_dataset("json", data_files="${trainingDataPath}")

def format_prompt(example):
    return f"### Instruction:\\n{example['instruction']}\\n\\n### Response:\\n{example['output']}"

training_args = TrainingArguments(
    output_dir="./${MODELS_DIR}/${newModelName}",
    num_train_epochs=3, per_device_train_batch_size=4, gradient_accumulation_steps=4,
    learning_rate=2e-4, logging_steps=10, save_steps=100, warmup_steps=50, fp16=True,
)

trainer = SFTTrainer(model=model, train_dataset=dataset["train"], args=training_args,
    peft_config=lora_config, formatting_func=format_prompt, max_seq_length=512)
trainer.train()
model.save_pretrained("./${MODELS_DIR}/${newModelName}")
tokenizer.save_pretrained("./${MODELS_DIR}/${newModelName}")
print("Training complete!")
`;

    const scriptPath = path.join(MODELS_DIR, "train.py");
    fs.writeFileSync(scriptPath, trainScript);

    console.log("\n🚀 Starting model training...");
    execSync(`python ${scriptPath}`, { stdio: "inherit" });

    await logger.info("autoTrain", "Converting model to GGUF format");
    execSync(`python -m llama_cpp.convert --model ${MODELS_DIR}/${newModelName} --outfile ${MODELS_DIR}/${newModelName}.gguf`, { stdio: "inherit" });

    const modelfile = `
FROM ./${MODELS_DIR}/${newModelName}.gguf
PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER top_k 40
SYSTEM """You are JARVIS, Trevor's personal AI assistant."""
`;
    const modelfilePath = path.join(MODELS_DIR, `${newModelName}.Modelfile`);
    fs.writeFileSync(modelfilePath, modelfile);

    execSync(`ollama create ${newModelName} -f ${modelfilePath}`, { stdio: "inherit" });

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

  if (lower.match(/swift|ios|swiftui|uikit|xcode|iphone|ipad|macos/)) {
    try { execSync(`ollama list | grep trevor-ios`, { stdio: "pipe" }); return "trevor-ios"; } catch {}
  }
  if (lower.match(/react|vue|angular|html|css|javascript|typescript|website|frontend|backend|node/)) {
    try { execSync(`ollama list | grep trevor-web`, { stdio: "pipe" }); return "trevor-web"; } catch {}
  }
  if (lower.match(/data|analyze|pandas|numpy|matplotlib|csv|excel|chart|graph|visualiz/)) {
    try { execSync(`ollama list | grep trevor-data`, { stdio: "pipe" }); return "trevor-data"; } catch {}
  }

  return await getCurrentModel();
}

// ── Start Auto-Training Scheduler ───────────────────────────────────────────
let trainingInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoTraining(intervalMs = 7 * 24 * 60 * 60 * 1000): void {
  if (trainingInterval) return;
  logger.info("autoTrain", "🤖 Auto-training enabled (runs weekly)");

  weeklyModelUpdate().catch(err =>
    logger.error("autoTrain", `Initial training failed: ${err}`)
  );

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
