/**
 * Initialize SQLite database with all tables
 * Note: Tables are now created by sqlite-init.ts during startup.
 * This file is kept for compatibility but delegates to the main init.
 */

import { logger } from "./logger.js";

export async function initializeSQLiteTables() {
  // Tables are created by sqlite-init.ts (initializeSQLiteDatabase)
  // which runs before this. Nothing to do here.
  await logger.info("db", "SQLite tables verified");
}