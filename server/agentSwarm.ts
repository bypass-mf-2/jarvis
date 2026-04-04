// server/agentSwarm.ts
interface Agent {
  id: string;
  specialty: string;
  task: string;
  status: "idle" | "working" | "complete";
}

// Spawn 5 agents to research a topic in parallel
// Combine their findings