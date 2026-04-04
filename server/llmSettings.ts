/**
 * LLM Settings Manager
 * 
 * Allows manual adjustment of:
 * - Model selection
 * - Temperature
 * - Top-P
 * - Max tokens
 * - System prompt
 * - RAG settings
 * - Memory settings
 * 
 * All settings persist in database and survive restarts
 */

import { db } from "./db.js";
import { llmSettings } from "../drizzle/schema.js";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger.js";

// ── Default LLM Settings ────────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  // Model Selection
  default_model: "llama3.2",
  embedding_model: "nomic-embed-text",
  vision_model: "llava",
  
  // Generation Parameters
  temperature: "0.7",
  top_p: "0.9",
  top_k: "40",
  max_tokens: "2048",
  repeat_penalty: "1.1",
  
  // RAG Settings
  rag_enabled: "true",
  rag_top_k: "5",
  rag_similarity_threshold: "0.7",
  
  // Memory Settings
  memory_enabled: "true",
  memory_auto_extract: "true",
  memory_fact_threshold: "0.7",
  
  // Conversation Settings
  context_window: "20", // Number of previous messages to include
  streaming_enabled: "true",
  
  // System Prompts
  system_prompt_base: `You are JARVIS, Trevor's personal AI assistant. You are helpful, precise, and knowledgeable.`,
  system_prompt_with_memory: `You are JARVIS, Trevor's personal AI assistant. You remember everything Trevor has told you and have deep knowledge about his life, preferences, and goals.`,
};

// ── Get Setting ─────────────────────────────────────────────────────────────
export async function getSetting(
  settingName: string,
  userId: number | null = null
): Promise<string> {
  try {
    // Try to get user-specific setting first
    if (userId) {
      const [userSetting] = await db
        .select()
        .from(llmSettings)
        .where(
          and(
            eq(llmSettings.settingName, settingName),
            eq(llmSettings.userId, userId)
          )
        )
        .limit(1);

      if (userSetting) {
        return userSetting.settingValue;
      }
    }

    // Fall back to global setting
    const [globalSetting] = await db
      .select()
      .from(llmSettings)
      .where(
        and(
          eq(llmSettings.settingName, settingName),
          eq(llmSettings.userId, null)
        )
      )
      .limit(1);

    if (globalSetting) {
      return globalSetting.settingValue;
    }

    // Fall back to default
    return DEFAULT_SETTINGS[settingName as keyof typeof DEFAULT_SETTINGS] || "";

  } catch (err) {
    logger.error("llmSettings", `Failed to get setting ${settingName}: ${err}`);
    return DEFAULT_SETTINGS[settingName as keyof typeof DEFAULT_SETTINGS] || "";
  }
}

// ── Set Setting ─────────────────────────────────────────────────────────────
export async function setSetting(
  settingName: string,
  settingValue: string,
  settingType: "string" | "number" | "boolean" | "json" = "string",
  userId: number | null = null,
  description?: string
): Promise<void> {
  try {
    // Check if setting exists
    const existing = await db
      .select()
      .from(llmSettings)
      .where(
        and(
          eq(llmSettings.settingName, settingName),
          eq(llmSettings.userId, userId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update existing
      await db
        .update(llmSettings)
        .set({
          settingValue,
          settingType,
          description,
          updatedAt: new Date(),
        })
        .where(eq(llmSettings.id, existing[0].id));
    } else {
      // Insert new
      await db.insert(llmSettings).values({
        userId,
        settingName,
        settingValue,
        settingType,
        description,
      });
    }

    await logger.info("llmSettings", `Updated ${settingName} = ${settingValue}`);

  } catch (err) {
    await logger.error("llmSettings", `Failed to set ${settingName}: ${err}`);
    throw err;
  }
}

// ── Get All Settings ────────────────────────────────────────────────────────
export async function getAllSettings(
  userId: number | null = null
): Promise<Record<string, any>> {
  try {
    const settings = await db
      .select()
      .from(llmSettings)
      .where(eq(llmSettings.userId, userId));

    const settingsMap: Record<string, any> = { ...DEFAULT_SETTINGS };

    for (const setting of settings) {
      let value: any = setting.settingValue;

      // Parse based on type
      if (setting.settingType === "number") {
        value = parseFloat(value);
      } else if (setting.settingType === "boolean") {
        value = value === "true";
      } else if (setting.settingType === "json") {
        value = JSON.parse(value);
      }

      settingsMap[setting.settingName] = value;
    }

    return settingsMap;

  } catch (err) {
    logger.error("llmSettings", `Failed to get all settings: ${err}`);
    return DEFAULT_SETTINGS;
  }
}

// ── Preset Configurations ──────────────────────────────────────────────────
export const PRESETS = {
  creative: {
    temperature: "0.9",
    top_p: "0.95",
    repeat_penalty: "1.05",
    description: "Creative, varied responses",
  },
  precise: {
    temperature: "0.3",
    top_p: "0.85",
    repeat_penalty: "1.15",
    description: "Focused, deterministic responses",
  },
  balanced: {
    temperature: "0.7",
    top_p: "0.9",
    repeat_penalty: "1.1",
    description: "Balanced creativity and precision",
  },
  fast: {
    max_tokens: "1024",
    temperature: "0.5",
    description: "Faster, shorter responses",
  },
  detailed: {
    max_tokens: "4096",
    temperature: "0.7",
    description: "Longer, more detailed responses",
  },
};

// ── Apply Preset ────────────────────────────────────────────────────────────
export async function applyPreset(
  presetName: keyof typeof PRESETS,
  userId: number | null = null
): Promise<void> {
  const preset = PRESETS[presetName];

  for (const [key, value] of Object.entries(preset)) {
    if (key !== "description") {
      await setSetting(key, value, "string", userId, preset.description);
    }
  }

  await logger.info("llmSettings", `Applied preset: ${presetName}`);
}

// ── Build Ollama Request ────────────────────────────────────────────────────
export async function buildOllamaRequest(
  messages: Array<{ role: string; content: string }>,
  userId: number | null = null,
  overrides?: Partial<Record<keyof typeof DEFAULT_SETTINGS, string>>
): Promise<any> {
  const settings = await getAllSettings(userId);

  // Apply overrides
  const finalSettings = { ...settings, ...overrides };

  return {
    model: finalSettings.default_model,
    messages,
    stream: finalSettings.streaming_enabled === "true",
    options: {
      temperature: parseFloat(finalSettings.temperature),
      top_p: parseFloat(finalSettings.top_p),
      top_k: parseInt(finalSettings.top_k),
      num_predict: parseInt(finalSettings.max_tokens),
      repeat_penalty: parseFloat(finalSettings.repeat_penalty),
    },
  };
}

// ── Initialize Default Settings ─────────────────────────────────────────────
export async function initializeDefaultSettings(): Promise<void> {
  await logger.info("llmSettings", "Initializing default LLM settings");

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    try {
      const existing = await db
        .select()
        .from(llmSettings)
        .where(
          and(
            eq(llmSettings.settingName, key),
            eq(llmSettings.userId, null)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        let settingType: "string" | "number" | "boolean" | "json" = "string";

        if (value === "true" || value === "false") {
          settingType = "boolean";
        } else if (!isNaN(parseFloat(value)) && key !== "default_model") {
          settingType = "number";
        }

        await db.insert(llmSettings).values({
          userId: null,
          settingName: key,
          settingValue: value,
          settingType,
          description: `Default ${key.replace(/_/g, " ")}`,
        });
      }
    } catch (err) {
      // Ignore errors - setting might already exist
    }
  }

  await logger.info("llmSettings", "Default settings initialized");
}
