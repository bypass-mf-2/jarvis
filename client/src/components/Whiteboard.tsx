/**
 * Whiteboard panel — drawn-notes UI lives in Home.tsx side panel.
 *
 * Two-level structure:
 *   Subjects (left rail) → Pages (top tabs) → Canvas (main area).
 *
 * Tools (v2):
 *   - Pen / Eraser — direct freehand drawing
 *   - Text         — click on canvas → input box → Enter commits text
 *   - Lasso        — encircle a region; releases as a draggable overlay
 *                    that pastes back on drop. Cut & move pattern.
 *   - Undo / Redo  — snapshot stack (30 states). Each completed action
 *                    pushes a state. Redo clears on any new edit.
 *   - Image import — drag-and-drop, Ctrl+V paste, or file-picker button
 *
 * Storage: each page is a base64 PNG dataURL in SQLite. Auto-saves
 * 600ms after the last action lands. Survives panel close + reopen.
 *
 * Bluetooth-from-phone (asked for but not feasible):
 *   - Web Bluetooth API doesn't support image transfer (BLE GATT only)
 *   - OS-level Bluetooth file transfer isn't browser-accessible
 *   - Real path: v17 mobile companion app, OR a QR-pair web page (future)
 *   - For now: drop an image, paste from clipboard, or file-pick instead
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
  Type,
  Lasso,
  Undo2,
  Redo2,
  Upload,
  MousePointer2,
  Copy,
  Send,
} from "lucide-react";

const DEFAULT_COLORS = [
  "#000000", "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#3b82f6", "#a855f7", "#ec4899", "#ffffff",
];
const DEFAULT_SIZES = [2, 4, 8, 16];
const SAVE_DEBOUNCE_MS = 600;
const CANVAS_W = 1200;
const CANVAS_H = 800;
const HISTORY_CAP = 30;

type Tool = "cursor" | "pen" | "eraser" | "text" | "lasso";

export function Whiteboard() {
  const utils = trpc.useUtils();
  const subjectsQuery = trpc.whiteboard.listSubjects.useQuery();
  const [activeSubjectId, setActiveSubjectId] = useState<number | null>(null);
  const [activePageId, setActivePageId] = useState<number | null>(null);

  useEffect(() => {
    if (activeSubjectId === null && subjectsQuery.data && subjectsQuery.data.length > 0) {
      setActiveSubjectId(subjectsQuery.data[0].id);
    }
  }, [activeSubjectId, subjectsQuery.data]);

  const pagesQuery = trpc.whiteboard.listPages.useQuery(
    { subjectId: activeSubjectId ?? 0 },
    { enabled: activeSubjectId !== null },
  );

  useEffect(() => {
    if (
      activeSubjectId !== null &&
      activePageId === null &&
      pagesQuery.data &&
      pagesQuery.data.length > 0
    ) {
      setActivePageId(pagesQuery.data[0].id);
    }
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
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleNewSubject} title="New subject">
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
                onClick={() => { setActiveSubjectId(s.id); setActivePageId(null); }}
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
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 shrink-0" onClick={handleNewPage}>
              <Plus className="w-3 h-3" /> Page
            </Button>
          )}
        </div>

        {activeSubjectId === null ? (
          <EmptyState message="Pick or create a subject on the left." />
        ) : activePageId === null ? (
          <EmptyState message="No page selected. Click + Page to make one." />
        ) : (
          <CanvasArea
            pageId={activePageId}
            onUpdate={(imageData) => updatePage.mutate({ id: activePageId, imageData })}
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

interface Point { x: number; y: number; }

interface Selection {
  /** PNG dataURL of the cut-out region (lasso shape, transparent outside). */
  imageDataUrl: string;
  /** Bounding rect in canvas coords. */
  bbox: { x: number; y: number; w: number; h: number };
  /** Current top-left in canvas coords (changes while dragging). */
  cur: { x: number; y: number };
}

function CanvasArea({ pageId, onUpdate, onDelete }: CanvasAreaProps) {
  const { data: page } = trpc.whiteboard.getPage.useQuery({ id: pageId });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const lassoPathRef = useRef<Point[]>([]);
  const draggingSelectionRef = useRef<{ startX: number; startY: number; selStartX: number; selStartY: number } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>("#000000");
  const [size, setSize] = useState<number>(4);

  // Undo/redo. Stored as PNG dataURLs. Capped to keep memory in check.
  const historyRef = useRef<string[]>([]);
  const futureRef = useRef<string[]>([]);
  const [, forceRender] = useState(0);
  const bumpRender = () => forceRender((n) => n + 1);

  // Active selection (lasso cutout). When set, an overlay is rendered.
  const [selection, setSelection] = useState<Selection | null>(null);
  // Pending text input. When non-null, an absolutely-positioned input shows.
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);

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
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        // Reset history when loading a different page so undo can't bleed
        historyRef.current = [page.imageData!];
        futureRef.current = [];
        bumpRender();
      };
      img.src = page.imageData;
    } else {
      historyRef.current = [snapshotCanvas(canvas)];
      futureRef.current = [];
      bumpRender();
    }
    // Drop any open selection / text input when switching pages
    setSelection(null);
    setTextInput(null);
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

  const pushHistory = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const snap = snapshotCanvas(canvas);
    historyRef.current.push(snap);
    if (historyRef.current.length > HISTORY_CAP) historyRef.current.shift();
    futureRef.current = []; // any new action invalidates redo
    bumpRender();
  }, []);

  const doUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (historyRef.current.length < 2) return; // first entry is the initial state
    const cur = historyRef.current.pop();
    if (cur) futureRef.current.push(cur);
    const prev = historyRef.current[historyRef.current.length - 1];
    if (prev) restoreCanvas(canvas, prev, () => { bumpRender(); debouncedSave(); });
  }, [debouncedSave]);

  const doRedo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push(next);
    restoreCanvas(canvas, next, () => { bumpRender(); debouncedSave(); });
  }, [debouncedSave]);

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textInput) return; // typing in text input — let it consume keys
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo(); else doUndo();
      } else if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo, textInput]);

  // Paste image from clipboard (Ctrl+V) — works for any image on clipboard,
  // including phone screenshots you copied via OS-native share.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            void importImageBlob(blob);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importImageBlob = useCallback(async (blob: Blob) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const url = URL.createObjectURL(blob);
    try {
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          // Fit the image into the canvas while preserving aspect ratio.
          // Center it. Caller can add lasso + move it after.
          const scale = Math.min(
            canvas.width / img.width,
            canvas.height / img.height,
            1, // never upscale
          );
          const w = img.width * scale;
          const h = img.height * scale;
          const dx = (canvas.width - w) / 2;
          const dy = (canvas.height - h) / 2;
          ctx.drawImage(img, dx, dy, w, h);
          resolve();
        };
        img.onerror = () => reject(new Error("decode failed"));
        img.src = url;
      });
      pushHistory();
      debouncedSave();
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [pushHistory, debouncedSave]);

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void importImageBlob(file);
    e.target.value = ""; // allow re-picking the same file later
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    void importImageBlob(file);
  };

  // ── Drawing handlers ──────────────────────────────────────────────────────

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Cursor mode: don't draw, don't capture pointer. Lets the user click
    // around the canvas (eventually scroll, click overlay buttons, etc.)
    // without leaving stray marks.
    if (tool === "cursor") return;

    canvas.setPointerCapture(e.pointerId);
    const p = canvasCoords(canvas, e);

    if (tool === "text") {
      setTextInput({ x: p.x, y: p.y, value: "" });
      return;
    }
    if (tool === "lasso") {
      // Starting a fresh lasso cancels any previous selection
      if (selection) commitSelectionToCanvas();
      lassoPathRef.current = [p];
      drawingRef.current = true;
      return;
    }
    drawingRef.current = true;
    lastPointRef.current = p;
    drawDot(canvas, p, color, size, tool);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!drawingRef.current) return;
    const next = canvasCoords(canvas, e);
    if (tool === "lasso") {
      lassoPathRef.current.push(next);
      // Redraw the dashed selection line live by overlaying on the
      // canvas — clear by re-applying the last committed snapshot, then
      // stroke the in-progress path.
      const last = historyRef.current[historyRef.current.length - 1];
      if (last) {
        restoreCanvas(canvas, last, () => drawLassoPath(canvas, lassoPathRef.current));
      }
      return;
    }
    if (tool === "pen" || tool === "eraser") {
      if (lastPointRef.current) drawSegment(canvas, lastPointRef.current, next, color, size, tool);
      lastPointRef.current = next;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (tool === "lasso") {
      finalizeLasso();
      return;
    }
    lastPointRef.current = null;
    pushHistory();
    debouncedSave();
  };

  // ── Lasso ─────────────────────────────────────────────────────────────────

  const finalizeLasso = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const path = lassoPathRef.current;
    lassoPathRef.current = [];
    if (path.length < 3) {
      // Too small a selection — just restore last snapshot, no-op
      const last = historyRef.current[historyRef.current.length - 1];
      if (last) restoreCanvas(canvas, last);
      return;
    }
    // Compute bounding rect
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of path) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    minX = Math.max(0, Math.floor(minX));
    minY = Math.max(0, Math.floor(minY));
    maxX = Math.min(canvas.width, Math.ceil(maxX));
    maxY = Math.min(canvas.height, Math.ceil(maxY));
    const w = maxX - minX;
    const h = maxY - minY;
    if (w < 3 || h < 3) {
      const last = historyRef.current[historyRef.current.length - 1];
      if (last) restoreCanvas(canvas, last);
      return;
    }

    // Restore the canvas first (we drew the dashed lasso on it during
    // pointer-move). Then read pixels.
    const last = historyRef.current[historyRef.current.length - 1];
    if (last) {
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        // Read the bounding rect's pixels and mask outside the lasso path
        const region = ctx.getImageData(minX, minY, w, h);
        const masked = maskImageData(region, path, minX, minY);

        // Paint over the lasso region on the source canvas (cut out)
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
        ctx.closePath();
        ctx.fill();

        // Convert masked pixels to a dataURL for the overlay
        const tmp = document.createElement("canvas");
        tmp.width = w;
        tmp.height = h;
        const tctx = tmp.getContext("2d");
        if (!tctx) return;
        tctx.putImageData(masked, 0, 0);
        const url = tmp.toDataURL("image/png");

        setSelection({
          imageDataUrl: url,
          bbox: { x: minX, y: minY, w, h },
          cur: { x: minX, y: minY },
        });
        // Don't push history yet — the move + drop is one undoable action
      };
      img.src = last;
    }
  };

  /**
   * Draw the selection back at its current position and clear the overlay
   * state. Pushes a single history entry for the whole move.
   */
  const commitSelectionToCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !selection) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, selection.cur.x, selection.cur.y);
      setSelection(null);
      pushHistory();
      debouncedSave();
    };
    img.src = selection.imageDataUrl;
  };

  // Drag handlers for the selection overlay
  const handleSelOverlayDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selection) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingSelectionRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      selStartX: selection.cur.x,
      selStartY: selection.cur.y,
    };
  };

  const handleSelOverlayMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = draggingSelectionRef.current;
    if (!drag || !selection) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const dx = (e.clientX - drag.startX) * scaleX;
    const dy = (e.clientY - drag.startY) * scaleY;
    setSelection({ ...selection, cur: { x: drag.selStartX + dx, y: drag.selStartY + dy } });
  };

  const handleSelOverlayUp = () => {
    draggingSelectionRef.current = null;
  };

  // ── Text tool ─────────────────────────────────────────────────────────────

  const commitTextInput = () => {
    if (!textInput) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setTextInput(null); return; }
    const text = textInput.value.trim();
    setTextInput(null);
    if (!text) return;
    // Font size: pen size has its own meaning; for text use a sensible
    // default linked to the size slider.
    const fontPx = Math.max(12, size * 4);
    ctx.font = `${fontPx}px system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.textBaseline = "top";
    // Wrap on newlines
    const lines = text.split("\n");
    lines.forEach((line, i) => ctx.fillText(line, textInput.x, textInput.y + i * fontPx * 1.15));
    pushHistory();
    debouncedSave();
  };

  // ── Misc actions ──────────────────────────────────────────────────────────

  const handleClear = () => {
    if (!confirm("Clear this page? You can't undo (well, you can with Ctrl+Z, until you switch pages).")) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    pushHistory();
    debouncedSave();
  };

  const handleSaveNow = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const canvas = canvasRef.current;
    if (!canvas) return;
    onUpdateRef.current(canvas.toDataURL("image/png"));
  };

  /** Copy the current page (or the active selection if any) as a PNG to the
   *  OS clipboard. Anything that accepts pasted images can receive it. */
  const handleCopy = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Prefer the selection cutout if there's an active one — feels more
    // intentional than copying the whole page.
    const sourceUrl = selection?.imageDataUrl ?? canvas.toDataURL("image/png");
    try {
      const blob = await (await fetch(sourceUrl)).blob();
      // ClipboardItem is the modern API; only PNG is universally supported.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ClipboardItemCtor = (window as any).ClipboardItem;
      if (!ClipboardItemCtor || !navigator.clipboard?.write) {
        throw new Error("Clipboard image API not available in this browser");
      }
      await navigator.clipboard.write([new ClipboardItemCtor({ "image/png": blob })]);
    } catch (err) {
      console.warn("[whiteboard] copy failed:", err);
      alert("Couldn't copy to clipboard. Browser may not support image clipboard. Use the Send-to-chat button or download instead.");
    }
  };

  /** Push the current page (or selection) to the JARVIS chat input as an
   *  attached image. Done via a CustomEvent that Home.tsx listens for so
   *  this component doesn't need to know about chat-input internals. */
  const handleSendToChat = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = selection?.imageDataUrl ?? canvas.toDataURL("image/png");
    // Also drop on the clipboard as a fallback — if the chat-side listener
    // isn't wired yet, the user can still Ctrl+V it into the chat input.
    try {
      const blob = await (await fetch(dataUrl)).blob();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ClipboardItemCtor = (window as any).ClipboardItem;
      if (ClipboardItemCtor && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItemCtor({ "image/png": blob })]);
      }
    } catch { /* clipboard is the fallback path; main path is the event */ }
    window.dispatchEvent(
      new CustomEvent("jarvis:whiteboard-to-chat", { detail: { dataUrl } }),
    );
  };

  /** Outbound drag — build a File on dragstart so any drop target accepting
   *  image MIME types (browsers' native chat inputs, file managers, etc.)
   *  receives a real png. */
  const handleCanvasDragStart = (e: React.DragEvent<HTMLCanvasElement>) => {
    if (tool !== "cursor") return; // only allow drag-out from cursor mode
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = selection?.imageDataUrl ?? canvas.toDataURL("image/png");
    e.dataTransfer.setData("text/uri-list", dataUrl);
    // dataTransfer.items.add(File) works in Chromium for cross-target image
    // drag, but is read-only on some browsers. We set a URL fallback above.
    try {
      const byteString = atob(dataUrl.split(",")[1]);
      const arr = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) arr[i] = byteString.charCodeAt(i);
      const file = new File([arr], "whiteboard.png", { type: "image/png" });
      e.dataTransfer.items.add(file);
    } catch { /* fall back to URL */ }
    e.dataTransfer.effectAllowed = "copy";
  };

  const canUndo = historyRef.current.length > 1;
  const canRedo = futureRef.current.length > 0;

  // Visual canvas-to-screen scale, used to position the text input + selection overlay
  const [canvasRect, setCanvasRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => setCanvasRect(canvas.getBoundingClientRect()));
    ro.observe(canvas);
    setCanvasRect(canvas.getBoundingClientRect());
    return () => ro.disconnect();
  }, []);
  const screenScaleX = canvasRect ? canvasRect.width / CANVAS_W : 1;
  const screenScaleY = canvasRect ? canvasRect.height / CANVAS_H : 1;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border flex-wrap">
        {/* Tools */}
        <div className="flex gap-1">
          <Button variant={tool === "cursor" ? "default" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setTool("cursor")} title="Mouse — no drawing, click around freely">
            <MousePointer2 className="w-3.5 h-3.5" />
          </Button>
          <Button variant={tool === "pen" ? "default" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setTool("pen")} title="Pen">
            <PencilLine className="w-3.5 h-3.5" />
          </Button>
          <Button variant={tool === "eraser" ? "default" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setTool("eraser")} title="Eraser">
            <Eraser className="w-3.5 h-3.5" />
          </Button>
          <Button variant={tool === "text" ? "default" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setTool("text")} title="Text — click to place">
            <Type className="w-3.5 h-3.5" />
          </Button>
          <Button variant={tool === "lasso" ? "default" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setTool("lasso")} title="Lasso — encircle to select + move">
            <Lasso className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Undo / redo */}
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={doUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            <Undo2 className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={doRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Colors */}
        <div className="flex gap-0.5 items-center">
          {DEFAULT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => { setColor(c); if (tool === "eraser" || tool === "lasso") setTool("pen"); }}
              className={`w-5 h-5 rounded-full border ${
                color === c && (tool === "pen" || tool === "text") ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "border-border"
              }`}
              style={{ background: c }}
              title={c}
            />
          ))}
          <Input
            type="color"
            value={color}
            onChange={(e) => { setColor(e.target.value); if (tool === "eraser" || tool === "lasso") setTool("pen"); }}
            className="w-7 h-6 p-0 border-border cursor-pointer"
          />
        </div>

        {/* Sizes */}
        <div className="flex gap-1 items-center">
          {DEFAULT_SIZES.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              className={`w-7 h-7 rounded flex items-center justify-center hover:bg-muted ${size === s ? "bg-muted ring-1 ring-primary" : ""}`}
              title={tool === "text" ? `${s * 4}px text` : `${s}px stroke`}
            >
              <span className="block rounded-full" style={{ width: s, height: s, background: "currentColor" }} />
            </button>
          ))}
        </div>

        {/* Image import */}
        <label className="cursor-pointer">
          <input type="file" accept="image/*" className="hidden" onChange={handleFileImport} />
          <span className="inline-flex items-center gap-1 h-7 px-2 text-xs rounded hover:bg-muted text-muted-foreground" title="Import image (or drag-and-drop, or Ctrl+V paste)">
            <Upload className="w-3 h-3" /> Image
          </span>
        </label>

        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleCopy} title={selection ? "Copy selection to clipboard" : "Copy page to clipboard (paste anywhere)"}>
            <Copy className="w-3 h-3" /> Copy
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-primary" onClick={handleSendToChat} title="Send to JARVIS chat as an image attachment">
            <Send className="w-3 h-3" /> To chat
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleSaveNow} title="Force save (auto-saves anyway)">
            <Save className="w-3 h-3" /> Save
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-amber-400" onClick={handleClear}>
            <Trash2 className="w-3 h-3" /> Clear
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-destructive" onClick={onDelete}>
            <X className="w-3 h-3" /> Delete page
          </Button>
        </div>
      </div>

      {/* Canvas + overlays */}
      <div
        className="flex-1 overflow-auto bg-muted/40 p-3 relative"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <div className="relative inline-block">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            draggable={tool === "cursor"}
            onDragStart={handleCanvasDragStart}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className={`bg-white shadow border border-border touch-none max-w-full h-auto ${
              tool === "cursor" ? "cursor-grab active:cursor-grabbing" :
              tool === "text" ? "cursor-text" :
              "cursor-crosshair"
            }`}
            style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
          />

          {/* Text input overlay — positioned in screen coords */}
          {textInput && (
            <textarea
              autoFocus
              value={textInput.value}
              onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); setTextInput(null); }
                else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitTextInput(); }
              }}
              onBlur={() => commitTextInput()}
              placeholder="Type text — Enter to commit, Shift+Enter for newline, Esc to cancel"
              className="absolute resize border border-primary/60 bg-white/95 text-black p-1 outline-none"
              style={{
                left: textInput.x * screenScaleX,
                top: textInput.y * screenScaleY,
                fontSize: Math.max(12, size * 4) * screenScaleY,
                color,
                minWidth: 120,
                minHeight: Math.max(20, size * 4 * 1.5 * screenScaleY),
              }}
            />
          )}

          {/* Selection (lasso cutout) overlay — draggable */}
          {selection && (
            <>
              <img
                src={selection.imageDataUrl}
                draggable={false}
                onPointerDown={handleSelOverlayDown}
                onPointerMove={handleSelOverlayMove}
                onPointerUp={handleSelOverlayUp}
                onPointerCancel={handleSelOverlayUp}
                className="absolute cursor-move outline outline-2 outline-primary/70 outline-dashed"
                style={{
                  left: selection.cur.x * screenScaleX,
                  top: selection.cur.y * screenScaleY,
                  width: selection.bbox.w * screenScaleX,
                  height: selection.bbox.h * screenScaleY,
                  touchAction: "none",
                }}
              />
              <div
                className="absolute flex gap-1 bg-background/95 border border-border rounded shadow px-1 py-0.5"
                style={{
                  left: selection.cur.x * screenScaleX,
                  top: (selection.cur.y - 30) * screenScaleY,
                }}
              >
                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={commitSelectionToCanvas}>
                  Drop here
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive" onClick={() => setSelection(null)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function canvasCoords(canvas: HTMLCanvasElement, e: React.PointerEvent<HTMLCanvasElement>): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function drawDot(canvas: HTMLCanvasElement, p: Point, color: string, size: number, tool: Tool): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.beginPath();
  ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = tool === "eraser" ? "#ffffff" : color;
  ctx.fill();
}

function drawSegment(canvas: HTMLCanvasElement, a: Point, b: Point, color: string, size: number, tool: Tool): void {
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

function drawLassoPath(canvas: HTMLCanvasElement, path: Point[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || path.length < 2) return;
  ctx.save();
  ctx.strokeStyle = "rgba(59, 130, 246, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();
  ctx.restore();
}

function snapshotCanvas(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

function restoreCanvas(canvas: HTMLCanvasElement, dataUrl: string, onLoad?: () => void): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = new Image();
  img.onload = () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    if (onLoad) onLoad();
  };
  img.src = dataUrl;
}

/** Mask pixels outside the polygon to fully transparent, leaving inside pixels unchanged. */
function maskImageData(
  imageData: ImageData,
  path: Point[],
  offsetX: number,
  offsetY: number,
): ImageData {
  const out = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
  const data = out.data;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      if (!pointInPolygon(x + offsetX, y + offsetY, path)) {
        const i = (y * out.width + x) * 4;
        data[i + 3] = 0; // alpha = 0
      }
    }
  }
  return out;
}

function pointInPolygon(x: number, y: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
