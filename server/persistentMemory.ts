/**
 * Persistent Memory Manager
 *
 * Automatically extracts and stores:
 * - Facts about Trevor from every conversation
 * - Entities (people, places, concepts)
 * - Cross-conversation context
 * - Everything learned from files
 *
 * SURVIVES RESTARTS - Everything stored in database
 */

import { ollamaChatBackground as ollamaChat } from "./ollama.js";
import {
  getMessages,
  getConversations,
  getLearnedFacts,
  searchLearnedFacts,
  getEntityMemory,
  searchEntityMemory,
} from "./db.js";
import { getDatabase, markDbDirty } from "./sqlite-init.js";
import { logger } from "./logger.js";

const USE_MYSQL = !!process.env.DATABASE_URL;

function isReadOnlySql(sql: string): boolean {
  const trimmed = sql.trimStart().toUpperCase();
  return trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA") || trimmed.startsWith("EXPLAIN");
}

// ── SQLite helpers (local to this module) ───────────────────────────────────
// Dirty-flag model — see db.ts for rationale.
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

// ── Extract Facts from Conversation ─────────────────────────────────────────
export async function extractFactsFromConversation(
  conversationId: number
): Promise<number> {
  await logger.info("memory", `Extracting facts from conversation ${conversationId}`);

  // Create learning session
  let sessionId: number;
  if (USE_MYSQL) {
    const { db, schema } = await getDrizzle();
    const [session] = await db.insert(schema.learningSessions).values({
      sessionType: "conversation_analysis",
      itemsProcessed: 0,
      factsLearned: 0,
    });
    sessionId = session.insertId;
  } else {
    sessionId = sqliteInsert(
      "INSERT INTO learning_sessions (sessionType, itemsProcessed, factsLearned, startedAt) VALUES (?, ?, ?, ?)",
      ["conversation_analysis", 0, 0, Date.now()]
    );
  }

  try {
    const msgs = await getMessages(conversationId);
    if (msgs.length === 0) return 0;

    const conversationText = msgs
      .map((m: any) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

    const prompt = `Analyze this conversation and extract ALL factual information about Trevor (the user).

Conversation:
${conversationText}

Extract facts in these categories:
- PERSONAL: Facts about Trevor himself (age, location, job, education, etc)
- PREFERENCES: What Trevor likes/dislikes, prefers, wants
- KNOWLEDGE: Things Trevor knows or is learning
- GOALS: Trevor's goals, aspirations, plans
- RELATIONSHIPS: People Trevor mentions (friends, family, colleagues)
- EXPERIENCES: Things Trevor has done or is doing
- SKILLS: Trevor's abilities and expertise

Return as JSON:
{
  "personal": [{"fact": "...", "confidence": 0.95}],
  "preferences": [{"fact": "...", "confidence": 0.90}],
  "knowledge": [{"fact": "...", "confidence": 0.85}],
  "goals": [{"fact": "...", "confidence": 0.90}],
  "relationships": [{"fact": "...", "confidence": 0.80}],
  "experiences": [{"fact": "...", "confidence": 0.95}],
  "skills": [{"fact": "...", "confidence": 0.90}]
}

Only include facts with confidence > 0.70. Be THOROUGH - extract EVERYTHING.`;

    const response = await ollamaChat([{ role: "user", content: prompt }]);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Failed to extract facts");

    const extracted = JSON.parse(jsonMatch[0]);
    let factsLearned = 0;

    for (const [category, facts] of Object.entries(extracted)) {
      for (const factData of facts as any[]) {
        if (USE_MYSQL) {
          const { db, schema, orm } = await getDrizzle();
          const existing = await db
            .select()
            .from(schema.learnedFacts)
            .where(orm.eq(schema.learnedFacts.fact, factData.fact))
            .limit(1);

          if (existing.length === 0) {
            await db.insert(schema.learnedFacts).values({
              category: category as any,
              fact: factData.fact,
              confidence: factData.confidence.toFixed(2),
              sourceConversationId: conversationId,
              verified: false,
              timesReferenced: 0,
            });
            factsLearned++;
          } else {
            await db
              .update(schema.learnedFacts)
              .set({
                confidence: Math.max(
                  parseFloat(existing[0].confidence),
                  factData.confidence
                ).toFixed(2),
                timesReferenced: existing[0].timesReferenced + 1,
                updatedAt: new Date(),
              })
              .where(orm.eq(schema.learnedFacts.id, existing[0].id));
          }
        } else {
          const existing = sqliteRun("SELECT * FROM learned_facts WHERE fact = ? LIMIT 1", [factData.fact]);
          if (existing.length === 0) {
            sqliteInsert(
              "INSERT INTO learned_facts (category, fact, confidence, sourceConversationId, verified, timesReferenced, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              [category, factData.fact, factData.confidence.toFixed(2), conversationId, 0, 0, Date.now(), Date.now()]
            );
            factsLearned++;
          } else {
            sqliteRun(
              "UPDATE learned_facts SET confidence = ?, timesReferenced = timesReferenced + 1, updatedAt = ? WHERE id = ?",
              [Math.max(parseFloat(existing[0].confidence), factData.confidence).toFixed(2), Date.now(), existing[0].id]
            );
          }
        }
      }
    }

    // Update session
    if (USE_MYSQL) {
      const { db, schema, orm } = await getDrizzle();
      await db.update(schema.learningSessions).set({
        itemsProcessed: msgs.length,
        factsLearned,
        status: "success",
        completedAt: new Date(),
      }).where(orm.eq(schema.learningSessions.id, sessionId));
    } else {
      sqliteRun(
        "UPDATE learning_sessions SET itemsProcessed = ?, factsLearned = ?, status = ?, completedAt = ? WHERE id = ?",
        [msgs.length, factsLearned, "success", Date.now(), sessionId]
      );
    }

    await logger.info("memory", `Learned ${factsLearned} new facts from conversation ${conversationId}`);
    return factsLearned;

  } catch (err) {
    await logger.error("memory", `Fact extraction failed: ${err}`);
    if (USE_MYSQL) {
      const { db, schema, orm } = await getDrizzle();
      await db.update(schema.learningSessions).set({
        status: "error",
        notes: String(err),
        completedAt: new Date(),
      }).where(orm.eq(schema.learningSessions.id, sessionId));
    } else {
      sqliteRun(
        "UPDATE learning_sessions SET status = ?, notes = ?, completedAt = ? WHERE id = ?",
        ["error", String(err), Date.now(), sessionId]
      );
    }
    return 0;
  }
}

// ── Extract Entities from Conversation ──────────────────────────────────────
export async function extractEntitiesFromConversation(
  conversationId: number
): Promise<number> {
  await logger.info("memory", `Extracting entities from conversation ${conversationId}`);

  const msgs = await getMessages(conversationId);
  const conversationText = msgs.map((m: any) => m.content).join("\n\n");

  const prompt = `Extract all named entities from this conversation:

${conversationText}

Return as JSON array:
[
  {
    "name": "Entity Name",
    "type": "person|place|organization|concept|event|object",
    "description": "Brief description",
    "attributes": {"key": "value"},
    "importance": 0.0-1.0
  }
]

Only include important entities (importance > 0.5).`;

  try {
    const response = await ollamaChat([{ role: "user", content: prompt }]);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return 0;

    const entities = JSON.parse(jsonMatch[0]);
    let entitiesAdded = 0;

    for (const entity of entities) {
      if (USE_MYSQL) {
        const { db, schema, orm } = await getDrizzle();
        const existing = await db
          .select()
          .from(schema.entityMemory)
          .where(orm.eq(schema.entityMemory.name, entity.name))
          .limit(1);

        if (existing.length === 0) {
          await db.insert(schema.entityMemory).values({
            name: entity.name,
            type: entity.type,
            description: entity.description,
            attributes: entity.attributes,
            importance: entity.importance.toFixed(2),
            mentionCount: 1,
            firstMentioned: new Date(),
            lastMentioned: new Date(),
          });
          entitiesAdded++;
        } else {
          await db.update(schema.entityMemory).set({
            mentionCount: existing[0].mentionCount + 1,
            lastMentioned: new Date(),
            importance: Math.max(
              parseFloat(existing[0].importance),
              entity.importance
            ).toFixed(2),
          }).where(orm.eq(schema.entityMemory.id, existing[0].id));
        }
      } else {
        const existing = sqliteRun("SELECT * FROM entity_memory WHERE name = ? LIMIT 1", [entity.name]);
        if (existing.length === 0) {
          sqliteInsert(
            "INSERT INTO entity_memory (name, type, description, attributes, importance, mentionCount, firstMentioned, lastMentioned, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [entity.name, entity.type, entity.description, JSON.stringify(entity.attributes), entity.importance.toFixed(2), 1, Date.now(), Date.now(), Date.now(), Date.now()]
          );
          entitiesAdded++;
        } else {
          sqliteRun(
            "UPDATE entity_memory SET mentionCount = mentionCount + 1, lastMentioned = ?, importance = ?, updatedAt = ? WHERE id = ?",
            [Date.now(), Math.max(parseFloat(existing[0].importance || "0"), entity.importance).toFixed(2), Date.now(), existing[0].id]
          );
        }
      }
    }

    return entitiesAdded;

  } catch (err) {
    await logger.error("memory", `Entity extraction failed: ${err}`);
    return 0;
  }
}

// ── Build Conversation Summary ──────────────────────────────────────────────
export async function summarizeConversation(
  conversationId: number
): Promise<void> {
  const msgs = await getMessages(conversationId);
  const conversationText = msgs
    .map((m: any) => `${m.role}: ${m.content}`)
    .join("\n");

  const prompt = `Summarize this conversation:

${conversationText}

Return as JSON:
{
  "summary": "Brief summary of what was discussed",
  "keyTopics": ["topic1", "topic2", ...],
  "sentiment": "positive|neutral|negative",
  "followUpNeeded": true|false,
  "followUpTopic": "What needs follow-up" or null
}`;

  try {
    const response = await ollamaChat([{ role: "user", content: prompt }]);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const summary = JSON.parse(jsonMatch[0]);

    if (USE_MYSQL) {
      const { db, schema } = await getDrizzle();
      await db.insert(schema.conversationContext).values({
        conversationId,
        topicSummary: summary.summary,
        keyTopics: summary.keyTopics,
        sentiment: summary.sentiment,
        followUpNeeded: summary.followUpNeeded,
        followUpTopic: summary.followUpTopic,
      });
    } else {
      sqliteInsert(
        "INSERT INTO conversation_context (conversationId, topicSummary, keyTopics, sentiment, followUpNeeded, followUpTopic, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [conversationId, summary.summary, JSON.stringify(summary.keyTopics), summary.sentiment, summary.followUpNeeded ? 1 : 0, summary.followUpTopic, Date.now(), Date.now()]
      );
    }
  } catch (err) {
    await logger.error("memory", `Conversation summarization failed: ${err}`);
  }
}

// ── Recall Relevant Facts ───────────────────────────────────────────────────
export async function recallRelevantFacts(
  query: string,
  limit = 10
): Promise<any[]> {
  if (USE_MYSQL) {
    return searchLearnedFacts(query, limit);
  }
  // SQLite: keyword search
  return sqliteRun(
    "SELECT * FROM learned_facts WHERE fact LIKE ? ORDER BY confidence DESC LIMIT ?",
    [`%${query}%`, limit]
  );
}

// ── Recall Related Entities ─────────────────────────────────────────────────
export async function recallEntities(
  query: string,
  limit = 5
): Promise<any[]> {
  if (USE_MYSQL) {
    return searchEntityMemory(query, limit);
  }
  return sqliteRun(
    "SELECT * FROM entity_memory WHERE name LIKE ? OR description LIKE ? ORDER BY importance DESC LIMIT ?",
    [`%${query}%`, `%${query}%`, limit]
  );
}

// ── Get Memory Context for Query ────────────────────────────────────────────
export async function getMemoryContext(query: string): Promise<string> {
  const facts = await recallRelevantFacts(query, 5);
  const entities = await recallEntities(query, 3);

  if (facts.length === 0 && entities.length === 0) return "";

  let context = "=== PERSISTENT MEMORY ===\n\n";

  if (facts.length > 0) {
    context += "FACTS ABOUT TREVOR:\n";
    for (const fact of facts) {
      context += `- ${fact.fact} (confidence: ${fact.confidence})\n`;
    }
    context += "\n";
  }

  if (entities.length > 0) {
    context += "RELEVANT ENTITIES:\n";
    for (const entity of entities) {
      context += `- ${entity.name} (${entity.type}): ${entity.description}\n`;
    }
    context += "\n";
  }

  context += "=== END MEMORY ===\n\n";
  return context;
}

// ── Auto-extract after conversation ends ────────────────────────────────────
export async function processConversationMemory(
  conversationId: number
): Promise<void> {
  await logger.info("memory", `Processing memory for conversation ${conversationId}`);

  try {
    const factsLearned = await extractFactsFromConversation(conversationId);
    const entitiesFound = await extractEntitiesFromConversation(conversationId);
    await summarizeConversation(conversationId);

    await logger.info(
      "memory",
      `Processed conversation ${conversationId}: ${factsLearned} facts, ${entitiesFound} entities`
    );
  } catch (err) {
    await logger.error("memory", `Memory processing failed: ${err}`);
  }
}

// ── Scheduled Memory Consolidation ──────────────────────────────────────────
let memoryInterval: ReturnType<typeof setInterval> | null = null;

export function startMemoryConsolidation(intervalMs = 60 * 60 * 1000): void {
  if (memoryInterval) return;

  logger.info("memory", "Memory consolidation started (every hour)");

  memoryInterval = setInterval(async () => {
    const recentConvs = await getConversations();

    for (const conv of recentConvs.slice(0, 10)) {
      // Check if already processed
      let alreadyProcessed = false;
      if (USE_MYSQL) {
        const { db, schema, orm } = await getDrizzle();
        const existing = await db
          .select()
          .from(schema.conversationContext)
          .where(orm.eq(schema.conversationContext.conversationId, conv.id))
          .limit(1);
        alreadyProcessed = existing.length > 0;
      } else {
        const existing = sqliteRun(
          "SELECT id FROM conversation_context WHERE conversationId = ? LIMIT 1",
          [conv.id]
        );
        alreadyProcessed = existing.length > 0;
      }

      if (!alreadyProcessed) {
        await processConversationMemory(conv.id);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }, intervalMs);
}

export function stopMemoryConsolidation(): void {
  if (memoryInterval) {
    clearInterval(memoryInterval);
    memoryInterval = null;
  }
}
