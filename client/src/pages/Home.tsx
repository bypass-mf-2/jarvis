import { useState, useRef, useEffect, useCallback } from "react";
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
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import {
  Send, Mic, MicOff, Volume2, VolumeX, Plus, Trash2,
  Brain, Globe, Zap, ChevronLeft, ChevronRight,
  MessageSquare, Database, Rss, Settings, Activity,
  RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle,
  Bot, User, Loader2, StopCircle,
  Upload, BarChart3
} from "lucide-react";
import { FileUploadPanel } from "@/components/FileUploadPanel";
import { MessageRating, TrainingDashboard } from "@/components/TrainingComponents";

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

type SidePanel = "chat" | "knowledge" | "scraper" | "improvement" | "logs" | "upload" | "training" | "benchmarks";

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const synth = useRef<SpeechSynthesis | null>(null);
  const isSendingRef = useRef(false);

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
  const { data: convData, refetch: refetchMessages } = trpc.chat.getConversation.useQuery(
    { id: activeConvId! },
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
  const { data: rates, refetch: refetchRates } = trpc.systemStatus.rates.useQuery(
    undefined,
    { enabled: sidePanel === "benchmarks", refetchInterval: 10000 }
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

  const { data: scraperEnabledData, refetch: refetchScraperEnabled } = trpc.scraper.getEnabled.useQuery();
  const scraperEnabled = scraperEnabledData?.enabled ?? true;
  const setScraperEnabled = trpc.scraper.setEnabled.useMutation({
    onSuccess: (r) => {
      toast.success(r.enabled ? "Scraping resumed" : "Scraping paused");
      refetchScraperEnabled();
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

  const transcribeAudio = trpc.chat.transcribeAudio.useMutation({
    onSuccess: (r) => { setInput(r.text); toast.success("Voice transcribed"); },
    onError: () => toast.error("Transcription failed"),
  });

  // ── Auto-scroll ──────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convData?.messages, streamedResponse]);

  // ── Attached files for chat input ────────────────────────────────────────────
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

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
    const summaries = await uploadAttachedFiles(attachedFiles);
    const filesNote = `\n\n[Attached files added to knowledge base:]\n${summaries.join("\n")}`;
    messageText = messageText ? messageText + filesNote : filesNote;
    setAttachedFiles([]);
  }

  setInput("");

  const payload = { conversationId: convId, content: messageText };
  setLastFailedMessage(payload);

  sendMessage.mutate(payload, {
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
    }
  );
}, [input, attachedFiles, activeConvId, voiceEnabled, refetchMessages, uploadAttachedFiles]);

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
  const speakText = (text: string) => {
    if (!synth.current || !voiceEnabled) return;
    synth.current.cancel();
    const clean = text.replace(/[#*`_~\[\]]/g, "").slice(0, 500);
    const utt = new SpeechSynthesisUtterance(clean);
    utt.rate = 0.95;
    utt.pitch = 0.9;
    const voices = synth.current.getVoices();
    const preferred = voices.find((v) => v.name.includes("Google") && v.lang.startsWith("en"));
    if (preferred) utt.voice = preferred;
    synth.current.speak(utt);
  };

  const stopSpeaking = () => synth.current?.cancel();

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

  // ── Messages display ─────────────────────────────────────────────────────────
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
        className={`flex flex-col border-r border-border transition-all duration-300 ${
          sidebarOpen ? "w-64" : "w-0 overflow-hidden"
        }`}
        style={{ background: "oklch(0.10 0.016 240)" }}
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
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => createConv.mutate({})}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {/* Conversation list */}
        <ScrollArea className="flex-1 px-2 py-2 overflow-hidden">
          {(conversations ?? []).map((conv: Conversation) => (
            <div
              key={conv.id}
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
      </aside>

      {/* ── Main Chat Area ──────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">
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

          {/* Right panel nav */}
          <div className="flex items-center gap-1">
            {([
              { id: "knowledge", icon: Database, label: "Knowledge" },
              { id: "scraper", icon: Rss, label: "Scraper" },
              { id: "improvement", icon: Zap, label: "Self-Improve" },
              { id: "benchmarks", icon: BarChart3, label: "Benchmarks" },
              { id: "logs", icon: Activity, label: "Logs" },
            ] as const).map(({ id, icon: Icon, label }) => (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-8 w-8 ${sidePanel === id ? "text-primary bg-primary/10" : "text-muted-foreground"}`}
                    onClick={() => setSidePanel(sidePanel === id ? "chat" : id)}
                  >
                    <Icon className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            ))}

            <Separator orientation="vertical" className="h-6 mx-1" />

            {/* ADD THIS: */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 ${sidePanel === "upload" ? "text-primary" : ""}`}
                  onClick={() => setSidePanel("upload")}
                >
                  <Upload className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Upload Files</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 ${voiceEnabled ? "text-primary" : "text-muted-foreground"}`}
                  onClick={() => { setVoiceEnabled((v) => !v); stopSpeaking(); }}
                >
                  {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{voiceEnabled ? "Disable voice" : "Enable voice"}</TooltipContent>
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
                  { icon: Globe, label: "Web Knowledge", value: `${status?.knowledge?.totalChunks ?? 0} chunks` },
                  { icon: Rss, label: "Active Sources", value: `${status?.scraper?.activeSources ?? 0} feeds` },
                  { icon: Brain, label: "LLM Model", value: status?.ollama?.models?.[0] ?? "Fallback" },
                  { icon: Zap, label: "Self-Improve", value: "Active" },
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

          {messages.map((msg) => (
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
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none text-foreground">
                    <Streamdown>{msg.content}</Streamdown>
                    <MessageRating 
                        messageId={msg.id} 
                        currentRating={msg.userRating ?? undefined}
                      />
                  </div>
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
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
          ))}

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

            <Button
              size="icon"
              className="h-12 w-12 rounded-xl flex-shrink-0"
              onClick={handleSend}
              disabled={(!input.trim() && attachedFiles.length === 0) || isSending}
              style={{ boxShadow: (input.trim() || attachedFiles.length > 0) ? "0 0 16px oklch(0.72 0.18 195 / 0.3)" : undefined }}
            >
              {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Right Panel ─────────────────────────────────────────────────────── */}
      {sidePanel !== "chat" && (
        <aside className="w-80 border-l border-border flex flex-col"
          style={{ background: "oklch(0.10 0.016 240)" }}>
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

          {/* Self-Improvement Panel */}
          {sidePanel === "improvement" && (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm">Self-Improvement</span>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                  onClick={() => runAnalysis.mutate()} disabled={runAnalysis.isPending}>
                  {runAnalysis.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                  Analyze
                </Button>
              </div>
              <ScrollArea className="flex-1 p-3 overflow-hidden">
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
                    No patches yet. Click "Analyze" to run self-improvement analysis.
                  </p>
                )}
              </ScrollArea>
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

            const jarvisStats = [
              { label: "Knowledge Chunks", value: chunks, target: chunkTarget },
              { label: "Active Sources",   value: activeSources, target: sourceTarget, suffix: ` / ${sources} total` },
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

                  {/* Activity rates — server-side rolling window counts */}
                  <div className="mb-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Activity className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                        Activity
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        {
                          label: "Chunks 1h",
                          value: rates?.chunksLast1h ?? 0,
                          // chunks/min derived from the hourly count — feels live without
                          // requiring a finer sampling cadence
                          sub: rates ? `${(rates.chunksLast1h / 60).toFixed(1)}/min` : null,
                        },
                        {
                          label: "Chunks 24h",
                          value: rates?.chunksLast24h ?? 0,
                          sub: null,
                        },
                        {
                          label: "New sources 24h",
                          value: rates?.sourcesAddedLast24h ?? 0,
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
        </aside>
      )}
    </div>
  );
}
