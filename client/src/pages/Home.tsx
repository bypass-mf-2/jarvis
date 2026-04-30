import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import {
  Send, Mic, MicOff, Volume2, VolumeX, Plus, Trash2,
  Brain, Globe, Zap, ChevronLeft, ChevronRight,
  MessageSquare, Database, Rss, Settings, Activity,
  RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle,
  Bot, User, Loader2, StopCircle,
  Upload, BarChart3, PenLine, Compass, Waypoints, Power, ImagePlus,
  FolderPlus, Folder, FolderOpen, ChevronDown, GripVertical, NotebookPen,
  CircleDot, Square, Lightbulb, ChevronUp, BookOpen, Sparkles, Gauge, Play,
  Github, Palette
} from "lucide-react";
import { FileUploadPanel } from "@/components/FileUploadPanel";
import { MessageRating, MessageCorrection, TrainingDashboard } from "@/components/TrainingComponents";
import { Whiteboard } from "@/components/Whiteboard";

// ── Types ─────────────────────────────────────────────────────────────────────
type Message = {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
  ragChunksUsed?: {
    id: string;
    source: string;
    url?: string | null;
    title?: string | null;
    sourceType?: string | null;
    distance: number;
  }[] | null;
  userRating?: number | null;
};

type Conversation = {
  id: number;
  title: string | null;
  model: string | null;
  createdAt: Date;
};

type SidePanel = "chat" | "knowledge" | "scraper" | "github" | "improvement" | "logs" | "upload" | "training" | "benchmarks" | "notes" | "whiteboard";

// ── AI Landscape Reference Data ───────────────────────────────────────────────
// Public benchmark scores (MMLU, approximate published values).
// Update these when new model results are released.
const AI_LANDSCAPE: { name: string; mmlu: number; humanEval: number }[] = [
  { name: "Claude Sonnet 4.5", mmlu: 88, humanEval: 92 },
  { name: "Claude Opus 4.6",   mmlu: 90, humanEval: 94 },
  { name: "GPT-4o",            mmlu: 88, humanEval: 90 },
  { name: "Gemini 2.5 Pro",    mmlu: 86, humanEval: 87 },
  { name: "Llama 3.1 70B",     mmlu: 83, humanEval: 80 },
];

// ── Status Dot ────────────────────────────────────────────────────────────────
function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${ok ? "bg-emerald-400" : "bg-red-500"}`}
      style={ok ? { boxShadow: "0 0 6px #34d399" } : {}}
    />
  );
}

// Parse GitHub repo input — accepts:
//   vercel/next.js
//   https://github.com/vercel/next.js
//   https://github.com/vercel/next.js/
//   https://github.com/vercel/next.js.git
//   github.com/vercel/next.js
//   git@github.com:vercel/next.js.git
//   https://github.com/vercel/next.js/tree/canary/packages
// Returns null if the input clearly isn't a repo reference yet (so the
// caller falls back to setting just the field the user is typing into).
function parseGithubInput(raw: string): { owner: string; repo: string } | null {
  if (!raw) return null;
  let s = raw.trim();
  // SSH form
  s = s.replace(/^git@github\.com:/i, "");
  // Strip protocol + host
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, "");
  s = s.replace(/^github\.com\//i, "");
  // Strip .git suffix and trailing slash
  s = s.replace(/\.git$/i, "").replace(/\/$/, "");
  if (!s.includes("/")) return null;
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1];
  // Crude validity guard — owner/repo can't have whitespace or dots-only
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return { owner, repo };
}

// ── Offline Mode Banner ───────────────────────────────────────────────────────
// Shows across the top of the main chat area when offline mode is toggled on
// so the user always knows which capabilities are deliberately disabled.
function OfflineModeBanner() {
  const { data: settings } = trpc.meta.settings.useQuery(undefined, {
    refetchInterval: 10000,
  });
  if (!settings?.offlineMode) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-amber-500/40 bg-amber-500/10 text-xs text-amber-400">
      <Zap className="w-3 h-3" />
      <span className="font-semibold">Offline mode</span>
      <span className="opacity-80">
        — scraper, source discovery, web search, Navigator, remote APIs disabled. Chat, RAG, book writer, benchmarks still work.
      </span>
    </div>
  );
}

// ── Meta Cognition Popover ────────────────────────────────────────────────────
function MetaCognitionPopover() {
  const { data: settings, refetch: refetchSettings } = trpc.meta.settings.useQuery(
    undefined,
    { refetchInterval: 30000 }
  );
  const { data: autonomy, refetch: refetchAutonomy } = trpc.meta.autonomyStatus.useQuery(
    undefined,
    { refetchInterval: 15000 }
  );
  const { data: stats, refetch: refetchStats } = trpc.meta.confidenceStats.useQuery(
    { windowHours: 168 },
    { refetchInterval: 60000 }
  );

  const setThresholdMut = trpc.meta.setConfidenceThreshold.useMutation({
    onSuccess: (data) => {
      console.log("[meta] threshold updated →", data.value);
      refetchSettings();
      toast.success("Threshold updated");
    },
    onError: (e) => { console.warn("[meta] threshold update failed:", e.message); toast.error(e.message); },
  });
  const setAutonomyMut = trpc.meta.setAutonomyEnabled.useMutation({
    onSuccess: (data) => {
      console.log("[meta] autonomy →", data.enabled ? "on" : "off");
      refetchSettings();
      refetchAutonomy();
    },
    onError: (e) => { console.warn("[meta] autonomy toggle failed:", e.message); toast.error(e.message); },
  });
  const setOfflineMut = trpc.meta.setOfflineMode.useMutation({
    onSuccess: (data) => {
      console.log("[meta] offline mode →", data.enabled ? "on" : "off");
      refetchSettings();
      toast.success(data.enabled ? "Offline mode ON — network features disabled" : "Offline mode OFF — full access");
    },
    onError: (e) => { console.warn("[meta] offline toggle failed:", e.message); toast.error(e.message); },
  });
  const runTickMut = trpc.meta.runAutonomyTick.useMutation({
    onSuccess: (data) => {
      console.log("[meta] tick fired →", data);
      refetchAutonomy();
      refetchStats();
      toast.success("Tick fired");
    },
    onError: (e) => { console.warn("[meta] tick failed:", e.message); toast.error(e.message); },
  });

  // Local slider state so the user can drag without firing a mutation on every pixel.
  const [draftThreshold, setDraftThreshold] = useState<number | null>(null);
  const currentThreshold = draftThreshold ?? settings?.confidenceThreshold ?? 0.85;
  const thresholdPct = Math.round(currentThreshold * 100);

  const autonomyEnabled = Boolean(settings?.autonomyEnabled);
  const lastTickMs = autonomy?.lastTick ?? 0;
  const lastTickAgo = lastTickMs ? Math.floor((Date.now() - lastTickMs) / 1000) : 0;
  const lastTickText = !lastTickMs
    ? "never"
    : lastTickAgo < 60
      ? `${lastTickAgo}s ago`
      : lastTickAgo < 3600
        ? `${Math.floor(lastTickAgo / 60)}m ago`
        : `${Math.floor(lastTickAgo / 3600)}h ago`;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
              <Gauge className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Meta cognition</TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" className="w-80" align="end">
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">Confidence threshold</span>
              <span className="font-mono text-sm text-primary">{thresholdPct}%</span>
            </div>
            <Slider
              value={[currentThreshold * 100]}
              min={20}
              max={99}
              step={1}
              onValueChange={(v) => setDraftThreshold(v[0] / 100)}
              onValueCommit={(v) => {
                setThresholdMut.mutate({ value: v[0] / 100 });
                setDraftThreshold(null);
              }}
            />
            <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
              JARVIS refuses to answer below this score and queues research instead.
            </p>
          </div>

          <Separator />

          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Autonomy</span>
              <Switch
                checked={autonomyEnabled}
                onCheckedChange={(v) => setAutonomyMut.mutate({ enabled: v })}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
              When on, acts on its own every 5 min — researches high-priority learning targets, flags stale goals.
            </p>
            <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Last tick: {lastTickText}</span>
              <span>
                Today: {autonomy?.actionsToday ?? 0} / {autonomy?.maxActionsPerDay ?? 12}
              </span>
            </div>
            {autonomy?.lastAction && (
              <div className="mt-1 text-[10px] text-muted-foreground truncate">
                {autonomy.lastAction.kind}: {autonomy.lastAction.detail}
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-xs mt-2"
              onClick={() => runTickMut.mutate()}
              disabled={runTickMut.isPending}
            >
              <Play className="w-3 h-3 mr-1" />
              Run tick now
            </Button>
          </div>

          <Separator />

          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Offline mode</span>
              <Switch
                checked={Boolean(settings?.offlineMode)}
                onCheckedChange={(v) => setOfflineMut.mutate({ enabled: v })}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
              Disables scraper, source discovery, web search, Navigator, media ingest, and all remote APIs. Core chat + RAG + book writer + benchmarks keep working on local data.
            </p>
          </div>

          <Separator />

          <div>
            <div className="text-sm font-medium mb-1">Last 7 days</div>
            {stats && stats.totalLowConfidence > 0 ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Refusals</span>
                  <span className="font-mono text-foreground">{stats.refusals}</span>
                </div>
                <div className="flex justify-between">
                  <span>Low-confidence replies</span>
                  <span className="font-mono text-foreground">{stats.totalLowConfidence}</span>
                </div>
                <div className="flex justify-between">
                  <span>Avg low score</span>
                  <span className="font-mono text-foreground">{(stats.avgLowScore * 100).toFixed(0)}%</span>
                </div>
                {stats.topReasons[0] && (
                  <div className="pt-1">
                    <div className="text-[10px] uppercase tracking-wide opacity-60">Top reason</div>
                    <div className="text-foreground text-[11px] truncate">{stats.topReasons[0].reason}</div>
                  </div>
                )}
                {stats.topTopics[0] && (
                  <div className="pt-1">
                    <div className="text-[10px] uppercase tracking-wide opacity-60">Most researched</div>
                    <div className="text-foreground text-[11px] truncate">{stats.topTopics[0].topic}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                No low-confidence events recorded.
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Home() {
  // State
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [sidePanel, setSidePanel] = useState<SidePanel>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [streamedResponse, setStreamedResponse] = useState("");
  const [newSourceForm, setNewSourceForm] = useState({ name: "", url: "", type: "rss" as "rss" | "news" | "custom_url" });
  const [newRepoForm, setNewRepoForm] = useState({ owner: "", repo: "", branch: "" });
  const [improvementTab, setImprovementTab] = useState<"evaluation" | "patches">("evaluation");
  // Reasoning state: per-message thinking, and a global "force reasoning" toggle
  const [reasoningByMessageId, setReasoningByMessageId] = useState<Record<number, { thinking: string; used: boolean }>>({});

  // Meta-cognition: per-message confidence info captured from the chat response.
  // In-memory only — clears on reload. Message itself is persisted; this is the
  // scoring metadata attached to the live reply.
  type ConfidenceInfo = {
    score: number;
    action: "ship" | "refuse";
    threshold: number;
    intent: "factual" | "creative";
    reasons: string[];
    topic?: string;
    retriedForConfidence?: boolean;
  };
  const [confidenceByMessageId, setConfidenceByMessageId] = useState<Record<number, ConfidenceInfo>>({});
  const [forceReasoning, setForceReasoning] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<Set<number>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set());
  const [draggingConvId, setDraggingConvId] = useState<number | null>(null);

  // ── Creativity slider (0-10, maps server-side to temperature 0.0-1.5) ──
  const [creativity, setCreativity] = useState(5);
  const creativityQuery = trpc.llm.getCreativity.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const setCreativityMutation = trpc.llm.setCreativity.useMutation();
  useEffect(() => {
    if (creativityQuery.data) setCreativity(creativityQuery.data.value);
  }, [creativityQuery.data]);

  // ── Resizable panel widths ──────────────────────────────────────────────
  const [leftWidth, setLeftWidth] = useState(() => {
    const saved = localStorage.getItem("jarvis-left-width");
    return saved ? parseInt(saved) : 256;
  });
  const [rightWidth, setRightWidth] = useState(() => {
    const saved = localStorage.getItem("jarvis-right-width");
    return saved ? parseInt(saved) : 320;
  });
  const resizingRef = useRef<"left" | "right" | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      e.preventDefault();
      const delta = e.clientX - startXRef.current;
      if (resizingRef.current === "left") {
        const newW = Math.max(180, Math.min(480, startWidthRef.current + delta));
        setLeftWidth(newW);
        localStorage.setItem("jarvis-left-width", String(newW));
      } else {
        // Right panel: dragging left = wider
        const newW = Math.max(240, Math.min(600, startWidthRef.current - delta));
        setRightWidth(newW);
        localStorage.setItem("jarvis-right-width", String(newW));
      }
    };
    const onMouseUp = () => { resizingRef.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
  }, []);

  // ── Notes Recording ─────────────────────────────────────────────────────
  const [notesRecording, setNotesRecording] = useState(false);
  const [notesTranscript, setNotesTranscript] = useState("");
  const [notesSummary, setNotesSummary] = useState("");
  const [notesSummarizing, setNotesSummarizing] = useState(false);
  const notesRecorderRef = useRef<MediaRecorder | null>(null);
  // Stream is held across chunks so we're not re-requesting mic every cycle.
  const notesStreamRef = useRef<MediaStream | null>(null);
  // "Still active" flag read inside onstop to decide whether to start the next chunk.
  const notesActiveRef = useRef<boolean>(false);

  // Live enrichment: per-session id (regenerated each recording), list of
  // enrichment cards, pinned ids (subset included in the final summary), and
  // an opt-in toggle so the feature doesn't hit the LLM/retriever without
  // the user asking for it.
  type NoteEnrichment = {
    id: string;
    topic: string;
    type: "factoid" | "definition" | "warning" | "related";
    content: string;
    sourceTitle: string | null;
    sourceUrl: string | null;
    confidence: number;
    createdAt: number;
  };
  const [notesEnrichmentEnabled, setNotesEnrichmentEnabled] = useState(false);
  const [noteEnrichments, setNoteEnrichments] = useState<NoteEnrichment[]>([]);
  const [pinnedEnrichmentIds, setPinnedEnrichmentIds] = useState<Set<string>>(new Set());
  const notesSessionIdRef = useRef<string>("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const synth = useRef<SpeechSynthesis | null>(null);
  const isSendingRef = useRef(false);
  const sendAbortRef = useRef<AbortController | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Edit mode state: per-message draft content
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  // Track which messages have been played / are loading TTS audio
  const [playingMessageId, setPlayingMessageId] = useState<number | null>(null);
  const [ttsLoadingId, setTtsLoadingId] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") synth.current = window.speechSynthesis;
  }, []);

  // When the Benchmarks panel becomes active, force an immediate refetch of
  // all its inputs so the bars and rates reflect the current state instantly
  // instead of waiting for the next interval tick.
  useEffect(() => {
    if (sidePanel === "benchmarks") {
      refetchStatus();
      refetchConvs();
      refetchRates();
    }
  }, [sidePanel]);

  // ── Queries ─────────────────────────────────────────────────────────────────
  const { data: conversations, refetch: refetchConvs } = trpc.chat.listConversations.useQuery();
  const { data: folders, refetch: refetchFolders } = trpc.chat.listFolders.useQuery();
  const { data: convData, refetch: refetchMessages } = trpc.chat.getConversation.useQuery(
    { id: activeConvId! },
    { enabled: !!activeConvId }
  );
  // All messages including inactive branches — used for branch navigation UI
  const { data: allMessages, refetch: refetchAllMessages } = trpc.chat.getAllMessages.useQuery(
    { conversationId: activeConvId! },
    { enabled: !!activeConvId }
  );
  // Tighten refresh while the Benchmarks panel is open so the bars feel
  // live; otherwise default to the cheaper 30s interval to avoid hammering
  // the backend when no one is looking at the stats.
  const { data: status, refetch: refetchStatus } = trpc.systemStatus.status.useQuery(
    undefined,
    { refetchInterval: sidePanel === "benchmarks" ? 10000 : 30000 }
  );
  // Activity rates — only fetched while the Benchmarks panel is open since
  // it's the only consumer. Same 10s refresh cadence as the rest of the panel.
  // Tracks isLoading + isError so the UI can distinguish "loading", "endpoint
  // missing/server stale", and "actual zero" instead of silently showing 0.
  const {
    data: rates,
    refetch: refetchRates,
    isLoading: ratesLoading,
    isError: ratesError,
  } = trpc.systemStatus.rates.useQuery(
    undefined,
    { enabled: sidePanel === "benchmarks", refetchInterval: 10000, retry: 1 }
  );
  const { data: knowledgeData, refetch: refetchKnowledge } = trpc.knowledge.list.useQuery(
    { limit: 30, offset: 0 },
    { enabled: sidePanel === "knowledge" }
  );
  const { data: scraperSources, refetch: refetchSources } = trpc.scraper.listSources.useQuery();
  const { data: patches, refetch: refetchPatches } = trpc.selfImprovement.listPatches.useQuery(
    undefined,
    { enabled: sidePanel === "improvement" }
  );
  const { data: evalPlan, refetch: refetchEvalPlan } = trpc.selfImprovement.getPlan.useQuery(
    undefined,
    { enabled: sidePanel === "improvement", refetchInterval: sidePanel === "improvement" ? 4000 : false }
  );
  const { data: logsData } = trpc.systemStatus.logs.useQuery(
    { limit: 50 },
    { enabled: sidePanel === "logs", refetchInterval: 10000 }
  );

  // ── Mutations ────────────────────────────────────────────────────────────────
  const createConv = trpc.chat.createConversation.useMutation({
    onSuccess: (conv) => {
      refetchConvs();
      if (conv) setActiveConvId(conv.id);
    },
  });

  const [lastFailedMessage, setLastFailedMessage] = useState<{ conversationId: number; content: string } | null>(null);

  const sendMessage = trpc.chat.sendMessage.useMutation({
    onSuccess: () => {
      refetchMessages();
      refetchConvs();
      setIsSending(false);
      setLastFailedMessage(null);
    },
    onError: (err) => {
      toast.error(`Error: ${err.message}`);
      setIsSending(false);
    },
  });

  const deleteConv = trpc.chat.deleteConversation.useMutation({
    onSuccess: () => {
      refetchConvs();
      setActiveConvId(null);
    },
  });

  // Message edit/retry/delete mutations
  const editMessageMut = trpc.chat.editMessage.useMutation({
    onSuccess: () => { toast.success("Edited"); refetchMessages(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMessageMut = trpc.chat.deleteMessage.useMutation({
    onSuccess: () => refetchMessages(),
  });
  const regenerateReplyMut = trpc.chat.regenerateReply.useMutation({
    onSuccess: (data: any) => {
      setIsSending(false);
      if (data?.thinking && data?.message?.id) {
        setReasoningByMessageId((prev) => ({
          ...prev,
          [data.message.id]: { thinking: data.thinking, used: Boolean(data.usedReasoning) },
        }));
      }
      if (data?.confidence && data?.message?.id) {
        const c = data.confidence as any;
        console.log(
          `[meta] confidence msg#${data.message.id}: ${(c.score * 100).toFixed(0)}% ${c.action} (${c.intent ?? "factual"})`,
          { reasons: c.reasons, signals: c.signals, retried: c.retriedForConfidence }
        );
        setConfidenceByMessageId((prev) => ({
          ...prev,
          [data.message.id]: {
            score: c.score,
            action: c.action,
            threshold: c.threshold,
            intent: c.intent ?? "factual",
            reasons: c.reasons ?? [],
            topic: c.topic,
            retriedForConfidence: c.retriedForConfidence,
          },
        }));
      }
      refetchMessages();
      refetchAllMessages();
    },
    onError: (e) => { setIsSending(false); toast.error(e.message); },
  });

  const retryMut = trpc.chat.retryFromMessage.useMutation({
    onSuccess: (r: any) => {
      // After deactivating the old branch:
      //   - pure retry: regenerateReply for the original user message
      //   - edit+retry: regenerateReply for the new user message (returned as newUserMessageId)
      const userMessageId = r.newUserMessageId ?? null;
      setIsSending(true);
      if (userMessageId) {
        regenerateReplyMut.mutate({ userMessageId, forceReasoning });
      } else {
        // Pure retry case — we need the original messageId from the click context.
        // We pass it through via the mutate args in the retry handler below.
      }
      refetchMessages();
    },
    onError: (e) => toast.error(e.message),
  });

  // Branch switching
  const switchBranchMut = trpc.chat.switchBranch.useMutation({
    onSuccess: () => { refetchMessages(); refetchAllMessages(); },
    onError: (e) => toast.error(e.message),
  });

  // Token stats
  const { data: tokenStats } = trpc.chat.tokenStats.useQuery(
    activeConvId ? { conversationId: activeConvId } : {},
    { refetchInterval: 10000 }
  );

  const stopGeneration = () => {
    // Abort the in-flight chat request
    sendAbortRef.current?.abort();
    sendAbortRef.current = null;
    setIsSending(false);
    stopSpeaking();
    toast.info("Generation stopped");
  };

  const handleEditMessage = (messageId: number, currentContent: string) => {
    setEditingMessageId(messageId);
    setEditDraft(currentContent);
  };

  const handleSaveEdit = async (messageId: number, role: "user" | "assistant") => {
    const newContent = editDraft.trim();
    if (!newContent) { setEditingMessageId(null); return; }
    setEditingMessageId(null);
    if (role === "user") {
      // Edit + regenerate → server creates new user sibling, then regenerateReply
      retryMut.mutate({ messageId, editedContent: newContent });
    } else {
      // Just update assistant message in place
      editMessageMut.mutate({ messageId, newContent });
    }
  };

  const handleRetryUserMessage = async (messageId: number) => {
    // Pure retry: deactivate old assistant subtree, then regenerate
    try {
      await retryMut.mutateAsync({ messageId });
      // After retryMut completes, the old subtree is deactivated and we need
      // to regenerate a reply to the same user message
      setIsSending(true);
      regenerateReplyMut.mutate({ userMessageId: messageId, forceReasoning });
    } catch (e) { /* toast already shown */ }
  };

  const createFolderMut = trpc.chat.createFolder.useMutation({
    onSuccess: () => { refetchFolders(); toast.success("Folder created"); },
  });
  const deleteFolderMut = trpc.chat.deleteFolder.useMutation({
    onSuccess: () => { refetchFolders(); refetchConvs(); },
  });
  const moveToFolder = trpc.chat.moveToFolder.useMutation({
    onSuccess: () => refetchConvs(),
  });

  const addSource = trpc.scraper.addSource.useMutation({
    onSuccess: () => { refetchSources(); setNewSourceForm({ name: "", url: "", type: "rss" }); toast.success("Source added"); },
    onError: (e) => toast.error(e.message),
  });

  const toggleSource = trpc.scraper.toggleSource.useMutation({ onSuccess: () => refetchSources() });
  const deleteSource = trpc.scraper.deleteSource.useMutation({ onSuccess: () => refetchSources() });
  const scrapeNow = trpc.scraper.scrapeNow.useMutation({
    onSuccess: () => { toast.success("Scrape triggered"); refetchSources(); },
    onError: (e) => toast.error(e.message),
  });

  const seedSources = trpc.scraper.seedSources.useMutation({
    onSuccess: (r) => { toast.success(`Seeded ${r.seeded} sources${r.scraped ? " and ran initial scrape" : ""}`); refetchSources(); refetchKnowledge(); refetchStatus(); },
    onError: (e) => toast.error(e.message),
  });

  // ── GitHub Repo Scraper ────────────────────────────────────────────────
  const { data: githubRepos, refetch: refetchGithubRepos } = trpc.githubRepo.list.useQuery(
    undefined,
    { enabled: sidePanel === "github", refetchInterval: sidePanel === "github" ? 10000 : false },
  );
  const { data: githubStats, refetch: refetchGithubStats } = trpc.githubRepo.stats.useQuery(
    undefined,
    { enabled: sidePanel === "github", refetchInterval: sidePanel === "github" ? 10000 : false },
  );
  const addGithubRepo = trpc.githubRepo.add.useMutation({
    onSuccess: () => {
      refetchGithubRepos();
      refetchGithubStats();
      setNewRepoForm({ owner: "", repo: "", branch: "" });
      toast.success("Repo added to watchlist");
    },
    onError: (e) => toast.error(e.message),
  });
  const removeGithubRepo = trpc.githubRepo.remove.useMutation({
    onSuccess: () => { refetchGithubRepos(); refetchGithubStats(); },
  });
  const toggleGithubRepo = trpc.githubRepo.toggle.useMutation({
    onSuccess: () => refetchGithubRepos(),
  });
  const runGithubScraper = trpc.githubRepo.runNow.useMutation({
    onSuccess: (r) => {
      if (r.ran) {
        toast.success(`Scraped ${r.repos?.length ?? 0} repos`);
      } else {
        toast.info(`Skipped: ${r.reason}`);
      }
      refetchGithubRepos();
      refetchGithubStats();
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: scraperEnabledData, refetch: refetchScraperEnabled } = trpc.scraper.getEnabled.useQuery();
  const scraperEnabled = scraperEnabledData?.enabled ?? true;
  const setScraperEnabled = trpc.scraper.setEnabled.useMutation({
    onSuccess: (r) => {
      toast.success(r.enabled ? "Scraping resumed" : "Scraping paused");
      refetchScraperEnabled();
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: mediaEnabledData, refetch: refetchMediaEnabled } = trpc.media.getEnabled.useQuery();
  const mediaEnabled = mediaEnabledData?.enabled ?? false;
  const setMediaEnabled = trpc.media.setEnabled.useMutation({
    onSuccess: (r) => {
      toast.success(r.enabled ? "Media ingestion enabled" : "Media ingestion paused");
      refetchMediaEnabled();
    },
    onError: (e) => toast.error(e.message),
  });

  const runAnalysis = trpc.selfImprovement.runAnalysis.useMutation({
    onSuccess: () => { toast.success("Analysis complete"); refetchPatches(); },
    onError: (e) => toast.error(e.message),
  });

  const patchAction = trpc.selfImprovement.approveOrRejectPatch.useMutation({
    onSuccess: () => refetchPatches(),
  });

  const applyPatch = trpc.selfImprovement.applyPatch.useMutation({
    onSuccess: (r) => { toast.success((r as any).message ?? "Patch applied"); refetchPatches(); },
    onError: (e) => toast.error(e.message),
  });

  const startEvaluation = trpc.selfImprovement.startEvaluation.useMutation({
    onSuccess: () => { toast.success("Knowledge-backed evaluation started"); refetchEvalPlan(); },
    onError: (e) => toast.error(e.message),
  });
  const cancelEvaluation = trpc.selfImprovement.cancelEvaluation.useMutation({
    onSuccess: () => { toast.success("Evaluation cancelled"); refetchEvalPlan(); },
  });
  const updatePlanItem = trpc.selfImprovement.updatePlanItem.useMutation({
    onSuccess: () => refetchEvalPlan(),
  });

  const generateImageMut = trpc.image.generate.useMutation({
    onSuccess: (r) => {
      toast.success(`Image generated (${r.provider})`);
    },
    onError: (e) => toast.error(`Image generation failed: ${e.message}`),
  });

  const transcribeAudio = trpc.chat.transcribeAudio.useMutation({
    onSuccess: (r) => { setInput(r.text); toast.success("Voice transcribed"); },
    onError: () => toast.error("Transcription failed"),
  });

  const analyzeImageMut = trpc.chat.analyzeImage.useMutation({
    onSuccess: () => { refetchMessages(); },
    onError: (e) => toast.error(`Image analysis failed: ${e.message}`),
  });

  // ── Auto-scroll ──────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convData?.messages, streamedResponse]);

  // ── Attached files for chat input ────────────────────────────────────────────
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  // Whiteboard → chat bridge. When the whiteboard fires "To chat", we
  // convert the dataURL to a File and prepend it to the attached files,
  // open the chat panel, and toast a hint. The event is fired by
  // components/Whiteboard.tsx — kept loose-coupled via CustomEvent so the
  // whiteboard component doesn't need to know chat-input internals.
  useEffect(() => {
    const handler = async (e: Event) => {
      const ev = e as CustomEvent<{ dataUrl: string }>;
      if (!ev.detail?.dataUrl) return;
      try {
        const blob = await (await fetch(ev.detail.dataUrl)).blob();
        const file = new File([blob], `whiteboard-${Date.now()}.png`, { type: "image/png" });
        setAttachedFiles((prev) => [...prev, file]);
        setSidePanel("chat");
        setSidebarOpen(true);
        toast.success("Whiteboard image attached — write a prompt and send.");
      } catch (err) {
        toast.error(`Couldn't attach whiteboard image: ${String(err).slice(0, 80)}`);
      }
    };
    window.addEventListener("jarvis:whiteboard-to-chat", handler);
    return () => window.removeEventListener("jarvis:whiteboard-to-chat", handler);
  }, []);

  const uploadAttachedFiles = useCallback(async (files: File[]): Promise<string[]> => {
    const summaries: string[] = [];
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        if (res.ok) {
          summaries.push(`📎 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
        } else {
          summaries.push(`⚠️ Failed to attach ${file.name}`);
        }
      } catch {
        summaries.push(`⚠️ Failed to attach ${file.name}`);
      }
    }
    return summaries;
  }, []);

  // ── Send message ─────────────────────────────────────────────────────────────
  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  const handleSend = useCallback(async () => {
  if ((!input.trim() && attachedFiles.length === 0) || isSendingRef.current) return;

  let convId = activeConvId;

  if (!convId) {
    const conv = await createConv.mutateAsync({});
    convId = conv?.id ?? null;
    if (!convId) return;
    setActiveConvId(convId);
    await new Promise(r => setTimeout(r, 100));
  }

  setIsSending(true);

  // Upload any attached files first and append summaries to the message
  let messageText = input.trim();
  if (attachedFiles.length > 0) {
    const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];
    const imageFiles = attachedFiles.filter(f =>
      imageExts.some(ext => f.name.toLowerCase().endsWith(ext))
    );
    const otherFiles = attachedFiles.filter(f =>
      !imageExts.some(ext => f.name.toLowerCase().endsWith(ext))
    );

    // Send image files to the vision analysis endpoint
    for (const imgFile of imageFiles) {
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            // Strip the data:image/...;base64, prefix
            resolve(dataUrl.split(",")[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(imgFile);
        });
        analyzeImageMut.mutate({
          conversationId: convId!,
          imageBase64: base64,
          mimeType: imgFile.type || "image/png",
          filename: imgFile.name,
          question: messageText || undefined,
        });
      } catch {
        toast.error(`Failed to read image: ${imgFile.name}`);
      }
    }

    // If we sent images and there's no other text/files, we're done
    if (imageFiles.length > 0 && otherFiles.length === 0) {
      setAttachedFiles([]);
      setInput("");
      setIsSending(false);
      return;
    }

    // Upload non-image files to knowledge base as before
    if (otherFiles.length > 0) {
      const summaries = await uploadAttachedFiles(otherFiles);
      const filesNote = `\n\n[Attached files added to knowledge base:]\n${summaries.join("\n")}`;
      messageText = messageText ? messageText + filesNote : filesNote;
    }
    setAttachedFiles([]);
  }

  setInput("");

  const payload = { conversationId: convId, content: messageText, forceReasoning };
  setLastFailedMessage(payload);

  sendMessage.mutate(payload, {
      onSuccess: (data) => {
        setIsSending(false);
        setLastFailedMessage(null);
        // Capture reasoning for this message if present
        if ((data as any).thinking && data.message?.id) {
          setReasoningByMessageId((prev) => ({
            ...prev,
            [data.message.id]: {
              thinking: (data as any).thinking,
              used: Boolean((data as any).usedReasoning),
            },
          }));
        }
        if ((data as any).confidence && data.message?.id) {
          const c = (data as any).confidence;
          console.log(
            `[meta] confidence msg#${data.message.id}: ${(c.score * 100).toFixed(0)}% ${c.action} (${c.intent ?? "factual"})`,
            { reasons: c.reasons, signals: c.signals, retried: c.retriedForConfidence }
          );
          setConfidenceByMessageId((prev) => ({
            ...prev,
            [data.message.id]: {
              score: c.score,
              action: c.action,
              threshold: c.threshold,
              intent: c.intent ?? "factual",
              reasons: c.reasons ?? [],
              topic: c.topic,
              retriedForConfidence: c.retriedForConfidence,
            },
          }));
        }
        refetchMessages();
        if (voiceEnabled && data.message?.content) {
          speakText(data.message.content);
        }
      },
      onError: () => {
        setIsSending(false);
      },
    }
  );
}, [input, attachedFiles, activeConvId, voiceEnabled, forceReasoning, refetchMessages, uploadAttachedFiles, analyzeImageMut]);

  const handleRetry = useCallback(() => {
    if (!lastFailedMessage || isSending) return;
    setIsSending(true);
    sendMessage.mutate(lastFailedMessage, {
      onSuccess: (data) => {
        setIsSending(false);
        setLastFailedMessage(null);
        refetchMessages();
        if (voiceEnabled && data.message?.content) {
          speakText(data.message.content);
        }
      },
      onError: () => {
        setIsSending(false);
      },
    });
  }, [lastFailedMessage, isSending, voiceEnabled, refetchMessages]);


  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── TTS ──────────────────────────────────────────────────────────────────────
  // Two paths:
  //   - speakText(text) — used for auto-speak after chat reply. Tries
  //     ElevenLabs via server; falls back to browser speechSynthesis if TTS
  //     fails or isn't configured.
  //   - playMessageAudio(messageId) — explicit replay button, always uses
  //     server-side ElevenLabs for the cloned voice.
  const ttsMessageMut = trpc.chat.ttsMessage.useMutation();
  const ttsTextMut = trpc.chat.ttsText.useMutation();

  const stopSpeaking = () => {
    // Stop browser synth if speaking
    synth.current?.cancel();
    // Stop any currently-playing <audio> element
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      } catch {}
      currentAudioRef.current = null;
    }
    setPlayingMessageId(null);
  };

  const playMp3 = (url: string, messageId?: number): Promise<void> => {
    return new Promise((resolve) => {
      stopSpeaking();
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      if (messageId !== undefined) setPlayingMessageId(messageId);
      audio.onended = () => { setPlayingMessageId(null); resolve(); };
      audio.onerror = () => { setPlayingMessageId(null); resolve(); };
      audio.play().catch(() => { setPlayingMessageId(null); resolve(); });
    });
  };

  const speakText = async (text: string) => {
    if (!voiceEnabled) return;
    const clean = text.replace(/[#*`_~\[\]]/g, "").trim();
    if (!clean) return;

    // Try server-side ElevenLabs first (uses cloned voice)
    try {
      const res = await ttsTextMut.mutateAsync({ text: clean.slice(0, 4000) });
      if (res?.audioUrl) {
        await playMp3(res.audioUrl);
        return;
      }
    } catch {
      // Fall through to browser synth
    }

    // Fallback: browser SpeechSynthesis
    if (!synth.current) return;
    synth.current.cancel();
    const utt = new SpeechSynthesisUtterance(clean.slice(0, 500));
    utt.rate = 0.95;
    utt.pitch = 0.9;
    const voices = synth.current.getVoices();
    const preferred = voices.find((v) => v.name.includes("Google") && v.lang.startsWith("en"));
    if (preferred) utt.voice = preferred;
    synth.current.speak(utt);
  };

  const playMessageAudio = async (messageId: number) => {
    // If this message is already playing, stop it (toggle)
    if (playingMessageId === messageId) { stopSpeaking(); return; }
    setTtsLoadingId(messageId);
    try {
      const res = await ttsMessageMut.mutateAsync({ messageId });
      if (res?.audioUrl) await playMp3(res.audioUrl, messageId);
    } catch (err: any) {
      toast.error(`Audio generation failed: ${err?.message || err}`);
    } finally {
      setTtsLoadingId(null);
    }
  };

  // ── Voice recording ──────────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mr.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        // Upload to storage then transcribe
        const formData = new FormData();
        formData.append("file", blob, "recording.webm");
        try {
          const uploadRes = await fetch("/api/upload-audio", { method: "POST", body: formData });
          if (uploadRes.ok) {
            const { url } = await uploadRes.json() as { url: string };
            transcribeAudio.mutate({ audioUrl: url });
          } else {
            toast.error("Audio upload failed");
          }
        } catch {
          toast.error("Could not upload audio");
        }
      };
      mr.start();
      setIsRecording(true);
    } catch {
      toast.error("Microphone access denied");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  // ── Notes Recording (continuous transcription) ──────────────────────────────
  // We cycle MediaRecorder every 15s instead of slicing one long stream. Each
  // start/stop produces a complete WebM file that Whisper can decode. Slicing
  // with mr.start(1000) produced chunks without container headers after the
  // first batch, so all subsequent transcriptions silently failed.
  const CHUNK_DURATION_MS = 15_000;

  const transcribeNotesChunk = async (blob: Blob) => {
    if (blob.size < 1000) return; // tiny / empty blobs aren't worth a round-trip
    try {
      const formData = new FormData();
      formData.append("file", blob, `notes-chunk-${Date.now()}.webm`);
      const uploadRes = await fetch("/api/upload-audio", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        console.warn("[notes] upload failed:", uploadRes.status);
        return;
      }
      const { url } = await uploadRes.json() as { url: string };
      const result = await fetch("/api/trpc/chat.transcribeAudio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ json: { audioUrl: url } }),
      });
      if (!result.ok) {
        console.warn("[notes] transcribe HTTP error:", result.status);
        return;
      }
      const data = await result.json() as any;
      const text = data?.result?.data?.json?.text || data?.result?.data?.text || "";
      if (text.trim()) {
        setNotesTranscript((prev) => prev + (prev ? " " : "") + text.trim());
        console.log(`[notes] transcribed ${text.length} chars`);
        // Fire background enrichment if the user has it toggled on. This is
        // CPU-friendly: no LLM on the path, just regex topic extraction +
        // multi-hop retrieval, rate-limited to 1 / 10s on the server.
        if (notesEnrichmentEnabled && notesSessionIdRef.current) {
          fireEnrichmentForChunk(text.trim()).catch((err) =>
            console.warn("[notes] enrichment error:", err)
          );
        }
      }
    } catch (err) {
      console.warn("[notes] transcribe error:", err);
    }
  };

  const fireEnrichmentForChunk = async (text: string) => {
    try {
      const res = await fetch("/api/trpc/notes.enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          json: { sessionId: notesSessionIdRef.current, text },
        }),
      });
      if (!res.ok) return;
      const data = await res.json() as any;
      const enrichments = data?.result?.data?.json?.enrichments;
      if (Array.isArray(enrichments) && enrichments.length > 0) {
        setNoteEnrichments((prev) => [...enrichments, ...prev].slice(0, 50));
        console.log(`[notes] +${enrichments.length} enrichment(s):`, enrichments.map((e: any) => e.topic).join(", "));
      } else {
        const skipped = data?.result?.data?.json?.skippedReason;
        if (skipped) console.log(`[notes] enrichment skipped: ${skipped}`);
      }
    } catch (err) {
      console.warn("[notes] enrichment fetch failed:", err);
    }
  };

  const recordOneChunk = (stream: MediaStream) => {
    const chunks: Blob[] = [];
    const mr = new MediaRecorder(stream);
    notesRecorderRef.current = mr;

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mr.onstop = () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      // Fire-and-forget transcription so we don't block the next chunk.
      transcribeNotesChunk(blob).catch(() => {});

      // Continue if the user hasn't stopped us. Otherwise release the mic.
      if (notesActiveRef.current) {
        recordOneChunk(stream);
      } else {
        stream.getTracks().forEach((t) => t.stop());
        notesStreamRef.current = null;
        notesRecorderRef.current = null;
      }
    };

    mr.start();

    // Stop this cycle after CHUNK_DURATION_MS so we get a full valid WebM.
    setTimeout(() => {
      if (mr.state === "recording") mr.stop();
    }, CHUNK_DURATION_MS);
  };

  const startNotesRecording = async () => {
    if (notesRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      notesStreamRef.current = stream;
      notesActiveRef.current = true;
      setNotesRecording(true);
      setNotesTranscript("");
      setNotesSummary("");
      setNoteEnrichments([]);
      setPinnedEnrichmentIds(new Set());
      // Fresh session id so the server-side dedup / rate-limit state resets.
      notesSessionIdRef.current = `notes-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      recordOneChunk(stream);
      toast.success("Notes recording started");
    } catch (err) {
      console.warn("[notes] getUserMedia failed:", err);
      toast.error("Microphone access denied");
    }
  };

  const stopNotesRecording = () => {
    notesActiveRef.current = false;
    const mr = notesRecorderRef.current;
    if (mr && mr.state === "recording") {
      // Triggers onstop → final chunk gets transcribed → stream gets released
      // because notesActiveRef is now false.
      mr.stop();
    } else if (notesStreamRef.current) {
      // No active recorder (between chunks) — release the stream directly.
      notesStreamRef.current.getTracks().forEach((t) => t.stop());
      notesStreamRef.current = null;
    }
    setNotesRecording(false);
    toast.success("Notes recording stopped");
  };

  const summarizeNotes = async () => {
    if (!notesTranscript.trim()) { toast.error("No transcript to summarize"); return; }
    setNotesSummarizing(true);
    try {
      // If the user pinned any enrichment cards, fold them into the prompt as
      // verified background context so the summary can weave them in naturally.
      const pinned = noteEnrichments.filter((e) => pinnedEnrichmentIds.has(e.id));
      const pinnedBlock = pinned.length > 0
        ? `\n\n## Background context (verified from knowledge base — weave in naturally, do not quote verbatim):\n` +
          pinned.map((e, i) =>
            `${i + 1}. **${e.topic}** — ${e.content}${e.sourceTitle ? ` (source: ${e.sourceTitle})` : ""}`
          ).join("\n")
        : "";

      const res = await fetch("/api/trpc/chat.sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          json: {
            conversationId: activeConvId || 1,
            content: `Summarize, organize, and improve the following raw voice notes. Extract key points, action items, and important details. Format with clear headings and bullet points:\n\n${notesTranscript}${pinnedBlock}`,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json() as any;
        const summary = data?.result?.data?.json?.message?.content || "Summary failed";
        setNotesSummary(summary);
      }
    } catch {
      toast.error("Summarization failed");
    }
    setNotesSummarizing(false);
  };

  // ── Messages display ─────────────────────────────────────────────────────────
  // Compute sibling info: map from messageId → { siblings: [msgIds], index: 0-based }
  // Messages with 2+ siblings get a branch switcher UI.
  const siblingMap = useMemo(() => {
    const map = new Map<number, { siblings: Array<{ id: number; isActive: boolean; createdAt: number; content: string }>; index: number }>();
    const all = (allMessages ?? []) as any[];
    if (all.length === 0) return map;
    // Group by parentId
    const byParent = new Map<number | null, any[]>();
    for (const m of all) {
      const pid = m.parentId ?? null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid)!.push(m);
    }
    // For each message, compute its siblings (same parentId)
    for (const m of all) {
      const siblings = byParent.get(m.parentId ?? null) ?? [];
      if (siblings.length >= 2) {
        const sorted = siblings.sort((a, b) => a.createdAt - b.createdAt);
        const idx = sorted.findIndex((s) => s.id === m.id);
        map.set(m.id, {
          siblings: sorted.map((s) => ({
            id: s.id,
            isActive: Boolean(s.isActive),
            createdAt: s.createdAt,
            content: String(s.content).slice(0, 100),
          })),
          index: idx,
        });
      }
    }
    return map;
  }, [allMessages]);

  const messages: Message[] = (convData?.messages ?? []).map((m: any) => ({
    ...m,
    role: m.role as "user" | "assistant" | "system",
    createdAt: new Date(m.createdAt),
    ragChunksUsed: m.ragChunksUsed as Message["ragChunksUsed"],
  }));

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* ── Left Sidebar: Conversations ─────────────────────────────────────── */}
      <aside
        className={`flex flex-col border-r border-border transition-all duration-300 relative ${
          sidebarOpen ? "" : "w-0 overflow-hidden"
        }`}
        style={{ background: "oklch(0.10 0.016 240)", width: sidebarOpen ? `${leftWidth}px` : 0 }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2 flex-1">
            <div className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background: "oklch(0.72 0.18 195 / 0.15)", border: "1px solid oklch(0.72 0.18 195 / 0.4)" }}>
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <span className="font-semibold text-sm tracking-wider text-primary" style={{ textShadow: "0 0 12px oklch(0.72 0.18 195 / 0.5)" }}>
              JARVIS
            </span>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => createConv.mutate({})}>
              <Plus className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
              const name = window.prompt("Folder name:");
              if (name?.trim()) createFolderMut.mutate({ name: name.trim() });
            }}>
              <FolderPlus className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Conversation list with folders */}
        <ScrollArea className="flex-1 px-2 py-2 overflow-hidden">
          {/* Folders */}
          {(folders ?? []).map((folder: any) => {
            const folderConvs = (conversations ?? []).filter((c: Conversation) => (c as any).folderId === folder.id);
            const isExpanded = expandedFolders.has(folder.id);
            return (
              <div key={`folder-${folder.id}`} className="mb-1">
                <div
                  className="group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer hover:bg-secondary/60 text-muted-foreground"
                  onClick={() => setExpandedFolders((prev) => {
                    const next = new Set(prev);
                    next.has(folder.id) ? next.delete(folder.id) : next.add(folder.id);
                    return next;
                  })}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("bg-primary/10"); }}
                  onDragLeave={(e) => { e.currentTarget.classList.remove("bg-primary/10"); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("bg-primary/10");
                    if (draggingConvId) {
                      moveToFolder.mutate({ conversationId: draggingConvId, folderId: folder.id });
                      setDraggingConvId(null);
                    }
                  }}
                >
                  {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: folder.color }} />
                  <span className="text-xs font-medium truncate flex-1">{folder.name}</span>
                  <Badge variant="outline" className="text-xs h-4 px-1 opacity-60">{folderConvs.length}</Badge>
                  <Button variant="ghost" size="icon" className="h-4 w-4 opacity-0 group-hover:opacity-100 flex-shrink-0"
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Delete folder "${folder.name}"?`)) deleteFolderMut.mutate({ id: folder.id }); }}>
                    <Trash2 className="w-2.5 h-2.5" />
                  </Button>
                </div>
                {isExpanded && folderConvs.map((conv: Conversation) => (
                  <div
                    key={conv.id}
                    draggable
                    onDragStart={() => setDraggingConvId(conv.id)}
                    onDragEnd={() => setDraggingConvId(null)}
                    className={`group flex items-center gap-2 pl-7 pr-3 py-1.5 rounded-md cursor-pointer mb-0.5 transition-all ${
                      activeConvId === conv.id
                        ? "bg-primary/10 border border-primary/30 text-primary"
                        : "hover:bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setActiveConvId(conv.id)}
                  >
                    <MessageSquare className="w-3 h-3 flex-shrink-0" />
                    <span className="text-xs truncate flex-1">{conv.title || "New Conversation"}</span>
                    <Button variant="ghost" size="icon" className="h-4 w-4 opacity-0 group-hover:opacity-100 flex-shrink-0"
                      onClick={(e) => { e.stopPropagation(); moveToFolder.mutate({ conversationId: conv.id, folderId: null }); }}>
                      <GripVertical className="w-2.5 h-2.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-4 w-4 opacity-0 group-hover:opacity-100 flex-shrink-0"
                      onClick={(e) => { e.stopPropagation(); deleteConv.mutate({ id: conv.id }); }}>
                      <Trash2 className="w-2.5 h-2.5" />
                    </Button>
                  </div>
                ))}
              </div>
            );
          })}

          {/* Unfiled conversations */}
          {(conversations ?? [])
            .filter((c: Conversation) => !(c as any).folderId)
            .map((conv: Conversation) => (
            <div
              key={conv.id}
              draggable
              onDragStart={() => setDraggingConvId(conv.id)}
              onDragEnd={() => setDraggingConvId(null)}
              className={`group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer mb-1 transition-all ${
                activeConvId === conv.id
                  ? "bg-primary/10 border border-primary/30 text-primary"
                  : "hover:bg-secondary text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveConvId(conv.id)}
            >
              <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="text-xs truncate flex-1">{conv.title || "New Conversation"}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100 flex-shrink-0"
                onClick={(e) => { e.stopPropagation(); deleteConv.mutate({ id: conv.id }); }}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
          {(!conversations || conversations.length === 0) && (
            <p className="text-xs text-muted-foreground text-center py-4">No conversations yet</p>
          )}
        </ScrollArea>

        {/* System status */}
        <div className="px-4 py-3 border-t border-border space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Ollama</span>
            <div className="flex items-center gap-1.5">
              <StatusDot ok={status?.ollama?.available ?? false} />
              <span className={status?.ollama?.available ? "text-emerald-400" : "text-red-400"}>
                {status?.ollama?.available ? "Online" : "Offline"}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Knowledge</span>
            <span className="text-primary font-mono">{status?.knowledge?.totalChunks ?? 0} chunks</span>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-between text-xs rounded-md px-1 -mx-1 py-0.5 hover:bg-secondary/60 transition-colors cursor-pointer"
              >
                <span className="text-muted-foreground group-hover:text-foreground">Sources</span>
                <span className="text-primary font-mono hover:underline">
                  {status?.scraper?.activeSources ?? 0} active
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="right"
              className="w-96 max-h-[70vh] overflow-y-auto p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Rss className="w-3 h-3 text-primary" />
                  Scrape Sources
                  <Badge variant="outline" className="text-[10px]">
                    {(scraperSources ?? []).length}
                  </Badge>
                </p>
                <button
                  type="button"
                  onClick={() => setSidePanel("scraper")}
                  className="text-[10px] text-primary hover:underline"
                >
                  Manage →
                </button>
              </div>
              {(scraperSources ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No sources configured yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {(scraperSources ?? []).map((source: any) => (
                    <div
                      key={source.id}
                      className="p-2 rounded-md border border-border bg-card text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <StatusDot ok={source.isActive} />
                            <span className="font-medium text-foreground truncate">
                              {source.name}
                            </span>
                          </div>
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-primary hover:underline break-all block"
                          >
                            {source.url}
                          </a>
                        </div>
                        <Badge variant="outline" className="text-[10px] flex-shrink-0">
                          {source.type}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground font-mono">
                        <span>{source.totalChunks ?? 0} chunks</span>
                        {source.lastScraped && (
                          <span>
                            • last {new Date(source.lastScraped).toLocaleDateString()}
                          </span>
                        )}
                        {source.lastStatus === "error" && (
                          <span className="text-red-400">• error</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
        {/* Resize handle */}
        {sidebarOpen && (
          <div
            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-10"
            onMouseDown={(e) => {
              e.preventDefault();
              resizingRef.current = "left";
              startXRef.current = e.clientX;
              startWidthRef.current = leftWidth;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          />
        )}
      </aside>

      {/* ── Main Chat Area ──────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Offline-mode banner — shows when the toggle is on so the user
            always knows which capabilities are deliberately disabled. */}
        <OfflineModeBanner />
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-border"
          style={{ background: "oklch(0.10 0.016 240 / 0.8)", backdropFilter: "blur(8px)" }}>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSidebarOpen((v) => !v)}>
            {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </Button>

          <div className="flex-1 flex items-center gap-3">
            <h1 className="text-sm font-semibold text-primary tracking-widest"
              style={{ textShadow: "0 0 16px oklch(0.72 0.18 195 / 0.6)" }}>
              J.A.R.V.I.S
            </h1>
            <span className="text-xs text-muted-foreground hidden sm:block">
              Just A Rather Very Intelligent System
            </span>
          </div>

          {/* Toolbar — ordered: chunks, scraper, self-improve, notes, writing, navigator, benchmarks, knowledge graph, logs, upload, voice, power */}
          <div className="flex items-center gap-1">
            {/* 1. Chunks (Knowledge) */}
            {([
              { id: "knowledge", icon: Database, label: "Chunks" },
              { id: "scraper", icon: Rss, label: "Scraper" },
              { id: "github", icon: Github, label: "GitHub Repos" },
              { id: "improvement", icon: Zap, label: "Self-Improve" },
            ] as const).map(({ id, icon: Icon, label }) => (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon"
                    className={`h-8 w-8 ${sidePanel === id ? "text-primary bg-primary/10" : "text-muted-foreground"}`}
                    onClick={() => setSidePanel(sidePanel === id ? "chat" : id)}>
                    <Icon className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            ))}

            <Separator orientation="vertical" className="h-6 mx-1" />

            {/* 4. Voice Notes panel — opens the panel, recording toggled inside */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon"
                  className={`h-8 w-8 ${notesRecording ? "text-red-400 animate-pulse" : sidePanel === "notes" ? "text-primary" : "text-muted-foreground"}`}
                  onClick={() => { setSidePanel("notes"); setSidebarOpen(true); }}>
                  <NotebookPen className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{notesRecording ? "Voice notes (recording — panel open)" : "Open voice notes"}</TooltipContent>
            </Tooltip>

            {/* 4b. Whiteboard / drawn notes — pen + multi-page + subjects */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon"
                  className={`h-8 w-8 ${sidePanel === "whiteboard" ? "text-primary" : "text-muted-foreground"}`}
                  onClick={() => { setSidePanel("whiteboard"); setSidebarOpen(true); }}>
                  <Palette className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Whiteboard / drawn notes</TooltipContent>
            </Tooltip>

            {/* 5. Writing Profile Voice */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/writing-profile">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                    <PenLine className="w-4 h-4" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Writing Profile</TooltipContent>
            </Tooltip>

            {/* 6. Navigator */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/navigator">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                    <Compass className="w-4 h-4" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Navigator</TooltipContent>
            </Tooltip>

            <Separator orientation="vertical" className="h-6 mx-1" />

            {/* 7-9. Benchmarks, Knowledge Graph, Logs */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon"
                  className={`h-8 w-8 ${sidePanel === "benchmarks" ? "text-primary bg-primary/10" : "text-muted-foreground"}`}
                  onClick={() => setSidePanel(sidePanel === "benchmarks" ? "chat" : "benchmarks")}>
                  <BarChart3 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Benchmarks</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/knowledge-graph">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                    <Waypoints className="w-4 h-4" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Knowledge Graph</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/books">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                    <BookOpen className="w-4 h-4" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Book Writer</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon"
                  className={`h-8 w-8 ${sidePanel === "logs" ? "text-primary bg-primary/10" : "text-muted-foreground"}`}
                  onClick={() => setSidePanel(sidePanel === "logs" ? "chat" : "logs")}>
                  <Activity className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Logs</TooltipContent>
            </Tooltip>

            <Separator orientation="vertical" className="h-6 mx-1" />

            {/* 10. Upload Files */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon"
                  className={`h-8 w-8 ${sidePanel === "upload" ? "text-primary bg-primary/10" : "text-muted-foreground"}`}
                  onClick={() => setSidePanel(sidePanel === "upload" ? "chat" : "upload")}>
                  <Upload className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Upload Files</TooltipContent>
            </Tooltip>

            {/* 11. Creativity slider — 0 deterministic → 10 max variation */}
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon"
                      className={`h-8 w-8 ${creativity >= 7 ? "text-amber-400" : creativity <= 3 ? "text-sky-400" : "text-muted-foreground"}`}>
                      <Sparkles className="w-4 h-4" />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>Creativity: {creativity.toFixed(0)}/10</TooltipContent>
              </Tooltip>
              <PopoverContent side="bottom" align="end" className="w-72">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Creativity</div>
                    <Badge variant="secondary">{creativity.toFixed(0)}/10</Badge>
                  </div>
                  <Slider
                    value={[creativity]}
                    min={0}
                    max={10}
                    step={1}
                    onValueChange={(v) => setCreativity(v[0] ?? 5)}
                    onValueCommit={(v) => {
                      const value = v[0] ?? 5;
                      setCreativityMutation.mutate(
                        { value },
                        {
                          onSuccess: () => toast.success(`Creativity set to ${value}/10`),
                          onError: () => toast.error("Failed to save creativity"),
                        }
                      );
                    }}
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>0 · books / facts</span>
                    <span>5 · balanced</span>
                    <span>10 · brainstorm</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug">
                    Lower = deterministic, minimal hallucination (good for long-form
                    writing and factual work). Higher = wider variation (good for
                    idea generation and brainstorming).
                  </p>
                </div>
              </PopoverContent>
            </Popover>

            {/* 12. Voice Toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon"
                  className={`h-8 w-8 ${voiceEnabled ? "text-primary" : "text-muted-foreground"}`}
                  onClick={() => { setVoiceEnabled((v) => !v); stopSpeaking(); }}>
                  {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{voiceEnabled ? "Disable voice" : "Enable voice"}</TooltipContent>
            </Tooltip>

            {/* 12. Meta Cognition */}
            <MetaCognitionPopover />

            {/* 13. Power */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-red-400"
                  onClick={() => {
                    if (confirm("Shut down JARVIS? This will save all data and stop the server.")) {
                      fetch("/api/shutdown", { method: "POST" })
                        .then(() => toast.success("JARVIS shutting down…"))
                        .catch(() => toast.error("Shutdown failed"));
                    }
                  }}>
                  <Power className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Shut down JARVIS</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {/* Chat messages */}
        <ScrollArea className="flex-1 px-4 py-4 overflow-hidden">
          {!activeConvId && (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-6">
              <div className="relative">
                <div className="w-20 h-20 rounded-full flex items-center justify-center"
                  style={{
                    background: "oklch(0.72 0.18 195 / 0.08)",
                    border: "2px solid oklch(0.72 0.18 195 / 0.3)",
                    boxShadow: "0 0 40px oklch(0.72 0.18 195 / 0.15)"
                  }}>
                  <Brain className="w-10 h-10 text-primary" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-400"
                  style={{ boxShadow: "0 0 8px #34d399", animation: "pulse 2s infinite" }} />
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-primary tracking-widest"
                  style={{ textShadow: "0 0 20px oklch(0.72 0.18 195 / 0.5)" }}>
                  JARVIS ONLINE
                </h2>
                <p className="text-muted-foreground text-sm max-w-sm">
                  Your AI assistant is ready. Start a new conversation or select an existing one.
                </p>
                {!status?.ollama?.available && (
                  <div className="flex items-center gap-2 text-amber-400 text-xs bg-amber-400/10 border border-amber-400/20 rounded-md px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Ollama offline — using cloud fallback
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
                {[
                  { icon: Globe, label: "Web Knowledge", value: `${(status?.knowledge?.totalChunks ?? 0).toLocaleString()} chunks` },
                  { icon: Rss, label: "Active Sources", value: `${status?.scraper?.activeSources ?? 0} feeds` },
                  { icon: Brain, label: "Entities", value: `${(status?.entityGraph?.entities ?? 0).toLocaleString()}` },
                  { icon: Zap, label: "Connections", value: `${(status?.entityGraph?.relationshipPairs ?? 0).toLocaleString()}` },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="rounded-lg p-3 text-center"
                    style={{ background: "oklch(0.12 0.018 240)", border: "1px solid oklch(0.22 0.03 230)" }}>
                    <Icon className="w-5 h-5 text-primary mx-auto mb-1" />
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xs font-medium text-foreground font-mono">{value}</p>
                  </div>
                ))}
              </div>

              {/* AI Landscape preview — links to full Benchmarks panel */}
              <div className="w-full max-w-sm rounded-lg p-3"
                style={{ background: "oklch(0.12 0.018 240)", border: "1px solid oklch(0.22 0.03 230)" }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                      AI Landscape · MMLU
                    </span>
                  </div>
                  <button
                    onClick={() => setSidePanel("benchmarks")}
                    className="text-[10px] text-muted-foreground hover:text-primary transition-colors"
                  >
                    View all →
                  </button>
                </div>
                <div className="space-y-1.5">
                  {AI_LANDSCAPE.slice(0, 3).map((m) => (
                    <div key={m.name} className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-28 truncate">{m.name}</span>
                      <Progress value={m.mmlu} className="h-1 flex-1" />
                      <span className="text-[10px] font-mono text-foreground w-6 text-right">{m.mmlu}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-muted-foreground mt-2 italic">
                  Public benchmark scores — reference only
                </p>
              </div>
              {(status?.scraper?.activeSources ?? 0) === 0 && (
                <Button
                  onClick={() => seedSources.mutate()}
                  disabled={seedSources.isPending}
                  className="gap-2 bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                >
                  {seedSources.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Seeding & Scraping...</>
                  ) : (
                    <><Database className="w-4 h-4" /> Seed Sources & Scrape Web</>
                  )}
                </Button>
              )}
              <Button onClick={() => createConv.mutate({})} className="gap-2">
                <Plus className="w-4 h-4" />
                New Conversation
              </Button>
            </div>
          )}

          {messages.map((msg) => {
            const branchInfo = siblingMap.get(msg.id);
            return (
            <div key={msg.id} className={`flex gap-3 mb-4 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                msg.role === "user"
                  ? "bg-secondary border border-border"
                  : "bg-primary/10 border border-primary/30"
              }`}>
                {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-primary" />}
              </div>
              <div className={`max-w-[75%] rounded-xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-secondary/80 border border-border text-foreground"
                  : "bg-card border border-border"
              }`}>
                {branchInfo && (
                  <div className={`flex items-center gap-1 mb-2 text-xs text-muted-foreground ${msg.role === "user" ? "justify-end" : ""}`}>
                    <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                      disabled={branchInfo.index === 0}
                      onClick={() => {
                        const prev = branchInfo.siblings[branchInfo.index - 1];
                        if (prev) switchBranchMut.mutate({ targetMessageId: prev.id });
                      }}>
                      <ChevronLeft className="w-3 h-3" />
                    </Button>
                    <span className="font-mono text-[10px]">
                      {branchInfo.index + 1}/{branchInfo.siblings.length}
                    </span>
                    <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                      disabled={branchInfo.index === branchInfo.siblings.length - 1}
                      onClick={() => {
                        const next = branchInfo.siblings[branchInfo.index + 1];
                        if (next) switchBranchMut.mutate({ targetMessageId: next.id });
                      }}>
                      <ChevronRight className="w-3 h-3" />
                    </Button>
                    <span className="text-[10px] opacity-60">branch</span>
                  </div>
                )}
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none text-foreground">
                    {/* Reasoning collapsible — shown when thinking tokens exist */}
                    {reasoningByMessageId[msg.id]?.thinking && (
                      <div className="mb-2 rounded-md border border-primary/20 bg-primary/5">
                        <button
                          type="button"
                          onClick={() => setExpandedReasoning((prev) => {
                            const next = new Set(prev);
                            next.has(msg.id) ? next.delete(msg.id) : next.add(msg.id);
                            return next;
                          })}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-primary hover:bg-primary/10 transition-colors"
                        >
                          <Lightbulb className="w-3 h-3" />
                          <span className="font-medium">
                            {reasoningByMessageId[msg.id]?.used ? "Reasoning (DeepSeek-R1)" : "Chain-of-thought"}
                          </span>
                          {expandedReasoning.has(msg.id) ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
                        </button>
                        {expandedReasoning.has(msg.id) && (
                          <div className="px-3 py-2 border-t border-primary/20 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                            {reasoningByMessageId[msg.id].thinking}
                          </div>
                        )}
                      </div>
                    )}
                    {editingMessageId === msg.id ? (
                      <div>
                        <textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={Math.max(3, Math.min(15, editDraft.split("\n").length + 1))}
                          className="w-full p-2 rounded-md border border-primary/40 bg-background text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                        <div className="flex gap-1 mt-2">
                          <Button size="sm" className="h-7 text-xs" onClick={() => handleSaveEdit(msg.id, "assistant")}>
                            <CheckCircle className="w-3 h-3 mr-1" /> Save
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditingMessageId(null); setEditDraft(""); }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Streamdown>{msg.content}</Streamdown>
                    )}
                    {editingMessageId !== msg.id && (
                      <div className="flex items-center flex-wrap gap-1 mt-2">
                        {confidenceByMessageId[msg.id] && (() => {
                          const c = confidenceByMessageId[msg.id];
                          const pct = Math.round(c.score * 100);
                          const thr = Math.round(c.threshold * 100);
                          const refused = c.action === "refuse";
                          const creative = c.intent === "creative";
                          const color = refused
                            ? "border-red-500/40 bg-red-500/10 text-red-400"
                            : c.score >= 0.9
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                              : "border-amber-500/40 bg-amber-500/10 text-amber-400";
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={`inline-flex items-center gap-1 h-6 px-1.5 rounded border text-[10px] font-mono ${color}`}>
                                  {creative ? <Sparkles className="w-3 h-3" /> : <Gauge className="w-3 h-3" />}
                                  {pct}%
                                  {refused && <span className="font-sans font-medium">refused</span>}
                                  {!refused && c.retriedForConfidence && <RefreshCw className="w-3 h-3" />}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <div className="text-xs">
                                  <div className="font-semibold mb-1">
                                    Confidence {pct}% (threshold {thr}%)
                                    <span className="ml-1 font-normal opacity-70">
                                      · {creative ? "creative" : "factual"}
                                    </span>
                                  </div>
                                  {c.reasons.length > 0 && (
                                    <ul className="list-disc pl-4 space-y-0.5 opacity-90">
                                      {c.reasons.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}
                                    </ul>
                                  )}
                                  {c.retriedForConfidence && (
                                    <div className="mt-1 opacity-75">Retried through reasoning model.</div>
                                  )}
                                  {refused && c.topic && !creative && (
                                    <div className="mt-1 opacity-75">Researching: {c.topic}</div>
                                  )}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })()}
                        <MessageRating
                          messageId={msg.id}
                          currentRating={msg.userRating ?? undefined}
                        />
                        {activeConvId != null && (
                          <MessageCorrection
                            messageId={msg.id}
                            conversationId={activeConvId}
                            originalContent={msg.content}
                          />
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-muted-foreground hover:text-primary"
                              onClick={() => playMessageAudio(msg.id)}
                              disabled={ttsLoadingId === msg.id}
                            >
                              {ttsLoadingId === msg.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : playingMessageId === msg.id ? (
                                <VolumeX className="w-3 h-3" />
                              ) : (
                                <Volume2 className="w-3 h-3" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{playingMessageId === msg.id ? "Stop audio" : "Play audio"}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-muted-foreground hover:text-primary"
                              onClick={() => handleEditMessage(msg.id, msg.content)}
                            >
                              <PenLine className="w-3 h-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit message</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                ) : (
                  editingMessageId === msg.id ? (
                    <div>
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={Math.max(2, Math.min(10, editDraft.split("\n").length + 1))}
                        className="w-full p-2 rounded-md border border-primary/40 bg-background text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                      <div className="flex gap-1 mt-2">
                        <Button size="sm" className="h-7 text-xs" onClick={() => handleSaveEdit(msg.id, "user")}>
                          <RefreshCw className="w-3 h-3 mr-1" /> Save & Retry
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditingMessageId(null); setEditDraft(""); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      <div className="flex items-center gap-1 mt-1 opacity-60 hover:opacity-100 transition-opacity">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1 text-muted-foreground hover:text-primary"
                              onClick={() => handleRetryUserMessage(msg.id)}
                              disabled={isSending}
                            >
                              <RefreshCw className="w-3 h-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Retry (get new response)</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1 text-muted-foreground hover:text-primary"
                              onClick={() => handleEditMessage(msg.id, msg.content)}
                              disabled={isSending}
                            >
                              <PenLine className="w-3 h-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit & retry</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  )
                )}
                {msg.ragChunksUsed && (msg.ragChunksUsed as any[]).length > 0 && (
                  <div className="mt-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-secondary/40 hover:bg-secondary hover:border-primary/40 text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                        >
                          <Globe className="w-3 h-3" />
                          <span>
                            {(msg.ragChunksUsed as any[]).length} knowledge source
                            {(msg.ragChunksUsed as any[]).length === 1 ? "" : "s"} used
                          </span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        side="top"
                        className="w-96 max-h-80 overflow-y-auto p-3"
                      >
                        <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                          <Database className="w-3 h-3 text-primary" />
                          Sources used in this response
                        </p>
                        <div className="space-y-2">
                          {(() => {
                            // De-duplicate by URL (or title) so repeated chunks from the same source collapse
                            const seen = new Map<string, any>();
                            for (const c of msg.ragChunksUsed as any[]) {
                              const key = (c.url || c.title || c.source || c.id) as string;
                              if (!seen.has(key)) seen.set(key, c);
                            }
                            const unique = Array.from(seen.values());
                            return unique.map((chunk, idx) => {
                              const label = chunk.title || chunk.source || chunk.url || "Unknown source";
                              const href = chunk.url as string | null | undefined;
                              const similarity =
                                typeof chunk.distance === "number"
                                  ? Math.max(0, Math.min(100, Math.round((1 - chunk.distance) * 100)))
                                  : null;
                              return (
                                <div
                                  key={`${chunk.id ?? idx}-${idx}`}
                                  className="p-2 rounded-md border border-border bg-card text-xs"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      {href ? (
                                        <a
                                          href={href}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="font-medium text-primary hover:underline break-words"
                                        >
                                          {label}
                                        </a>
                                      ) : (
                                        <span className="font-medium text-foreground break-words">
                                          {label}
                                        </span>
                                      )}
                                      {href && (
                                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                                          {href}
                                        </p>
                                      )}
                                    </div>
                                    {similarity !== null && (
                                      <Badge variant="outline" className="text-[10px] flex-shrink-0">
                                        {similarity}%
                                      </Badge>
                                    )}
                                  </div>
                                  {chunk.sourceType && (
                                    <Badge variant="outline" className="text-[10px] mt-1">
                                      {chunk.sourceType}
                                    </Badge>
                                  )}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {msg.createdAt.toLocaleTimeString()}
                </p>
              </div>
            </div>
            );
          })}

          {isSending && (
            <div className="flex gap-3 mb-4">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-primary/10 border border-primary/30">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="rounded-xl px-4 py-3 bg-card border border-border">
                <div className="flex items-center gap-2 text-primary">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Processing...</span>
                </div>
              </div>
            </div>
          )}

          {!isSending && lastFailedMessage && (
            <div className="flex gap-3 mb-4">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-red-500/10 border border-red-500/30">
                <AlertTriangle className="w-4 h-4 text-red-400" />
              </div>
              <div className="rounded-xl px-4 py-3 bg-card border border-red-500/30">
                <p className="text-sm text-red-400 mb-2">Response failed — timed out or lost connection.</p>
                <Button size="sm" variant="outline" onClick={handleRetry} className="gap-2">
                  <RefreshCw className="w-3 h-3" />
                  Retry
                </Button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </ScrollArea>

        {/* Token usage bar */}
        {tokenStats && (
          <div className="px-4 py-1 border-t border-border text-[10px] text-muted-foreground flex items-center gap-4"
            style={{ background: "oklch(0.09 0.016 240)" }}>
            <div className="flex items-center gap-1">
              <span className="text-primary font-mono">
                {tokenStats.totalTokens.toLocaleString()}
              </span>
              <span>tokens this chat</span>
            </div>
            <span className="opacity-40">·</span>
            <div className="flex items-center gap-1">
              <span className="font-mono">↑{tokenStats.byRole.user.toLocaleString()}</span>
              <span className="opacity-60">in</span>
              <span className="font-mono">↓{tokenStats.byRole.assistant.toLocaleString()}</span>
              <span className="opacity-60">out</span>
            </div>
            <span className="opacity-40">·</span>
            <div className="flex items-center gap-1">
              <span className="font-mono">{tokenStats.todayTokens.toLocaleString()}</span>
              <span>today</span>
            </div>
            <span className="opacity-40">·</span>
            <div className="flex items-center gap-1">
              <span className="font-mono">{tokenStats.weekTokens.toLocaleString()}</span>
              <span>this week</span>
            </div>
            {tokenStats.byModel && tokenStats.byModel.length > 0 && (
              <>
                <span className="opacity-40">·</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="hover:text-primary transition-colors underline-offset-2 hover:underline cursor-pointer">
                      by model ▾
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 p-3">
                    <p className="text-xs font-semibold mb-2">Tokens by Model</p>
                    <div className="space-y-1">
                      {tokenStats.byModel.map((m) => (
                        <div key={m.model} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground font-mono truncate mr-2">{m.model}</span>
                          <span className="text-foreground font-mono">{m.tokens.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2 italic">
                      Estimated at ~4 chars/token. Local models are free; cloud API models (OpenAI, ElevenLabs) cost real money.
                    </p>
                  </PopoverContent>
                </Popover>
              </>
            )}
          </div>
        )}

        {/* Input area */}
        <div className="px-4 py-3 border-t border-border"
          style={{ background: "oklch(0.10 0.016 240 / 0.8)", backdropFilter: "blur(8px)" }}>
          {/* Attached files preview */}
          {attachedFiles.length > 0 && (
            <div className="max-w-4xl mx-auto mb-2 flex flex-wrap gap-2">
              {attachedFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary border border-border text-xs">
                  <Upload className="w-3 h-3 text-primary" />
                  <span className="truncate max-w-[200px]">{f.name}</span>
                  <span className="text-muted-foreground">({(f.size / 1024).toFixed(0)}KB)</span>
                  <button
                    onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))}
                    className="text-muted-foreground hover:text-red-400 ml-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 max-w-4xl mx-auto">
            <input
              ref={chatFileInputRef}
              type="file"
              multiple
              className="hidden"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.js,.ts,.jsx,.tsx,.py,.java,.cpp,.c,.rs,.go"
              onChange={(e) => {
                if (e.target.files) {
                  setAttachedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                  e.target.value = "";
                }
              }}
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 rounded-xl flex-shrink-0 text-muted-foreground hover:text-primary"
                  onClick={() => chatFileInputRef.current?.click()}
                >
                  <Upload className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach files (added to knowledge base)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 rounded-xl flex-shrink-0 text-muted-foreground hover:text-primary"
                  disabled={generateImageMut.isPending}
                  onClick={() => {
                    const prompt = window.prompt("Describe the image to generate:");
                    if (prompt?.trim()) {
                      generateImageMut.mutate({ prompt: prompt.trim() });
                    }
                  }}
                >
                  {generateImageMut.isPending
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <ImagePlus className="w-5 h-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Generate image (DALL-E / Stable Diffusion)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={forceReasoning ? "default" : "outline"}
                  size="icon"
                  className={`h-12 w-12 rounded-xl flex-shrink-0 ${forceReasoning ? "text-primary-foreground bg-primary" : "text-muted-foreground hover:text-primary"}`}
                  onClick={() => setForceReasoning((v) => !v)}
                >
                  <Lightbulb className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{forceReasoning ? "Reasoning mode ON — every message uses deep thinking" : "Toggle reasoning mode (DeepSeek-R1 step-by-step)"}</TooltipContent>
            </Tooltip>

            <div className="flex-1 relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message JARVIS... (Enter to send, Shift+Enter for newline)"
                rows={1}
                className="w-full resize-none rounded-xl px-4 py-3 pr-12 text-sm bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all"
                style={{ minHeight: "48px", maxHeight: "200px" }}
                onInput={(e) => {
                  const t = e.target as HTMLTextAreaElement;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 200) + "px";
                }}
              />
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className={`h-12 w-12 rounded-xl flex-shrink-0 ${
                    isRecording
                      ? "text-red-400 border-red-400/50 bg-red-400/10 animate-pulse"
                      : "text-muted-foreground hover:text-primary"
                  }`}
                  onClick={isRecording ? stopRecording : startRecording}
                >
                  {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isRecording ? "Stop recording" : "Voice input"}</TooltipContent>
            </Tooltip>

            {isSending ? (
              <Button
                size="icon"
                variant="destructive"
                className="h-12 w-12 rounded-xl flex-shrink-0"
                onClick={stopGeneration}
                title="Stop generation"
              >
                <StopCircle className="w-5 h-5" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-12 w-12 rounded-xl flex-shrink-0"
                onClick={handleSend}
                disabled={(!input.trim() && attachedFiles.length === 0)}
                style={{ boxShadow: (input.trim() || attachedFiles.length > 0) ? "0 0 16px oklch(0.72 0.18 195 / 0.3)" : undefined }}
              >
                <Send className="w-5 h-5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Right Panel ─────────────────────────────────────────────────────── */}
      {sidePanel !== "chat" && (
        <aside className="border-l border-border flex flex-col relative"
          style={{ background: "oklch(0.10 0.016 240)", width: `${rightWidth}px` }}>
          {/* Left-edge resize handle */}
          <div
            className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-10"
            onMouseDown={(e) => {
              e.preventDefault();
              resizingRef.current = "right";
              startXRef.current = e.clientX;
              startWidthRef.current = rightWidth;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          />
          {/* Knowledge Panel */}
          {sidePanel === "knowledge" && (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm">Knowledge Base</span>
                </div>
                <Badge variant="secondary" className="text-xs font-mono">
                  {knowledgeData?.total ?? 0} chunks
                </Badge>
              </div>
              <ScrollArea className="flex-1 p-3 overflow-hidden">
                {(knowledgeData?.chunks ?? []).map((chunk: any) => (
                  <div key={chunk.id} className="mb-2 p-3 rounded-lg border border-border bg-card text-xs">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="font-medium text-primary truncate flex-1">
                        {chunk.sourceTitle || "Unknown Source"}
                      </span>
                      <Badge variant="outline" className="text-xs flex-shrink-0">{chunk.sourceType}</Badge>
                    </div>
                    <p className="text-muted-foreground line-clamp-3">{chunk.content}</p>
                    <p className="text-muted-foreground mt-1 font-mono">
                      {new Date(chunk.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                ))}
                {(!knowledgeData?.chunks || knowledgeData.chunks.length === 0) && (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    No knowledge chunks yet. Add scrape sources to start learning.
                  </p>
                )}
              </ScrollArea>
            </>
          )}

          {/* Scraper Panel */}
          {sidePanel === "scraper" && (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Rss className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm">Web Scraper</span>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                    onClick={() => seedSources.mutate()} disabled={seedSources.isPending}>
                    {seedSources.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
                    Seed
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                    onClick={() => scrapeNow.mutate({})} disabled={scrapeNow.isPending || !scraperEnabled}>
                    {scrapeNow.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Scrape All
                  </Button>
                </div>
              </div>

              {/* Master on/off toggle */}
              <div className="px-4 py-2 border-b border-border flex items-center justify-between bg-muted/30">
                <div className="flex flex-col">
                  <span className="text-xs font-medium">Background Scraping</span>
                  <span className="text-[10px] text-muted-foreground">
                    {scraperEnabled ? "Running on schedule" : "Paused — no auto-scrapes"}
                  </span>
                </div>
                <Switch
                  checked={scraperEnabled}
                  disabled={setScraperEnabled.isPending}
                  onCheckedChange={(checked) => setScraperEnabled.mutate({ enabled: checked })}
                />
              </div>

              {/* Media ingestion toggle (YouTube / TikTok / Instagram) */}
              <div className="px-4 py-2 border-b border-border flex items-center justify-between bg-muted/30">
                <div className="flex flex-col">
                  <span className="text-xs font-medium">Media Ingestion</span>
                  <span className="text-[10px] text-muted-foreground">
                    {mediaEnabled
                      ? "YouTube / TikTok / Instagram URLs allowed"
                      : "Off — media URLs will be rejected"}
                  </span>
                </div>
                <Switch
                  checked={mediaEnabled}
                  disabled={setMediaEnabled.isPending}
                  onCheckedChange={(checked) => setMediaEnabled.mutate({ enabled: checked })}
                />
              </div>

              {/* Add source form */}
              <div className="p-3 border-b border-border space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Add Source</p>
                <Input
                  placeholder="Name"
                  value={newSourceForm.name}
                  onChange={(e) => setNewSourceForm((f) => ({ ...f, name: e.target.value }))}
                  className="h-8 text-xs"
                />
                <Input
                  placeholder="URL"
                  value={newSourceForm.url}
                  onChange={(e) => setNewSourceForm((f) => ({ ...f, url: e.target.value }))}
                  className="h-8 text-xs"
                />
                <div className="flex gap-2">
                  <select
                    value={newSourceForm.type}
                    onChange={(e) => setNewSourceForm((f) => ({ ...f, type: e.target.value as any }))}
                    className="flex-1 h-8 text-xs rounded-md border border-border bg-input px-2 text-foreground"
                  >
                    <option value="rss">RSS Feed</option>
                    <option value="news">News Site</option>
                    <option value="custom_url">Custom URL</option>
                  </select>
                  <Button size="sm" className="h-8 text-xs"
                    onClick={() => addSource.mutate(newSourceForm)}
                    disabled={!newSourceForm.name || !newSourceForm.url || addSource.isPending}>
                    Add
                  </Button>
                </div>
              </div>

              <ScrollArea className="flex-1 p-3 overflow-hidden">
                {(scraperSources ?? []).map((source: any) => (
                  <div key={source.id} className="mb-2 p-3 rounded-lg border border-border bg-card text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium truncate flex-1">{source.name}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <StatusDot ok={source.isActive} />
                        <Button variant="ghost" size="icon" className="h-5 w-5"
                          onClick={() => toggleSource.mutate({ id: source.id, isActive: !source.isActive })}>
                          {source.isActive ? <StopCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-5 w-5"
                          onClick={() => scrapeNow.mutate({ sourceId: source.id })}>
                          <RefreshCw className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive"
                          onClick={() => deleteSource.mutate({ id: source.id })}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-muted-foreground truncate">{source.url}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">{source.type}</Badge>
                      <span className="text-muted-foreground font-mono">{source.totalChunks ?? 0} chunks</span>
                      {source.lastStatus === "error" && (
                        <span className="text-red-400 flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" /> Error
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </ScrollArea>
            </>
          )}

          {/* GitHub Repo Scraper Panel */}
          {sidePanel === "github" && (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Github className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm">GitHub Repos</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => runGithubScraper.mutate({ force: true })}
                  disabled={runGithubScraper.isPending}
                >
                  {runGithubScraper.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Scrape All
                </Button>
              </div>

              {/* Stats strip */}
              <div className="px-4 py-2 border-b border-border bg-muted/30 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-sm font-semibold">
                    {githubStats?.watchlistSize ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Repos</div>
                </div>
                <div>
                  <div className="text-sm font-semibold">
                    {(githubStats?.totalChunks ?? 0).toLocaleString()}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Chunks</div>
                </div>
                <div>
                  <div className="text-sm font-semibold">
                    {githubStats?.intervalHours ?? 168}h
                  </div>
                  <div className="text-[10px] text-muted-foreground">Cadence</div>
                </div>
              </div>

              {/* Add repo form */}
              <div className="p-3 border-b border-border space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Paste a GitHub URL, <span className="font-mono">owner/repo</span>, or fill the boxes manually
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="owner or full URL"
                    value={newRepoForm.owner}
                    onChange={(e) => {
                      const v = e.target.value;
                      const parsed = parseGithubInput(v);
                      if (parsed) {
                        setNewRepoForm((f) => ({ ...f, owner: parsed.owner, repo: parsed.repo }));
                      } else {
                        setNewRepoForm((f) => ({ ...f, owner: v }));
                      }
                    }}
                    className="h-8 text-xs"
                  />
                  <Input
                    placeholder="repo"
                    value={newRepoForm.repo}
                    onChange={(e) => {
                      const v = e.target.value;
                      // Allow pasting URL into the repo box too
                      const parsed = parseGithubInput(v);
                      if (parsed) {
                        setNewRepoForm((f) => ({ ...f, owner: parsed.owner, repo: parsed.repo }));
                      } else {
                        setNewRepoForm((f) => ({ ...f, repo: v }));
                      }
                    }}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="branch (optional — defaults to repo default)"
                    value={newRepoForm.branch}
                    onChange={(e) =>
                      setNewRepoForm((f) => ({ ...f, branch: e.target.value }))
                    }
                    className="h-8 text-xs flex-1"
                  />
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() =>
                      addGithubRepo.mutate({
                        owner: newRepoForm.owner.trim(),
                        repo: newRepoForm.repo.trim(),
                        branch: newRepoForm.branch.trim() || undefined,
                      })
                    }
                    disabled={
                      !newRepoForm.owner.trim() ||
                      !newRepoForm.repo.trim() ||
                      addGithubRepo.isPending
                    }
                  >
                    Add
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Fetches README + /docs markdown. SHA-gated (unchanged repos skip).
                  {" "}Set <span className="font-mono">GITHUB_TOKEN</span> in <span className="font-mono">.env</span> for 5000 req/hr instead of 60.
                </p>
              </div>

              <ScrollArea className="flex-1 p-3 overflow-hidden">
                {(githubRepos ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-8">
                    No repos on the watchlist yet. Add one above.
                  </p>
                ) : (
                  (githubRepos ?? []).map((r: any) => (
                    <div
                      key={r.id}
                      className="mb-2 p-3 rounded-lg border border-border bg-card text-xs"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <a
                          href={`https://github.com/${r.owner}/${r.repo}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium truncate flex-1 text-primary hover:underline"
                        >
                          {r.owner}/{r.repo}
                        </a>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <StatusDot ok={r.enabled === 1} />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() =>
                              toggleGithubRepo.mutate({
                                id: r.id,
                                enabled: r.enabled !== 1,
                              })
                            }
                            title={r.enabled === 1 ? "Disable" : "Enable"}
                          >
                            {r.enabled === 1 ? (
                              <StopCircle className="w-3 h-3" />
                            ) : (
                              <CheckCircle className="w-3 h-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-destructive"
                            onClick={() => removeGithubRepo.mutate({ id: r.id })}
                            title="Remove from watchlist"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground font-mono flex-wrap">
                        <span>{(r.chunksIngested ?? 0).toLocaleString()} chunks</span>
                        {r.branch && <span>• branch {r.branch}</span>}
                        {r.lastSha && (
                          <span>• sha {String(r.lastSha).slice(0, 7)}</span>
                        )}
                        {r.lastScrapedAt && (
                          <span>
                            • last {new Date(r.lastScrapedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      {r.lastError && (
                        <div className="mt-1 text-[10px] text-red-400 flex items-start gap-1">
                          <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                          <span className="break-all">{r.lastError}</span>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </ScrollArea>
            </>
          )}

          {/* Self-Improvement Panel */}
          {sidePanel === "improvement" && (
            <>
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm">Self-Improvement</span>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant={improvementTab === "evaluation" ? "default" : "outline"} className="h-6 text-xs flex-1"
                    onClick={() => setImprovementTab("evaluation")}>
                    Knowledge Eval
                  </Button>
                  <Button size="sm" variant={improvementTab === "patches" ? "default" : "outline"} className="h-6 text-xs flex-1"
                    onClick={() => setImprovementTab("patches")}>
                    Patches
                  </Button>
                </div>
              </div>

              {/* ── Knowledge-Backed Evaluation Tab ── */}
              {improvementTab === "evaluation" && (
                <ScrollArea className="flex-1 p-3 overflow-hidden">
                  <div className="flex gap-1 mb-3">
                    {(!evalPlan || evalPlan.status !== "running") ? (
                      <Button size="sm" className="h-7 text-xs gap-1 flex-1"
                        onClick={() => startEvaluation.mutate()} disabled={startEvaluation.isPending}>
                        {startEvaluation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                        Analyze Code
                      </Button>
                    ) : (
                      <Button size="sm" variant="destructive" className="h-7 text-xs gap-1 flex-1"
                        onClick={() => cancelEvaluation.mutate()}>
                        <XCircle className="w-3 h-3" /> Cancel
                      </Button>
                    )}
                  </div>

                  {/* Progress */}
                  {evalPlan?.status === "running" && (
                    <div className="mb-3 p-2 rounded-lg border border-border bg-card text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <Loader2 className="w-3 h-3 animate-spin text-primary" />
                        <span className="font-medium">Evaluating...</span>
                      </div>
                      <p className="text-muted-foreground">
                        {evalPlan.progress.currentFile} ({evalPlan.progress.filesProcessed}/{evalPlan.progress.totalFiles} files)
                      </p>
                      <p className="text-muted-foreground">{evalPlan.progress.itemsFound} suggestions found</p>
                      <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${evalPlan.progress.totalFiles ? (evalPlan.progress.filesProcessed / evalPlan.progress.totalFiles) * 100 : 0}%` }} />
                      </div>
                    </div>
                  )}

                  {evalPlan?.status === "completed" && (
                    <div className="mb-3 p-2 rounded-lg border border-green-500/30 bg-green-500/5 text-xs text-green-400">
                      Evaluation complete: {evalPlan.items.length} suggestions from {evalPlan.progress.totalFiles} files
                      ({((evalPlan.completedAt! - evalPlan.createdAt) / 60000).toFixed(1)} min)
                    </div>
                  )}

                  {evalPlan?.status === "failed" && (
                    <div className="mb-3 p-2 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-400">
                      Evaluation failed: {evalPlan.error}
                    </div>
                  )}

                  {/* Plan Items */}
                  {(evalPlan?.items ?? []).map((item: any) => (
                    <div key={item.id} className="mb-3 p-3 rounded-lg border border-border bg-card text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <Badge variant={
                          item.severity === "high" ? "destructive" :
                          item.severity === "medium" ? "secondary" : "outline"
                        } className="text-xs">{item.severity}</Badge>
                        <Badge variant="outline" className="text-xs">{item.category}</Badge>
                      </div>
                      <p className="font-medium text-foreground mb-1">{item.title}</p>
                      <p className="text-muted-foreground font-mono text-xs mb-1">{item.file}</p>
                      <p className="text-foreground/80 mb-2">{item.description}</p>
                      {item.rationale && (
                        <p className="text-muted-foreground italic mb-2">{item.rationale}</p>
                      )}
                      {item.knowledgeSources?.length > 0 && (
                        <div className="mb-2">
                          <p className="text-muted-foreground font-medium mb-1">Knowledge sources:</p>
                          {item.knowledgeSources.map((s: any, i: number) => (
                            <p key={i} className="text-muted-foreground/70 text-xs ml-2">- {s.title}</p>
                          ))}
                        </div>
                      )}
                      {item.status === "pending" && (
                        <div className="flex gap-1">
                          <Button size="sm" className="h-6 text-xs flex-1"
                            onClick={() => updatePlanItem.mutate({ itemId: item.id, status: "accepted" })}>
                            <CheckCircle className="w-3 h-3 mr-1" /> Accept
                          </Button>
                          <Button size="sm" variant="secondary" className="h-6 text-xs flex-1"
                            onClick={() => updatePlanItem.mutate({ itemId: item.id, status: "modified" })}>
                            Modify
                          </Button>
                          <Button size="sm" variant="destructive" className="h-6 text-xs flex-1"
                            onClick={() => updatePlanItem.mutate({ itemId: item.id, status: "rejected" })}>
                            <XCircle className="w-3 h-3 mr-1" /> Reject
                          </Button>
                        </div>
                      )}
                      {item.status !== "pending" && (
                        <Badge variant={
                          item.status === "accepted" ? "default" :
                          item.status === "modified" ? "secondary" : "destructive"
                        } className="text-xs">{item.status}</Badge>
                      )}
                    </div>
                  ))}

                  {(!evalPlan || evalPlan.items.length === 0) && evalPlan?.status !== "running" && (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      No evaluation yet. Click "Analyze Code" to run a knowledge-backed code review.
                    </p>
                  )}
                </ScrollArea>
              )}

              {/* ── Old Patches Tab ── */}
              {improvementTab === "patches" && (
                <ScrollArea className="flex-1 p-3 overflow-hidden">
                  <div className="mb-3">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 w-full"
                      onClick={() => runAnalysis.mutate()} disabled={runAnalysis.isPending}>
                      {runAnalysis.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                      Quick Analyze
                    </Button>
                  </div>
                  {(patches ?? []).map((patch: any) => (
                    <div key={patch.id} className="mb-3 p-3 rounded-lg border border-border bg-card text-xs">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-muted-foreground">#{patch.id}</span>
                        <Badge variant={
                          patch.status === "applied" ? "default" :
                          patch.status === "approved" ? "secondary" :
                          patch.status === "rejected" ? "destructive" : "outline"
                        } className="text-xs">
                          {patch.status}
                        </Badge>
                      </div>
                      <p className="text-foreground line-clamp-4 mb-2">{patch.suggestion}</p>
                      {patch.targetFile && (
                        <p className="text-muted-foreground font-mono mb-2">{patch.targetFile}</p>
                      )}
                      {patch.status === "pending" && (
                        <div className="flex gap-1">
                          <Button size="sm" className="h-6 text-xs flex-1"
                            onClick={() => patchAction.mutate({ id: patch.id, action: "approved" })}>
                            <CheckCircle className="w-3 h-3 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="destructive" className="h-6 text-xs flex-1"
                            onClick={() => patchAction.mutate({ id: patch.id, action: "rejected" })}>
                            <XCircle className="w-3 h-3 mr-1" /> Reject
                          </Button>
                        </div>
                      )}
                      {patch.status === "approved" && patch.patchDiff && (
                        <Button size="sm" variant="outline" className="h-6 text-xs w-full"
                          onClick={() => applyPatch.mutate({ id: patch.id })}>
                          <Zap className="w-3 h-3 mr-1" /> Apply Patch
                        </Button>
                      )}
                    </div>
                  ))}
                  {(!patches || patches.length === 0) && (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      No patches yet. Click "Quick Analyze" to run analysis.
                    </p>
                  )}
                </ScrollArea>
              )}
            </>
          )}

          {/* Upload Panel */}
          {sidePanel === "upload" && (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Upload className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm">File Upload</span>
              </div>
              <div className="flex-1 overflow-hidden p-3">
                <FileUploadPanel />
              </div>
            </>
          )}

          {/* Benchmarks Panel */}
          {sidePanel === "benchmarks" && (() => {
            const chunks = status?.knowledge?.totalChunks ?? 0;
            const sources = status?.scraper?.totalSources ?? 0;
            const activeSources = status?.scraper?.activeSources ?? 0;
            const models = status?.ollama?.models?.length ?? 0;
            const convCount = conversations?.length ?? 0;

            // Milestone targets — bars fill toward the next round number.
            const nextMilestone = (n: number, step: number) =>
              Math.max(step, Math.ceil((n + 1) / step) * step);
            const chunkTarget = nextMilestone(chunks, 1000);
            const sourceTarget = nextMilestone(sources, 25);
            const convTarget = nextMilestone(convCount, 50);

            const entities = status?.entityGraph?.entities ?? 0;
            const connections = status?.entityGraph?.relationshipPairs ?? 0;
            const entityTarget = nextMilestone(entities, 10000);
            const connectionTarget = nextMilestone(connections, 100000);

            const jarvisStats = [
              { label: "Knowledge Chunks", value: chunks, target: chunkTarget },
              { label: "Active Sources",   value: activeSources, target: sourceTarget, suffix: ` / ${sources} total` },
              { label: "Entities (Graph)", value: entities, target: entityTarget },
              { label: "Connections",      value: connections, target: connectionTarget },
              { label: "Conversations",    value: convCount, target: convTarget },
              { label: "Local Models",     value: models, target: Math.max(5, models + 1) },
            ];

            return (
              <>
                <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm">Benchmarks</span>
                </div>
                <ScrollArea className="flex-1 p-3 overflow-hidden">
                  {/* Jarvis self-reported stats */}
                  <div className="mb-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Brain className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                        Jarvis Stats
                      </span>
                    </div>
                    <div className="space-y-3">
                      {jarvisStats.map((s) => {
                        const pct = Math.min(100, Math.round((s.value / s.target) * 100));
                        return (
                          <div key={s.label}>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-muted-foreground">{s.label}</span>
                              <span className="font-mono text-foreground">
                                {s.value.toLocaleString()}
                                {s.suffix ?? ` / ${s.target.toLocaleString()}`}
                              </span>
                            </div>
                            <Progress value={pct} className="h-1.5" />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <Separator className="my-4" />

                  {/* Activity rates — server-side rolling window counts.
                      Distinguishes loading / error / data states so a literal
                      0 is never confused with "the endpoint is missing because
                      the server hasn't reloaded yet". */}
                  <div className="mb-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Activity className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                        Activity
                      </span>
                    </div>
                    {ratesError ? (
                      <div className="rounded-lg p-3 text-center text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20">
                        Activity endpoint unreachable — restart the dev server to pick up the new tRPC route.
                      </div>
                    ) : ratesLoading || !rates ? (
                      <div className="rounded-lg p-3 text-center text-xs text-muted-foreground"
                        style={{ background: "oklch(0.12 0.018 240)", border: "1px solid oklch(0.22 0.03 230)" }}>
                        Loading activity…
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          {
                            label: "Chunks 1h",
                            value: rates.chunksLast1h,
                            // chunks/min derived from the hourly count — feels live without
                            // requiring a finer sampling cadence
                            sub: `${(rates.chunksLast1h / 60).toFixed(1)}/min`,
                          },
                          {
                            label: "Chunks 24h",
                            value: rates.chunksLast24h,
                            sub: null,
                          },
                          {
                            label: "New sources 24h",
                            value: rates.sourcesAddedLast24h,
                            sub: null,
                          },
                        ].map((m) => (
                          <div
                            key={m.label}
                            className="rounded-lg p-2 text-center"
                            style={{ background: "oklch(0.12 0.018 240)", border: "1px solid oklch(0.22 0.03 230)" }}
                          >
                            <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">{m.label}</p>
                            <p className="text-sm font-mono text-foreground">{m.value.toLocaleString()}</p>
                            {m.sub && <p className="text-[9px] text-muted-foreground mt-0.5">{m.sub}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <Separator className="my-4" />

                  {/* AI landscape reference card */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Globe className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                        AI Landscape
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mb-3">
                      Public benchmark scores (MMLU / HumanEval). Reference only.
                    </p>
                    <div className="space-y-3">
                      {AI_LANDSCAPE.map((m) => (
                        <div key={m.name} className="p-2 rounded-lg border border-border bg-card">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-medium">{m.name}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              MMLU {m.mmlu} · HE {m.humanEval}
                            </span>
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground w-12">MMLU</span>
                              <Progress value={m.mmlu} className="h-1 flex-1" />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground w-12">HumanEval</span>
                              <Progress value={m.humanEval} className="h-1 flex-1" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </ScrollArea>
              </>
            );
          })()}

          {/* Logs Panel */}
          {sidePanel === "logs" && (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm">System Logs</span>
              </div>
              <ScrollArea className="flex-1 p-3 overflow-hidden">
                {(logsData ?? []).map((log: any) => (
                  <div key={log.id} className="mb-1 text-xs font-mono">
                    <span className={`mr-2 ${
                      log.level === "error" ? "text-red-400" :
                      log.level === "warn" ? "text-amber-400" :
                      log.level === "debug" ? "text-muted-foreground" : "text-emerald-400"
                    }`}>
                      [{(log.level ?? "info").toUpperCase()}]
                    </span>
                    <span className="text-primary/70">[{log.module}]</span>
                    <span className="text-foreground/80 ml-1">{log.message}</span>
                  </div>
                ))}
                {(!logsData || logsData.length === 0) && (
                  <p className="text-xs text-muted-foreground text-center py-8">No logs yet</p>
                )}
              </ScrollArea>
            </>
          )}
          {/* Whiteboard / drawn notes — subjects on left, pages along top, canvas main */}
          {sidePanel === "whiteboard" && (
            <>
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Palette className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm">Whiteboard</span>
                  <span className="text-[11px] text-muted-foreground ml-auto">
                    auto-saves on stroke end
                  </span>
                </div>
              </div>
              <div className="flex-1 flex flex-col min-h-0">
                <Whiteboard />
              </div>
            </>
          )}

          {/* Notes Panel */}
          {sidePanel === "notes" && (
            <>
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <NotebookPen className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-sm">Voice Notes</span>
                    {notesRecording && (
                      <div className="flex items-center gap-1">
                        <CircleDot className="w-3 h-3 text-red-400 animate-pulse" />
                        <span className="text-xs text-red-400">Recording</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {!notesRecording ? (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                        onClick={startNotesRecording}>
                        <Mic className="w-3 h-3" /> Record
                      </Button>
                    ) : (
                      <Button size="sm" variant="destructive" className="h-7 text-xs gap-1"
                        onClick={stopNotesRecording}>
                        <Square className="w-3 h-3" /> Stop
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={summarizeNotes}
                      disabled={notesSummarizing || !notesTranscript.trim()}>
                      {notesSummarizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                      Summarize
                    </Button>
                  </div>
                </div>
                {/* Live insights toggle — opt-in so we don't hit the retriever
                    on every transcription unless the user wants background
                    research running. */}
                <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                  <Switch
                    checked={notesEnrichmentEnabled}
                    onCheckedChange={setNotesEnrichmentEnabled}
                  />
                  <Sparkles className="w-3 h-3 text-primary" />
                  <span>
                    Live insights
                    <span className="ml-1 opacity-70">
                      — JARVIS researches topics you mention and shows relevant facts
                    </span>
                  </span>
                </label>
              </div>
              {/* Enrichment cards — arriving during recording. Pin any you
                  want folded into the final summary. */}
              {noteEnrichments.length > 0 && (
                <div className="px-4 py-2 border-b border-border bg-secondary/20 max-h-48 overflow-y-auto">
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                    Live insights · {noteEnrichments.length}
                  </div>
                  <div className="space-y-1.5">
                    {noteEnrichments.map((e) => {
                      const pinned = pinnedEnrichmentIds.has(e.id);
                      const color =
                        e.type === "warning" ? "border-amber-500/40 bg-amber-500/5" :
                        e.type === "definition" ? "border-sky-500/40 bg-sky-500/5" :
                        e.type === "related" ? "border-muted-foreground/30 bg-muted/20" :
                        "border-emerald-500/40 bg-emerald-500/5";
                      return (
                        <div
                          key={e.id}
                          className={`rounded-md border p-2 text-[11px] ${color} ${pinned ? "ring-1 ring-primary/50" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="flex items-center gap-1 flex-1 min-w-0">
                              <Sparkles className="w-3 h-3 text-primary flex-shrink-0" />
                              <span className="font-semibold truncate">{e.topic}</span>
                              <Badge variant="outline" className="text-[9px] h-4 px-1 font-mono">
                                {Math.round(e.confidence * 100)}%
                              </Badge>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className={`h-5 px-1 text-[10px] ${pinned ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                              onClick={() => {
                                setPinnedEnrichmentIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(e.id)) next.delete(e.id);
                                  else next.add(e.id);
                                  return next;
                                });
                              }}
                            >
                              {pinned ? "Pinned" : "Pin"}
                            </Button>
                          </div>
                          <p className="text-foreground/85 leading-snug">{e.content}</p>
                          {e.sourceTitle && (
                            <div className="mt-1 text-[9px] text-muted-foreground truncate">
                              {e.sourceUrl ? (
                                <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
                                  {e.sourceTitle}
                                </a>
                              ) : (
                                e.sourceTitle
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {pinnedEnrichmentIds.size > 0 && (
                    <p className="text-[9px] text-muted-foreground mt-2 italic">
                      {pinnedEnrichmentIds.size} pinned — will be woven into the summary.
                    </p>
                  )}
                </div>
              )}
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Raw Transcript */}
                <div className="flex-1 flex flex-col border-b border-border min-h-0">
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Raw Transcript</span>
                    {notesTranscript && (
                      <Button size="sm" variant="ghost" className="h-5 text-xs px-1"
                        onClick={() => { navigator.clipboard.writeText(notesTranscript); toast.success("Copied!"); }}>
                        Copy
                      </Button>
                    )}
                  </div>
                  <ScrollArea className="flex-1 px-3 pb-2 overflow-hidden">
                    {notesTranscript ? (
                      <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">{notesTranscript}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground text-center py-6">
                        {notesRecording ? "Listening... speak and your words will appear here." : "Click Record to start capturing voice notes."}
                      </p>
                    )}
                  </ScrollArea>
                </div>
                {/* Summarized / Improved */}
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Summarized & Organized</span>
                    {notesSummary && (
                      <Button size="sm" variant="ghost" className="h-5 text-xs px-1"
                        onClick={() => { navigator.clipboard.writeText(notesSummary); toast.success("Copied!"); }}>
                        Copy
                      </Button>
                    )}
                  </div>
                  <ScrollArea className="flex-1 px-3 pb-2 overflow-hidden">
                    {notesSummary ? (
                      <div className="text-xs text-foreground/90 prose prose-invert prose-xs max-w-none">
                        <Streamdown>{notesSummary}</Streamdown>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground text-center py-6">
                        {notesTranscript ? "Click Summarize to organize your notes." : "Record some notes first, then summarize."}
                      </p>
                    )}
                  </ScrollArea>
                </div>
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
