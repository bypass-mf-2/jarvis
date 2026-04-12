import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowLeft,
  Play,
  StopCircle,
  Loader2,
  Globe,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  ShieldCheck,
  MousePointer,
  Type,
  Navigation,
  Eye,
  Clock,
  Download,
  KeyRound,
  Plus,
  Trash2,
  FileText,
} from "lucide-react";

// ─── Helpers ───────────────────────────────────────────────────────────────

function actionIcon(kind: string) {
  switch (kind) {
    case "goto": return Navigation;
    case "click": return MousePointer;
    case "type": return Type;
    case "extract": return Eye;
    case "wait": return Clock;
    case "switchTab": return Globe;
    case "closeTab": return XCircle;
    default: return Globe;
  }
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string; Icon: any }> = {
    running: { label: "Running", className: "bg-blue-500/15 text-blue-400 border-blue-500/30", Icon: Loader2 },
    completed: { label: "Completed", className: "bg-green-500/15 text-green-400 border-green-500/30", Icon: CheckCircle2 },
    failed: { label: "Failed", className: "bg-red-500/15 text-red-400 border-red-500/30", Icon: XCircle },
    stopped: { label: "Stopped", className: "bg-amber-500/15 text-amber-400 border-amber-500/30", Icon: StopCircle },
    awaiting_confirmation: {
      label: "Needs approval",
      className: "bg-purple-500/15 text-purple-400 border-purple-500/30",
      Icon: ShieldAlert,
    },
    awaiting_typed_confirmation: {
      label: "High-stakes approval",
      className: "bg-red-500/15 text-red-400 border-red-500/30",
      Icon: ShieldAlert,
    },
  };
  const c = config[status] ?? { label: status, className: "", Icon: Globe };
  const Icon = c.Icon;
  return (
    <Badge variant="outline" className={`gap-1.5 ${c.className}`}>
      <Icon className={`h-3 w-3 ${status === "running" ? "animate-spin" : ""}`} />
      {c.label}
    </Badge>
  );
}

// ─── Sessions panel subcomponent ───────────────────────────────────────────

function SessionsPanel() {
  const { data: sessions, refetch } = trpc.navigator.listSessions.useQuery();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureStartUrl, setCaptureStartUrl] = useState("");
  const [captureName, setCaptureName] = useState("");
  const [captureDesc, setCaptureDesc] = useState("");
  const [captureStep, setCaptureStep] = useState<"idle" | "in_progress">("idle");

  const beginCapture = trpc.navigator.beginCapture.useMutation({
    onSuccess: () => {
      setCaptureStep("in_progress");
      toast.success("Chromium opened. Log in manually, then name and save the session.");
    },
    onError: (err) => toast.error(`Capture failed: ${err.message}`),
  });

  const finalizeCapture = trpc.navigator.finalizeCapture.useMutation({
    onSuccess: () => {
      toast.success("Session saved");
      setCaptureOpen(false);
      setCaptureName("");
      setCaptureDesc("");
      setCaptureStartUrl("");
      setCaptureStep("idle");
      refetch();
    },
    onError: (err) => toast.error(`Save failed: ${err.message}`),
  });

  const cancelCapture = trpc.navigator.cancelCapture.useMutation({
    onSuccess: () => {
      setCaptureOpen(false);
      setCaptureStep("idle");
      refetch();
    },
  });

  const deleteSession = trpc.navigator.deleteSession.useMutation({
    onSuccess: () => {
      toast.success("Session deleted");
      refetch();
    },
  });

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Saved sessions ({sessions?.length ?? 0})
          </span>
          <Dialog open={captureOpen} onOpenChange={(v) => { setCaptureOpen(v); if (!v && captureStep === "in_progress") cancelCapture.mutate(); }}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Capture new session
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Capture a login session</DialogTitle>
                <DialogDescription>
                  Jarvis will open a Chromium window. Navigate to any site, log
                  in manually, then come back here and name the session. The
                  cookies + localStorage are saved so future Navigator tasks
                  start already authenticated.
                </DialogDescription>
              </DialogHeader>

              {captureStep === "idle" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="cap-url">
                      Start URL <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="cap-url"
                      placeholder="https://github.com/login"
                      value={captureStartUrl}
                      onChange={(e) => setCaptureStartUrl(e.target.value)}
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={() => beginCapture.mutate({ startUrl: captureStartUrl || undefined })}
                      disabled={beginCapture.isPending}
                    >
                      {beginCapture.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Open browser
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-sm">
                    Browser is open. Finish logging in, then fill in the name
                    below and click Save. Don't close the browser yourself —
                    Jarvis closes it when you save or cancel.
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cap-name">Session name *</Label>
                    <Input
                      id="cap-name"
                      placeholder="github-main"
                      value={captureName}
                      onChange={(e) => setCaptureName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cap-desc">
                      Description <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="cap-desc"
                      placeholder="Main GitHub account"
                      value={captureDesc}
                      onChange={(e) => setCaptureDesc(e.target.value)}
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => cancelCapture.mutate()}>
                      Cancel
                    </Button>
                    <Button
                      disabled={!captureName.trim() || finalizeCapture.isPending}
                      onClick={() =>
                        finalizeCapture.mutate({
                          name: captureName.trim(),
                          description: captureDesc.trim() || undefined,
                        })
                      }
                    >
                      {finalizeCapture.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save session
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {!sessions || sessions.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No saved sessions. Capture one to start running tasks that need login.
          </div>
        ) : (
          <ul>
            {sessions.map((s: any, i: number) => (
              <li key={s.id}>
                {i > 0 && <Separator />}
                <div className="flex items-center justify-between gap-4 p-4 hover:bg-muted/30">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-green-400" />
                      <span className="font-medium">{s.name}</span>
                      {s.origin && (
                        <Badge variant="outline" className="text-xs">
                          {s.origin}
                        </Badge>
                      )}
                    </div>
                    {s.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Captured {new Date(s.createdAt).toLocaleDateString()}
                      {s.lastUsedAt && ` · last used ${new Date(s.lastUsedAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteSession.mutate({ id: s.id })}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function Navigator() {
  const [goal, setGoal] = useState("");
  const [allowlistInput, setAllowlistInput] = useState("");
  const [maxSteps, setMaxSteps] = useState(15);
  const [headless, setHeadless] = useState(false);
  const [highStakes, setHighStakes] = useState(false);
  const [sessionId, setSessionId] = useState<string>("none");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [typedConfirmation, setTypedConfirmation] = useState("");

  const { data: sessions } = trpc.navigator.listSessions.useQuery();

  const { data: activeRun, refetch: refetchRun } = trpc.navigator.getRun.useQuery(
    { taskId: activeTaskId ?? "" },
    {
      enabled: !!activeTaskId,
      refetchInterval: (query) => {
        const run = query.state.data as any;
        if (!run) return 2000;
        if (run.status === "running") return 1500;
        return false;
      },
    }
  );

  const { data: runs, refetch: refetchRuns } = trpc.navigator.listRuns.useQuery(undefined, {
    refetchInterval: 3000,
  });

  const startMutation = trpc.navigator.startTask.useMutation({
    onSuccess: (data) => {
      setActiveTaskId(data.taskId);
      toast.success("Task started — watch the browser window");
      refetchRuns();
    },
    onError: (err) => toast.error(`Start failed: ${err.message}`),
  });

  const stopMutation = trpc.navigator.stopTask.useMutation({
    onSuccess: () => { refetchRun(); refetchRuns(); },
  });

  const resolveMutation = trpc.navigator.resolvePending.useMutation({
    onSuccess: () => { refetchRun(); refetchRuns(); },
  });

  const resolveTypedMutation = trpc.navigator.resolveTyped.useMutation({
    onSuccess: (data) => {
      if (data.approved) {
        toast.success("Action approved");
      } else {
        toast.error(data.reason || "Rejected");
      }
      setTypedConfirmation("");
      refetchRun();
      refetchRuns();
    },
  });

  const startTask = () => {
    if (goal.trim().length < 5) {
      toast.error("Goal must be at least 5 characters");
      return;
    }
    const allowlist = allowlistInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    startMutation.mutate({
      goal: goal.trim(),
      allowlist,
      maxSteps,
      headless,
      highStakes,
      allowDestructive: false,
      sessionId: sessionId === "none" ? null : parseInt(sessionId),
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl p-6">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="mb-6 flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" aria-label="Back to chat">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">Navigator</h1>
            <p className="text-sm text-muted-foreground">
              Give Jarvis a browser task. It plans actions step-by-step using
              Ollama and drives a real Chromium window. Supports saved login
              sessions, file downloads, multi-tab navigation, and high-stakes
              typed approvals.
            </p>
          </div>
        </div>

        {/* ── Sessions panel ─────────────────────────────────────────── */}
        <SessionsPanel />

        {/* ── New task card ──────────────────────────────────────────── */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">New task</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nav-goal">Goal</Label>
              <Textarea
                id="nav-goal"
                placeholder={`e.g. "Find the top Hacker News story and give me a 2-sentence summary"`}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="min-h-[80px] text-sm"
                maxLength={1000}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="nav-session">Session</Label>
                <Select value={sessionId} onValueChange={setSessionId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (fresh browser)</SelectItem>
                    {sessions?.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}{s.origin ? ` (${s.origin})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Starts the browser already logged in using stored cookies.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="nav-allowlist">
                  Allowlist <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="nav-allowlist"
                  placeholder="wikipedia.org, news.ycombinator.com"
                  value={allowlistInput}
                  onChange={(e) => setAllowlistInput(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nav-maxsteps">Max steps (hard cap 30)</Label>
                <Input
                  id="nav-maxsteps"
                  type="number"
                  min={1}
                  max={30}
                  value={maxSteps}
                  onChange={(e) => setMaxSteps(parseInt(e.target.value) || 15)}
                />
              </div>

              <div className="space-y-2">
                <Label>Options</Label>
                <div className="flex flex-col gap-2 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Headless (hidden)</span>
                    <Switch checked={headless} onCheckedChange={setHeadless} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      High-stakes mode (typed approval)
                    </span>
                    <Switch checked={highStakes} onCheckedChange={setHighStakes} />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
              <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
              Destructive actions (submit, purchase, delete, confirm, press Enter)
              always pause for approval. In high-stakes mode you must type a
              specific confirmation phrase exactly — otherwise a single click
              suffices.
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                onClick={startTask}
                disabled={startMutation.isPending || goal.trim().length < 5}
              >
                {startMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Run task
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Active task viewer ─────────────────────────────────────── */}
        {activeRun && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span className="truncate">Current task</span>
                <div className="flex items-center gap-2">
                  <StatusBadge status={activeRun.status} />
                  {(activeRun.status === "running" ||
                    activeRun.status === "awaiting_confirmation" ||
                    activeRun.status === "awaiting_typed_confirmation") && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => stopMutation.mutate({ taskId: activeRun.taskId })}
                    >
                      <StopCircle className="mr-2 h-4 w-4" />
                      Stop
                    </Button>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm italic text-muted-foreground">"{activeRun.goal}"</p>

              {/* Tabs list */}
              {activeRun.tabs && activeRun.tabs.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                    Open tabs ({activeRun.tabs.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {activeRun.tabs.map((t: any) => (
                      <Badge
                        key={t.index}
                        variant="outline"
                        className={`max-w-xs truncate ${t.index === activeRun.currentTabIndex ? "border-primary bg-primary/10" : ""}`}
                      >
                        [{t.index}] {t.title || t.url || "(blank)"}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Downloads list */}
              {activeRun.downloads && activeRun.downloads.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                    Downloaded files ({activeRun.downloads.length})
                  </div>
                  <ul className="space-y-1">
                    {activeRun.downloads.map((d: any, i: number) => (
                      <li key={i}>
                        <a
                          href={`/api/nav-download/${encodeURIComponent(activeRun.taskId)}/${encodeURIComponent(
                            (d.storedPath as string).split(/[\\/]/).pop() ?? ""
                          )}`}
                          className="flex items-center gap-2 rounded-md border p-2 text-sm hover:bg-muted/30"
                          download={d.filename}
                        >
                          <Download className="h-4 w-4" />
                          <span className="flex-1 truncate">{d.filename}</span>
                          <span className="text-xs text-muted-foreground">
                            {(d.sizeBytes / 1024).toFixed(1)} KB
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Simple approval prompt */}
              {activeRun.status === "awaiting_confirmation" && activeRun.pendingAction && (
                <div className="rounded-md border border-purple-500/40 bg-purple-500/5 p-4">
                  <div className="mb-2 flex items-center gap-2 font-medium text-purple-300">
                    <ShieldAlert className="h-4 w-4" />
                    Approval needed for destructive action
                  </div>
                  <pre className="mb-3 overflow-x-auto rounded bg-muted/50 p-2 font-mono text-xs text-purple-200">
                    {JSON.stringify(activeRun.pendingAction, null, 2)}
                  </pre>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        resolveMutation.mutate({ taskId: activeRun.taskId, approve: true })
                      }
                    >
                      Approve & continue
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        resolveMutation.mutate({ taskId: activeRun.taskId, approve: false })
                      }
                    >
                      Reject & stop
                    </Button>
                  </div>
                </div>
              )}

              {/* High-stakes typed-confirmation prompt */}
              {activeRun.status === "awaiting_typed_confirmation" && (
                <div className="rounded-md border border-red-500/40 bg-red-500/5 p-4">
                  <div className="mb-2 flex items-center gap-2 font-medium text-red-300">
                    <ShieldAlert className="h-4 w-4" />
                    HIGH-STAKES action — typed confirmation required
                  </div>
                  <p className="mb-3 text-sm text-red-200">
                    To approve, type exactly this phrase:
                  </p>
                  <code className="mb-3 block break-all rounded bg-muted/50 p-2 font-mono text-xs text-red-200">
                    {activeRun.requiredConfirmationPhrase}
                  </code>
                  <pre className="mb-3 overflow-x-auto rounded bg-muted/50 p-2 font-mono text-xs text-red-200/70">
                    {JSON.stringify(activeRun.pendingAction, null, 2)}
                  </pre>
                  <Input
                    value={typedConfirmation}
                    onChange={(e) => setTypedConfirmation(e.target.value)}
                    placeholder="Type the phrase exactly as shown above"
                    className="mb-2 font-mono"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!typedConfirmation}
                      onClick={() =>
                        resolveTypedMutation.mutate({
                          taskId: activeRun.taskId,
                          userText: typedConfirmation,
                        })
                      }
                    >
                      Submit confirmation
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => stopMutation.mutate({ taskId: activeRun.taskId })}
                    >
                      Cancel task
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Any mismatch (including extra whitespace) rejects and writes an audit log entry.
                  </p>
                </div>
              )}

              {/* Final result */}
              {activeRun.status === "completed" && activeRun.finalResult && (
                <div className="rounded-md border border-green-500/30 bg-green-500/5 p-4">
                  <div className="mb-1 text-xs font-medium uppercase text-green-400">
                    Result
                  </div>
                  <div className="text-sm">{activeRun.finalResult}</div>
                </div>
              )}

              {/* Error */}
              {activeRun.error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4">
                  <div className="mb-1 text-xs font-medium uppercase text-red-400">Error</div>
                  <div className="text-sm">{activeRun.error}</div>
                </div>
              )}

              {/* Step-by-step log */}
              <div>
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                  Step log ({activeRun.steps.length})
                </div>
                <ScrollArea className="max-h-[500px] rounded-md border">
                  <ol>
                    {activeRun.steps.map((step: any, i: number) => {
                      const Icon = actionIcon(step.action.kind);
                      const isError = step.outcome.startsWith("ERROR");
                      return (
                        <li key={step.step}>
                          {i > 0 && <Separator />}
                          <div className="flex gap-3 p-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-xs text-muted-foreground">
                                  #{step.step}
                                </span>
                                <Badge variant="outline" className="h-5 px-1.5 text-xs">
                                  {step.action.kind}
                                </Badge>
                                <Badge variant="outline" className="h-5 px-1.5 text-xs">
                                  tab {step.tabIndex}
                                </Badge>
                                {isError && (
                                  <Badge variant="outline" className="h-5 border-red-500/40 bg-red-500/10 px-1.5 text-xs text-red-400">
                                    error
                                  </Badge>
                                )}
                                {step.downloadedFile && (
                                  <Badge variant="outline" className="h-5 border-green-500/40 bg-green-500/10 px-1.5 text-xs text-green-400">
                                    <Download className="mr-1 h-3 w-3" />
                                    downloaded
                                  </Badge>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  {step.durationMs} ms
                                </span>
                              </div>
                              {step.action.reasoning && (
                                <p className="mt-0.5 text-xs italic text-muted-foreground">
                                  {step.action.reasoning}
                                </p>
                              )}
                              <div className={`mt-1 truncate text-sm ${isError ? "text-red-400" : ""}`}>
                                {step.outcome}
                              </div>
                              {step.extractedText && (
                                <div className="mt-1 line-clamp-3 rounded bg-muted/50 p-2 text-xs">
                                  {step.extractedText}
                                </div>
                              )}
                              {step.downloadedFile && (
                                <a
                                  href={`/api/nav-download/${encodeURIComponent(activeRun.taskId)}/${encodeURIComponent(
                                    (step.downloadedFile.storedPath as string).split(/[\\/]/).pop() ?? ""
                                  )}`}
                                  className="mt-1 flex items-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/5 p-2 text-xs hover:bg-green-500/10"
                                  download={step.downloadedFile.filename}
                                >
                                  <FileText className="h-3 w-3" />
                                  <span>{step.downloadedFile.filename}</span>
                                  <span className="text-muted-foreground">
                                    ({(step.downloadedFile.sizeBytes / 1024).toFixed(1)} KB)
                                  </span>
                                </a>
                              )}
                              {step.screenshotPath && (
                                <img
                                  src={`/api/nav-screenshot/${encodeURIComponent(
                                    step.screenshotPath.split(/[\\/]/).pop() ?? ""
                                  )}`}
                                  alt={`Step ${step.step} screenshot`}
                                  className="mt-2 max-h-60 w-full rounded border border-border object-contain"
                                  loading="lazy"
                                />
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                    {activeRun.steps.length === 0 && (
                      <div className="p-6 text-center text-sm text-muted-foreground">
                        Waiting for first action…
                      </div>
                    )}
                  </ol>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Run history ────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent runs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[300px]">
              {!runs || runs.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No runs yet.
                </div>
              ) : (
                <ul>
                  {runs.map((r: any, i: number) => (
                    <li key={r.taskId}>
                      {i > 0 && <Separator />}
                      <button
                        className="w-full p-4 text-left hover:bg-muted/30"
                        onClick={() => setActiveTaskId(r.taskId)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{r.goal}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {r.stepCount} steps · {new Date(r.startedAt).toLocaleString()}
                              {r.finalResult && ` · "${r.finalResult.slice(0, 60)}"`}
                            </div>
                          </div>
                          <StatusBadge status={r.status} />
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
