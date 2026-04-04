/**
 * Multi-Agent Swarm System
 * 
 * 20 specialized agents working in parallel:
 * - Research Agents (5) - Gather information
 * - Analysis Agents (3) - Deep analysis
 * - Coding Agents (4) - Generate and review code
 * - Planning Agents (2) - Strategy and roadmaps
 * - Execution Agents (3) - Run tasks
 * - Memory Agents (2) - Manage knowledge
 * - QA Agents (1) - Quality assurance
 * 
 * All agents can work simultaneously on complex tasks
 */

import { ollamaChat } from "./ollama.js";
import { logger } from "./logger.js";
import { searchWeb } from "./webSearch.js";
import { generateCode, reviewCode } from "./codingAI.js";
import { executeCode } from "./codeExecution.js";
import { getMemoryContext, recallRelevantFacts } from "./persistentMemory.js";

// ── Agent Types ─────────────────────────────────────────────────────────────
type AgentRole = 
  | "researcher"
  | "analyst" 
  | "coder"
  | "planner"
  | "executor"
  | "memory_keeper"
  | "qa_specialist";

interface Agent {
  id: string;
  role: AgentRole;
  name: string;
  status: "idle" | "thinking" | "working" | "complete" | "error";
  currentTask: string | null;
  specialization: string;
  model: string; // Which LLM to use
  performance: {
    tasksCompleted: number;
    successRate: number;
    avgResponseTime: number;
  };
}

interface Task {
  id: string;
  description: string;
  type: "research" | "analyze" | "code" | "plan" | "execute" | "remember" | "qa";
  assignedAgent: string | null;
  status: "pending" | "in_progress" | "complete" | "failed";
  priority: number; // 1-10
  result: any;
  startTime?: Date;
  endTime?: Date;
}

// ── Agent Definitions ───────────────────────────────────────────────────────
const AGENT_POOL: Agent[] = [
  // Research Agents (5)
  {
    id: "researcher-1",
    role: "researcher",
    name: "WebScout",
    status: "idle",
    currentTask: null,
    specialization: "Web search and information gathering",
    model: "llama3.2",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },
  {
    id: "researcher-2",
    role: "researcher",
    name: "DataMiner",
    status: "idle",
    currentTask: null,
    specialization: "Data extraction and parsing",
    model: "llama3.2",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },
  {
    id: "researcher-3",
    role: "researcher",
    name: "Scholar",
    status: "idle",
    currentTask: null,
    specialization: "Academic and technical research",
    model: "llama3.1:70b",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },
  {
    id: "researcher-4",
    role: "researcher",
    name: "NewsHound",
    status: "idle",
    currentTask: null,
    specialization: "Current events and news",
    model: "llama3.2",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },
  {
    id: "researcher-5",
    role: "researcher",
    name: "SourceValidator",
    status: "idle",
    currentTask: null,
    specialization: "Fact-checking and source validation",
    model: "llama3.2",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },

  // Analysis Agents (3)
  {
    id: "analyst-1",
    role: "analyst",
    name: "Strategist",
    status: "idle",
    currentTask: null,
    specialization: "Strategic analysis and recommendations",
    model: "llama3.1:70b",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },
  {
    id: "analyst-2",
    role: "analyst",
    name: "Critic",
    status: "idle",
    currentTask: null,
    specialization: "Critical evaluation and improvement suggestions",
    model: "llama3.2",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },
  {
    id: "analyst-3",
    role: "analyst",
    name: "Synthesizer",
    status: "idle",
    currentTask: null,
    specialization: "Combining insights from multiple sources",
    model: "llama3.2",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },

  // Coding Agents (4)
  {
    id: "coder-1",
    role: "coder",
    name: "SwiftMaster",
    status: "idle",
    currentTask: null,
    specialization: "iOS and Swift development",
    model: "codellama:7b-instruct",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },
  {
    id: "coder-2",
    role: "coder",
    name: "PythonPro",
    status: "idle",
    currentTask: null,
    specialization: "Python and data science",
    model: "codellama:7b-python",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },
  {
    id: "coder-3",
    role: "coder",
    name: "FullStack",
    status: "idle",
    currentTask: null,
    specialization: "Web development (JavaScript/TypeScript)",
    model: "codellama:7b-instruct",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },
  {
    id: "coder-4",
    role: "coder",
    name: "CodeReviewer",
    status: "idle",
    currentTask: null,
    specialization: "Code review and optimization",
    model: "codellama:7b-instruct",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },

  // Planning Agents (2)
  {
    id: "planner-1",
    role: "planner",
    name: "Architect",
    status: "idle",
    currentTask: null,
    specialization: "System architecture and design",
    model: "llama3.1:70b",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },
  {
    id: "planner-2",
    role: "planner",
    name: "TaskMaster",
    status: "idle",
    currentTask: null,
    specialization: "Task breakdown and workflow planning",
    model: "llama3.2",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },

  // Execution Agents (3)
  {
    id: "executor-1",
    role: "executor",
    name: "Runner",
    status: "idle",
    currentTask: null,
    specialization: "Code execution and testing",
    model: "llama3.2",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },
  {
    id: "executor-2",
    role: "executor",
    name: "Automator",
    status: "idle",
    currentTask: null,
    specialization: "Workflow automation",
    model: "llama3.2",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },
  {
    id: "executor-3",
    role: "executor",
    name: "Coordinator",
    status: "idle",
    currentTask: null,
    specialization: "Multi-step task coordination",
    model: "llama3.2",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },

  // Memory Agents (2)
  {
    id: "memory-1",
    role: "memory_keeper",
    name: "Archivist",
    status: "idle",
    currentTask: null,
    specialization: "Long-term knowledge storage and retrieval",
    model: "llama3.2",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },
  {
    id: "memory-2",
    role: "memory_keeper",
    name: "Librarian",
    status: "idle",
    currentTask: null,
    specialization: "Knowledge organization and categorization",
    model: "llama3.2",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },

  // QA Agent (1)
  {
    id: "qa-1",
    role: "qa_specialist",
    name: "Validator",
    status: "idle",
    currentTask: null,
    specialization: "Quality assurance and verification",
    model: "llama3.1:70b",
    performance: { tasksCompleted: 0, successRate: 1.0, avgResponseTime: 0 },
  },
];

// ── Task Queue ──────────────────────────────────────────────────────────────
const taskQueue: Task[] = [];
const activeTasks = new Map<string, Task>();

// ── Decompose Complex Query ────────────────────────────────────────────────
export async function decomposeQuery(query: string): Promise<Task[]> {
  await logger.info("agentSwarm", `Decomposing query: ${query}`);

  const prompt = `Break down this complex query into specific, actionable tasks:

Query: ${query}

Return as JSON array:
[
  {
    "description": "Task description",
    "type": "research|analyze|code|plan|execute|remember|qa",
    "priority": 1-10,
    "dependencies": [] // IDs of tasks that must complete first
  }
]

Each task should be:
- Specific and focused
- Independently executable
- Have clear success criteria

Return ONLY the JSON array.`;

  try {
    const response = await ollamaChat(
      [{ role: "user", content: prompt }],
      "llama3.1:70b" // Use best model for planning
    );

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("Failed to parse task decomposition");
    }

    const taskDefinitions = JSON.parse(jsonMatch[0]);

    const tasks: Task[] = taskDefinitions.map((def: any, idx: number) => ({
      id: `task-${Date.now()}-${idx}`,
      description: def.description,
      type: def.type,
      assignedAgent: null,
      status: "pending",
      priority: def.priority || 5,
      result: null,
    }));

    return tasks;

  } catch (err) {
    await logger.error("agentSwarm", `Task decomposition failed: ${err}`);
    
    // Fallback: Create single task
    return [{
      id: `task-${Date.now()}`,
      description: query,
      type: "research",
      assignedAgent: null,
      status: "pending",
      priority: 5,
      result: null,
    }];
  }
}

// ── Assign Tasks to Agents ──────────────────────────────────────────────────
function assignTask(task: Task): Agent | null {
  // Find best available agent for this task type
  const availableAgents = AGENT_POOL.filter(
    a => a.status === "idle" && isAgentSuitableForTask(a, task)
  );

  if (availableAgents.length === 0) {
    return null;
  }

  // Sort by performance (success rate and response time)
  availableAgents.sort((a, b) => {
    const scoreA = a.performance.successRate / (a.performance.avgResponseTime || 1);
    const scoreB = b.performance.successRate / (b.performance.avgResponseTime || 1);
    return scoreB - scoreA;
  });

  const agent = availableAgents[0];
  agent.status = "working";
  agent.currentTask = task.description;
  task.assignedAgent = agent.id;
  task.status = "in_progress";
  task.startTime = new Date();

  return agent;
}

function isAgentSuitableForTask(agent: Agent, task: Task): boolean {
  const roleTaskMap: Record<string, AgentRole[]> = {
    research: ["researcher"],
    analyze: ["analyst", "researcher"],
    code: ["coder"],
    plan: ["planner", "analyst"],
    execute: ["executor", "coder"],
    remember: ["memory_keeper"],
    qa: ["qa_specialist", "analyst"],
  };

  return roleTaskMap[task.type]?.includes(agent.role) || false;
}

// ── Execute Task ────────────────────────────────────────────────────────────
async function executeTask(task: Task, agent: Agent): Promise<any> {
  await logger.info("agentSwarm", `${agent.name} executing: ${task.description}`);

  const startTime = Date.now();

  try {
    let result: any;

    switch (task.type) {
      case "research":
        result = await executeResearchTask(task, agent);
        break;
      case "analyze":
        result = await executeAnalysisTask(task, agent);
        break;
      case "code":
        result = await executeCodingTask(task, agent);
        break;
      case "plan":
        result = await executePlanningTask(task, agent);
        break;
      case "execute":
        result = await executeExecutionTask(task, agent);
        break;
      case "remember":
        result = await executeMemoryTask(task, agent);
        break;
      case "qa":
        result = await executeQATask(task, agent);
        break;
      default:
        result = "Task type not implemented";
    }

    // Update performance metrics
    const duration = Date.now() - startTime;
    agent.performance.tasksCompleted++;
    agent.performance.avgResponseTime = 
      (agent.performance.avgResponseTime * (agent.performance.tasksCompleted - 1) + duration) /
      agent.performance.tasksCompleted;

    task.status = "complete";
    task.result = result;
    task.endTime = new Date();
    agent.status = "idle";
    agent.currentTask = null;

    await logger.info("agentSwarm", `${agent.name} completed task in ${duration}ms`);

    return result;

  } catch (err) {
    const duration = Date.now() - startTime;
    
    // Update failure rate
    const totalTasks = agent.performance.tasksCompleted + 1;
    agent.performance.successRate = 
      (agent.performance.successRate * agent.performance.tasksCompleted) / totalTasks;
    agent.performance.tasksCompleted++;

    task.status = "failed";
    task.result = { error: String(err) };
    task.endTime = new Date();
    agent.status = "idle";
    agent.currentTask = null;

    await logger.error("agentSwarm", `${agent.name} failed task: ${err}`);

    throw err;
  }
}

// ── Task Execution Handlers ─────────────────────────────────────────────────
async function executeResearchTask(task: Task, agent: Agent): Promise<any> {
  // Search the web
  const searchResults = await searchWeb(task.description, 5);
  
  // Summarize findings
  const summary = await ollamaChat(
    [
      {
        role: "user",
        content: `Summarize these search results:

${searchResults.map(r => `${r.title}: ${r.snippet}`).join("\n\n")}

Provide a concise summary with key findings.`,
      },
    ],
    agent.model
  );

  return { searchResults, summary };
}

async function executeAnalysisTask(task: Task, agent: Agent): Promise<any> {
  // Get relevant context
  const memory = await getMemoryContext(task.description);
  
  // Analyze
  const analysis = await ollamaChat(
    [
      {
        role: "system",
        content: `You are ${agent.name}, specializing in ${agent.specialization}.`,
      },
      {
        role: "user",
        content: `${memory}\n\nAnalyze: ${task.description}`,
      },
    ],
    agent.model
  );

  return analysis;
}

async function executeCodingTask(task: Task, agent: Agent): Promise<any> {
  // Extract language from task
  const languageMatch = task.description.match(/\b(swift|python|javascript|typescript)\b/i);
  const language = (languageMatch?.[1]?.toLowerCase() || "swift") as any;

  const code = await generateCode(task.description, language, false);
  
  return code;
}

async function executePlanningTask(task: Task, agent: Agent): Promise<any> {
  const plan = await ollamaChat(
    [
      {
        role: "system",
        content: `You are ${agent.name}, an expert in ${agent.specialization}.`,
      },
      {
        role: "user",
        content: `Create a detailed plan for: ${task.description}

Include:
- Steps to complete
- Resources needed
- Estimated timeline
- Potential challenges

Format as structured plan.`,
      },
    ],
    agent.model
  );

  return plan;
}

async function executeExecutionTask(task: Task, agent: Agent): Promise<any> {
  // Extract code from task if present
  const codeMatch = task.description.match(/```(?:\w+)?\n([\s\S]*?)```/);
  
  if (codeMatch) {
    const code = codeMatch[1];
    const result = await executeCode(code);
    return result;
  }

  return "No executable code found";
}

async function executeMemoryTask(task: Task, agent: Agent): Promise<any> {
  const facts = await recallRelevantFacts(task.description, 10);
  return facts;
}

async function executeQATask(task: Task, agent: Agent): Promise<any> {
  // Validate previous task results
  const validation = await ollamaChat(
    [
      {
        role: "system",
        content: "You are a quality assurance specialist. Verify accuracy and completeness.",
      },
      {
        role: "user",
        content: `Validate this result:

Task: ${task.description}

Return JSON:
{
  "valid": true/false,
  "issues": ["issue 1", ...],
  "suggestions": ["suggestion 1", ...],
  "confidence": 0.0-1.0
}`,
      },
    ],
    agent.model
  );

  const jsonMatch = validation.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : { valid: true, issues: [], suggestions: [], confidence: 0.5 };
}

// ── Orchestrate Multi-Agent Swarm ───────────────────────────────────────────
export async function swarmProcess(
  query: string,
  onProgress?: (update: { agent: string; status: string; result?: any }) => void
): Promise<any> {
  await logger.info("agentSwarm", `Starting swarm process for: ${query}`);

  // 1. Decompose query into tasks
  const tasks = await decomposeQuery(query);
  taskQueue.push(...tasks);

  await logger.info("agentSwarm", `Decomposed into ${tasks.length} tasks`);

  // 2. Execute tasks in parallel
  const taskPromises: Promise<any>[] = [];

  for (const task of tasks) {
    const agent = assignTask(task);
    
    if (agent) {
      const promise = executeTask(task, agent).then(result => {
        onProgress?.({ agent: agent.name, status: "complete", result });
        return { task, agent, result };
      }).catch(err => {
        onProgress?.({ agent: agent.name, status: "error", result: String(err) });
        return { task, agent, error: err };
      });

      taskPromises.push(promise);
    } else {
      await logger.warn("agentSwarm", `No available agent for task: ${task.description}`);
    }
  }

  // 3. Wait for all tasks
  const results = await Promise.all(taskPromises);

  // 4. Synthesize final answer
  const successfulResults = results.filter(r => !r.error);
  
  const synthesis = await ollamaChat(
    [
      {
        role: "system",
        content: "You are synthesizing results from multiple specialized agents.",
      },
      {
        role: "user",
        content: `Original query: ${query}

Agent results:
${successfulResults.map(r => `${r.agent.name}: ${JSON.stringify(r.result)}`).join("\n\n")}

Provide a comprehensive, coherent answer to the original query.`,
      },
    ],
    "llama3.1:70b" // Use best model for synthesis
  );

  await logger.info("agentSwarm", "Swarm process complete");

  return {
    query,
    taskCount: tasks.length,
    agentsUsed: successfulResults.length,
    synthesis,
    individualResults: results,
  };
}

// ── Get Agent Status ────────────────────────────────────────────────────────
export function getAgentStatus(): {
  total: number;
  idle: number;
  working: number;
  byRole: Record<AgentRole, number>;
  topPerformers: Agent[];
} {
  const byRole: Record<AgentRole, number> = {
    researcher: 0,
    analyst: 0,
    coder: 0,
    planner: 0,
    executor: 0,
    memory_keeper: 0,
    qa_specialist: 0,
  };

  let idle = 0;
  let working = 0;

  for (const agent of AGENT_POOL) {
    byRole[agent.role]++;
    if (agent.status === "idle") idle++;
    if (agent.status === "working") working++;
  }

  const topPerformers = [...AGENT_POOL]
    .sort((a, b) => {
      const scoreA = a.performance.successRate * a.performance.tasksCompleted;
      const scoreB = b.performance.successRate * b.performance.tasksCompleted;
      return scoreB - scoreA;
    })
    .slice(0, 5);

  return {
    total: AGENT_POOL.length,
    idle,
    working,
    byRole,
    topPerformers,
  };
}