/**
 * Monkey-patches console.log / warn / error to prepend a [HH:MM:SS.mmm]
 * timestamp to every terminal line. Import this FIRST from any entry point
 * (start-jarvis.ts, _core/index.ts) so it runs before any other module's
 * top-level code gets a chance to log.
 *
 * Covers both direct console.* calls AND the logger.ts module (which calls
 * console.log internally), so every line in the terminal ends up with a
 * timestamp without having to touch each module individually.
 *
 * Idempotent — re-importing is a no-op.
 */

const GUARD = "__jarvisConsoleTimestamped";

if (!(globalThis as any)[GUARD]) {
  (globalThis as any)[GUARD] = true;

  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  const origDebug = console.debug.bind(console);

  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const timestamp = () => {
    const d = new Date();
    return `[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}]`;
  };

  console.log = (...args: unknown[]) => origLog(timestamp(), ...args);
  console.info = (...args: unknown[]) => origInfo(timestamp(), ...args);
  console.warn = (...args: unknown[]) => origWarn(timestamp(), ...args);
  console.error = (...args: unknown[]) => origError(timestamp(), ...args);
  console.debug = (...args: unknown[]) => origDebug(timestamp(), ...args);
}

export {};
