/**
 * Long-Term Memory System
 * 
 * Remembers facts about Trevor across conversations
 * Builds a persistent profile
 */

import * as fs from "fs";
import { ollamaChatBackground as ollamaChat } from "./ollama.js";

interface Memory {
  fact: string;
  category: string;
  confidence: number;
  lastUpdated: Date;
  sources: string[]; // Which conversations this came from
}

interface MemoryStore {
  personal: Record<string, Memory>;
  preferences: Record<string, Memory>;
  knowledge: Record<string, Memory>;
  goals: Record<string, Memory>;
}

let memoryStore: MemoryStore = {
  personal: {},
  preferences: {},
  knowledge: {},
  goals: {},
};

// Extract facts from conversation
export async function extractMemoriesFromConversation(
  messages: Array<{ role: string; content: string }>
): Promise<Memory[]> {
  const conversationText = messages
    .filter(m => m.role === "user")
    .map(m => m.content)
    .join("\n\n");

  const prompt = `Extract factual memories about Trevor from this conversation:

${conversationText}

Return as JSON:
{
  "personal": [{"fact": "...", "confidence": 0-1}],
  "preferences": [{"fact": "...", "confidence": 0-1}],
  "knowledge": [{"fact": "...", "confidence": 0-1}],
  "goals": [{"fact": "...", "confidence": 0-1}]
}

Only include high-confidence (>0.7) facts.`;

  const response = await ollamaChat([{ role: "user", content: prompt }]);
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  
  if (jsonMatch) {
    try {
      const extracted = JSON.parse(jsonMatch[0]);
      const memories: Memory[] = [];
      
      for (const [category, facts] of Object.entries(extracted)) {
        for (const fact of facts as any[]) {
          memories.push({
            fact: fact.fact,
            category,
            confidence: fact.confidence,
            lastUpdated: new Date(),
            sources: [],
          });
        }
      }
      
      return memories;
    } catch {
      return [];
    }
  }
  
  return [];
}

// Save memories
export function saveMemory(memory: Memory) {
  const category = memory.category as keyof MemoryStore;
  memoryStore[category][memory.fact] = memory;
  
  // Persist to disk
  fs.writeFileSync("trevor-memories.json", JSON.stringify(memoryStore, null, 2));
}

// Get relevant memories
export function recallMemories(query: string): Memory[] {
  const allMemories = [
    ...Object.values(memoryStore.personal),
    ...Object.values(memoryStore.preferences),
    ...Object.values(memoryStore.knowledge),
    ...Object.values(memoryStore.goals),
  ];
  
  // Filter by relevance
  const queryLower = query.toLowerCase();
  return allMemories
    .filter(m => m.fact.toLowerCase().includes(queryLower))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}