/**
 * v16 wake-sequence overlay — the card that appears on screen when the
 * clap/hotkey trigger fires.
 *
 * STATUS: standalone React component. NOT imported into App.tsx anywhere.
 * Safe to preview in Storybook or render with fake props in a scratchpad.
 *
 * Shape matches the v16 Falcon design: a frameless, always-on-top panel
 * that appears over any app the user is in. For the web-preview version
 * it just renders as a centered card.
 *
 * Props are hand-rolled (not wired to tRPC) so this component can't
 * accidentally fetch from v15 during dev. When the Electron shell goes
 * live, the wake sequence's orchestrator calls this with real data.
 */

import { useEffect, useState } from "react";
import { VoiceMode } from "./VoiceMode";

export interface WakeOverlayProps {
  /** "Good morning, sir. Today is Thursday, April 23rd. ..." — already composed. */
  briefingText: string;
  /** List of today's tasks to render as a checklist. Optional — the component still looks right with none. */
  tasks?: Array<{ title: string; note?: string }>;
  /** List of today's events to render on a simple timeline. Optional. */
  events?: Array<{ title: string; startAt: string | Date; location?: string }>;
  /** Whether the music has started. Controls a subtle visual indicator. */
  musicPlaying?: boolean;
  /** Whether TTS is currently speaking. Drives a ripple/animation accent. */
  speaking?: boolean;
  /** Auto-start voice recording when the overlay mounts. Used when the wake
   *  was triggered by the wake-word listener — the user already started
   *  talking, so we should start capturing immediately. */
  autoStartVoice?: boolean;
  /** Called when the user dismisses the overlay (Escape key, click-away, "dismiss" button). */
  onDismiss?: () => void;
}

/**
 * Design goals:
 *   - Readable at a glance — one glance = what's today.
 *   - Non-intrusive — minimal chrome, blurred background, fades out.
 *   - No click required — disappears on Escape or after a timeout.
 *   - Feels like a JARVIS overlay, not a web page.
 *
 * Styling is Tailwind — same conventions as the rest of the client.
 * Glass effect via backdrop-blur.
 */
export function WakeOverlay({
  briefingText,
  tasks = [],
  events = [],
  musicPlaying = false,
  speaking = false,
  autoStartVoice = false,
  onDismiss,
}: WakeOverlayProps) {
  // Escape dismisses. Also auto-fades after 30s of idle.
  useEffect(() => {
    if (!onDismiss) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    const idle = setTimeout(() => onDismiss(), 30_000);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(idle);
    };
  }, [onDismiss]);

  // Progressive reveal — greeting appears first, then tasks fade in 400ms later.
  // Feels more "sequential conversation" than "wall of text".
  const [showBody, setShowBody] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowBody(true), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center pointer-events-none"
      style={{
        background: "radial-gradient(circle at center, rgba(0,20,40,0.25), rgba(0,0,0,0.55))",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        className="pointer-events-auto w-full max-w-2xl rounded-2xl border border-sky-400/30 bg-[oklch(0.10_0.016_240/0.85)] p-8 shadow-2xl"
        style={{
          boxShadow: speaking
            ? "0 0 60px rgba(56,189,248,0.35), 0 0 120px rgba(56,189,248,0.15)"
            : "0 20px 40px rgba(0,0,0,0.5)",
          transition: "box-shadow 300ms ease-out",
        }}
      >
        {/* Status pills */}
        <div className="flex items-center gap-2 mb-4 text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="text-sky-400">JARVIS</span>
          <span className="text-muted-foreground">·</span>
          <span>wake sequence</span>
          {musicPlaying && (
            <span className="ml-auto flex items-center gap-1 text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              music
            </span>
          )}
          {speaking && (
            <span className="flex items-center gap-1 text-sky-400">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
              speaking
            </span>
          )}
        </div>

        {/* Briefing text */}
        <div
          className="text-lg leading-relaxed text-foreground/95"
          style={{
            textShadow: speaking ? "0 0 8px rgba(56,189,248,0.4)" : undefined,
            transition: "text-shadow 200ms ease-out",
          }}
        >
          {briefingText.split(". ").map((sentence, i) => (
            <p key={i} className="mb-2">
              {sentence.trim()}
              {!sentence.endsWith(".") && !sentence.endsWith("?") ? "." : ""}
            </p>
          ))}
        </div>

        {/* Tasks + events progressive reveal */}
        <div
          style={{
            opacity: showBody ? 1 : 0,
            transform: showBody ? "translateY(0)" : "translateY(8px)",
            transition: "opacity 400ms ease-out, transform 400ms ease-out",
          }}
          className="mt-6"
        >
          {events.length > 0 && (
            <div className="mb-5">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Today</h3>
              <ul className="space-y-1">
                {events.map((e, i) => (
                  <li key={i} className="flex items-baseline gap-3 text-sm">
                    <span className="font-mono text-xs text-sky-400 w-16 flex-shrink-0">
                      {formatTime(e.startAt)}
                    </span>
                    <span className="text-foreground/90">{e.title}</span>
                    {e.location && (
                      <span className="text-xs text-muted-foreground">· {e.location}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tasks.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">To do</h3>
              <ul className="space-y-1">
                {tasks.map((t, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-sm">
                    <span className="text-muted-foreground">·</span>
                    <span className="text-foreground/90">{t.title}</span>
                    {t.note && (
                      <span className="text-xs text-muted-foreground">— {t.note}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Ask about screen — uses the Electron API when present.
            Capture + OCR + ask LLM in one flow. Shows the answer below. */}
        <ScreenAskWidget />

        {/* Code-aware mode — appears only when focused app is an IDE */}
        <CodeAskWidget />

        {/* Voice conversation loop — click-toggle → STT → chat → TTS.
            Auto-starts when wake came from "Hey JARVIS" wake-word match. */}
        <VoiceMode autoStart={autoStartVoice} />

        {/* Dismiss hint — deliberately quiet */}
        <div className="mt-6 text-[10px] text-muted-foreground/60 text-right">
          Press Escape to dismiss
        </div>
      </div>
    </div>
  );
}

function ScreenAskWidget() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Detect Electron context (preload exposes window.jarvisV16). On the
  // browser-preview side, this whole widget hides — capture-screen requires
  // Electron's desktopCapturer.
  const hasElectron = typeof window !== "undefined" && !!(window as any).jarvisV16?.askAboutScreen;
  if (!hasElectron) return null;

  const ask = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setAnswer(null);
    try {
      const a = await (window as any).jarvisV16.askAboutScreen(q);
      setAnswer(typeof a === "string" ? a : "(no answer returned)");
    } catch (err) {
      setAnswer(`Failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 pt-4 border-t border-border/40">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="Ask about what's on screen…"
          disabled={busy}
          className="flex-1 px-2 py-1.5 rounded border border-border bg-background/50 text-sm placeholder:text-muted-foreground/60 disabled:opacity-50"
        />
        <button
          onClick={ask}
          disabled={busy || !question.trim()}
          className="text-xs px-3 py-1.5 rounded bg-sky-500/20 text-sky-300 border border-sky-400/40 hover:bg-sky-500/30 disabled:opacity-50"
        >
          {busy ? "Looking…" : "Ask"}
        </button>
      </div>
      {answer && (
        <div className="mt-2 p-2 rounded border border-border/40 bg-background/40 text-xs text-foreground/90 whitespace-pre-wrap max-h-48 overflow-y-auto">
          {answer}
        </div>
      )}
    </div>
  );
}

/**
 * Code-aware widget — only renders when focused app is an IDE
 * (`/api/v16/code-mode` returns isIDE=true). Captures clipboard
 * (presumed selected code) and asks the LLM a question.
 */
function CodeAskWidget() {
  const [isIDE, setIsIDE] = useState(false);
  const [focusedName, setFocusedName] = useState<string>("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasElectron =
    typeof window !== "undefined" && !!(window as any).jarvisV16?.askAboutCode;

  // Poll every 5s for IDE focus state — could be event-driven later
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const r = await fetch("/api/v16/code-mode");
        const data = await r.json();
        if (!cancelled) {
          setIsIDE(!!data.isIDE);
          setFocusedName(data.focused?.name ?? "");
        }
      } catch {
        if (!cancelled) setIsIDE(false);
      }
    };
    check();
    const t = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!hasElectron || !isIDE) return null;

  const ask = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setAnswer(null);
    try {
      const a = await (window as any).jarvisV16.askAboutCode(q);
      setAnswer(typeof a === "string" ? a : "(no answer returned)");
    } catch (err) {
      setAnswer(`Failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 pt-4 border-t border-emerald-500/30">
      <div className="text-[10px] uppercase tracking-widest text-emerald-400 mb-2">
        Code mode · {focusedName || "IDE"} focused
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="Ask about your clipboard code…"
          disabled={busy}
          className="flex-1 px-2 py-1.5 rounded border border-emerald-500/40 bg-background/50 text-sm placeholder:text-muted-foreground/60 disabled:opacity-50"
        />
        <button
          onClick={ask}
          disabled={busy || !question.trim()}
          className="text-xs px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 hover:bg-emerald-500/30 disabled:opacity-50"
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground/70 mt-1">
        Copy code in your editor first; I'll read your clipboard.
      </p>
      {answer && (
        <pre className="mt-2 p-2 rounded border border-border/40 bg-background/40 text-xs text-foreground/90 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">
          {answer}
        </pre>
      )}
    </div>
  );
}

function formatTime(when: string | Date): string {
  const d = when instanceof Date ? when : new Date(when);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
