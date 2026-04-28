/**
 * Preload script — runs in a privileged context before the renderer loads,
 * exposes a typed API via `contextBridge` so the renderer can call main-
 * process functions without having raw Node/Electron access.
 *
 * This is the Electron security best practice: no `nodeIntegration: true`,
 * no `contextIsolation: false`. The renderer gets exactly the functions
 * listed here and nothing else.
 */

import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type WakeEvent, type DismissEvent, type ClapEvent, type JarvisV16API, type V16Panel } from "./types.js";

const api: JarvisV16API = {
  onWake(listener) {
    const handler = (_: unknown, event: WakeEvent) => listener(event);
    ipcRenderer.on(IPC_CHANNELS.wake, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.wake, handler);
  },

  onMicToggle(listener) {
    const handler = (_: unknown, payload: { enabled: boolean }) =>
      listener(payload.enabled);
    ipcRenderer.on(IPC_CHANNELS.micToggle, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.micToggle, handler);
  },

  onSetPanel(listener) {
    const handler = (_: unknown, panel: V16Panel) => listener(panel);
    ipcRenderer.on(IPC_CHANNELS.setPanel, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.setPanel, handler);
  },

  notifyDismiss(event: DismissEvent) {
    ipcRenderer.send(IPC_CHANNELS.dismiss, event);
  },

  notifyClap(event: ClapEvent) {
    ipcRenderer.send(IPC_CHANNELS.clap, event);
  },

  async fetchBriefing() {
    return ipcRenderer.invoke(IPC_CHANNELS.fetchBriefing) as Promise<WakeEvent["briefing"]>;
  },

  async getAudioPath() {
    return ipcRenderer.invoke(IPC_CHANNELS.getAudioPath) as Promise<string | null>;
  },

  async speak(text: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.speak, text) as Promise<string | null>;
  },

  async ocrFocused() {
    return ipcRenderer.invoke(IPC_CHANNELS.ocrFocused) as Promise<string>;
  },

  async askAboutScreen(question: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.askAboutScreen, question) as Promise<string>;
  },

  async readClipboard() {
    return ipcRenderer.invoke(IPC_CHANNELS.readClipboard) as Promise<string>;
  },

  async askAboutCode(question: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.askAboutCode, question) as Promise<string>;
  },

  onSetWakeWordEnabled(listener: (enabled: boolean) => void) {
    const handler = (_: unknown, enabled: boolean) => listener(enabled);
    ipcRenderer.on(IPC_CHANNELS.setWakeWordEnabled, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.setWakeWordEnabled, handler);
  },

  requestWake() {
    ipcRenderer.send(IPC_CHANNELS.requestWake);
  },
};

try {
  contextBridge.exposeInMainWorld("jarvisV16", api);
} catch (err) {
  console.error("[v16/preload] exposeInMainWorld failed:", err);
}
