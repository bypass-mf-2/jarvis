#!/usr/bin/env node

/**
 * JARVIS 2.0 Upgrade Script (ES Module Version)
 * 
 * Automatically integrates autonomous improvement features into existing JARVIS installation.
 * 
 * Usage: node upgrade-to-v2.mjs [--dry-run] [--autonomy-level=1]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRY_RUN = process.argv.includes('--dry-run');
const AUTONOMY_LEVEL = parseInt(
  (process.argv.find(a => a.startsWith('--autonomy-level=')) || '').split('=')[1] || '1'
);

const PROJECT_ROOT = process.cwd();
const SERVER_DIR = path.join(PROJECT_ROOT, 'server');
const BACKUP_DIR = path.join(PROJECT_ROOT, '.jarvis-v1-backup');

console.log('🤖 JARVIS 2.0 Upgrade Script');
console.log('━'.repeat(60));
console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE UPGRADE'}`);
console.log(`Target autonomy level: ${AUTONOMY_LEVEL}`);
console.log('━'.repeat(60));

// ── Step 1: Pre-flight Checks ─────────────────────────────────────────────────
console.log('\n📋 Step 1: Pre-flight checks...');

function checkExists(filepath) {
  if (!fs.existsSync(filepath)) {
    console.error(`❌ Missing: ${filepath}`);
    process.exit(1);
  }
  console.log(`✅ Found: ${path.basename(filepath)}`);
}

checkExists(path.join(SERVER_DIR, 'db.ts'));
checkExists(path.join(SERVER_DIR, 'routers.ts'));
checkExists(path.join(SERVER_DIR, 'services.ts'));
checkExists(path.join(SERVER_DIR, 'ollama.ts'));
checkExists(path.join(SERVER_DIR, 'rag.ts'));

// Check for new modules
const newModules = [
  'autonomousImprovement.ts',
  'sourceDiscovery.ts',
  'multiAgent.ts'
];

console.log('\nChecking for new modules...');
for (const module of newModules) {
  const modulePath = path.join(SERVER_DIR, module);
  if (fs.existsSync(modulePath)) {
    console.log(`✅ Found: ${module}`);
  } else {
    console.error(`❌ Missing: ${module}`);
    console.error(`\nPlease copy the new modules to server/ directory first:`);
    console.error(`  cp autonomousImprovement.ts server/`);
    console.error(`  cp sourceDiscovery.ts server/`);
    console.error(`  cp multiAgent.ts server/`);
    process.exit(1);
  }
}

// Check if Git is initialized
try {
  execSync('git status', { cwd: PROJECT_ROOT, stdio: 'ignore' });
  console.log('✅ Git repository detected');
} catch {
  console.log('⚠️  No Git repository found');
  console.log('Initializing Git for rollback capability...');
  if (!DRY_RUN) {
    try {
      execSync('git init', { cwd: PROJECT_ROOT });
      execSync('git add .', { cwd: PROJECT_ROOT });
      execSync('git commit -m "Pre-v2.0 baseline"', { cwd: PROJECT_ROOT });
      execSync('git branch backup-v1', { cwd: PROJECT_ROOT });
      console.log('✅ Git initialized');
    } catch (err) {
      console.log('⚠️  Git initialization failed, continuing anyway...');
    }
  }
}

// ── Step 2: Create Backup ─────────────────────────────────────────────────────
console.log('\n💾 Step 2: Creating backup...');

if (!DRY_RUN) {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const filesToBackup = [
    'server/db.ts',
    'server/routers.ts',
    'server/services.ts',
  ];

  for (const file of filesToBackup) {
    const src = path.join(PROJECT_ROOT, file);
    const dest = path.join(BACKUP_DIR, path.basename(file));
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`✅ Backed up: ${file}`);
    }
  }
}

// ── Step 3: Update Database Schema ────────────────────────────────────────────
console.log('\n🗄️  Step 3: Updating database schema...');

const schemaPath = path.join(PROJECT_ROOT, 'drizzle', 'schema.ts');

if (!fs.existsSync(schemaPath)) {
  console.error('❌ Could not find drizzle/schema.ts');
  console.log('⚠️  Skipping database schema update - you may need to do this manually');
} else {
  let schemaContent = fs.readFileSync(schemaPath, 'utf-8');

  const newTables = `
// ─── v2.0 Autonomous Features ───────────────────────────────────────────────────
export const autonomyConfig = mysqlTable("autonomy_config", {
  id: serial("id").primaryKey(),
  autonomyLevel: int("autonomy_level").notNull().default(1),
  maxPatchesPerHour: int("max_patches_per_hour").notNull().default(3),
  enabledCategories: json("enabled_categories").notNull().default("[]"),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const sourceMetrics = mysqlTable("source_metrics", {
  id: serial("id").primaryKey(),
  sourceId: int("source_id").notNull(),
  qualityScore: decimal("quality_score", { precision: 3, scale: 2 }),
  avgChunkLength: int("avg_chunk_length"),
  errorRate: decimal("error_rate", { precision: 3, scale: 2 }),
  lastEvaluated: timestamp("last_evaluated").defaultNow(),
});

export const agentMetrics = mysqlTable("agent_metrics", {
  id: serial("id").primaryKey(),
  agentName: varchar("agent_name", { length: 50 }).notNull().unique(),
  totalCalls: int("total_calls").notNull().default(0),
  avgConfidence: decimal("avg_confidence", { precision: 3, scale: 2 }),
  avgResponseTime: int("avg_response_time"),
  errorRate: decimal("error_rate", { precision: 3, scale: 2 }),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
`;

  if (!schemaContent.includes('autonomyConfig')) {
    console.log('📝 Adding new tables to schema...');
    if (!DRY_RUN) {
      schemaContent += '\n' + newTables;
      fs.writeFileSync(schemaPath, schemaContent);
    }
    console.log('✅ Schema updated');
  } else {
    console.log('✅ Schema already has v2.0 tables');
  }
}

// ── Step 4: Update Database Functions ─────────────────────────────────────────
console.log('\n🔧 Step 4: Updating database functions...');

const dbPath = path.join(SERVER_DIR, 'db.ts');
let dbContent = fs.readFileSync(dbPath, 'utf-8');

const newDbFunctions = `
// ─── v2.0 Database Functions ────────────────────────────────────────────────────
export async function getAutonomyConfig() {
  const [config] = await db.select().from(autonomyConfig).limit(1);
  return config || { 
    id: 0,
    autonomyLevel: 1, 
    maxPatchesPerHour: 3,
    enabledCategories: [] 
  };
}

export async function updateAutonomyConfig(data: Partial<{
  autonomyLevel: number;
  maxPatchesPerHour: number;
  enabledCategories: string[];
}>) {
  const existing = await getAutonomyConfig();
  if (existing.id) {
    return db.update(autonomyConfig)
      .set(data)
      .where(eq(autonomyConfig.id, existing.id));
  } else {
    return db.insert(autonomyConfig).values({
      autonomyLevel: data.autonomyLevel || 1,
      maxPatchesPerHour: data.maxPatchesPerHour || 3,
      enabledCategories: data.enabledCategories || [],
    });
  }
}

export async function trackAgentCall(agentName: string, data: {
  confidence: number;
  responseTime: number;
  error?: boolean;
}) {
  const [existing] = await db
    .select()
    .from(agentMetrics)
    .where(eq(agentMetrics.agentName, agentName))
    .limit(1);

  if (existing) {
    const newTotalCalls = existing.totalCalls + 1;
    const currentConf = parseFloat(existing.avgConfidence || "0");
    const newAvgConfidence = 
      (currentConf * existing.totalCalls + data.confidence) / newTotalCalls;
    const newAvgResponseTime =
      ((existing.avgResponseTime || 0) * existing.totalCalls + data.responseTime) / newTotalCalls;
    const currentError = parseFloat(existing.errorRate || "0");
    const newErrorRate =
      (currentError * existing.totalCalls + (data.error ? 1 : 0)) / newTotalCalls;

    return db.update(agentMetrics).set({
      totalCalls: newTotalCalls,
      avgConfidence: newAvgConfidence.toFixed(2),
      avgResponseTime: Math.round(newAvgResponseTime),
      errorRate: newErrorRate.toFixed(2),
    }).where(eq(agentMetrics.agentName, agentName));
  } else {
    return db.insert(agentMetrics).values({
      agentName,
      totalCalls: 1,
      avgConfidence: data.confidence.toFixed(2),
      avgResponseTime: data.responseTime,
      errorRate: data.error ? "1.0" : "0.0",
    });
  }
}

export async function getAllAgentMetrics() {
  return db.select().from(agentMetrics);
}
`;

if (!dbContent.includes('getAutonomyConfig')) {
  console.log('📝 Adding v2.0 database functions...');
  if (!DRY_RUN) {
    dbContent += '\n' + newDbFunctions;
    fs.writeFileSync(dbPath, dbContent);
  }
  console.log('✅ Database functions added');
} else {
  console.log('✅ Database functions already present');
}

// ── Step 5: Update Services ───────────────────────────────────────────────────
console.log('\n⚙️  Step 5: Updating service startup...');

const servicesPath = path.join(SERVER_DIR, 'services.ts');
let servicesContent = fs.readFileSync(servicesPath, 'utf-8');

const newImports = `import {
  startAutonomousScheduler,
  setAutonomyLevel,
} from "./autonomousImprovement.js";
import { startSourceDiscoveryScheduler } from "./sourceDiscovery.js";
import { startAgentOptimization } from "./multiAgent.js";
`;

const newServiceStarts = `
  // ─── v2.0 Autonomous Services ───────────────────────────────────────────────
  const config = await getAutonomyConfig();
  setAutonomyLevel(config.autonomyLevel as 0 | 1 | 2 | 3 | 4);
  
  startAutonomousScheduler(60 * 60 * 1000); // Every hour
  startSourceDiscoveryScheduler(24 * 60 * 60 * 1000); // Daily
  startAgentOptimization(6 * 60 * 60 * 1000); // Every 6 hours
  
  logger.info("services", "v2.0 autonomous services started");
`;

if (!servicesContent.includes('startAutonomousScheduler')) {
  console.log('📝 Updating services startup...');
  if (!DRY_RUN) {
    // Add imports at top (after existing imports)
    const lastImportIndex = servicesContent.lastIndexOf('import');
    const importEndIndex = servicesContent.indexOf(';', lastImportIndex) + 1;
    servicesContent = 
      servicesContent.slice(0, importEndIndex) +
      '\n' + newImports +
      servicesContent.slice(importEndIndex);
    
    // Add service starts at the end of the start function
    const funcMatch = servicesContent.match(/export (async )?function start\w*Services/);
    if (funcMatch) {
      const funcStart = funcMatch.index;
      const funcBody = servicesContent.slice(funcStart);
      const lastCloseBrace = funcBody.lastIndexOf('}');
      const insertPoint = funcStart + lastCloseBrace;
      
      servicesContent = 
        servicesContent.slice(0, insertPoint) +
        newServiceStarts +
        servicesContent.slice(insertPoint);
    }
    
    fs.writeFileSync(servicesPath, servicesContent);
  }
  console.log('✅ Services updated');
} else {
  console.log('✅ Services already configured');
}

// ── Step 6: Update Environment Variables ──────────────────────────────────────
console.log('\n🌍 Step 6: Updating environment variables...');

const envPath = path.join(PROJECT_ROOT, 'jarvis.env');
if (fs.existsSync(envPath)) {
  let envContent = fs.readFileSync(envPath, 'utf-8');
  
  const newEnvVars = `
# ─── v2.0 Autonomous Features ───────────────────────────────────────────────────
AUTONOMY_LEVEL=${AUTONOMY_LEVEL}
MAX_PATCHES_PER_HOUR=3
ENABLE_AUTO_TESTING=true
AUTO_COMMIT_PATCHES=true

DISCOVERY_INTERVAL_HOURS=24
MIN_QUALITY_SCORE=0.7
PRUNE_INACTIVE_SOURCES=true

ENABLE_MULTI_AGENT=true
AGENT_OPTIMIZATION_HOURS=6
`;
  
  if (!envContent.includes('AUTONOMY_LEVEL')) {
    console.log('📝 Adding v2.0 environment variables...');
    if (!DRY_RUN) {
      envContent += '\n' + newEnvVars;
      fs.writeFileSync(envPath, envContent);
    }
    console.log('✅ Environment updated');
  } else {
    console.log('✅ Environment already configured');
  }
} else {
  console.log('⚠️  No jarvis.env file found, skipping environment setup');
}

// ── Step 7: Run Database Migration ────────────────────────────────────────────
console.log('\n🔄 Step 7: Database migration instructions...');

console.log(`
To apply the database schema changes, run:

  pnpm drizzle-kit generate
  pnpm drizzle-kit migrate

Or if using SQLite:

  pnpm drizzle-kit generate:sqlite
  pnpm drizzle-kit push:sqlite
`);

if (!DRY_RUN) {
  console.log('⚠️  Automatic migration skipped - please run manually to review changes');
}

// ── Step 8: Summary ──────────────────────────────────────────────────────────
console.log('\n' + '━'.repeat(60));
console.log('🎉 JARVIS 2.0 Upgrade Complete!');
console.log('━'.repeat(60));

console.log('\nWhat was done:');
console.log('✅ Verified new modules are in place');
console.log('✅ Created backup in .jarvis-v1-backup/');
console.log('✅ Updated database schema');
console.log('✅ Added database helper functions');
console.log('✅ Updated service startup sequence');
console.log(`✅ Set autonomy level to ${AUTONOMY_LEVEL}`);

console.log('\nNext steps:');
console.log('1. Run database migration:');
console.log('   pnpm drizzle-kit generate');
console.log('   pnpm drizzle-kit migrate');
console.log('');
console.log('2. Start JARVIS: pnpm dev');
console.log('3. Monitor logs for autonomous activity');
console.log('4. Read ARCHITECTURE_V2.md for details');
console.log('5. Gradually increase autonomy level as you gain confidence');

console.log('\nRollback if needed:');
console.log('  git reset --hard backup-v1');
console.log('  or restore from .jarvis-v1-backup/');

console.log('\n🤖 JARVIS is now autonomous! Monitor closely at first.');
console.log('━'.repeat(60));

if (DRY_RUN) {
  console.log('\n⚠️  DRY RUN - No changes were made');
  console.log('Run without --dry-run to apply changes');
}
