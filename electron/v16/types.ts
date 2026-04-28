/**
 * Shared IPC types between main and renderer. The preload script mirrors
 * these names so both sides of the bridge agree on what data crosses.
 */

// Inlined from server/v16/briefing.ts so this package is self-contained
// for compilation. tsc enforces rootDir, and importing from outside
// electron/v16/ breaks the build even though it's a type-only import.
// If briefing's types ever change, mirror them here.
export interface BriefingTask {
  title: string;
  /** Optional short note — shows if <=60 chars, omitted otherwise. */
  note?: string;
  /** Optional due time today (ISO string or Date). */
  dueAt?: string | Date;
}

export interface BriefingEvent {
  title: string;
  /** When it starts (ISO string or Date). */
  startAt: string | Date;
  /** Optional short location. */
  location?: string;
}

/** Fired from main → renderer when the wake trigger activates. */
export interface WakeEvent {
  /** Why the wake fired. wake-word also auto-starts the voice-mode recorder. */
  source: "hotkey" | "clap" | "tray" | "manual" | "wake-word";
  /** Server-fetched briefing data. Might be empty if v15 server is offline. */
  briefing: {
    text: string;
    tasks: BriefingTask[];
    events: BriefingEvent[];
  };
  /** Audio file path (resolved from WAKE_AUDIO_PATH env). null if not set. */
  audioPath: string | null;
}

/** Fired from renderer → main when the user dismisses the overlay. */
export interface DismissEvent {
  /** Why the overlay closed — escape key, auto-timeout, click-out. */
  reason: "escape" | "timeout" | "manual";
}

/** Fired from renderer → main when a valid double-clap is detected. */
export interface ClapEvent {
  timestamp: number;
}

/** Panel views the renderer can show. "idle" = window hidden; the rest are
 *  full-window panels reachable from the tray menu. "wake" is the overlay. */
export type V16Panel = "idle" | "wake" | "workflows" | "memory" | "settings" | "phone" | "opinions" | "distillation" | "tunnel" | "credentials";

/** IPC channel names — centralized so typos don't silently break the bridge. */
export const IPC_CHANNELS = {
  wake: "v16:wake",
  dismiss: "v16:dismiss",
  clap: "v16:clap",
  /** Main → renderer: toggle mic capture on/off (driven by the tray menu). */
  micToggle: "v16:mic:toggle",
  /** Main → renderer: switch to a specific panel view (workflows / memory / settings). */
  setPanel: "v16:setPanel",
  /** Request briefing data from main (which calls v15 HTTP). */
  fetchBriefing: "v16:fetchBriefing",
  /**
   * Request TTS synthesis. Main proxies to v15's ElevenLabs endpoint and
   * returns an absolute URL the renderer can feed to <audio>. Returns null
   * if TTS is unavailable so the renderer can gracefully skip speech.
   */
  speak: "v16:speak",
  /** Request audio file path from main (reads WAKE_AUDIO_PATH at runtime). */
  getAudioPath: "v16:getAudioPath",
  /**
   * Renderer → main: capture screenshot of the focused screen, encode as
   * base64 PNG, OCR via v15 server, return text. Used by per-app-memory
   * "remember what's on screen now" flow.
   */
  ocrFocused: "v16:ocrFocused",
  /**
   * Renderer → main: capture + OCR + ask the LLM a question about the
   * screen contents. Returns the LLM's answer.
   */
  askAboutScreen: "v16:askAboutScreen",
  /**
   * Renderer → main: read the clipboard text. Used by the code-aware
   * "Ask about my code" widget which captures the current selection
   * (user copies before asking).
   */
  readClipboard: "v16:readClipboard",
  /**
   * Renderer → main: ask LLM a question about the user's clipboard
   * code. Returns the LLM's answer.
   */
  askAboutCode: "v16:askAboutCode",
  /**
   * Main → renderer: enable or disable the wake-word listener
   * (browser SpeechRecognition for "Hey JARVIS" / "JARVIS ..." matches).
   * Driven by the tray menu toggle.
   */
  setWakeWordEnabled: "v16:setWakeWordEnabled",
  /**
   * Renderer → main: wake-word matched, fire a wake event. The renderer
   * can't call triggerWake itself; it has to go through main.
   */
  requestWake: "v16:requestWake",
} as const;

/** Shape of the window.jarvisV16 API the preload exposes to the renderer. */
export interface JarvisV16API {
  /** Listen for main → renderer wake events. Returns an unsubscribe function. */
  onWake(listener: (event: WakeEvent) => void): () => void;
  /** Listen for main → renderer mic toggle commands (from the tray menu). */
  onMicToggle(listener: (enabled: boolean) => void): () => void;
  /** Listen for main → renderer panel-switch messages (from the tray menu). */
  onSetPanel(listener: (panel: V16Panel) => void): () => void;
  /** Notify main that the overlay was dismissed. */
  notifyDismiss(event: DismissEvent): void;
  /** Notify main that a double-clap was detected. */
  notifyClap(event: ClapEvent): void;
  /** Ask main to fetch briefing data from the v15 server. */
  fetchBriefing(): Promise<WakeEvent["briefing"]>;
  /** Ask main for the configured wake audio file path (absolute). */
  getAudioPath(): Promise<string | null>;
  /**
   * Ask main to synthesize TTS. Returns the absolute URL of the generated
   * audio (so the renderer can play it in sync with the music ducking),
   * or null if TTS failed.
   */
  speak(text: string): Promise<string | null>;
  /**
   * Ask main to capture the focused screen, OCR it via the v15 server,
   * and return the extracted text. Returns empty string on failure.
   */
  ocrFocused(): Promise<string>;
  /**
   * Capture the screen + ask the LLM a question about its contents.
   * Returns the LLM's answer. Used by the WakeOverlay "ask about screen" button.
   */
  askAboutScreen(question: string): Promise<string>;
  /** Read the system clipboard as text. */
  readClipboard(): Promise<string>;
  /**
   * Capture the clipboard (presumed to be code the user just selected),
   * ask the LLM a question about it. Returns the LLM's answer.
   */
  askAboutCode(question: string): Promise<string>;
  /** Listen for main → renderer wake-word toggle messages. */
  onSetWakeWordEnabled(listener: (enabled: boolean) => void): () => void;
  /** Tell main that the wake word was matched — fire a wake event. */
  requestWake(): void;
}

/** Add to `window` so TypeScript sees `window.jarvisV16` after preload runs. */
declare global {
  interface Window {
    jarvisV16?: JarvisV16API;
  }
}
