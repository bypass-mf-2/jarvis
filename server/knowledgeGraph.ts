/**
 * Knowledge Graph System
 * 
 * Builds connections between concepts, people, events, and facts
 * Enables reasoning across the knowledge base
 */

import { ollamaChatBackground as ollamaChat } from "./ollama.js";
import { getKnowledgeChunks } from "./db.js";
import { logger } from "./logger.js";
import * as fs from "fs";

interface Entity {
  name: string;
  type: "person" | "place" | "concept" | "event" | "organization";
  mentions: number;
  relatedChunks: string[];
}

interface Relationship {
  from: string;
  to: string;
  type: string;
  strength: number;
}

interface KnowledgeGraph {
  entities: Record<string, Entity>;
  relationships: Relationship[];
  lastUpdated: Date;
}

let graph: KnowledgeGraph = {
  entities: {},
  relationships: [],
  lastUpdated: new Date(),
};

// Extract entities from a chunk of text
async function extractEntities(text: string): Promise<Entity[]> {
  const prompt = `Extract all important entities from this text:

${text}

Return as JSON array:
[
  {"name": "Entity Name", "type": "person|place|concept|event|organization"}
]

Only return the JSON array.`;

  const response = await ollamaChat([{ role: "user", content: prompt }]);
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return [];
    }
  }
  
  return [];
}

// Build graph from all knowledge chunks
export async function buildKnowledgeGraph(): Promise<KnowledgeGraph> {
  await logger.info("knowledgeGraph", "Building knowledge graph...");
  
  const chunks = await getKnowledgeChunks(1000);
  
  for (const chunk of chunks) {
    const entities = await extractEntities(chunk.content);
    
    for (const entity of entities) {
      if (!graph.entities[entity.name]) {
        graph.entities[entity.name] = {
          ...entity,
          mentions: 1,
          relatedChunks: [chunk.chromaId],
        };
      } else {
        graph.entities[entity.name].mentions++;
        graph.entities[entity.name].relatedChunks.push(chunk.chromaId);
      }
    }
  }
  
  graph.lastUpdated = new Date();
  
  // Save graph
  fs.writeFileSync(
    "knowledge-graph.json",
    JSON.stringify(graph, null, 2)
  );
  
  await logger.info("knowledgeGraph", `Graph built: ${Object.keys(graph.entities).length} entities`);
  
  return graph;
}

// Query the knowledge graph
export function queryGraph(query: string): Entity[] {
  const queryLower = query.toLowerCase();
  
  return Object.values(graph.entities)
    .filter(e => e.name.toLowerCase().includes(queryLower))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 10);
}