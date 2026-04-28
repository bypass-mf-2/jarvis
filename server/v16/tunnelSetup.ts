/**
 * Cloudflare Tunnel setup helpers — backs the TunnelSetupPanel UI.
 *
 * What this module owns:
 *   - Detecting cloudflared installation
 *   - Detecting authentication (cert.pem exists)
 *   - Listing existing tunnels
 *   - Generating + writing config.yml
 *   - Running the various cloudflared commands
 *   - Reading + updating JARVIS_PUBLIC_URL in .env
 *
 * What it does NOT own:
 *   - Adding a domain to Cloudflare (browser flow on cloudflare.com)
 *   - Changing nameservers at the user's registrar
 *   - cloudflared tunnel login interactive auth (opens browser)
 *
 * Those steps still require user action — but the UI panel will tell
 * them exactly what to do and detect when each completes.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../logger.js";

const execAsync = promisify(exec);

// ─── Filesystem locations ───────────────────────────────────────────────────

const HOME = os.homedir();
const CLOUDFLARED_DIR = path.join(HOME, ".cloudflared");
const CERT_PATH = path.join(CLOUDFLARED_DIR, "cert.pem");
const CONFIG_PATH = path.join(CLOUDFLARED_DIR, "config.yml");
const ENV_PATH = path.join(process.cwd(), ".env");

// ─── Step detection ─────────────────────────────────────────────────────────

export interface TunnelState {
  /** cloudflared CLI on PATH and runnable. */
  cloudflaredInstalled: boolean;
  cloudflaredVersion: string | null;
  /** ~/.cloudflared/cert.pem exists — user authenticated via `tunnel login`. */
  authenticated: boolean;
  /** All tunnels visible to the authenticated account. */
  tunnels: TunnelInfo[];
  /** Config file at ~/.cloudflared/config.yml. */
  configPath: string;
  configExists: boolean;
  configContents: string | null;
  /** Current JARVIS_PUBLIC_URL value from .env. */
  jarvisPublicUrl: string | null;
}

export interface TunnelInfo {
  id: string;
  name: string;
  createdAt: string;
  connections: number;
}

/**
 * Inspect the local cloudflared install + config + Cloudflare account
 * state. Used by the wizard to know which steps are already done.
 */
export async function getTunnelState(): Promise<TunnelState> {
  const [installCheck, tunnels, configContents, publicUrl] = await Promise.all([
    detectCloudflared(),
    listTunnels().catch(() => []),
    readConfigSafe(),
    readEnvVar("JARVIS_PUBLIC_URL"),
  ]);

  return {
    cloudflaredInstalled: installCheck.installed,
    cloudflaredVersion: installCheck.version,
    authenticated: fs.existsSync(CERT_PATH),
    tunnels,
    configPath: CONFIG_PATH,
    configExists: configContents !== null,
    configContents,
    jarvisPublicUrl: publicUrl,
  };
}

async function detectCloudflared(): Promise<{ installed: boolean; version: string | null }> {
  try {
    const { stdout } = await execAsync("cloudflared --version", { timeout: 5000 });
    const match = stdout.match(/cloudflared version (\S+)/);
    return { installed: true, version: match ? match[1] : stdout.trim().slice(0, 80) };
  } catch {
    return { installed: false, version: null };
  }
}

async function listTunnels(): Promise<TunnelInfo[]> {
  if (!fs.existsSync(CERT_PATH)) return [];
  try {
    const { stdout } = await execAsync("cloudflared tunnel list -o json", { timeout: 10_000 });
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t: any) => ({
      id: String(t.id ?? t.ID ?? ""),
      name: String(t.name ?? t.Name ?? ""),
      createdAt: String(t.created_at ?? t.CreatedAt ?? ""),
      connections: Array.isArray(t.connections ?? t.Connections) ? (t.connections ?? t.Connections).length : 0,
    }));
  } catch {
    return [];
  }
}

function readConfigSafe(): string | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    return fs.readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    return null;
  }
}

// ─── .env helpers (read + update JARVIS_PUBLIC_URL) ────────────────────────

function readEnvVar(key: string): string | null {
  try {
    if (!fs.existsSync(ENV_PATH)) return null;
    const lines = fs.readFileSync(ENV_PATH, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      // Skip commented lines
      if (/^\s*#/.test(line)) continue;
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && m[1] === key) {
        let val = m[2];
        // Strip quotes if wrapped
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        return val;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Update or append a key=value pair in .env. Idempotent. */
export function setEnvVar(key: string, value: string): void {
  const safeValue = String(value).replace(/[\r\n]/g, "");
  if (!fs.existsSync(ENV_PATH)) {
    fs.writeFileSync(ENV_PATH, `${key}=${safeValue}\n`, "utf-8");
    return;
  }
  const original = fs.readFileSync(ENV_PATH, "utf-8");
  const lines = original.split(/\r?\n/);
  let replaced = false;
  const out = lines.map((line) => {
    if (/^\s*#/.test(line)) return line;
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=/);
    if (m && m[1] === key) {
      replaced = true;
      return `${key}=${safeValue}`;
    }
    return line;
  });
  if (!replaced) out.push(`${key}=${safeValue}`);
  fs.writeFileSync(ENV_PATH, out.join("\n"), "utf-8");
}

// ─── Operations exposed via tRPC ────────────────────────────────────────────

/**
 * Install cloudflared on Windows via winget. Returns immediately with
 * { started: true } once winget is invoked; the actual install happens
 * asynchronously in a detached process. Caller should poll detectCloudflared()
 * after a few seconds.
 *
 * Note: requires interactive UAC prompt the first time on Windows.
 * If winget is unavailable (older Windows), returns { started: false }
 * with instructions.
 */
export async function installCloudflared(): Promise<{ started: boolean; message: string }> {
  // Check winget first
  try {
    await execAsync("winget --version", { timeout: 5000 });
  } catch {
    return {
      started: false,
      message:
        "winget not found. Download cloudflared manually: https://github.com/cloudflare/cloudflared/releases (pick the .msi).",
    };
  }
  try {
    // Run install in the background — don't await it
    exec("winget install --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements", {
      timeout: 120_000,
    });
    return {
      started: true,
      message: "Install started via winget. Approve any UAC prompt. Refresh this panel in 30-60 seconds.",
    };
  } catch (err) {
    return { started: false, message: `Install failed: ${String(err).slice(0, 200)}` };
  }
}

/**
 * Run `cloudflared tunnel login`. This opens a browser for the user to
 * authenticate with Cloudflare. Returns immediately with the URL the
 * browser opened to (parsed from cloudflared's stdout) so the UI can
 * surface it in case the browser didn't auto-open.
 */
export async function startCloudflaredLogin(): Promise<{ started: boolean; loginUrl: string | null; message: string }> {
  if (!(await detectCloudflared()).installed) {
    return { started: false, loginUrl: null, message: "cloudflared isn't installed yet." };
  }
  try {
    if (!fs.existsSync(CLOUDFLARED_DIR)) fs.mkdirSync(CLOUDFLARED_DIR, { recursive: true });

    // Spawn detached so it doesn't block. We poll for cert.pem to detect completion.
    const child = exec("cloudflared tunnel login", { timeout: 600_000 });
    let loginUrl: string | null = null;
    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        const match = text.match(/https:\/\/[^\s]+/);
        if (match && !loginUrl) loginUrl = match[0];
      });
    }

    // Wait briefly to capture the URL from stdout
    await new Promise((r) => setTimeout(r, 2500));

    return {
      started: true,
      loginUrl,
      message: loginUrl
        ? `Login URL: ${loginUrl}. A browser should have opened. Sign in to Cloudflare, pick your domain, and approve.`
        : "cloudflared is running. Browser should have opened to Cloudflare. Sign in + approve.",
    };
  } catch (err) {
    return { started: false, loginUrl: null, message: `Login start failed: ${String(err).slice(0, 200)}` };
  }
}

/**
 * Create a named tunnel. Idempotent: if one with the name already exists,
 * returns the existing tunnel info.
 */
export async function createTunnel(name: string): Promise<{ ok: boolean; tunnel: TunnelInfo | null; message: string }> {
  if (!fs.existsSync(CERT_PATH)) {
    return { ok: false, tunnel: null, message: "Not authenticated. Run `cloudflared tunnel login` first." };
  }
  // Check existing first
  const existing = (await listTunnels()).find((t) => t.name === name);
  if (existing) {
    return { ok: true, tunnel: existing, message: `Tunnel "${name}" already exists.` };
  }
  try {
    const { stdout } = await execAsync(`cloudflared tunnel create ${name}`, { timeout: 30_000 });
    // Output: "Created tunnel <name> with id <uuid>"
    const idMatch = stdout.match(/with id ([0-9a-f-]+)/i);
    if (!idMatch) {
      return { ok: false, tunnel: null, message: `Created but couldn't parse ID: ${stdout.slice(0, 200)}` };
    }
    return {
      ok: true,
      tunnel: { id: idMatch[1], name, createdAt: new Date().toISOString(), connections: 0 },
      message: `Tunnel "${name}" created with id ${idMatch[1]}.`,
    };
  } catch (err) {
    return { ok: false, tunnel: null, message: `Create failed: ${String(err).slice(0, 200)}` };
  }
}

/**
 * Write or overwrite ~/.cloudflared/config.yml with the JARVIS-shaped
 * ingress rules. Restricts to the routes phone callbacks need by default;
 * caller can override with `mode: "open"` to expose everything.
 */
export function writeConfig(opts: {
  tunnelId: string;
  hostname: string;
  /** "locked" = only expose phone-callback paths; "open" = expose everything. */
  mode?: "locked" | "open";
  localPort?: number;
}): { ok: boolean; path: string; message: string } {
  const port = opts.localPort ?? 3000;
  const credPath = path.join(CLOUDFLARED_DIR, `${opts.tunnelId}.json`);
  if (!fs.existsSync(credPath)) {
    return { ok: false, path: CONFIG_PATH, message: `Credentials file not found: ${credPath}. Did the tunnel get created?` };
  }
  const lines: string[] = [
    `tunnel: ${opts.tunnelId}`,
    `credentials-file: ${credPath.replace(/\\/g, "/")}`,
    "",
    "ingress:",
  ];
  if (opts.mode === "open") {
    // Expose everything (with a catch-all 404 at the end as cloudflared requires)
    lines.push(
      `  - hostname: ${opts.hostname}`,
      `    service: http://localhost:${port}`,
      `  - service: http_status:404`
    );
  } else {
    // Locked: only the routes ntfy needs to reach + Google OAuth callback
    lines.push(
      `  # Phone-notification action callbacks (ntfy POSTs here when buttons tapped)`,
      `  - hostname: ${opts.hostname}`,
      `    path: /api/notify/action.*`,
      `    service: http://localhost:${port}`,
      `  # Google Calendar OAuth callback (only used during initial connect)`,
      `  - hostname: ${opts.hostname}`,
      `    path: /api/oauth/google/callback.*`,
      `    service: http://localhost:${port}`,
      `  # Block everything else`,
      `  - service: http_status:403`
    );
  }
  try {
    if (!fs.existsSync(CLOUDFLARED_DIR)) fs.mkdirSync(CLOUDFLARED_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, lines.join("\n") + "\n", "utf-8");
    return { ok: true, path: CONFIG_PATH, message: "Config written." };
  } catch (err) {
    return { ok: false, path: CONFIG_PATH, message: `Write failed: ${String(err).slice(0, 200)}` };
  }
}

/** Create the Cloudflare DNS CNAME pointing the hostname at the tunnel. */
export async function addDnsRoute(tunnelName: string, hostname: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { stdout, stderr } = await execAsync(
      `cloudflared tunnel route dns ${tunnelName} ${hostname}`,
      { timeout: 30_000 }
    );
    return { ok: true, message: stdout.trim() || stderr.trim() || "DNS route created." };
  } catch (err: any) {
    const msg = String(err?.stderr ?? err?.message ?? err).slice(0, 300);
    // Cloudflared returns non-zero if the route already exists; treat as ok.
    if (msg.includes("already exists") || msg.includes("Added CNAME")) {
      return { ok: true, message: "Route already exists or just created." };
    }
    return { ok: false, message: `Route failed: ${msg}` };
  }
}

/**
 * Install cloudflared as a Windows service so it auto-starts on boot.
 * Requires admin privileges. Returns { started: true } if the install
 * command was invoked; caller should check service status separately.
 */
export async function installService(): Promise<{ ok: boolean; message: string }> {
  try {
    const { stdout, stderr } = await execAsync("cloudflared service install", { timeout: 30_000 });
    return { ok: true, message: stdout.trim() || stderr.trim() || "Service installed." };
  } catch (err: any) {
    const msg = String(err?.stderr ?? err?.message ?? err).slice(0, 300);
    if (msg.toLowerCase().includes("already exists")) {
      return { ok: true, message: "Service already installed." };
    }
    return { ok: false, message: `Service install failed: ${msg}. Note: requires admin privileges.` };
  }
}

/** Quick reachability check — does the tunnel actually answer? */
export async function pingTunnel(hostname: string): Promise<{ ok: boolean; status: number; message: string }> {
  try {
    const url = hostname.startsWith("http") ? hostname : `https://${hostname}`;
    const probe = `${url}/api/oauth/google/status`; // a known-existing GET endpoint
    const res = await fetch(probe, { signal: AbortSignal.timeout(10_000) });
    return {
      ok: res.ok,
      status: res.status,
      message: res.ok
        ? `Tunnel responds (HTTP ${res.status}).`
        : `Tunnel reachable but JARVIS returned ${res.status}.`,
    };
  } catch (err) {
    return { ok: false, status: 0, message: `Unreachable: ${String(err).slice(0, 200)}` };
  }
}
