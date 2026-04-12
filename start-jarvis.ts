/**
 * JARVIS startup script
 * Starts ChromaDB (vector store) and the main server
 */
// IMPORTANT: this import MUST come first so the console monkey-patch runs
// before any other module gets a chance to log. ES module imports execute
// in source order, and this one has to beat _core/index.js below.
import "./server/consoleTimestamp.js";

import { spawn } from "child_process";
import path from "path";
import fs from "fs";

// ── Start ChromaDB if available ──────────────────────────────────────────────
function startChromaDB() {
  const appData = process.env.APPDATA || "";
  const possiblePaths = [
    path.join(appData, "Python", "Python313", "Scripts", "chroma.exe"),
    path.join(appData, "Python", "Python312", "Scripts", "chroma.exe"),
    path.join(appData, "Python", "Python311", "Scripts", "chroma.exe"),
    "chroma", // fallback to PATH
  ];

  const chromaExe = possiblePaths.find((p) => {
    try {
      return p === "chroma" || fs.existsSync(p);
    } catch {
      return false;
    }
  });

  if (!chromaExe) {
    console.log("[ChromaDB] Not found — vector search will use keyword fallback");
    return null;
  }

  const dataDir = path.join(process.cwd(), "chroma-data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  console.log(`[ChromaDB] Starting: ${chromaExe} run --path ${dataDir}`);
  const child = spawn(chromaExe, ["run", "--path", dataDir], {
    stdio: "ignore",
    detached: false,
  });

  child.on("error", (err) => {
    console.log(`[ChromaDB] Failed to start: ${err.message}`);
  });

  // Shut down ChromaDB when the main process exits.
  // NOTE: do NOT call process.exit() here — server/sqlite-init.ts
  // registers its own SIGINT/SIGTERM handler that flushes jarvis.db to
  // disk and then exits. Calling process.exit() here would race that
  // flush and leave the DB half-written.
  const cleanup = () => {
    try { child.kill(); } catch {}
  };
  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  console.log("[ChromaDB] Started on http://localhost:8000");
  return child;
}

startChromaDB();

// ── Start main server ────────────────────────────────────────────────────────
import "./server/_core/index.js";
