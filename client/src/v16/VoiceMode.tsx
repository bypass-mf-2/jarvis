/**
 * v16 Voice Mode — click-to-toggle conversation loop in the WakeOverlay.
 *
 * Flow: click button → mic captures → click again OR auto-stop on 1.5s
 * silence → upload to /api/v16/voice-turn → JARVIS transcribes + chats
 * + TTS → renderer plays the audio reply.
 *
 * Visual states:
 *   idle      — ready, button shows mic icon
 *   listening — recording, pulsing red ring; live volume bar
 *   thinking  — uploaded, waiting for STT+chat+TTS
 *   speaking  — playing TTS reply, sky pulse
 *   error     — last turn failed (auto-clears after 3s)
 *
 * Voice Activity Detection: WebAudio AnalyserNode samples the mic stream
 * every 100ms. Below SILENCE_THRESHOLD for SILENCE_MS straight = user
 * stopped speaking → auto-stop. There's also a HARD_TIMEOUT_MS ceiling so
 * a stuck-on mic doesn't record forever.
 */

import { useEffect, useRef, useState } from "react";

const SILENCE_THRESHOLD = 0.015; // RMS level (0-1); below = silence
const SILENCE_MS = 1500;          // how long silence must persist before auto-stop
const MIN_SPEECH_MS = 800;        // don't auto-stop until we've heard at least this much
const HARD_TIMEOUT_MS = 60_000;   // absolute max recording length

type State =
  | { phase: "idle" }
  | { phase: "listening"; level: number }
  | { phase: "thinking" }
  | { phase: "speaking"; audio: HTMLAudioElement }
  | { phase: "error"; message: string };

interface Turn {
  user: string;
  reply: string;
  audioUrl: string | null;
  at: number;
}

interface VoiceModeProps {
  /** When true, auto-start recording on mount. Used when wake fired from
   *  the wake-word listener — the user just said "Hey JARVIS" and a follow-on
   *  utterance is incoming, no need to wait for a click. */
  autoStart?: boolean;
}

export function VoiceMode({ autoStart = false }: VoiceModeProps = {}) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [history, setHistory] = useState<Turn[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordStartRef = useRef<number>(0);
  const lastVoiceAtRef = useRef<number>(0);
  // Prevents re-entrant stops when both VAD and a click race to stop the recorder
  const stoppingRef = useRef(false);

  useEffect(() => {
    return () => {
      cleanupResources();
      if (state.phase === "speaking") state.audio.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start recording when triggered by the wake-word listener.
  // Small delay so the briefing TTS finishes its first phoneme before we
  // start capturing (avoids capturing JARVIS's own voice).
  useEffect(() => {
    if (!autoStart) return;
    const t = setTimeout(() => {
      if (state.phase === "idle") void startRecording();
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  function cleanupResources() {
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    if (hardTimerRef.current) {
      clearTimeout(hardTimerRef.current);
      hardTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  const startRecording = async () => {
    if (state.phase === "speaking") state.audio.pause();
    stoppingRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up MediaRecorder for the audio blob we'll upload.
      const recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      recordStartRef.current = Date.now();
      lastVoiceAtRef.current = Date.now();

      // Set up WebAudio analyser for VAD.
      const Ctx = (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      const audioCtx = new Ctx();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);

      vadTimerRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        // RMS — root mean square of the waveform samples = volume estimate
        let sumSquares = 0;
        for (let i = 0; i < buf.length; i++) sumSquares += buf[i] * buf[i];
        const rms = Math.sqrt(sumSquares / buf.length);

        if (rms > SILENCE_THRESHOLD) {
          lastVoiceAtRef.current = Date.now();
        }
        setState((s) => (s.phase === "listening" ? { phase: "listening", level: rms } : s));

        // Auto-stop: had at least MIN_SPEECH_MS of recording AND silence
        // has persisted for SILENCE_MS.
        const elapsed = Date.now() - recordStartRef.current;
        const silentFor = Date.now() - lastVoiceAtRef.current;
        if (elapsed > MIN_SPEECH_MS && silentFor > SILENCE_MS) {
          void stopRecording("vad");
        }
      }, 100);

      // Absolute ceiling — never record longer than this.
      hardTimerRef.current = setTimeout(() => {
        void stopRecording("timeout");
      }, HARD_TIMEOUT_MS);

      setState({ phase: "listening", level: 0 });
    } catch (err) {
      setState({ phase: "error", message: `Mic permission denied or unavailable: ${String(err)}` });
      autoClearError();
      cleanupResources();
    }
  };

  const stopRecording = async (_reason: "click" | "vad" | "timeout" = "click") => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      cleanupResources();
      setState({ phase: "idle" });
      return;
    }
    recorder.stop();
    await new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    cleanupResources();

    setState({ phase: "thinking" });
    try {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      if (blob.size < 1000) {
        setState({ phase: "idle" });
        return;
      }
      const form = new FormData();
      form.append("audio", blob, `turn-${Date.now()}.${pickExt(recorder.mimeType)}`);
      const res = await fetch("/api/v16/voice-turn", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.text().catch(() => "");
        throw new Error(`server returned ${res.status}: ${err.slice(0, 100)}`);
      }
      const data = (await res.json()) as { userText: string; reply: string; audioUrl: string | null };
      setHistory((h) =>
        [...h, { user: data.userText, reply: data.reply, audioUrl: data.audioUrl, at: Date.now() }].slice(-6),
      );
      if (data.audioUrl) {
        const audio = new Audio(data.audioUrl);
        audio.addEventListener("ended", () => setState({ phase: "idle" }));
        audio.addEventListener("error", () => setState({ phase: "idle" }));
        await audio.play();
        setState({ phase: "speaking", audio });
      } else {
        setState({ phase: "idle" });
      }
    } catch (err) {
      setState({ phase: "error", message: String(err) });
      autoClearError();
    }
  };

  const autoClearError = () => {
    setTimeout(() => {
      setState((s) => (s.phase === "error" ? { phase: "idle" } : s));
    }, 3000);
  };

  const onButtonClick = () => {
    if (state.phase === "listening") {
      void stopRecording("click");
    } else if (state.phase === "idle" || state.phase === "error") {
      void startRecording();
    } else if (state.phase === "speaking") {
      // Tap-to-interrupt: cut off TTS and start listening for a follow-up.
      state.audio.pause();
      void startRecording();
    }
    // thinking phase: ignore — server is processing
  };

  const isRecording = state.phase === "listening";
  const isBusy = state.phase === "thinking";
  const liveLevel = state.phase === "listening" ? state.level : 0;
  const ringColor =
    state.phase === "listening"
      ? "ring-red-500/70"
      : state.phase === "thinking"
        ? "ring-amber-400/70"
        : state.phase === "speaking"
          ? "ring-sky-400/70"
          : "ring-sky-400/30";

  return (
    <div className="mt-5 pt-4 border-t border-border/40">
      <div className="flex items-center gap-3">
        <button
          onClick={onButtonClick}
          disabled={isBusy}
          className={`relative w-14 h-14 rounded-full ring-4 transition-all ${ringColor} ${
            isRecording ? "bg-red-500/30 animate-pulse" : "bg-sky-500/20 hover:bg-sky-500/30"
          } disabled:opacity-50 flex items-center justify-center text-xl`}
          title={isRecording ? "Click to stop" : "Click to talk"}
          aria-label="Toggle voice"
        >
          {isRecording ? "■" : isBusy ? "…" : "🎤"}
        </button>
        <div className="flex-1 min-w-0 text-xs">
          <div className="text-foreground/90 flex items-center gap-2">
            {state.phase === "idle" && <span>Click to talk</span>}
            {state.phase === "listening" && (
              <>
                <span className="text-red-400">Listening…</span>
                <VolumeBar level={liveLevel} />
                <span className="text-[10px] text-muted-foreground/70">auto-stops on silence</span>
              </>
            )}
            {state.phase === "thinking" && <span className="text-amber-400">Thinking…</span>}
            {state.phase === "speaking" && (
              <span className="text-sky-400">Speaking · click to interrupt</span>
            )}
            {state.phase === "error" && (
              <span className="text-destructive">{state.message}</span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground/70 mt-0.5">
            Whisper STT → smartChat → cloned voice TTS
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
          {history
            .slice()
            .reverse()
            .map((t) => (
              <div key={t.at} className="text-xs">
                <div className="text-muted-foreground">
                  <span className="text-sky-300/70">you:</span> {t.user}
                </div>
                <div className="text-foreground/90">
                  <span className="text-amber-300/70">jarvis:</span> {t.reply}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function VolumeBar({ level }: { level: number }) {
  // Map RMS [0..0.3] → width [0..100%]. 0.3 is shouting; most speech is 0.02-0.1.
  const pct = Math.min(100, Math.round((level / 0.3) * 100));
  return (
    <span className="inline-block w-16 h-1.5 bg-muted rounded-full overflow-hidden">
      <span
        className="block h-full bg-red-400 transition-[width] duration-75"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/**
 * Pick a MIME type the browser can record. WebM Opus is best — universal
 * support, good compression, Whisper handles it natively. Fallback to mp4
 * (Safari) and finally to whatever the platform offers.
 */
function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "";
}

function pickExt(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  return "audio";
}
