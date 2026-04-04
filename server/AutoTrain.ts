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
import { db } from "./db.js";
import { messages, trainingExamples, modelVersions } from "../drizzle/schema.js";
import { gte, desc, eq } from "drizzle-orm";
import { logger } from "./logger.js";

const TRAINING_DATA_DIR = path.join(process.cwd(), "training-data");
const MODELS_DIR = path.join(process.cwd(), "custom-models");

// Ensure directories exist
if (!fs.existsSync(TRAINING_DATA_DIR)) {
  fs.mkdirSync(TRAINING_DATA_DIR, { recursive: true });
}
if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

// ── Collect Training Data ───────────────────────────────────────────────────
export async function collectTrainingExample(
  conversationId: number,
  userPrompt: string,
  assistantResponse: string,
  userRating: number,
  category?: "ios" | "web" | "data" | "general"
): Promise<void> {
  // Only save highly-rated responses (4-5 stars)
  if (userRating >= 4) {
    await db.insert(trainingExamples).values({
      conversationId,
      instruction: userPrompt,
      output: assistantResponse,
      rating: userRating,
      category: category || detectCategory(userPrompt),
      createdAt: new Date(),
    });

    await logger.info(
      "autoTrain",
      `Collected training example (${userRating}⭐): ${userPrompt.slice(0, 50)}...`
    );
  }
}

function detectCategory(prompt: string): "ios" | "web" | "data" | "general" {
  const lower = prompt.toLowerCase();
  
  if (lower.match(/swift|ios|swiftui|uikit|xcode|iphone|ipad/)) {
    return "ios";
  }
  if (lower.match(/react|vue|angular|html|css|javascript|typescript|website|frontend|backend/)) {
    return "web";
  }
  if (lower.match(/data|analyze|pandas|numpy|matplotlib|csv|excel|chart|graph/)) {
    return "data";
  }
  
  return "general";
}

// ── Export Training Data ────────────────────────────────────────────────────
export async function exportTrainingData(
  category?: "ios" | "web" | "data" | "general",
  minRating = 4,
  limit = 10000
): Promise<string> {
  await logger.info("autoTrain", `Exporting training data (category: ${category || "all"})`);

  let query = db
    .select()
    .from(trainingExamples)
    .where(gte(trainingExamples.rating, minRating))
    .orderBy(desc(trainingExamples.createdAt))
    .limit(limit);

  if (category) {
    query = query.where(eq(trainingExamples.category, category));
  }

  const examples = await query;

  if (examples.length === 0) {
    throw new Error("No training examples found. Need at least 100 examples.");
  }

  // Format as JSONL for training
  const jsonlData = examples.map(ex => 
    JSON.stringify({
      instruction: ex.instruction,
      output: ex.output,
    })
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
    // Create training script
    const trainScript = `
import json
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from peft import LoraConfig, get_peft_model, TaskType
from datasets import load_dataset
from trl import SFTTrainer

# Load base model
model_name = "${baseModel}"
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    load_in_8bit=True,
    device_map="auto"
)
tokenizer = AutoTokenizer.from_pretrained(model_name)
tokenizer.pad_token = tokenizer.eos_token

# LoRA configuration
lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules=["q_proj", "v_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type=TaskType.CAUSAL_LM
)

model = get_peft_model(model, lora_config)

# Load training data
dataset = load_dataset("json", data_files="${trainingDataPath}")

# Combine instruction + output
def format_prompt(example):
    return f"### Instruction:\\n{example['instruction']}\\n\\n### Response:\\n{example['output']}"

# Training arguments
training_args = TrainingArguments(
    output_dir="./${MODELS_DIR}/${newModelName}",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    logging_steps=10,
    save_steps=100,
    warmup_steps=50,
    fp16=True,
)

# Train
trainer = SFTTrainer(
    model=model,
    train_dataset=dataset["train"],
    args=training_args,
    peft_config=lora_config,
    formatting_func=format_prompt,
    max_seq_length=512,
)

trainer.train()

# Save
model.save_pretrained("./${MODELS_DIR}/${newModelName}")
tokenizer.save_pretrained("./${MODELS_DIR}/${newModelName}")

print("Training complete!")
`;

    const scriptPath = path.join(MODELS_DIR, "train.py");
    fs.writeFileSync(scriptPath, trainScript);

    // Run training
    console.log("\n🚀 Starting model training...");
    console.log("This will take 2-6 hours depending on your hardware.\n");

    execSync(`python ${scriptPath}`, { stdio: "inherit" });

    // Convert to GGUF for Ollama
    await logger.info("autoTrain", "Converting model to GGUF format");
    
    execSync(
      `python -m llama_cpp.convert --model ${MODELS_DIR}/${newModelName} --outfile ${MODELS_DIR}/${newModelName}.gguf`,
      { stdio: "inherit" }
    );

    // Create Modelfile for Ollama
    const modelfile = `
FROM ./${MODELS_DIR}/${newModelName}.gguf

PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER top_k 40

SYSTEM """
You are JARVIS, Trevor's personal AI assistant.
You have been trained on Trevor's code style, preferences, and projects.
You write code exactly how Trevor would write it.
You understand Trevor's architectural patterns and best practices.
"""
`;

    const modelfilePath = path.join(MODELS_DIR, `${newModelName}.Modelfile`);
    fs.writeFileSync(modelfilePath, modelfile);

    // Create Ollama model
    execSync(`ollama create ${newModelName} -f ${modelfilePath}`, { stdio: "inherit" });

    // Save to database
    await db.insert(modelVersions).values({
      modelName: newModelName,
      baseModel,
      trainingExamples: fs.readFileSync(trainingDataPath, "utf-8").split("\n").length,
      status: "trained",
      createdAt: new Date(),
    });

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
    // Get responses from both models
    const responseA = await ollamaChat([{ role: "user", content: query }], modelA);
    const responseB = await ollamaChat([{ role: "user", content: query }], modelB);

    // Use a judge model to compare
    const judgePrompt = `Compare these two AI responses and choose the better one:

Query: ${query}

Response A:
${responseA}

Response B:
${responseB}

Which response is better? Reply with ONLY "A" or "B".`;

    const judgment = await ollamaChat(
      [{ role: "user", content: judgePrompt }],
      "llama3.1:70b" // Use best model as judge
    );

    if (judgment.trim().toUpperCase() === "A") {
      scores.modelA++;
    } else if (judgment.trim().toUpperCase() === "B") {
      scores.modelB++;
    }
  }

  const winner = scores.modelA > scores.modelB ? modelA : modelB;

  await logger.info(
    "autoTrain",
    `A/B test complete. Winner: ${winner} (${scores.modelA}:${scores.modelB})`
  );

  return { winner, scores };
}

// ── Weekly Auto-Update ──────────────────────────────────────────────────────
export async function weeklyModelUpdate(): Promise<void> {
  await logger.info("autoTrain", "🔄 Starting weekly model update");

  try {
    // 1. Check if we have enough new training data
    const newExamples = await db
      .select()
      .from(trainingExamples)
      .where(gte(trainingExamples.rating, 4))
      .orderBy(desc(trainingExamples.createdAt))
      .limit(1000);

    if (newExamples.length < 100) {
      await logger.info(
        "autoTrain",
        `Not enough new examples (${newExamples.length}/100). Skipping update.`
      );
      return;
    }

    // 2. Export training data
    const trainingDataPath = await exportTrainingData("general", 4, 1000);

    // 3. Train new model
    const newModel = await trainNewModel(trainingDataPath);

    // 4. A/B test against current model
    const currentModel = await getCurrentModel();
    
    const testQueries = [
      "Write a SwiftUI button component",
      "Create a React form with validation",
      "Analyze this dataset and create a chart",
      "Fix this bug in my code",
      "Explain how MVVM works",
    ];

    const { winner } = await abTestModels(currentModel, newModel, testQueries);

    // 5. Deploy winner
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

async function getCurrentModel(): Promise<string> {
  const current = await db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.status, "deployed"))
    .orderBy(desc(modelVersions.createdAt))
    .limit(1);

  return current[0]?.modelName || "llama3.2";
}

async function deployModel(modelName: string): Promise<void> {
  // Update LLM settings to use new model
  await db
    .update(modelVersions)
    .set({ status: "archived" })
    .where(eq(modelVersions.status, "deployed"));

  await db
    .update(modelVersions)
    .set({ status: "deployed" })
    .where(eq(modelVersions.modelName, modelName));

  // Update default model in settings
  const { setSetting } = await import("./llmSettings.js");
  await setSetting("default_model", modelName);
}

// ── Specialized Model Training ──────────────────────────────────────────────
export async function trainSpecializedModel(
  specialty: "ios" | "web" | "data"
): Promise<string> {
  await logger.info("autoTrain", `Training specialized model: ${specialty}`);

  // Export category-specific data
  const trainingDataPath = await exportTrainingData(specialty, 4, 5000);

  // Train with specialty in name
  const modelName = `trevor-${specialty}`;
  const newModel = await trainNewModel(trainingDataPath, "llama3.2", modelName);

  return newModel;
}

// ── Smart Model Router ──────────────────────────────────────────────────────
export async function smartRouteModel(query: string): Promise<string> {
  const lower = query.toLowerCase();

  // Check for iOS
  if (lower.match(/swift|ios|swiftui|uikit|xcode|iphone|ipad|macos/)) {
    const iosModel = "trevor-ios";
    // Check if model exists
    try {
      execSync(`ollama list | grep ${iosModel}`, { stdio: "pipe" });
      return iosModel;
    } catch {
      // Fall through to default
    }
  }

  // Check for web
  if (lower.match(/react|vue|angular|html|css|javascript|typescript|website|frontend|backend|node/)) {
    const webModel = "trevor-web";
    try {
      execSync(`ollama list | grep ${webModel}`, { stdio: "pipe" });
      return webModel;
    } catch {
      // Fall through to default
    }
  }

  // Check for data
  if (lower.match(/data|analyze|pandas|numpy|matplotlib|csv|excel|chart|graph|visualiz/)) {
    const dataModel = "trevor-data";
    try {
      execSync(`ollama list | grep ${dataModel}`, { stdio: "pipe" });
      return dataModel;
    } catch {
      // Fall through to default
    }
  }

  // Default to best general model
  return await getCurrentModel();
}

// ── Start Auto-Training Scheduler ───────────────────────────────────────────
let trainingInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoTraining(intervalMs = 7 * 24 * 60 * 60 * 1000): void {
  if (trainingInterval) return;

  logger.info("autoTrain", "🤖 Auto-training enabled (runs weekly)");

  // Run immediately on startup (async)
  weeklyModelUpdate().catch(err =>
    logger.error("autoTrain", `Initial training failed: ${err}`)
  );

  // Then run weekly
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
  const examples = await db.select().from(trainingExamples);

  const byCategory: Record<string, number> = {};
  const byRating: Record<number, number> = {};

  for (const ex of examples) {
    byCategory[ex.category] = (byCategory[ex.category] || 0) + 1;
    byRating[ex.rating] = (byRating[ex.rating] || 0) + 1;
  }

  const lastModel = await db
    .select()
    .from(modelVersions)
    .orderBy(desc(modelVersions.createdAt))
    .limit(1);

  return {
    totalExamples: examples.length,
    byCategory,
    byRating,
    lastTrained: lastModel[0]?.createdAt || null,
    currentModel: await getCurrentModel(),
  };
}
