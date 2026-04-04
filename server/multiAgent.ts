/**
 * Multi-Agent Orchestration System
 * 
 * Specialized agents for different tasks:
 * - Research Agent: Deep web research and fact-checking
 * - Code Agent: Code analysis, generation, and review
 * - Analysis Agent: Data analysis and pattern recognition
 * - Planning Agent: Strategic planning and task decomposition
 * - Memory Agent: Context management and retrieval optimization
 * 
 * The orchestrator routes queries to appropriate agents and combines results.
 */

import { ollamaChat, ollamaChatStream, type OllamaMessage } from "./ollama";
import { queryVectorStore } from "./vectorStore";
import { logger } from "./logger";
import { getRecentErrorLogs, getSystemLogs } from "./db";

// ── Agent Definitions ──────────────────────────────────────────────────────────
interface Agent {
  name: string;
  role: string;
  systemPrompt: string;
  capabilities: string[];
  priority: number; // Higher = more likely to be selected
}

const AGENTS: Record<string, Agent> = {
  research: {
    name: "Research Agent",
    role: "research",
    systemPrompt: `You are JARVIS's Research Agent. You specialize in:
- Deep web research across multiple sources
- Fact-checking and source verification
- Synthesizing information from diverse sources
- Identifying knowledge gaps
- Tracking claims to original sources

Always cite sources and evaluate information quality.`,
    capabilities: ["research", "fact-check", "synthesis", "analysis"],
    priority: 8,
  },

  code: {
    name: "Code Agent",
    role: "code",
    systemPrompt: `You are JARVIS's Code Agent. You specialize in:
- Code analysis and review
- Bug detection and fixes
- Performance optimization
- Architecture design
- Test generation
- Code explanation

Always follow best practices and consider edge cases.`,
    capabilities: ["code", "debug", "optimize", "review", "test"],
    priority: 9,
  },

  analysis: {
    name: "Analysis Agent",
    role: "analysis",
    systemPrompt: `You are JARVIS's Analysis Agent. You specialize in:
- Data analysis and pattern recognition
- Statistical reasoning
- Trend identification
- Anomaly detection
- Predictive insights

Always ground analysis in data and quantify confidence.`,
    capabilities: ["analyze", "pattern", "trend", "predict", "quantify"],
    priority: 7,
  },

  planning: {
    name: "Planning Agent",
    role: "planning",
    systemPrompt: `You are JARVIS's Planning Agent. You specialize in:
- Task decomposition and sequencing
- Resource estimation
- Risk assessment
- Strategic planning
- Dependency management

Always create actionable, prioritized plans.`,
    capabilities: ["plan", "organize", "strategy", "prioritize", "estimate"],
    priority: 6,
  },

  memory: {
    name: "Memory Agent",
    role: "memory",
    systemPrompt: `You are JARVIS's Memory Agent. You specialize in:
- Context retrieval and relevance ranking
- Knowledge graph construction
- Entity relationship mapping
- Temporal reasoning
- Information organization

Always optimize for recall and relevance.`,
    capabilities: ["remember", "recall", "organize", "relate", "track"],
    priority: 5,
  },

  general: {
    name: "General Agent",
    role: "general",
    systemPrompt: `You are JARVIS (Just A Rather Very Intelligent System). You are helpful, precise, and versatile. Handle general queries with clarity and efficiency.`,
    capabilities: ["general", "chat", "help", "explain"],
    priority: 3,
  },
};

// ── Agent Selection ────────────────────────────────────────────────────────────
async function selectAgent(query: string): Promise<Agent> {
  // Use LLM to classify the query
  const prompt = `Classify this query into one of these categories:

Query: "${query}"

Categories:
- research: Requires web research, fact-checking, or information synthesis
- code: Involves programming, debugging, or technical implementation
- analysis: Needs data analysis, pattern recognition, or statistical reasoning
- planning: Requires task breakdown, scheduling, or strategic planning
- memory: About recalling past information or organizing knowledge
- general: General conversation or simple questions

Respond with ONLY the category name, nothing else.`;

  try {
    const response = await ollamaChat([{ role: "user", content: prompt }]);
    const category = response.toLowerCase().trim();
    
    // Find matching agent
    for (const [key, agent] of Object.entries(AGENTS)) {
      if (category.includes(key) || agent.capabilities.some(cap => category.includes(cap))) {
        return agent;
      }
    }
  } catch (err) {
    await logger.warn("multiAgent", `Agent selection failed: ${String(err)}`);
  }

  return AGENTS.general;
}

// ── Task Decomposition ─────────────────────────────────────────────────────────
interface Subtask {
  description: string;
  agent: string;
  dependencies: number[]; // Indices of tasks that must complete first
  priority: number;
}

async function decomposeComplexTask(query: string): Promise<Subtask[]> {
  const prompt = `Decompose this complex task into subtasks:

Task: "${query}"

Create a JSON array of subtasks:
[{
  "description": "Subtask description",
  "agent": "research|code|analysis|planning|memory|general",
  "dependencies": [index of required prior tasks],
  "priority": 1-10
}]

Return only the JSON array. For simple tasks, return a single subtask.`;

  try {
    const response = await ollamaChat([{ role: "user", content: prompt }]);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    
    if (jsonMatch) {
      const subtasks: Subtask[] = JSON.parse(jsonMatch[0]);
      return subtasks.filter(st => st.description && st.agent);
    }
  } catch (err) {
    await logger.warn("multiAgent", `Task decomposition failed: ${String(err)}`);
  }

  // Fallback: single task
  return [{
    description: query,
    agent: "general",
    dependencies: [],
    priority: 5,
  }];
}

// ── Agent Execution ────────────────────────────────────────────────────────────
interface AgentResult {
  agent: string;
  content: string;
  confidence: number;
  sources?: string[];
}

async function executeAgent(
  agent: Agent,
  query: string,
  context: string[] = []
): Promise<AgentResult> {
  await logger.info("multiAgent", `Executing ${agent.name} for: "${query.slice(0, 80)}..."`);

  // Retrieve relevant knowledge
  const ragChunks = await queryVectorStore(query, 5);
  const ragContext = ragChunks
    .map((c, i) => `[${i + 1}] ${c.content.slice(0, 300)}`)
    .join("\n\n");

  // Build agent-specific context
  let fullContext = agent.systemPrompt;
  
  if (ragContext) {
    fullContext += `\n\n=== KNOWLEDGE BASE ===\n${ragContext}`;
  }
  
  if (context.length > 0) {
    fullContext += `\n\n=== PREVIOUS RESULTS ===\n${context.join("\n\n")}`;
  }

  const messages: OllamaMessage[] = [
    { role: "system", content: fullContext },
    { role: "user", content: query },
  ];

  const response = await ollamaChat(messages);

  // Extract confidence if present
  const confidenceMatch = response.match(/confidence[:\s]*([0-9.]+)/i);
  const confidence = confidenceMatch 
    ? parseFloat(confidenceMatch[1])
    : 0.8;

  return {
    agent: agent.role,
    content: response,
    confidence,
    sources: ragChunks.map(c => c.metadata.sourceTitle || c.metadata.sourceUrl),
  };
}

// ── Multi-Agent Orchestration ──────────────────────────────────────────────────
export async function orchestrateQuery(
  query: string,
  conversationHistory: OllamaMessage[] = []
): Promise<{ response: string; agents: string[]; confidence: number }> {
  await logger.info("multiAgent", `Orchestrating query: "${query.slice(0, 80)}..."`);

  // Determine if task is complex
  const isComplex = query.split(" ").length > 20 || 
                    query.includes("and") || 
                    query.includes("also") ||
                    query.includes("then");

  if (isComplex) {
    return await handleComplexQuery(query, conversationHistory);
  } else {
    return await handleSimpleQuery(query, conversationHistory);
  }
}

async function handleSimpleQuery(
  query: string,
  conversationHistory: OllamaMessage[]
): Promise<{ response: string; agents: string[]; confidence: number }> {
  const agent = await selectAgent(query);
  const result = await executeAgent(agent, query);

  return {
    response: result.content,
    agents: [agent.role],
    confidence: result.confidence,
  };
}

async function handleComplexQuery(
  query: string,
  conversationHistory: OllamaMessage[]
): Promise<{ response: string; agents: string[]; confidence: number }> {
  // Decompose into subtasks
  const subtasks = await decomposeComplexTask(query);
  
  // Execute subtasks in order (respecting dependencies)
  const results: AgentResult[] = [];
  const completedTasks = new Set<number>();
  
  while (completedTasks.size < subtasks.length) {
    for (let i = 0; i < subtasks.length; i++) {
      if (completedTasks.has(i)) continue;
      
      const subtask = subtasks[i];
      
      // Check if dependencies are met
      const dependenciesMet = subtask.dependencies.every(dep => 
        completedTasks.has(dep)
      );
      
      if (!dependenciesMet) continue;
      
      // Execute subtask
      const agent = AGENTS[subtask.agent] || AGENTS.general;
      const previousResults = results.map(r => 
        `[${r.agent}] ${r.content.slice(0, 500)}`
      );
      
      const result = await executeAgent(agent, subtask.description, previousResults);
      results.push(result);
      completedTasks.add(i);
    }
  }
  
  // Synthesize results
  const synthesis = await synthesizeResults(query, results);
  
  return {
    response: synthesis.content,
    agents: results.map(r => r.agent),
    confidence: results.reduce((sum, r) => sum + r.confidence, 0) / results.length,
  };
}

async function synthesizeResults(
  originalQuery: string,
  results: AgentResult[]
): Promise<AgentResult> {
  const prompt = `Synthesize these agent results into a cohesive answer:

Original query: "${originalQuery}"

Agent results:
${results.map(r => `[${r.agent}]: ${r.content}`).join("\n\n")}

Provide a unified, comprehensive answer that integrates all agent insights.`;

  const response = await ollamaChat([{ role: "user", content: prompt }]);

  return {
    agent: "orchestrator",
    content: response,
    confidence: 0.85,
  };
}

// ── Streaming Multi-Agent Response ────────────────────────────────────────────
export async function* orchestrateQueryStream(
  query: string,
  conversationHistory: OllamaMessage[] = []
): AsyncGenerator<{ type: "agent" | "chunk"; data: string }> {
  const agent = await selectAgent(query);
  
  yield { type: "agent", data: agent.role };
  
  // Retrieve RAG context
  const ragChunks = await queryVectorStore(query, 5);
  const ragContext = ragChunks
    .map((c, i) => `[${i + 1}] ${c.content.slice(0, 300)}`)
    .join("\n\n");
  
  let fullContext = agent.systemPrompt;
  if (ragContext) {
    fullContext += `\n\n=== KNOWLEDGE BASE ===\n${ragContext}`;
  }
  
  const messages: OllamaMessage[] = [
    { role: "system", content: fullContext },
    ...conversationHistory.slice(-10),
    { role: "user", content: query },
  ];
  
  // Stream response
  for await (const chunk of ollamaChatStream(messages)) {
    yield { type: "chunk", data: chunk };
  }
}

// ── Agent Performance Monitoring ───────────────────────────────────────────────
interface AgentMetrics {
  agent: string;
  totalCalls: number;
  avgConfidence: number;
  avgResponseTime: number;
  errorRate: number;
}

const agentMetrics = new Map<string, {
  calls: number;
  confidenceSum: number;
  timeSum: number;
  errors: number;
}>();

function trackAgentPerformance(
  agent: string,
  confidence: number,
  timeMs: number,
  error: boolean = false
): void {
  const current = agentMetrics.get(agent) || {
    calls: 0,
    confidenceSum: 0,
    timeSum: 0,
    errors: 0,
  };
  
  current.calls++;
  current.confidenceSum += confidence;
  current.timeSum += timeMs;
  if (error) current.errors++;
  
  agentMetrics.set(agent, current);
}

export function getAgentMetrics(): AgentMetrics[] {
  return Array.from(agentMetrics.entries()).map(([agent, data]) => ({
    agent,
    totalCalls: data.calls,
    avgConfidence: data.confidenceSum / data.calls,
    avgResponseTime: data.timeSum / data.calls,
    errorRate: data.errors / data.calls,
  }));
}

// ── Self-Optimization ──────────────────────────────────────────────────────────
export async function optimizeAgentSelection(): Promise<void> {
  const metrics = getAgentMetrics();
  
  // Adjust agent priorities based on performance
  for (const metric of metrics) {
    const agent = AGENTS[metric.agent];
    if (!agent) continue;
    
    // Increase priority for high-performing agents
    if (metric.avgConfidence > 0.85 && metric.errorRate < 0.1) {
      agent.priority = Math.min(10, agent.priority + 1);
    }
    
    // Decrease priority for low-performing agents
    if (metric.avgConfidence < 0.6 || metric.errorRate > 0.3) {
      agent.priority = Math.max(1, agent.priority - 1);
    }
  }
  
  await logger.info("multiAgent", "Agent priorities optimized based on performance");
}

// ── Scheduler for agent optimization ───────────────────────────────────────────
let optimizationInterval: ReturnType<typeof setInterval> | null = null;

export function startAgentOptimization(intervalMs = 6 * 60 * 60 * 1000): void {
  if (optimizationInterval) return;
  
  logger.info("multiAgent", "Agent optimization scheduler started");
  optimizationInterval = setInterval(() => optimizeAgentSelection(), intervalMs);
}

export function stopAgentOptimization(): void {
  if (optimizationInterval) {
    clearInterval(optimizationInterval);
    optimizationInterval = null;
  }
}
