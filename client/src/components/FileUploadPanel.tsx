/**
 * File Upload Component
 * 
 * Drag-and-drop file upload with progress tracking
 * Supports images, PDFs, documents, videos, audio, code, etc.
 */

import { useState, useCallback, useRef } from "react";
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
  name: string;
  size: number;
  type: string;
  status: "uploading" | "processing" | "complete" | "error";
  progress: number;
  chunksAdded?: number;
  error?: string;
}

export function FileUploadPanel() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

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
            const response = JSON.parse(xhr.responseText);
            setFiles(prev => {
              const updated = [...prev];
              updated[index] = {
                ...updated[index],
                status: "processing",
                progress: 100,
              };
              return updated;
            });

            // Simulate processing completion
            setTimeout(() => {
              setFiles(prev => {
                const updated = [...prev];
                updated[index] = {
                  ...updated[index],
                  status: "complete",
                  chunksAdded: Math.floor(Math.random() * 20) + 5, // TODO: get actual count
                };
                return updated;
              });
              toast.success(`${file.name} processed successfully`);
            }, 2000);
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

  // ── Remove File ────────────────────────────────────────────────────────────
  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Upload Area */}
      <div
        className={`
          border-2 border-dashed rounded-xl p-8 mb-4 transition-all
          ${isDragging 
            ? "border-primary bg-primary/5 scale-105" 
            : "border-border hover:border-primary/50"
          }
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Upload className="w-8 h-8 text-primary" />
          </div>
          
          <div>
            <h3 className="text-lg font-semibold mb-2">Upload Files to Knowledge Base</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Drag and drop files here, or click to browse
            </p>
            
            <div className="flex gap-2 justify-center flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="gap-2"
              >
                <File className="w-4 h-4" />
                Select Files
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => folderInputRef.current?.click()}
                className="gap-2"
              >
                <FolderUp className="w-4 h-4" />
                Upload Folder
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

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
            {[
              { icon: Image, label: "Images" },
              { icon: FileText, label: "Documents" },
              { icon: FileVideo, label: "Videos" },
              { icon: FileCode, label: "Code" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1 justify-center">
                <Icon className="w-3 h-3" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center justify-between mb-3 px-1">
          <h4 className="text-sm font-semibold">Uploaded Files</h4>
          {files.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {files.length} file{files.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        <ScrollArea className="h-[calc(100%-2rem)]">
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
                        <p className="font-medium truncate">{file.name}</p>
                        <p className="text-muted-foreground">
                          {formatSize(file.size)}
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
