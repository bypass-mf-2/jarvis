/**
 * Renderer root — subscribes to wake events from main, orchestrates the
 * wake sequence (audio + TTS + overlay), mounts WakeOverlay on show.
 *
 * The end-to-end sequence:
 *   1. Main fires `onWake` with briefing data + audioPath
 *   2. Start wake-song playback at 20% volume (non-blocking)
 *   3. Show overlay with briefing text
 *   4. Ask main to TTS the briefing — returns a URL
 *   5. Play the TTS audio through a SECOND <audio> element at full volume
 *      (runs in parallel with the ducked music — both heard at once)
 *   6. When TTS completes, ramp music from 20% → 100% over 3s
 *   7. User hits Escape (or 30s timeout) → stop everything
 *
 * Mic capture is toggled by the tray menu. When on, feeds the pure
 * clapDetector signal processor; valid double-claps notify main which
 * re-triggers the wake flow.
 */

import { useCallback, useEffect, useState } from "react";
import { useWakeWordListener } from "@/v16/useWakeWordListener";
import { WakeOverlay } from "@/v16/WakeOverlay";
import { WorkflowPanel } from "@/v16/WorkflowPanel";
import { PerAppMemoryPanel } from "@/v16/PerAppMemoryPanel";
import { SettingsPanel } from "@/v16/SettingsPanel";
import { PhonePanel } from "@/v16/PhonePanel";
import { OpinionsPanel } from "@/v16/OpinionsPanel";
import { DistillationPanel } from "@/v16/DistillationPanel";
import { TunnelSetupPanel } from "@/v16/TunnelSetupPanel";
import type { WakeEvent, V16Panel } from "../types.js";
import { startMicListener, stopMicListener } from "./mic.js";
import { createAudioController } from "./audio.js";
import { createSpeechController } from "./speech.js";

type State =
  | { phase: "idle" }
  | { phase: "panel"; panel: Exclude<V16Panel, "idle" | "wake"> }
  | { phase: "waking"; event: WakeEvent }
  | { phase: "speaking"; event: WakeEvent }
  | { phase: "musicOnly"; event: WakeEvent };

// Two windows share this renderer code. The wake window opens to "/" and
// handles wake events; the panel window opens to "/?mode=panel" and only
// renders panel views. Each window has its own React tree and ignores
// IPC events it doesn't care about.
const isPanelWindow =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mode") === "panel";

export function App() {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [music] = useState(() => createAudioController());
  const [speech] = useState(() => createSpeechController());
  const [wakeWordEnabled, setWakeWordEnabledState] = useState(false);

  // Wake-word listener (browser SpeechRecognition). Only runs in the wake
  // overlay window — that window stays loaded but hidden between wakes, so
  // continuous listening works without a panel window being open.
  const onWakeWordMatched = useCallback(() => {
    if (!window.jarvisV16) return;
    window.jarvisV16.requestWake();
  }, []);
  const wakeWord = useWakeWordListener({
    enabled: wakeWordEnabled && !isPanelWindow,
    onWake: onWakeWordMatched,
  });
  // Reference to silence unused-var warnings — surfaces in DevTools for debug.
  void wakeWord;

  useEffect(() => {
    if (!window.jarvisV16 || isPanelWindow) return;
    return window.jarvisV16.onSetWakeWordEnabled(setWakeWordEnabledState);
  }, []);

  // Subscribe to wake events from main. Panel window doesn't run the wake
  // pipeline — wake events go to the overlay window only.
  useEffect(() => {
    if (!window.jarvisV16 || isPanelWindow) return;
    const off = window.jarvisV16.onWake(async (event) => {
      setState({ phase: "waking", event });

      // Start wake song ducked (non-blocking — if it fails, the greeting still happens)
      if (event.audioPath) {
        music.play(event.audioPath, 0.2).catch((err) => {
          console.warn("[v16/renderer] wake-song play failed:", err);
        });
      }

      // Request TTS and play the generated audio over the ducked music.
      setState({ phase: "speaking", event });
      try {
        const ttsUrl = await window.jarvisV16!.speak(event.briefing.text);
        if (ttsUrl) {
          // Blocks until the greeting audio finishes. Meanwhile the wake
          // song keeps playing underneath at 20%.
          await speech.playAndWait(ttsUrl);
        } else {
          // No TTS available — small pause so the overlay isn't instantly
          // gone if the user wanted to read the briefing. 3s is arbitrary.
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (err) {
        console.warn("[v16/renderer] speak pipeline failed:", err);
      }

      // Ramp wake song back up to full volume.
      if (event.audioPath) {
        setState({ phase: "musicOnly", event });
        await music.rampVolume(0.2, 1.0, 3000);
      } else {
        setState({ phase: "musicOnly", event });
      }
    });
    return () => {
      off();
      music.stop().catch(() => {});
      speech.stop().catch(() => {});
    };
  }, [music, speech]);

  // Mic toggle driven by tray menu — start/stop Web Audio mic capture.
  useEffect(() => {
    if (!window.jarvisV16) return;
    const off = window.jarvisV16.onMicToggle((enabled) => {
      if (enabled) {
        startMicListener().catch((err) =>
          console.warn("[v16/renderer] mic start failed:", err)
        );
      } else {
        stopMicListener();
      }
    });
    return () => {
      off();
      stopMicListener();
    };
  }, []);

  // Panel-switch driven by tray menu — main fires this when user picks
  // "Open Workflows" / "Open Memory" / "Open Settings" from the tray.
  useEffect(() => {
    if (!window.jarvisV16) return;
    const off = window.jarvisV16.onSetPanel((panel) => {
      if (panel === "idle") {
        setState({ phase: "idle" });
      } else if (panel === "wake") {
        // wake fires through onWake separately — ignore here
      } else {
        setState({ phase: "panel", panel });
      }
    });
    return off;
  }, []);

  const onDismiss = async () => {
    if (!window.jarvisV16) return;
    window.jarvisV16.notifyDismiss({ reason: "escape" });
    await Promise.allSettled([music.stop(), speech.stop()]);
    setState({ phase: "idle" });
  };

  if (state.phase === "idle") {
    // The panel window opens to a different URL (?mode=panel) and starts in
    // idle until main pushes a setPanel event. Show a quiet loading state
    // instead of the floating standby pill — opaque background since this
    // window has a real frame.
    if (isPanelWindow) {
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
          <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
            Loading…
          </div>
        </div>
      );
    }
    // Wake window: floating standby pill on transparent backdrop.
    return (
      <div
        className="fixed inset-0 flex items-end justify-end p-6 pointer-events-none"
        style={{
          background: "radial-gradient(circle at center, rgba(0,20,40,0.15), rgba(0,0,0,0.35))",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="text-[11px] text-sky-400/70 font-mono tracking-wider uppercase">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-400/70 animate-pulse mr-2 align-middle" />
          JARVIS · standing by
        </div>
      </div>
    );
  }

  if (state.phase === "panel") {
    // Tray-driven full-window panels. No backdrop blur — panels are
    // standalone tools the user reads + interacts with.
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PanelHeader panel={state.panel} onClose={onDismiss} />
        {state.panel === "workflows" && <WorkflowPanel />}
        {state.panel === "memory" && <PerAppMemoryPanel />}
        {state.panel === "settings" && <SettingsPanel />}
        {state.panel === "phone" && <PhonePanel />}
        {state.panel === "opinions" && <OpinionsPanel />}
        {state.panel === "distillation" && <DistillationPanel />}
        {state.panel === "tunnel" && <TunnelSetupPanel />}
      </div>
    );
  }

  const { event } = state;

  return (
    <WakeOverlay
      briefingText={event.briefing.text}
      tasks={event.briefing.tasks}
      events={event.briefing.events}
      musicPlaying={state.phase === "speaking" || state.phase === "musicOnly"}
      speaking={state.phase === "speaking"}
      // wake-word fires also auto-start voice mode (Google-Home style)
      autoStartVoice={event.source === "wake-word"}
      onDismiss={onDismiss}
    />
  );
}

function PanelHeader({
  panel,
  onClose,
}: {
  panel: "workflows" | "memory" | "settings" | "phone" | "opinions" | "distillation" | "tunnel";
  onClose: () => void;
}) {
  const labels = {
    workflows: "Workflows",
    memory: "Per-App Memory",
    settings: "Falcon Settings",
    phone: "Phone Notifications",
    opinions: "Opinions",
    distillation: "Distillation",
    tunnel: "Cloudflare Tunnel",
  } as const;
  // Panel window has a native OS title bar with min/max/close — no need for
  // an in-renderer close button. This strip is just visual context for which
  // panel is currently in view.
  void onClose; // kept in signature for back-compat but unused
  return (
    <div className="flex items-center px-4 py-2 border-b border-border bg-muted/30 sticky top-0 z-10">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-sky-400 font-mono uppercase tracking-wider">JARVIS · v16</span>
        <span className="text-muted-foreground">/</span>
        <span className="text-foreground/90">{labels[panel]}</span>
      </div>
    </div>
  );
}

export { startMicListener, stopMicListener };
