/**
 * File Upload Component
 * 
 * Drag-and-drop file upload with progress tracking
 * Supports images, PDFs, documents, videos, audio, code, etc.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Upload, File, Image, FileText, FileVideo, FileAudio,
  FileCode, CheckCircle, XCircle, Loader2, FolderUp, X
} from "lucide-react";

interface UploadedFile {
  name: string;          // server filename (with timestamp prefix) - used for delete
  displayName?: string;  // friendly name without timestamp prefix
  size: number;
  type: string;
  status: "uploading" | "processing" | "complete" | "error";
  progress: number;
  chunksAdded?: number;
  error?: string;
  uploadedAt?: string;
}

// Guess a MIME-ish string from a filename for icon selection
function guessTypeFromName(name: string | undefined | null): string {
  if (!name) return "application/octet-stream";
  const ext = String(name).toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
    mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
    js: "text/javascript", ts: "text/typescript", py: "text/x-python", java: "text/x-java",
    txt: "text/plain", md: "text/markdown", json: "application/json",
  };
  return map[ext] ?? "application/octet-stream";
}

export function FileUploadPanel() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // ── Load existing uploads on mount + poll for chunk count updates ──────────
  const refreshUploads = useCallback(async () => {
    try {
      const res = await fetch("/api/upload-status");
      if (!res.ok) return;
      const data = await res.json() as {
        files: Array<{
          filename: string;
          displayName: string;
          size: number;
          uploadedAt: string;
          chunksAdded: number;
          status: "complete" | "processing";
        }>;
      };
      // Merge server state with any in-flight uploads (preserve uploading/error rows by filename)
      setFiles(prev => {
        const inFlight = prev.filter(f => f.status === "uploading" || f.status === "error");
        const fromServer: UploadedFile[] = data.files.map(f => ({
          name: f.filename,
          displayName: f.displayName ?? f.filename?.replace(/^\d+-/, ""),
          size: f.size ?? 0,
          type: guessTypeFromName(f.displayName ?? f.filename),
          status: f.status ?? "complete",
          progress: 100,
          chunksAdded: f.chunksAdded ?? 0,
          uploadedAt: f.uploadedAt,
        }));
        return [...inFlight, ...fromServer];
      });
    } catch {
      // Silent — sidebar may open before server is ready
    }
  }, []);

  useEffect(() => {
    refreshUploads();
    // Poll every 5s while panel is open so processing → complete transitions show up
    const interval = setInterval(refreshUploads, 5000);
    return () => clearInterval(interval);
  }, [refreshUploads]);

  // ── File Icon ──────────────────────────────────────────────────────────────
  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) return <Image className="w-4 h-4" />;
    if (type.startsWith("video/")) return <FileVideo className="w-4 h-4" />;
    if (type.startsWith("audio/")) return <FileAudio className="w-4 h-4" />;
    if (type.includes("pdf")) return <FileText className="w-4 h-4 text-red-400" />;
    if (type.includes("word") || type.includes("document")) 
      return <FileText className="w-4 h-4 text-blue-400" />;
    if (type.includes("sheet") || type.includes("excel")) 
      return <FileText className="w-4 h-4 text-green-400" />;
    if (type.includes("presentation") || type.includes("powerpoint")) 
      return <FileText className="w-4 h-4 text-orange-400" />;
    if (type.includes("javascript") || type.includes("typescript") || 
        type.includes("python") || type.includes("java"))
      return <FileCode className="w-4 h-4 text-purple-400" />;
    return <File className="w-4 h-4" />;
  };

  // ── Upload Handler ─────────────────────────────────────────────────────────
  const uploadFiles = useCallback(async (fileList: FileList) => {
    const newFiles: UploadedFile[] = Array.from(fileList).map(f => ({
      name: f.name,
      size: f.size,
      type: f.type || "application/octet-stream",
      status: "uploading",
      progress: 0,
    }));

    setFiles(prev => [...newFiles, ...prev]);

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const index = i;

      try {
        const formData = new FormData();
        formData.append("file", file);

        // Upload with progress
        const xhr = new XMLHttpRequest();
        
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const progress = (e.loaded / e.total) * 100;
            setFiles(prev => {
              const updated = [...prev];
              updated[index] = { ...updated[index], progress };
              return updated;
            });
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status === 200) {
            setFiles(prev => {
              const updated = [...prev];
              updated[index] = {
                ...updated[index],
                status: "processing",
                progress: 100,
              };
              return updated;
            });
            toast.success(`${file.name} uploaded — processing...`);
            // Refresh from server to get the real chunk count once processing finishes
            setTimeout(refreshUploads, 1500);
            setTimeout(refreshUploads, 5000);
          } else {
            throw new Error("Upload failed");
          }
        });

        xhr.addEventListener("error", () => {
          setFiles(prev => {
            const updated = [...prev];
            updated[index] = {
              ...updated[index],
              status: "error",
              error: "Upload failed",
            };
            return updated;
          });
          toast.error(`Failed to upload ${file.name}`);
        });

        xhr.open("POST", "/api/upload");
        xhr.send(formData);

      } catch (err) {
        setFiles(prev => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            status: "error",
            error: String(err),
          };
          return updated;
        });
        toast.error(`Error uploading ${file.name}`);
      }
    }
  }, []);

  // ── Drag and Drop ──────────────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length > 0) {
      uploadFiles(droppedFiles);
    }
  }, [uploadFiles]);

  // ── File Selection ─────────────────────────────────────────────────────────
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
    }
  }, [uploadFiles]);

  // ── Format File Size ───────────────────────────────────────────────────────
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  // ── Remove File (also deletes from disk + knowledge base) ──────────────────
  const removeFile = useCallback(async (index: number) => {
    const file = files[index];
    if (!file) return;

    // Optimistic UI: remove immediately
    setFiles(prev => prev.filter((_, i) => i !== index));

    // Only call delete API if this is a server-side file (has been uploaded)
    if (file.status !== "uploading" && file.name) {
      try {
        const res = await fetch(`/api/upload/${encodeURIComponent(file.name)}`, {
          method: "DELETE",
        });
        if (res.ok) {
          const data = await res.json() as { removedChunks: number };
          toast.success(
            `Removed ${file.displayName ?? file.name}` +
            (data.removedChunks > 0 ? ` (${data.removedChunks} chunks)` : "")
          );
        } else {
          toast.error(`Failed to delete ${file.displayName ?? file.name}`);
          refreshUploads(); // Restore state from server
        }
      } catch {
        toast.error("Delete request failed");
        refreshUploads();
      }
    }
  }, [files, refreshUploads]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Compact Upload Area */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-3 mb-3 transition-all flex-shrink-0
          ${isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50"
          }
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex items-center gap-2 mb-2">
          <Upload className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="text-xs text-muted-foreground truncate">
            Drag files here or click below
          </span>
        </div>

        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="gap-1 h-7 text-xs flex-1"
          >
            <File className="w-3 h-3" />
            Files
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => folderInputRef.current?.click()}
            className="gap-1 h-7 text-xs flex-1"
          >
            <FolderUp className="w-3 h-3" />
            Folder
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.js,.ts,.jsx,.tsx,.py,.java,.cpp,.c,.rs,.go"
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          {...{ webkitdirectory: "", directory: "" } as any}
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* File List */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2 px-1 flex-shrink-0">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Uploaded</h4>
          {files.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {files.length}
            </Badge>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0">
          {files.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No files uploaded yet
            </div>
          ) : (
            <div className="space-y-2">
              {files.map((file, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-border bg-card p-3 text-xs"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {getFileIcon(file.type)}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{file.displayName ?? file.name}</p>
                        <p className="text-muted-foreground">
                          {formatSize(file.size)}
                          {file.uploadedAt && ` • ${new Date(file.uploadedAt).toLocaleDateString()}`}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      {file.status === "uploading" && (
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      )}
                      {file.status === "processing" && (
                        <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                      )}
                      {file.status === "complete" && (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      )}
                      {file.status === "error" && (
                        <XCircle className="w-4 h-4 text-red-400" />
                      )}
                      
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeFile(index)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  {file.status === "uploading" && (
                    <Progress value={file.progress} className="h-1 mb-1" />
                  )}

                  <div className="flex items-center justify-between">
                    <Badge
                      variant={
                        file.status === "complete" ? "default" :
                        file.status === "error" ? "destructive" :
                        "secondary"
                      }
                      className="text-xs"
                    >
                      {file.status}
                    </Badge>
                    
                    {file.chunksAdded && (
                      <span className="text-muted-foreground">
                        {file.chunksAdded} chunks added
                      </span>
                    )}
                    
                    {file.error && (
                      <span className="text-red-400 text-xs">{file.error}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
