/**
 * Continuous wake-word listener using the browser's SpeechRecognition API.
 *
 * Why SpeechRecognition (not Whisper streaming)?
 *   - Built into Chromium → no model download, no install step
 *   - Truly continuous with interim results (no chunking-and-uploading round trip)
 *   - Free at any volume → no Whisper API quota burn for "is the user awake?"
 *
 * Trade-off: Chrome's implementation sends audio to Google for transcription.
 * For wake-word detection only ("hey jarvis" / "jarvis ..."), the privacy
 * cost is bounded — we're not transcribing whole conversations, just polling
 * for one phrase. Once detected, we hand off to local Whisper for the actual
 * voice turn (server/_core/voiceTranscription.ts).
 *
 * Detection strategy: match against any chunk of interim transcript that
 * contains a wake phrase, then fire the callback. After firing, give the
 * recognizer a small cooldown so the same utterance doesn't fire twice.
 */

import { useEffect, useRef, useState } from "react";

const WAKE_PHRASES = [
  "hey jarvis",
  "hi jarvis",
  "hello jarvis",
  "okay jarvis",
  "ok jarvis",
  "jarvis ",     // bare "jarvis " followed by something — must have a trailing space
  "yo jarvis",
];

const COOLDOWN_MS = 3000; // don't refire on the same utterance

interface UseWakeWordListenerOpts {
  enabled: boolean;
  onWake: () => void;
}

interface UseWakeWordListenerResult {
  /** True if SpeechRecognition is available in this runtime. */
  supported: boolean;
  /** True while the recognizer is actively listening. */
  active: boolean;
  /** Most recent interim transcript fragment — useful as a debug signal. */
  lastHeard: string;
  /** True if the recognizer ran but errored (e.g. no mic permission). */
  errored: boolean;
}

// SpeechRecognition lives behind a vendor prefix on most platforms.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSpeechRecognition(): any {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useWakeWordListener(opts: UseWakeWordListenerOpts): UseWakeWordListenerResult {
  const [active, setActive] = useState(false);
  const [lastHeard, setLastHeard] = useState("");
  const [errored, setErrored] = useState(false);
  const lastFireRef = useRef(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const supported = !!getSpeechRecognition();

  useEffect(() => {
    if (!opts.enabled || !supported) {
      setActive(false);
      return;
    }

    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onstart = () => {
      setActive(true);
      setErrored(false);
    };
    rec.onend = () => {
      setActive(false);
      // Auto-restart if still enabled — SpeechRecognition stops on its own
      // after periods of silence in some browsers.
      if (opts.enabled) {
        try {
          rec.start();
        } catch {
          /* already started, ignore */
        }
      }
    };
    rec.onerror = (e: { error: string }) => {
      // "no-speech" is fired routinely when nobody's talking — ignore it.
      // Real errors (e.g. "not-allowed") set the flag so the UI can show it.
      if (e.error !== "no-speech" && e.error !== "aborted") {
        console.warn("[wakeWord] recognition error:", e.error);
        setErrored(true);
      }
    };
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let combined = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        combined += e.results[i][0].transcript;
      }
      const lower = combined.toLowerCase().trim();
      if (lower) setLastHeard(lower);

      const now = Date.now();
      if (now - lastFireRef.current < COOLDOWN_MS) return;

      for (const phrase of WAKE_PHRASES) {
        if (lower.includes(phrase)) {
          lastFireRef.current = now;
          opts.onWake();
          break;
        }
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
    } catch (err) {
      console.warn("[wakeWord] start failed:", err);
      setErrored(true);
    }

    return () => {
      try {
        rec.onend = null;
        rec.onerror = null;
        rec.onresult = null;
        rec.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
      setActive(false);
    };
  }, [opts.enabled, supported, opts.onWake]);

  return { supported, active, lastHeard, errored };
}

// Make the SpeechRecognition global types available without pulling in a
// heavy DOM lib version. The DOM lib has these but only behind a flag in
// some TS configs — this minimal shape is enough for our usage.
declare global {
  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
  }
  interface SpeechRecognitionResultList {
    readonly length: number;
    [index: number]: SpeechRecognitionResult;
  }
  interface SpeechRecognitionResult {
    readonly length: number;
    readonly isFinal: boolean;
    [index: number]: SpeechRecognitionAlternative;
  }
  interface SpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;
  }
}
