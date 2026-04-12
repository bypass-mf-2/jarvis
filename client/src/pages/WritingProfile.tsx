import { useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ArrowLeft,
  Upload,
  FileText,
  Trash2,
  RefreshCw,
  Sparkles,
  BookOpen,
  FlaskConical,
  FileUser,
  BookMarked,
  Newspaper,
  FileQuestion,
} from "lucide-react";

// ─── Types (mirror the tRPC router shapes) ──────────────────────────────────

type WritingCategory =
  | "essay"
  | "lab_report"
  | "book_report"
  | "resume"
  | "book"
  | "article"
  | "other";

const CATEGORIES: Array<{ value: WritingCategory; label: string; icon: any }> = [
  { value: "essay", label: "Essay", icon: FileText },
  { value: "lab_report", label: "Lab Report", icon: FlaskConical },
  { value: "book_report", label: "Book Report", icon: BookOpen },
  { value: "resume", label: "Resume", icon: FileUser },
  { value: "book", label: "Book", icon: BookMarked },
  { value: "article", label: "Article", icon: Newspaper },
  { value: "other", label: "Other", icon: FileQuestion },
];

function categoryMeta(value: string) {
  return CATEGORIES.find((c) => c.value === value) ?? CATEGORIES[CATEGORIES.length - 1];
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function WritingProfile() {
  const [category, setCategory] = useState<WritingCategory>("essay");
  const [description, setDescription] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    data: samples,
    refetch: refetchSamples,
    isLoading: samplesLoading,
  } = trpc.writingProfile.listSamples.useQuery(undefined, {
    // Poll while an upload is in-flight so analysis progress shows up.
    refetchInterval: (query) => {
      const list = (query.state.data as any[] | undefined) ?? [];
      const pending = list.some((s: any) => !s.analyzed);
      return pending ? 4000 : false;
    },
  });

  const {
    data: profile,
    refetch: refetchProfile,
  } = trpc.writingProfile.getProfile.useQuery(undefined, {
    refetchInterval: (query) => {
      const list = (samples as any[] | undefined) ?? [];
      const pending = list.some((s: any) => !s.analyzed);
      return pending ? 4000 : false;
    },
  });

  const deleteMutation = trpc.writingProfile.deleteSample.useMutation({
    onSuccess: () => {
      toast.success("Sample deleted");
      refetchSamples();
      refetchProfile();
    },
    onError: (err) => toast.error(`Delete failed: ${err.message}`),
  });

  const regenMutation = trpc.writingProfile.regenerate.useMutation({
    onSuccess: () => {
      toast.success("Profile regenerated");
      refetchSamples();
      refetchProfile();
    },
    onError: (err) => toast.error(`Regenerate failed: ${err.message}`),
  });

  // ── Upload handler (shared between drag-drop and file picker) ─────────────
  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      setUploading(true);
      try {
        for (const file of list) {
          const form = new FormData();
          form.append("file", file);
          form.append("category", category);
          if (description.trim()) {
            form.append("description", description.trim());
          }

          // Backend mounts upload routes under /api (see server/_core/index.ts)
          const res = await fetch("/api/upload-writing", {
            method: "POST",
            body: form,
          });

          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `${res.status} ${res.statusText}`);
          }

          toast.success(`Received "${file.name}" — analyzing style...`);
        }
        // Clear description after a successful batch so the next upload
        // doesn't accidentally re-use stale context.
        setDescription("");
        refetchSamples();
      } catch (err: any) {
        toast.error(`Upload failed: ${err.message}`);
      } finally {
        setUploading(false);
      }
    },
    [category, description, refetchSamples]
  );

  // ── Drop / drag handlers ─────────────────────────────────────────────────
  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        uploadFiles(e.dataTransfer.files);
      }
    },
    [uploadFiles]
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl p-6">
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" aria-label="Back to chat">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-semibold">Writing Profile</h1>
              <p className="text-sm text-muted-foreground">
                Upload things you've written so Jarvis can learn your voice.
                These files are never used for knowledge retrieval — only style
                analysis.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => regenMutation.mutate()}
            disabled={regenMutation.isPending || !samples || samples.length === 0}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${regenMutation.isPending ? "animate-spin" : ""}`} />
            Regenerate Profile
          </Button>
        </div>

        {/* ── Upload card ───────────────────────────────────────────────── */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" />
              Upload a writing sample
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted-foreground">Category:</label>
              <Select value={category} onValueChange={(v) => setCategory(v as WritingCategory)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => {
                    const Icon = c.icon;
                    return (
                      <SelectItem key={c.value} value={c.value}>
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          {c.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                flex min-h-[160px] cursor-pointer flex-col items-center justify-center
                rounded-lg border-2 border-dashed p-8 text-center transition-colors
                ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}
                ${uploading ? "pointer-events-none opacity-50" : ""}
              `}
            >
              <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
              <p className="mb-1 font-medium">
                {uploading ? "Uploading…" : "Drop files here or click to browse"}
              </p>
              <p className="text-xs text-muted-foreground">
                PDF, DOCX, TXT, MD, RTF — up to 50 MB each
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt,.md,.markdown,.rtf,.odt"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) uploadFiles(e.target.files);
                  e.target.value = ""; // allow re-upload of same file
                }}
              />
            </div>

            {/* Optional context — the LLM uses this when analyzing voice,
                 so e.g. "formal because it was a grad-school history paper"
                 gets distinguished from the user's actual voice tendencies. */}
            <div className="space-y-2">
              <Label htmlFor="writing-description" className="text-sm">
                Description <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="writing-description"
                placeholder="Context about this sample — the assignment prompt, class, intended audience, anything that affected how you wrote it. Jarvis uses this to separate 'style I was forced into' from 'how I actually write.'"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[90px] resize-y text-sm"
                maxLength={2000}
              />
              <p className="text-xs text-muted-foreground">
                {description.length} / 2000 characters. This description
                applies to all files uploaded in the next batch, then clears.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ── Profile viewer ───────────────────────────────────────────── */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" />
              Voice Profile
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!profile ? (
              <p className="text-sm text-muted-foreground">
                No profile yet. Upload some of your writing and Jarvis will
                analyze it to learn your voice.
              </p>
            ) : (
              <div className="space-y-4">
                {/* Narrative */}
                <div className="rounded-md bg-muted/30 p-4">
                  <p className="text-sm leading-relaxed">{profile.narrative}</p>
                </div>

                {/* Metrics grid */}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <ProfileMetric label="Samples" value={String(profile.sampleCount)} />
                  <ProfileMetric label="Words analyzed" value={profile.totalWords.toLocaleString()} />
                  <ProfileMetric label="Voice" value={profile.dominantVoice} />
                  <ProfileMetric label="Vocabulary" value={profile.dominantVocabulary} />
                  <ProfileMetric label="Person" value={profile.dominantPerson} />
                  <ProfileMetric
                    label="Avg sentence"
                    value={`${Math.round(profile.avgSentenceLength)} words`}
                  />
                  <ProfileMetric label="Paragraph style" value={profile.paragraphStyle} />
                  <ProfileMetric label="Hedging" value={profile.hedging} />
                </div>

                {/* Tags */}
                {profile.tones?.length > 0 && (
                  <ProfileTagList label="Dominant tones" items={profile.tones} />
                )}
                {profile.verbalTics?.length > 0 && (
                  <ProfileTagList label="Verbal tics" items={profile.verbalTics} />
                )}
                {profile.domainVocabulary?.length > 0 && (
                  <ProfileTagList
                    label="Domain vocabulary"
                    items={profile.domainVocabulary.slice(0, 15)}
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Samples list ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>
                Uploaded samples {samples ? `(${samples.length})` : ""}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[400px]">
              {samplesLoading ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Loading…
                </div>
              ) : !samples || samples.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No samples uploaded yet.
                </div>
              ) : (
                <ul>
                  {samples.map((s: any, i: number) => {
                    const meta = categoryMeta(s.category);
                    const Icon = meta.icon;
                    return (
                      <li key={s.id}>
                        {i > 0 && <Separator />}
                        <div className="flex items-center justify-between gap-4 p-4 hover:bg-muted/30">
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <div className="rounded-md bg-muted p-2">
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">
                                {s.originalName}
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline" className="h-5 px-1.5 text-xs">
                                  {meta.label}
                                </Badge>
                                <span>{s.wordCount.toLocaleString()} words</span>
                                {s.analyzed ? (
                                  <span className="text-green-500">✓ analyzed</span>
                                ) : (
                                  <span className="text-amber-500">analyzing…</span>
                                )}
                              </div>
                              {s.description && (
                                <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">
                                  {s.description}
                                </p>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate({ id: s.id })}
                            disabled={deleteMutation.isPending}
                            aria-label={`Delete ${s.originalName}`}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Small subcomponents ────────────────────────────────────────────────────

function ProfileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium capitalize">{value}</div>
    </div>
  );
}

function ProfileTagList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="mb-1.5 text-xs text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((t, i) => (
          <Badge key={`${t}-${i}`} variant="secondary" className="font-normal">
            {t}
          </Badge>
        ))}
      </div>
    </div>
  );
}
