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
import { logger } from "./logger.js";

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
router.get("/upload-status", (req, res) => {
  const files = fs.readdirSync(uploadDir);
  const stats = files.map(f => {
    const filepath = path.join(uploadDir, f);
    const stat = fs.statSync(filepath);
    return {
      filename: f,
      size: stat.size,
      uploadedAt: stat.birthtime,
    };
  });
  
  res.json({
    totalFiles: files.length,
    files: stats.slice(0, 50), // Last 50 uploads
  });
});

export default router;
