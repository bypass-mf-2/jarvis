/**
 * File Upload API Routes
 * 
 * Handles file uploads and triggers processing
 */

import { Router } from "express";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";
import { ingestFileToKnowledge } from "./fileIngestion.js";
import { ingestWritingSample, type WritingCategory } from "./writingProfile.js";
import { logger } from "./logger.js";
import { getUploadedFileChunkCounts, deleteChunksByFileUrl } from "./db.js";

const router = Router();

// Configure multer for file uploads
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
  },
  fileFilter: (req, file, cb) => {
    // Allow most file types
    const allowedTypes = [
      // Images
      "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp",
      // Documents
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      // Text
      "text/plain", "text/csv", "text/markdown",
      "application/json", "application/xml",
      // Code
      "text/javascript", "application/javascript",
      "text/x-python", "application/x-python-code",
      // Media
      "video/mp4", "video/quicktime", "video/x-msvideo",
      "audio/mpeg", "audio/wav", "audio/mp4",
      // Archives
      "application/zip", "application/x-tar", "application/gzip",
    ];
    
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(ts|tsx|jsx|py|java|cpp|c|rs|go)$/)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not supported`));
    }
  },
});

// ── Single File Upload ─────────────────────────────────────────────────────────
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    
    const filepath = req.file.path;
    
    logger.info("upload", `File uploaded: ${req.file.originalname}`);
    
    // Process file in background
    ingestFileToKnowledge(filepath)
      .then(result => {
        logger.info("upload", `Processed: ${result.filename}, ${result.chunksAdded} chunks`);
      })
      .catch(err => {
        logger.error("upload", `Processing failed: ${err}`);
      });
    
    res.json({
      success: true,
      filename: req.file.originalname,
      size: req.file.size,
      message: "File uploaded and processing started",
    });
    
  } catch (err) {
    logger.error("upload", `Upload failed: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

// ── Multiple Files Upload ──────────────────────────────────────────────────────
router.post("/upload-multiple", upload.array("files", 10), async (req, res) => {
  try {
    if (!req.files || !Array.isArray(req.files)) {
      return res.status(400).json({ error: "No files uploaded" });
    }
    
    logger.info("upload", `Batch upload: ${req.files.length} files`);
    
    const results = [];
    
    // Process each file
    for (const file of req.files) {
      ingestFileToKnowledge(file.path)
        .then(result => {
          logger.info("upload", `Processed: ${result.filename}, ${result.chunksAdded} chunks`);
        })
        .catch(err => {
          logger.error("upload", `Processing failed for ${file.originalname}: ${err}`);
        });
      
      results.push({
        filename: file.originalname,
        size: file.size,
      });
    }
    
    res.json({
      success: true,
      filesProcessed: results.length,
      files: results,
      message: "Files uploaded and processing started",
    });
    
  } catch (err) {
    logger.error("upload", `Batch upload failed: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

// ── Folder Upload (recursive) ──────────────────────────────────────────────────
router.post("/upload-folder", upload.array("files", 100), async (req, res) => {
  try {
    if (!req.files || !Array.isArray(req.files)) {
      return res.status(400).json({ error: "No files uploaded" });
    }
    
    logger.info("upload", `Folder upload: ${req.files.length} files`);
    
    let processed = 0;
    let failed = 0;
    
    for (const file of req.files) {
      try {
        await ingestFileToKnowledge(file.path);
        processed++;
      } catch (err) {
        failed++;
        logger.error("upload", `Failed to process ${file.originalname}: ${err}`);
      }
    }
    
    res.json({
      success: true,
      totalFiles: req.files.length,
      processed,
      failed,
      message: `Processed ${processed} files, ${failed} failed`,
    });
    
  } catch (err) {
    logger.error("upload", `Folder upload failed: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

// ── Get Upload Status ──────────────────────────────────────────────────────────
router.get("/upload-status", async (req, res) => {
  try {
    const files = fs.readdirSync(uploadDir);
    const chunkCounts = await getUploadedFileChunkCounts();

    const stats = files
      .map(f => {
        const filepath = path.join(uploadDir, f);
        const stat = fs.statSync(filepath);
        const sourceUrl = `file://${filepath}`;
        return {
          filename: f,
          // strip the timestamp prefix added by multer (e.g. "1234567890-name.pdf" -> "name.pdf")
          displayName: f.replace(/^\d+-/, ""),
          size: stat.size,
          uploadedAt: stat.birthtime,
          sourceUrl,
          chunksAdded: chunkCounts[sourceUrl] ?? 0,
          status: chunkCounts[sourceUrl] > 0 ? "complete" : "processing",
        };
      })
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

    res.json({
      totalFiles: stats.length,
      files: stats.slice(0, 100),
    });
  } catch (err) {
    logger.error("upload", `upload-status failed: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

// ── Delete an uploaded file (and its chunks) ──────────────────────────────────
router.delete("/upload/:filename", async (req, res) => {
  try {
    const filename = req.params.filename;
    // Prevent path traversal
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return res.status(400).json({ error: "Invalid filename" });
    }

    const filepath = path.join(uploadDir, filename);
    const sourceUrl = `file://${filepath}`;

    let removedChunks = 0;
    try {
      removedChunks = await deleteChunksByFileUrl(sourceUrl);
    } catch (err) {
      logger.warn("upload", `Failed to delete chunks for ${filename}: ${err}`);
    }

    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    res.json({ success: true, filename, removedChunks });
  } catch (err) {
    logger.error("upload", `Delete failed: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Writing Samples — separate upload endpoint for personal writing style
// ═══════════════════════════════════════════════════════════════════════════
// These uploads are SEPARATE from the regular knowledge-base upload flow:
//   - stored in uploads-writing/ (not uploads/)
//   - never embedded into ChromaDB
//   - never retrieved by RAG
//   - never show up in the regular upload-status list
// Their only purpose is to feed the writingProfile module so Jarvis can
// learn the user's voice.

const writingUploadDir = path.join(process.cwd(), "uploads-writing");
if (!fs.existsSync(writingUploadDir)) {
  fs.mkdirSync(writingUploadDir, { recursive: true });
}

const writingStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, writingUploadDir),
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const writingUpload = multer({
  storage: writingStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB — voice analysis doesn't need massive files
  fileFilter: (_req, file, cb) => {
    // Only accept text-bearing formats. No images, no audio, no video —
    // those don't represent the user's writing.
    const ok = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.oasis.opendocument.text",
      "application/rtf", "text/rtf",
      "text/plain", "text/markdown", "text/csv",
    ];
    if (ok.includes(file.mimetype) || /\.(txt|md|markdown|rst|rtf|pdf|doc|docx|odt)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`Writing samples must be text/pdf/doc — got ${file.mimetype}`));
    }
  },
});

const VALID_CATEGORIES = new Set<WritingCategory>([
  "essay", "lab_report", "book_report", "resume", "book", "article", "other",
]);

function normalizeCategory(raw: unknown): WritingCategory {
  if (typeof raw !== "string") return "other";
  const lower = raw.toLowerCase() as WritingCategory;
  return VALID_CATEGORIES.has(lower) ? lower : "other";
}

function normalizeDescription(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 2000); // cap so a pasted essay in the field doesn't blow the prompt
}

// ── Upload a writing sample ──────────────────────────────────────────────
router.post("/upload-writing", writingUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const category = normalizeCategory(req.body?.category);
    const description = normalizeDescription(req.body?.description);
    const filepath = req.file.path;
    const originalName = req.file.originalname;

    logger.info("writingProfile", `Writing sample uploaded: ${originalName} (${category})`);

    // Do the text-extraction + DB-insert phase synchronously so the client
    // gets a real success/failure response. If text extraction fails (e.g.
    // unreadable PDF), we send a 422 so the UI can show the actual error
    // instead of silently showing "analyzing..." forever.
    // Style analysis (the slow Ollama call) still runs in the background
    // after the response is sent, because it takes 10-30s.
    try {
      const result = await ingestWritingSample(filepath, originalName, category, description);
      logger.info(
        "writingProfile",
        `Sample #${result.sampleId} ingested: ${result.wordCount} words, analyzed=${result.analyzed}`
      );
      res.json({
        success: true,
        filename: originalName,
        category,
        size: req.file.size,
        sampleId: result.sampleId,
        wordCount: result.wordCount,
        analyzed: result.analyzed,
        message: result.analyzed
          ? "Writing sample ingested and analyzed"
          : "Writing sample ingested — style analysis will run in background",
      });
    } catch (err: any) {
      // Ingest failed before the DB row was created — delete the orphan
      // file from disk so re-upload is clean, and send the actual error.
      try { fs.unlinkSync(filepath); } catch { /* noop */ }
      logger.error("writingProfile", `Sample ingest failed for ${originalName}: ${err?.message ?? err}`);
      res.status(422).json({
        error: err?.message ?? String(err),
        filename: originalName,
      });
    }
  } catch (err) {
    logger.error("writingProfile", `Writing upload failed: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

// ── Upload multiple writing samples at once ──────────────────────────────
router.post("/upload-writing-multiple", writingUpload.array("files", 20), async (req, res) => {
  try {
    if (!req.files || !Array.isArray(req.files)) {
      return res.status(400).json({ error: "No files uploaded" });
    }
    const category = normalizeCategory(req.body?.category);
    const description = normalizeDescription(req.body?.description);

    for (const file of req.files) {
      ingestWritingSample(file.path, file.originalname, category, description).catch((err) => {
        logger.error("writingProfile", `Sample ingest failed for ${file.originalname}: ${err}`);
      });
    }

    res.json({
      success: true,
      filesReceived: req.files.length,
      category,
      message: "Writing samples received — style analysis in progress",
    });
  } catch (err) {
    logger.error("writingProfile", `Writing batch upload failed: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

// ── Navigator screenshot serving ─────────────────────────────────────────
// Serves screenshots captured by server/navigator.ts so the UI can display
// the step-by-step audit trail. Path-traversal guarded.
const navScreenshotDir = path.join(process.cwd(), "nav-screenshots");
router.get("/nav-screenshot/:filename", (req, res) => {
  const filename = req.params.filename;
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  const filepath = path.join(navScreenshotDir, filename);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: "Screenshot not found" });
  }
  res.sendFile(filepath);
});

// ── Navigator download serving ───────────────────────────────────────────
// Serves files the agent downloaded during a task run. Namespaced by taskId
// so downloads from different runs can't collide. Path-traversal guarded.
const navDownloadDir = path.join(process.cwd(), "nav-downloads");
router.get("/nav-download/:taskId/:filename", (req, res) => {
  const { taskId, filename } = req.params;
  // Strict: taskId is nanoid(10) → alphanumeric + _ -. Filename is arbitrary
  // but must not contain path separators or traversal segments.
  if (!/^[A-Za-z0-9_-]+$/.test(taskId)) {
    return res.status(400).json({ error: "Invalid taskId" });
  }
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  const filepath = path.join(navDownloadDir, taskId, filename);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: "Download not found" });
  }
  res.download(filepath, filename);
});

export default router;
