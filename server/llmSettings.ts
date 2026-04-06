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

import { getDatabase, saveDatabase } from "./sqlite-init.js";
import { logger } from "./logger.js";

const USE_MYSQL = !!process.env.DATABASE_URL;

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

// ── Default LLM Settings ────────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  default_model: "llama3.2",
  embedding_model: "nomic-embed-text",
  vision_model: "llava",
  temperature: "0.7",
  top_p: "0.9",
  top_k: "40",
  max_tokens: "2048",
  repeat_penalty: "1.1",
  rag_enabled: "true",
  rag_top_k: "5",
  rag_similarity_threshold: "0.7",
  memory_enabled: "true",
  memory_auto_extract: "true",
  memory_fact_threshold: "0.7",
  context_window: "20",
  streaming_enabled: "true",
  system_prompt_base: `You are JARVIS, Trevor's personal AI assistant. You are helpful, precise, and knowledgeable.`,
  system_prompt_with_memory: `You are JARVIS, Trevor's personal AI assistant. You remember everything Trevor has told you and have deep knowledge about his life, preferences, and goals.`,
};

// ── Get Setting ─────────────────────────────────────────────────────────────
export async function getSetting(
  settingName: string,
  userId: number | null = null
): Promise<string> {
  try {
    if (USE_MYSQL) {
      const { db, schema, orm } = await getDrizzle();
      if (userId) {
        const [userSetting] = await db
          .select()
          .from(schema.llmSettings)
          .where(orm.and(orm.eq(schema.llmSettings.settingName, settingName), orm.eq(schema.llmSettings.userId, userId)))
          .limit(1);
        if (userSetting) return userSetting.settingValue;
      }
      const [globalSetting] = await db
        .select()
        .from(schema.llmSettings)
        .where(orm.and(orm.eq(schema.llmSettings.settingName, settingName), orm.isNull(schema.llmSettings.userId)))
        .limit(1);
      if (globalSetting) return globalSetting.settingValue;
    } else {
      if (userId) {
        const rows = sqliteRun("SELECT * FROM llm_settings WHERE settingName = ? AND userId = ? LIMIT 1", [settingName, userId]);
        if (rows[0]) return rows[0].settingValue;
      }
      const rows = sqliteRun("SELECT * FROM llm_settings WHERE settingName = ? AND userId IS NULL LIMIT 1", [settingName]);
      if (rows[0]) return rows[0].settingValue;
    }
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
    if (USE_MYSQL) {
      const { db, schema, orm } = await getDrizzle();
      const existing = await db
        .select()
        .from(schema.llmSettings)
        .where(
          orm.and(
            orm.eq(schema.llmSettings.settingName, settingName),
            userId === null ? orm.isNull(schema.llmSettings.userId) : orm.eq(schema.llmSettings.userId, userId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db.update(schema.llmSettings).set({ settingValue, settingType, description, updatedAt: new Date() })
          .where(orm.eq(schema.llmSettings.id, existing[0].id));
      } else {
        await db.insert(schema.llmSettings).values({ userId, settingName, settingValue, settingType, description });
      }
    } else {
      const existing = sqliteRun(
        userId === null
          ? "SELECT * FROM llm_settings WHERE settingName = ? AND userId IS NULL LIMIT 1"
          : "SELECT * FROM llm_settings WHERE settingName = ? AND userId = ? LIMIT 1",
        userId === null ? [settingName] : [settingName, userId]
      );

      if (existing.length > 0) {
        sqliteRun("UPDATE llm_settings SET settingValue = ?, settingType = ?, description = ?, updatedAt = ? WHERE id = ?",
          [settingValue, settingType, description ?? null, Date.now(), existing[0].id]);
      } else {
        sqliteInsert(
          "INSERT INTO llm_settings (userId, settingName, settingValue, settingType, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [userId, settingName, settingValue, settingType, description ?? null, Date.now(), Date.now()]
        );
      }
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
    let settings: any[];
    if (USE_MYSQL) {
      const { db, schema, orm } = await getDrizzle();
      settings = await db.select().from(schema.llmSettings)
        .where(userId === null ? orm.isNull(schema.llmSettings.userId) : orm.eq(schema.llmSettings.userId, userId));
    } else {
      settings = userId === null
        ? sqliteRun("SELECT * FROM llm_settings WHERE userId IS NULL")
        : sqliteRun("SELECT * FROM llm_settings WHERE userId = ?", [userId]);
    }

    const settingsMap: Record<string, any> = { ...DEFAULT_SETTINGS };

    for (const setting of settings) {
      let value: any = setting.settingValue;
      if (setting.settingType === "number") value = parseFloat(value);
      else if (setting.settingType === "boolean") value = value === "true";
      else if (setting.settingType === "json") value = JSON.parse(value);
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
  const finalSettings = { ...settings, ...overrides };

  return {
    model: finalSettings.default_model,
    messages,
    stream: finalSettings.streaming_enabled === "true",
    options: {
      temperature: parseFloat(finalSettings.temperature ?? "0.7"),
      top_p: parseFloat(finalSettings.top_p ?? "0.9"),
      top_k: parseInt(finalSettings.top_k ?? "40"),
      num_predict: parseInt(finalSettings.max_tokens ?? "2048"),
      repeat_penalty: parseFloat(finalSettings.repeat_penalty ?? "1.1"),
    },
  };
}

// ── Initialize Default Settings ─────────────────────────────────────────────
export async function initializeDefaultSettings(): Promise<void> {
  await logger.info("llmSettings", "Initializing default LLM settings");

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    try {
      let exists = false;
      if (USE_MYSQL) {
        const { db, schema, orm } = await getDrizzle();
        const existing = await db.select().from(schema.llmSettings)
          .where(orm.and(orm.eq(schema.llmSettings.settingName, key), orm.isNull(schema.llmSettings.userId)))
          .limit(1);
        exists = existing.length > 0;

        if (!exists) {
          let settingType: "string" | "number" | "boolean" | "json" = "string";
          if (value === "true" || value === "false") settingType = "boolean";
          else if (!isNaN(parseFloat(value)) && key !== "default_model") settingType = "number";

          await db.insert(schema.llmSettings).values({
            userId: null,
            settingName: key,
            settingValue: value,
            settingType,
            description: `Default ${key.replace(/_/g, " ")}`,
          });
        }
      } else {
        const existing = sqliteRun("SELECT id FROM llm_settings WHERE settingName = ? AND userId IS NULL LIMIT 1", [key]);
        exists = existing.length > 0;

        if (!exists) {
          let settingType: "string" | "number" | "boolean" | "json" = "string";
          if (value === "true" || value === "false") settingType = "boolean";
          else if (!isNaN(parseFloat(value)) && key !== "default_model") settingType = "number";

          sqliteInsert(
            "INSERT INTO llm_settings (userId, settingName, settingValue, settingType, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [null, key, value, settingType, `Default ${key.replace(/_/g, " ")}`, Date.now(), Date.now()]
          );
        }
      }
    } catch (err) {
      // Ignore errors - setting might already exist
    }
  }

  await logger.info("llmSettings", "Default settings initialized");
}
