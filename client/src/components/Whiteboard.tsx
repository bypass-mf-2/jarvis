/**
 * Whiteboard panel — drawn-notes UI lives in Home.tsx side panel.
 *
 * Two-level structure:
 *   Subjects (left rail) → Pages (top tabs) → Canvas (main area).
 *
 * Drawing:
 *   - PointerEvents covers mouse / touch / pen with one handler set
 *   - Pen + eraser + color picker + brush size + clear
 *   - Auto-saves the canvas as a PNG dataURL ~600ms after the last stroke
 *     ends (debounced) — survives a panel close + reopen, server crash,
 *     etc. without user action
 *
 * Things deliberately NOT in v1:
 *   - Undo / redo (would need stroke history; PNG round-trip drops it)
 *   - Layers
 *   - Vector export
 *   - Multi-page selection
 *   These are easy adds later if the basic version sees use.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PencilLine,
  Eraser,
  Trash2,
  Plus,
  X,
  Folder,
  FolderPlus,
  Save,
} from "lucide-react";

const DEFAULT_COLORS = [
  "#000000", "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#3b82f6", "#a855f7", "#ec4899", "#ffffff",
];
const DEFAULT_SIZES = [2, 4, 8, 16];
const SAVE_DEBOUNCE_MS = 600;
const CANVAS_W = 1200;
const CANVAS_H = 800;

type Tool = "pen" | "eraser";

export function Whiteboard() {
  const utils = trpc.useUtils();
  const subjectsQuery = trpc.whiteboard.listSubjects.useQuery();
  const [activeSubjectId, setActiveSubjectId] = useState<number | null>(null);
  const [activePageId, setActivePageId] = useState<number | null>(null);

  // Auto-pick the first subject when the list loads
  useEffect(() => {
    if (activeSubjectId === null && subjectsQuery.data && subjectsQuery.data.length > 0) {
      setActiveSubjectId(subjectsQuery.data[0].id);
    }
  }, [activeSubjectId, subjectsQuery.data]);

  const pagesQuery = trpc.whiteboard.listPages.useQuery(
    { subjectId: activeSubjectId ?? 0 },
    { enabled: activeSubjectId !== null },
  );

  // Auto-pick the first page when pages load for the current subject
  useEffect(() => {
    if (
      activeSubjectId !== null &&
      activePageId === null &&
      pagesQuery.data &&
      pagesQuery.data.length > 0
    ) {
      setActivePageId(pagesQuery.data[0].id);
    }
    // If the subject changes, clear the active page so we re-pick from the new subject's list
    if (activeSubjectId !== null && pagesQuery.data && pagesQuery.data.length === 0) {
      setActivePageId(null);
    }
  }, [activeSubjectId, activePageId, pagesQuery.data]);

  const createSubject = trpc.whiteboard.createSubject.useMutation({
    onSuccess: (s) => {
      utils.whiteboard.listSubjects.invalidate();
      setActiveSubjectId(s.id);
      setActivePageId(null);
    },
  });
  const deleteSubject = trpc.whiteboard.deleteSubject.useMutation({
    onSuccess: () => {
      utils.whiteboard.listSubjects.invalidate();
      setActiveSubjectId(null);
      setActivePageId(null);
    },
  });
  const createPage = trpc.whiteboard.createPage.useMutation({
    onSuccess: (p) => {
      utils.whiteboard.listPages.invalidate({ subjectId: p.subjectId });
      setActivePageId(p.id);
    },
  });
  const deletePage = trpc.whiteboard.deletePage.useMutation({
    onSuccess: () => {
      if (activeSubjectId !== null) {
        utils.whiteboard.listPages.invalidate({ subjectId: activeSubjectId });
      }
      setActivePageId(null);
    },
  });
  const updatePage = trpc.whiteboard.updatePage.useMutation();

  const handleNewSubject = async () => {
    const name = prompt("Subject name (e.g. Math, English, Reading list)?")?.trim();
    if (!name) return;
    await createSubject.mutateAsync({ name });
  };

  const handleDeleteSubject = async () => {
    if (activeSubjectId === null) return;
    const subj = subjectsQuery.data?.find((s) => s.id === activeSubjectId);
    if (!subj) return;
    if (!confirm(`Delete subject "${subj.name}" and all its ${subj.pageCount} page(s)?`)) return;
    await deleteSubject.mutateAsync({ id: activeSubjectId });
  };

  const handleNewPage = async () => {
    if (activeSubjectId === null) return;
    const title = prompt("Page title?")?.trim() || "Untitled";
    await createPage.mutateAsync({ subjectId: activeSubjectId, title });
  };

  const handleDeletePage = async () => {
    if (activePageId === null) return;
    if (!confirm("Delete this page? This cannot be undone.")) return;
    await deletePage.mutateAsync({ id: activePageId });
  };

  return (
    <div className="flex flex-1 min-h-0 bg-background text-foreground">
      {/* Left rail: subjects */}
      <div className="w-44 shrink-0 border-r border-border flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Subjects
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleNewSubject}
            title="New subject"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {(subjectsQuery.data ?? []).length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground italic">
              No subjects yet — create one to start.
            </p>
          ) : (
            (subjectsQuery.data ?? []).map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setActiveSubjectId(s.id);
                  setActivePageId(null);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-muted ${
                  s.id === activeSubjectId ? "bg-muted text-primary" : "text-foreground/85"
                }`}
              >
                <Folder className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 truncate">{s.name}</span>
                <span className="text-[10px] text-muted-foreground">{s.pageCount}</span>
              </button>
            ))
          )}
        </div>
        {activeSubjectId !== null && (
          <button
            className="px-3 py-2 text-[11px] text-muted-foreground hover:text-destructive border-t border-border text-left flex items-center gap-1"
            onClick={handleDeleteSubject}
          >
            <Trash2 className="w-3 h-3" /> Delete subject
          </button>
        )}
      </div>

      {/* Right side: pages + canvas */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top: page tabs */}
        <div className="flex items-center gap-1 px-2 py-1 border-b border-border overflow-x-auto">
          {(pagesQuery.data ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePageId(p.id)}
              className={`px-2 py-1 text-xs rounded shrink-0 ${
                p.id === activePageId
                  ? "bg-primary/15 text-primary"
                  : "hover:bg-muted text-muted-foreground"
              }`}
              title={p.title}
            >
              {p.title.slice(0, 24)}
            </button>
          ))}
          {activeSubjectId !== null && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 shrink-0"
              onClick={handleNewPage}
            >
              <Plus className="w-3 h-3" /> Page
            </Button>
          )}
        </div>

        {/* Canvas + tools */}
        {activeSubjectId === null ? (
          <EmptyState message="Pick or create a subject on the left." />
        ) : activePageId === null ? (
          <EmptyState message="No page selected. Click + Page to make one." />
        ) : (
          <CanvasArea
            pageId={activePageId}
            onUpdate={(imageData) =>
              updatePage.mutate({ id: activePageId, imageData })
            }
            onDelete={handleDeletePage}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <p className="text-xs text-muted-foreground italic text-center">{message}</p>
    </div>
  );
}

// ── Canvas area ─────────────────────────────────────────────────────────────

interface CanvasAreaProps {
  pageId: number;
  onUpdate: (imageData: string) => void;
  onDelete: () => void;
}

function CanvasArea({ pageId, onUpdate, onDelete }: CanvasAreaProps) {
  const { data: page } = trpc.whiteboard.getPage.useQuery({ id: pageId });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>("#000000");
  const [size, setSize] = useState<number>(4);

  // Load page imageData onto the canvas when the page changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !page) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = page.width;
    canvas.height = page.height;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (page.imageData) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = page.imageData;
    }
  }, [page]);

  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dataUrl = canvas.toDataURL("image/png");
      onUpdateRef.current(dataUrl);
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // Cleanup any pending save when unmounting
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = canvasCoords(canvas, e);
    drawDot(canvas, lastPointRef.current, color, size, tool);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !drawingRef.current || !lastPointRef.current) return;
    const next = canvasCoords(canvas, e);
    drawSegment(canvas, lastPointRef.current, next, color, size, tool);
    lastPointRef.current = next;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (drawingRef.current) {
      drawingRef.current = false;
      lastPointRef.current = null;
      debouncedSave();
    }
  };

  const handleClear = () => {
    if (!confirm("Clear this page? You can't undo.")) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    debouncedSave();
  };

  const handleSaveNow = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const canvas = canvasRef.current;
    if (!canvas) return;
    onUpdateRef.current(canvas.toDataURL("image/png"));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border flex-wrap">
        <div className="flex gap-1">
          <Button
            variant={tool === "pen" ? "default" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setTool("pen")}
            title="Pen"
          >
            <PencilLine className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant={tool === "eraser" ? "default" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setTool("eraser")}
            title="Eraser"
          >
            <Eraser className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex gap-0.5 items-center">
          {DEFAULT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => { setColor(c); setTool("pen"); }}
              className={`w-5 h-5 rounded-full border ${
                color === c && tool === "pen" ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "border-border"
              }`}
              style={{ background: c }}
              title={c}
            />
          ))}
          <Input
            type="color"
            value={color}
            onChange={(e) => { setColor(e.target.value); setTool("pen"); }}
            className="w-7 h-6 p-0 border-border cursor-pointer"
          />
        </div>

        <div className="flex gap-1 items-center">
          {DEFAULT_SIZES.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              className={`w-7 h-7 rounded flex items-center justify-center hover:bg-muted ${
                size === s ? "bg-muted ring-1 ring-primary" : ""
              }`}
              title={`${s}px`}
            >
              <span
                className="block rounded-full"
                style={{ width: s, height: s, background: "currentColor" }}
              />
            </button>
          ))}
        </div>

        <div className="ml-auto flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={handleSaveNow}
            title="Save now (auto-saves anyway, this just forces it)"
          >
            <Save className="w-3 h-3" /> Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1 text-amber-400"
            onClick={handleClear}
          >
            <Trash2 className="w-3 h-3" /> Clear
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1 text-destructive"
            onClick={onDelete}
          >
            <X className="w-3 h-3" /> Delete page
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-auto bg-muted/40 p-3">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="bg-white shadow border border-border touch-none cursor-crosshair max-w-full h-auto"
          style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
        />
      </div>
    </div>
  );
}

// ── Drawing helpers ─────────────────────────────────────────────────────────

function canvasCoords(canvas: HTMLCanvasElement, e: React.PointerEvent<HTMLCanvasElement>) {
  const rect = canvas.getBoundingClientRect();
  // Map CSS-pixel pointer position back to canvas-pixel coords (canvas is
  // displayed at a different size than its intrinsic resolution).
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function drawDot(
  canvas: HTMLCanvasElement,
  p: { x: number; y: number },
  color: string,
  size: number,
  tool: Tool,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.beginPath();
  ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = tool === "eraser" ? "#ffffff" : color;
  ctx.fill();
}

function drawSegment(
  canvas: HTMLCanvasElement,
  a: { x: number; y: number },
  b: { x: number; y: number },
  color: string,
  size: number,
  tool: Tool,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
  ctx.lineWidth = size;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
