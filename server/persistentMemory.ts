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

import { ollamaChat } from "./ollama.js";
import { db } from "./db.js";
import { 
  learnedFacts, 
  entityMemory, 
  conversationContext,
  learningSessions,
  messages,
  conversations,
} from "../drizzle/schema.js";
import { eq, desc } from "drizzle-orm";
import { logger } from "./logger.js";

// ── Extract Facts from Conversation ─────────────────────────────────────────
export async function extractFactsFromConversation(
  conversationId: number
): Promise<number> {
  await logger.info("memory", `Extracting facts from conversation ${conversationId}`);

  // Create learning session
  const [session] = await db.insert(learningSessions).values({
    sessionType: "conversation_analysis",
    itemsProcessed: 0,
    factsLearned: 0,
  });

  try {
    // Get all messages from this conversation
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);

    if (msgs.length === 0) return 0;

    // Build conversation text
    const conversationText = msgs
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

    // Extract facts using LLM
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
    
    // Parse JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to extract facts");
    }

    const extracted = JSON.parse(jsonMatch[0]);
    let factsLearned = 0;

    // Store each fact
    for (const [category, facts] of Object.entries(extracted)) {
      for (const factData of facts as any[]) {
        // Check if we already know this fact
        const existing = await db
          .select()
          .from(learnedFacts)
          .where(eq(learnedFacts.fact, factData.fact))
          .limit(1);

        if (existing.length === 0) {
          // New fact - store it
          await db.insert(learnedFacts).values({
            category: category as any,
            fact: factData.fact,
            confidence: factData.confidence.toFixed(2),
            sourceConversationId: conversationId,
            verified: false,
            timesReferenced: 0,
          });
          factsLearned++;
        } else {
          // Fact exists - update confidence and reference count
          await db
            .update(learnedFacts)
            .set({
              confidence: Math.max(
                parseFloat(existing[0].confidence),
                factData.confidence
              ).toFixed(2),
              timesReferenced: existing[0].timesReferenced + 1,
              updatedAt: new Date(),
            })
            .where(eq(learnedFacts.id, existing[0].id));
        }
      }
    }

    // Update session
    await db
      .update(learningSessions)
      .set({
        itemsProcessed: msgs.length,
        factsLearned,
        status: "success",
        completedAt: new Date(),
      })
      .where(eq(learningSessions.id, session.id));

    await logger.info("memory", `Learned ${factsLearned} new facts from conversation ${conversationId}`);
    
    return factsLearned;

  } catch (err) {
    await logger.error("memory", `Fact extraction failed: ${err}`);
    
    await db
      .update(learningSessions)
      .set({
        status: "error",
        notes: String(err),
        completedAt: new Date(),
      })
      .where(eq(learningSessions.id, session.id));
    
    return 0;
  }
}

// ── Extract Entities from Conversation ──────────────────────────────────────
export async function extractEntitiesFromConversation(
  conversationId: number
): Promise<number> {
  await logger.info("memory", `Extracting entities from conversation ${conversationId}`);

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId));

  const conversationText = msgs
    .map(m => m.content)
    .join("\n\n");

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
      // Check if entity exists
      const existing = await db
        .select()
        .from(entityMemory)
        .where(eq(entityMemory.name, entity.name))
        .limit(1);

      if (existing.length === 0) {
        // New entity
        await db.insert(entityMemory).values({
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
        // Update existing
        await db
          .update(entityMemory)
          .set({
            mentionCount: existing[0].mentionCount + 1,
            lastMentioned: new Date(),
            importance: Math.max(
              parseFloat(existing[0].importance),
              entity.importance
            ).toFixed(2),
          })
          .where(eq(entityMemory.id, existing[0].id));
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
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId));

  const conversationText = msgs
    .map(m => `${m.role}: ${m.content}`)
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

    // Store context
    await db.insert(conversationContext).values({
      conversationId,
      topicSummary: summary.summary,
      keyTopics: summary.keyTopics,
      sentiment: summary.sentiment,
      followUpNeeded: summary.followUpNeeded,
      followUpTopic: summary.followUpTopic,
    });

  } catch (err) {
    await logger.error("memory", `Conversation summarization failed: ${err}`);
  }
}

// ── Recall Relevant Facts ───────────────────────────────────────────────────
export async function recallRelevantFacts(
  query: string,
  limit = 10
): Promise<any[]> {
  // Simple keyword matching for now
  // TODO: Use vector similarity with embeddings
  
  const allFacts = await db
    .select()
    .from(learnedFacts)
    .orderBy(desc(learnedFacts.confidence))
    .limit(100);

  const queryLower = query.toLowerCase();
  const relevant = allFacts
    .filter(f => f.fact.toLowerCase().includes(queryLower))
    .slice(0, limit);

  return relevant;
}

// ── Recall Related Entities ─────────────────────────────────────────────────
export async function recallEntities(
  query: string,
  limit = 5
): Promise<any[]> {
  const allEntities = await db
    .select()
    .from(entityMemory)
    .orderBy(desc(entityMemory.importance))
    .limit(50);

  const queryLower = query.toLowerCase();
  const relevant = allEntities
    .filter(e => 
      e.name.toLowerCase().includes(queryLower) ||
      e.description?.toLowerCase().includes(queryLower)
    )
    .slice(0, limit);

  return relevant;
}

// ── Get Memory Context for Query ────────────────────────────────────────────
export async function getMemoryContext(query: string): Promise<string> {
  const facts = await recallRelevantFacts(query, 5);
  const entities = await recallEntities(query, 3);

  if (facts.length === 0 && entities.length === 0) {
    return "";
  }

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
    // Extract facts
    const factsLearned = await extractFactsFromConversation(conversationId);
    
    // Extract entities
    const entitiesFound = await extractEntitiesFromConversation(conversationId);
    
    // Summarize conversation
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
    // Process recent conversations that haven't been processed
    const recentConvs = await db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.updatedAt))
      .limit(10);

    for (const conv of recentConvs) {
      // Check if already processed
      const existing = await db
        .select()
        .from(conversationContext)
        .where(eq(conversationContext.conversationId, conv.id))
        .limit(1);

      if (existing.length === 0) {
        await processConversationMemory(conv.id);
        // Wait a bit between processing
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
