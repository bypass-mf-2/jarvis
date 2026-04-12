/**
 * Structured logger that writes to the system_logs table.
 * Used by all modules so the self-improvement engine can analyze logs.
 */

import { addSystemLog } from "./db";

type LogLevel = "info" | "warn" | "error" | "debug";

async function writeLog(
  level: LogLevel,
  module: string,
  message: string,
  metadata?: unknown
) {
  // Always log to console
  const prefix = `[${module.toUpperCase()}]`;
  if (level === "error") console.error(prefix, message, metadata ?? "");
  else if (level === "warn") console.warn(prefix, message, metadata ?? "");
  else console.log(prefix, message, metadata ?? "");

  // Persist to DB (best-effort)
  try {
    await addSystemLog({
      level,
      module,
      message,
      metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null,
    });
  } catch {
    // Swallow DB errors to avoid log loops
  }
}

export const logger = {
  info: (module: string, message: string, metadata?: unknown) =>
    writeLog("info", module, message, metadata),
  warn: (module: string, message: string, metadata?: unknown) =>
    writeLog("warn", module, message, metadata),
  error: (module: string, message: string, metadata?: unknown) =>
    writeLog("error", module, message, metadata),
  debug: (module: string, message: string, metadata?: unknown) =>
    writeLog("debug", module, message, metadata),
};
