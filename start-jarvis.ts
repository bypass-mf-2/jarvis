/**
 * JARVIS startup script
 * Starts ChromaDB (vector store) and the main server
 */
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

  // Shut down ChromaDB when the main process exits
  const cleanup = () => {
    try { child.kill(); } catch {}
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(); });
  process.on("SIGTERM", () => { cleanup(); process.exit(); });

  console.log("[ChromaDB] Started on http://localhost:8000");
  return child;
}

startChromaDB();

// ── Start main server ────────────────────────────────────────────────────────
import "./server/_core/index.js";
