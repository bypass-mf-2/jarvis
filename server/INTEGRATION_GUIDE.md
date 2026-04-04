# JARVIS 2.0 Integration Guide

Complete step-by-step guide to integrate the autonomous improvements into your existing JARVIS system.

## Prerequisites

- Working JARVIS installation (as per original README.md)
- Git installed
- Node.js 18+
- TypeScript knowledge (for customization)

## Step 1: Backup Current System

```bash
cd jarvis
git init
git add .
git commit -m "Pre-v2.0 baseline"
git branch backup-v1
```

## Step 2: Add New Server Files

Copy these three new files to `server/`:

1. **autonomousImprovement.ts** - Self-modification engine
2. **sourceDiscovery.ts** - Intelligent source management  
3. **multiAgent.ts** - Specialized agent orchestration

## Step 3: Update Database Schema

Add new tables to `drizzle/schema.ts`:

```typescript
// Add to existing schema
export const autonomyConfig = mysqlTable("autonomy_config", {
  id: serial("id").primaryKey(),
  autonomyLevel: int("autonomy_level").notNull().default(1),
  maxPatchesPerHour: int("max_patches_per_hour").notNull().default(3),
  enabledCategories: json("enabled_categories").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const sourceMetrics = mysqlTable("source_metrics", {
  id: serial("id").primaryKey(),
  sourceId: int("source_id").notNull().references(() => scrapeSources.id),
  qualityScore: decimal("quality_score", { precision: 3, scale: 2 }),
  avgChunkLength: int("avg_chunk_length"),
  errorRate: decimal("error_rate", { precision: 3, scale: 2 }),
  lastEvaluated: timestamp("last_evaluated").defaultNow(),
});

export const agentMetrics = mysqlTable("agent_metrics", {
  id: serial("id").primaryKey(),
  agentName: varchar("agent_name", { length: 50 }).notNull(),
  totalCalls: int("total_calls").notNull().default(0),
  avgConfidence: decimal("avg_confidence", { precision: 3, scale: 2 }),
  avgResponseTime: int("avg_response_time"),
  errorRate: decimal("error_rate", { precision: 3, scale: 2 }),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
```

Run migration:
```bash
pnpm drizzle-kit generate:mysql
pnpm drizzle-kit migrate
```

## Step 4: Update Database Functions

Add to `server/db.ts`:

```typescript
// Autonomy config
export async function getAutonomyConfig() {
  const [config] = await db.select().from(autonomyConfig).limit(1);
  return config || { autonomyLevel: 1, maxPatchesPerHour: 3 };
}

export async function updateAutonomyConfig(data: {
  autonomyLevel?: number;
  maxPatchesPerHour?: number;
  enabledCategories?: string[];
}) {
  const existing = await getAutonomyConfig();
  if (existing.id) {
    return db.update(autonomyConfig).set(data).where(eq(autonomyConfig.id, existing.id));
  } else {
    return db.insert(autonomyConfig).values(data);
  }
}

// Source metrics
export async function updateSourceMetrics(sourceId: number, metrics: {
  qualityScore: number;
  avgChunkLength: number;
  errorRate: number;
}) {
  return db.insert(sourceMetrics).values({
    sourceId,
    ...metrics,
  }).onDuplicateKeyUpdate({
    set: metrics,
  });
}

export async function getSourceMetrics(sourceId: number) {
  const [metrics] = await db
    .select()
    .from(sourceMetrics)
    .where(eq(sourceMetrics.sourceId, sourceId))
    .limit(1);
  return metrics;
}

// Agent metrics  
export async function trackAgentCall(agentName: string, data: {
  confidence: number;
  responseTime: number;
  error?: boolean;
}) {
  const existing = await db
    .select()
    .from(agentMetrics)
    .where(eq(agentMetrics.agentName, agentName))
    .limit(1);

  if (existing[0]) {
    const current = existing[0];
    const newTotalCalls = current.totalCalls + 1;
    const newAvgConfidence = 
      (parseFloat(current.avgConfidence || "0") * current.totalCalls + data.confidence) / newTotalCalls;
    const newAvgResponseTime =
      (current.avgResponseTime * current.totalCalls + data.responseTime) / newTotalCalls;
    const newErrorRate =
      (parseFloat(current.errorRate || "0") * current.totalCalls + (data.error ? 1 : 0)) / newTotalCalls;

    return db.update(agentMetrics).set({
      totalCalls: newTotalCalls,
      avgConfidence: newAvgConfidence.toString(),
      avgResponseTime: newAvgResponseTime,
      errorRate: newErrorRate.toString(),
    }).where(eq(agentMetrics.agentName, agentName));
  } else {
    return db.insert(agentMetrics).values({
      agentName,
      totalCalls: 1,
      avgConfidence: data.confidence.toString(),
      avgResponseTime: data.responseTime,
      errorRate: data.error ? "1.0" : "0.0",
    });
  }
}

export async function getAgentMetrics() {
  return db.select().from(agentMetrics);
}
```

## Step 5: Update tRPC Routers

Add to `server/routers.ts`:

```typescript
import {
  runAutonomousAnalysis,
  setAutonomyLevel,
  getAutonomyConfig,
  applyPatch as applyAutoPatch,
} from "./autonomousImprovement";
import {
  runSourceDiscovery,
} from "./sourceDiscovery";
import {
  orchestrateQuery,
  getAgentMetrics as getMultiAgentMetrics,
} from "./multiAgent";

// Add new router procedures
const systemRouter = router({
  // ... existing procedures ...

  // Autonomous improvement
  getAutonomyConfig: publicProcedure
    .query(async () => {
      return await getAutonomyConfig();
    }),

  setAutonomyLevel: publicProcedure
    .input(z.object({ level: z.number().min(0).max(4) }))
    .mutation(async ({ input }) => {
      setAutonomyLevel(input.level as 0 | 1 | 2 | 3 | 4);
      await updateAutonomyConfig({ autonomyLevel: input.level });
      return { success: true };
    }),

  runAutonomousAnalysis: publicProcedure
    .mutation(async () => {
      return await runAutonomousAnalysis();
    }),

  // Source discovery
  runSourceDiscovery: publicProcedure
    .mutation(async () => {
      return await runSourceDiscovery();
    }),

  // Multi-agent metrics
  getAgentMetrics: publicProcedure
    .query(async () => {
      return await getMultiAgentMetrics();
    }),
});

// Update chat router to use multi-agent
const chatRouter = router({
  sendMessage: publicProcedure
    .input(z.object({
      message: z.string(),
      conversationId: z.number(),
      useMultiAgent: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input }) => {
      // ... existing code to save message ...

      if (input.useMultiAgent) {
        // Use multi-agent orchestration
        const result = await orchestrateQuery(input.message, conversationHistory);
        
        // Save assistant message
        await addMessage({
          conversationId: input.conversationId,
          role: "assistant",
          content: result.response,
        });

        return {
          response: result.response,
          agents: result.agents,
          confidence: result.confidence,
        };
      } else {
        // Use original RAG pipeline
        const { response, ragChunks } = await ragChat(
          input.message,
          conversationHistory
        );

        // ... existing code ...
      }
    }),
});

export const appRouter = router({
  chat: chatRouter,
  system: systemRouter,
  // ... other routers ...
});
```

## Step 6: Update Services Startup

Edit `server/services.ts`:

```typescript
import {
  startAutonomousScheduler,
  setAutonomyLevel,
} from "./autonomousImprovement";
import {
  startSourceDiscoveryScheduler,
} from "./sourceDiscovery";
import {
  startAgentOptimization,
} from "./multiAgent";

export async function startBackgroundServices() {
  // Existing services
  startScraperScheduler(SCRAPER_INTERVAL_MS);
  startSelfImprovementScheduler(IMPROVEMENT_INTERVAL_MS);

  // Load autonomy config from DB
  const config = await getAutonomyConfig();
  setAutonomyLevel(config.autonomyLevel as 0 | 1 | 2 | 3 | 4);

  // New autonomous services
  startAutonomousScheduler(60 * 60 * 1000); // Every hour
  startSourceDiscoveryScheduler(24 * 60 * 60 * 1000); // Daily
  startAgentOptimization(6 * 60 * 60 * 1000); // Every 6 hours

  logger.info("services", "All background services started");
}
```

## Step 7: Update Frontend UI

Add new UI components to `client/src/pages/Home.tsx`:

```tsx
// Add state
const [autonomyLevel, setAutonomyLevel] = useState(1);
const [agentMetrics, setAgentMetrics] = useState([]);
const [useMultiAgent, setUseMultiAgent] = useState(false);

// Add queries/mutations
const autonomyConfig = trpc.system.getAutonomyConfig.useQuery();
const setAutonomy = trpc.system.setAutonomyLevel.useMutation();
const runDiscovery = trpc.system.runSourceDiscovery.useMutation();
const runAutoAnalysis = trpc.system.runAutonomousAnalysis.useMutation();

// Add UI sections
<div className="autonomy-controls">
  <h3>Autonomous Improvement</h3>
  
  <label>
    Autonomy Level: {autonomyLevel}
    <input
      type="range"
      min="0"
      max="4"
      value={autonomyLevel}
      onChange={(e) => {
        const level = parseInt(e.target.value);
        setAutonomyLevel(level);
        setAutonomy.mutate({ level });
      }}
    />
  </label>
  
  <div className="level-descriptions">
    <p>0: Manual approval only</p>
    <p>1: Auto-apply safe optimizations</p>
    <p>2: Auto-apply bug fixes</p>
    <p>3: Auto-refactor code</p>
    <p>4: Auto-implement features</p>
  </div>

  <button onClick={() => runAutoAnalysis.mutate()}>
    Run Analysis Now
  </button>

  <button onClick={() => runDiscovery.mutate()}>
    Discover Sources
  </button>
</div>

<div className="agent-toggle">
  <label>
    <input
      type="checkbox"
      checked={useMultiAgent}
      onChange={(e) => setUseMultiAgent(e.target.checked)}
    />
    Use Multi-Agent System
  </label>
</div>

// Update message sending
const handleSend = async () => {
  await sendMessage.mutateAsync({
    message: input,
    conversationId: currentConv.id,
    useMultiAgent,
  });
};
```

## Step 8: Add Environment Variables

Update `jarvis.env`:

```env
# Autonomous Improvement
AUTONOMY_LEVEL=1
MAX_PATCHES_PER_HOUR=3
ENABLE_AUTO_TESTING=true
AUTO_COMMIT_PATCHES=true

# Source Discovery  
DISCOVERY_INTERVAL_HOURS=24
MIN_QUALITY_SCORE=0.7
PRUNE_INACTIVE_SOURCES=true

# Multi-Agent
ENABLE_MULTI_AGENT=true
AGENT_OPTIMIZATION_HOURS=6
DEFAULT_AGENT_PRIORITY=5
```

## Step 9: Test the Integration

### 9.1 Test Autonomous Improvement

```bash
# Start JARVIS
pnpm dev

# In browser console or API:
trpc.system.setAutonomyLevel.mutate({ level: 1 })
trpc.system.runAutonomousAnalysis.mutate()

# Check logs for:
# - Analysis started
# - Patches generated
# - Sandbox testing
# - Auto-application (if Level >= 1)
```

### 9.2 Test Source Discovery

```bash
# Trigger discovery
trpc.system.runSourceDiscovery.mutate()

# Should see in logs:
# - Interest analysis
# - Source searches
# - Quality evaluation
# - New sources added
```

### 9.3 Test Multi-Agent

```bash
# Send complex query with multi-agent enabled
trpc.chat.sendMessage.mutate({
  message: "Research recent AI advances, analyze their impact on software development, and create a learning plan",
  conversationId: 1,
  useMultiAgent: true
})

# Should see:
# - Task decomposition
# - Multiple agent executions
# - Result synthesis
```

## Step 10: Monitor and Tune

### Check Git History
```bash
git log --grep="JARVIS Auto-Improve" --oneline
```

### Review Metrics
```bash
# Agent performance
trpc.system.getAgentMetrics.query()

# Autonomy status
trpc.system.getAutonomyConfig.query()
```

### Adjust Settings

If too aggressive:
```typescript
setAutonomy.mutate({ level: 0 }); // Turn off auto-apply
```

If too conservative:
```typescript
setAutonomy.mutate({ level: 2 }); // Enable bug fixes
```

## Troubleshooting

### Issue: Patches not applying
**Solution**: Check sandbox test logs, ensure Git is initialized

### Issue: No sources discovered
**Solution**: Have some conversations first to establish interests

### Issue: Multi-agent slow
**Solution**: Reduce number of agents or use single agent for simple queries

### Issue: High memory usage
**Solution**: Reduce agent context window, lower RAG topK

## Rollback Procedure

If something breaks:

```bash
# Rollback specific module
git checkout HEAD~1 -- server/autonomousImprovement.ts

# Full rollback to v1
git reset --hard backup-v1

# Or use backup files
cp server/scraper.ts.backup.1234567890 server/scraper.ts
```

## Next Steps

1. **Week 1**: Run at Level 1, monitor closely
2. **Week 2**: Review applied patches, increase to Level 2
3. **Month 1**: Evaluate source discovery effectiveness
4. **Month 2**: Consider Level 3 if confident
5. **Month 3+**: Fine-tune agent priorities and prompts

## Support

For issues:
1. Check logs: `systemLogs` table
2. Review Git history
3. Test in isolation (disable schedulers)
4. File issue on GitHub with logs

## Advanced: Custom Agent

```typescript
// In server/multiAgent.ts
AGENTS.security = {
  name: "Security Agent",
  role: "security",
  systemPrompt: `You are a security expert...`,
  capabilities: ["security", "audit", "vulnerability"],
  priority: 9,
};
```

Then update agent selection prompt to include it.

---

**You're ready!** JARVIS will now continuously learn, improve, and evolve. Start conservative and gradually increase autonomy as you build trust.
