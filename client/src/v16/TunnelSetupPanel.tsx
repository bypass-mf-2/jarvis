/**
 * v16 Cloudflare Tunnel setup wizard.
 *
 * Walks the user through Steps 3-9 of pointing their existing domain at
 * JARVIS via a named Cloudflare Tunnel. Steps 1-2 (own a domain, add to
 * Cloudflare) happen on cloudflare.com — we just check that DNS works.
 *
 * Each step auto-detects whether it's already done by polling tunnel.state,
 * so refreshing or re-opening the panel always picks up where the user
 * left off. Designed for admin/single-user use — no auth gate beyond the
 * fact that this panel is only reachable from the tray.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

interface TunnelInfo {
  id: string;
  name: string;
  createdAt: string;
  connections: number;
}

interface TunnelState {
  cloudflaredInstalled: boolean;
  cloudflaredVersion: string | null;
  authenticated: boolean;
  tunnels: TunnelInfo[];
  configPath: string;
  configExists: boolean;
  configContents: string | null;
  jarvisPublicUrl: string | null;
}

const TRPC_TIMEOUT_MS = 8000;

async function trpcRead(res: Response): Promise<any> {
  // Defensive — if v15 is unreachable the Vite proxy can return 502 with
  // non-JSON body; if it's reachable but slow we still want a useful error.
  const text = await res.text();
  if (!text) {
    throw new Error(`Empty response from /api/trpc (HTTP ${res.status}). Is the v15 server running on http://localhost:3000? \`pnpm dev\` in the project root.`);
  }
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from /api/trpc (HTTP ${res.status}). First 100 chars: ${text.slice(0, 100)}`);
  }
  if (data?.[0]?.error) throw new Error(data[0].error?.json?.message ?? "tRPC error");
  return data?.[0]?.result?.data?.json;
}

const trpc = {
  async query(path: string, input?: unknown): Promise<any> {
    const url = `/api/trpc/${path}?batch=1&input=${encodeURIComponent(
      JSON.stringify({ "0": { json: input ?? null } })
    )}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(TRPC_TIMEOUT_MS) });
    return trpcRead(r);
  },
  async mutate(path: string, input?: unknown): Promise<any> {
    const r = await fetch(`/api/trpc/${path}?batch=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "0": { json: input ?? {} } }),
      signal: AbortSignal.timeout(TRPC_TIMEOUT_MS),
    });
    return trpcRead(r);
  },
};

type StepKey =
  | "domain"
  | "install"
  | "login"
  | "create"
  | "config"
  | "dns"
  | "service"
  | "publicUrl"
  | "verify";

const STEP_ORDER: StepKey[] = [
  "domain",
  "install",
  "login",
  "create",
  "config",
  "dns",
  "service",
  "publicUrl",
  "verify",
];

export function TunnelSetupPanel() {
  const [state, setState] = useState<TunnelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyStep, setBusyStep] = useState<StepKey | null>(null);
  const [stepMessage, setStepMessage] = useState<Partial<Record<StepKey, string>>>({});

  // User-controlled inputs
  const [tunnelName, setTunnelName] = useState("jarvis");
  const [hostname, setHostname] = useState("");
  const [mode, setMode] = useState<"locked" | "open">("locked");
  const [pingResult, setPingResult] = useState<{ ok: boolean; status: number; message: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await trpc.query("tunnel.state");
      setState(s);
      setError(null);
      // Pre-fill hostname from existing public URL if we have one
      if (s?.jarvisPublicUrl && !hostname) {
        try {
          const u = new URL(s.jarvisPublicUrl);
          setHostname(u.hostname);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      setError(`Failed to load state: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [hostname]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8_000);
    return () => clearInterval(t);
  }, [refresh]);

  const setMsg = (step: StepKey, msg: string | undefined) =>
    setStepMessage((prev) => ({ ...prev, [step]: msg }));

  // Existing tunnel for the current name (if any)
  const matchingTunnel = useMemo(
    () => state?.tunnels.find((t) => t.name === tunnelName),
    [state, tunnelName]
  );

  // Step status — used to show the green dot / strikethrough effect
  const stepDone = (k: StepKey): boolean => {
    if (!state) return false;
    switch (k) {
      case "install": return state.cloudflaredInstalled;
      case "login": return state.authenticated;
      case "create": return !!matchingTunnel;
      case "config": return state.configExists && !!state.configContents?.includes(hostname);
      case "publicUrl": return !!state.jarvisPublicUrl && hostname.length > 0 && state.jarvisPublicUrl.includes(hostname);
      // domain/dns/service/verify — can't reliably auto-detect; rely on user
      default: return false;
    }
  };

  // ── Step actions ──────────────────────────────────────────────────────────

  const runInstall = async () => {
    setBusyStep("install");
    setMsg("install", undefined);
    try {
      const res = await trpc.mutate("tunnel.install");
      setMsg("install", res.message);
      setTimeout(refresh, 30_000); // poll once after winget likely finishes
    } catch (err) {
      setMsg("install", `Failed: ${String(err)}`);
    } finally {
      setBusyStep(null);
    }
  };

  const runLogin = async () => {
    setBusyStep("login");
    setMsg("login", undefined);
    try {
      const res = await trpc.mutate("tunnel.login");
      setMsg(
        "login",
        res.loginUrl
          ? `Browser should have opened. If not, copy: ${res.loginUrl}`
          : res.message
      );
    } catch (err) {
      setMsg("login", `Failed: ${String(err)}`);
    } finally {
      setBusyStep(null);
    }
  };

  const runCreate = async () => {
    if (!tunnelName.trim()) return;
    setBusyStep("create");
    setMsg("create", undefined);
    try {
      const res = await trpc.mutate("tunnel.createTunnel", { name: tunnelName.trim() });
      setMsg("create", res.message);
      refresh();
    } catch (err) {
      setMsg("create", `Failed: ${String(err)}`);
    } finally {
      setBusyStep(null);
    }
  };

  const runWriteConfig = async () => {
    if (!matchingTunnel || !hostname.trim()) return;
    setBusyStep("config");
    setMsg("config", undefined);
    try {
      const res = await trpc.mutate("tunnel.writeConfig", {
        tunnelId: matchingTunnel.id,
        hostname: hostname.trim(),
        mode,
      });
      setMsg("config", res.message);
      refresh();
    } catch (err) {
      setMsg("config", `Failed: ${String(err)}`);
    } finally {
      setBusyStep(null);
    }
  };

  const runDns = async () => {
    if (!matchingTunnel || !hostname.trim()) return;
    setBusyStep("dns");
    setMsg("dns", undefined);
    try {
      const res = await trpc.mutate("tunnel.addDnsRoute", {
        tunnelName: matchingTunnel.name,
        hostname: hostname.trim(),
      });
      setMsg("dns", res.message);
    } catch (err) {
      setMsg("dns", `Failed: ${String(err)}`);
    } finally {
      setBusyStep(null);
    }
  };

  const runInstallService = async () => {
    setBusyStep("service");
    setMsg("service", undefined);
    try {
      const res = await trpc.mutate("tunnel.installService");
      setMsg("service", res.message);
    } catch (err) {
      setMsg("service", `Failed: ${String(err)}`);
    } finally {
      setBusyStep(null);
    }
  };

  const runSetPublicUrl = async () => {
    if (!hostname.trim()) return;
    setBusyStep("publicUrl");
    setMsg("publicUrl", undefined);
    try {
      const url = `https://${hostname.trim()}`;
      const res = await trpc.mutate("tunnel.setPublicUrl", { url });
      setMsg("publicUrl", `Saved: ${res.url}`);
      refresh();
    } catch (err) {
      setMsg("publicUrl", `Failed: ${String(err)}`);
    } finally {
      setBusyStep(null);
    }
  };

  const runVerify = async () => {
    if (!hostname.trim()) return;
    setBusyStep("verify");
    setPingResult(null);
    try {
      const res = await trpc.query("tunnel.ping", { hostname: hostname.trim() });
      setPingResult(res);
    } catch (err) {
      setPingResult({ ok: false, status: 0, message: `Failed: ${String(err)}` });
    } finally {
      setBusyStep(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading && !state) {
    return (
      <div className="p-6 text-foreground">
        <p className="text-sm text-muted-foreground">Loading tunnel state…</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto text-foreground space-y-4">
      <header>
        <h2 className="text-lg font-semibold">Cloudflare Tunnel</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Expose JARVIS at a stable hostname on your own domain — without opening
          a router port. Works the same from any network.
        </p>
      </header>

      {error && (
        <pre className="text-[11px] p-2 rounded border border-destructive/40 bg-destructive/10 text-destructive whitespace-pre-wrap">
          {error}
        </pre>
      )}

      {/* Live state summary */}
      {state && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
          <Pill ok={state.cloudflaredInstalled} label="cloudflared" detail={state.cloudflaredVersion ?? "not installed"} />
          <Pill ok={state.authenticated} label="auth" detail={state.authenticated ? "cert.pem ✓" : "not logged in"} />
          <Pill ok={state.tunnels.length > 0} label="tunnels" detail={`${state.tunnels.length} found`} />
          <Pill
            ok={!!state.jarvisPublicUrl}
            label="public URL"
            detail={state.jarvisPublicUrl ? new URL(state.jarvisPublicUrl).hostname : "unset"}
          />
        </div>
      )}

      {/* Inputs that span multiple steps */}
      <section className="rounded border border-border bg-background/50 p-3 space-y-2">
        <h3 className="text-sm font-semibold">Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
          <label className="block">
            <span className="text-muted-foreground">Tunnel name</span>
            <input
              value={tunnelName}
              onChange={(e) => setTunnelName(e.target.value)}
              placeholder="jarvis"
              className="mt-0.5 w-full px-2 py-1 rounded border border-border bg-background font-mono"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="text-muted-foreground">Hostname (subdomain on your domain)</span>
            <input
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="jarvis.yourdomain.com"
              className="mt-0.5 w-full px-2 py-1 rounded border border-border bg-background font-mono"
            />
          </label>
        </div>
        <label className="block text-xs">
          <span className="text-muted-foreground">Exposure mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "locked" | "open")}
            className="mt-0.5 ml-2 px-2 py-1 rounded border border-border bg-background"
          >
            <option value="locked">Locked — only phone callbacks + OAuth (recommended)</option>
            <option value="open">Open — full JARVIS UI exposed to the internet</option>
          </select>
        </label>
      </section>

      {/* Step list */}
      <ol className="space-y-3">
        {STEP_ORDER.map((key, idx) => (
          <Step
            key={key}
            n={idx + 1}
            done={stepDone(key)}
            title={STEP_TITLES[key]}
            description={renderStepDescription(key, { hostname, mode })}
            message={stepMessage[key]}
            busy={busyStep === key}
          >
            {renderStepActions(key, {
              hostname,
              tunnelName,
              matchingTunnel,
              busy: busyStep === key,
              actions: {
                runInstall,
                runLogin,
                runCreate,
                runWriteConfig,
                runDns,
                runInstallService,
                runSetPublicUrl,
                runVerify,
              },
              pingResult,
            })}
          </Step>
        ))}
      </ol>

      {/* Final summary */}
      {state?.jarvisPublicUrl && pingResult?.ok && (
        <section className="rounded border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs">
          <p className="text-emerald-400 font-semibold">✓ Tunnel is live</p>
          <p className="mt-1 text-muted-foreground">
            JARVIS is reachable at <span className="font-mono text-emerald-400">{state.jarvisPublicUrl}</span>.
            Phone notification action buttons will use this URL automatically.
          </p>
        </section>
      )}

      <div className="text-[11px] text-muted-foreground pt-2 border-t border-border">
        Config file: <span className="font-mono">{state?.configPath}</span>
        {state?.configExists && state.configContents && (
          <details className="mt-2">
            <summary className="cursor-pointer hover:text-foreground">view config.yml</summary>
            <pre className="mt-1 p-2 rounded border border-border bg-background/60 overflow-x-auto whitespace-pre">
              {state.configContents}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

const STEP_TITLES: Record<StepKey, string> = {
  domain: "Add your domain to Cloudflare",
  install: "Install cloudflared",
  login: "Authenticate with Cloudflare",
  create: "Create the named tunnel",
  config: "Write config.yml",
  dns: "Point hostname at the tunnel (DNS)",
  service: "Install as Windows service",
  publicUrl: "Save JARVIS_PUBLIC_URL",
  verify: "Verify the tunnel is reachable",
};

function renderStepDescription(key: StepKey, ctx: { hostname: string; mode: "locked" | "open" }): string {
  switch (key) {
    case "domain":
      return "On cloudflare.com → Add Site → enter your domain → switch nameservers at your registrar (one-time, takes minutes to hours). Skip if already done.";
    case "install":
      return "Installs cloudflared via winget. Approve the UAC prompt. Refresh after ~30s.";
    case "login":
      return "Opens a browser to Cloudflare. Sign in, pick your domain, click Authorize. Drops cert.pem into ~/.cloudflared.";
    case "create":
      return `Creates a named tunnel "${ctx.hostname || "jarvis"}". Idempotent — safe to click if it already exists.`;
    case "config":
      return ctx.mode === "locked"
        ? "Writes ~/.cloudflared/config.yml exposing only the phone-callback paths and Google OAuth callback. Everything else returns 403."
        : "Writes ~/.cloudflared/config.yml exposing the full JARVIS UI to the internet. Make sure auth is configured.";
    case "dns":
      return "Adds a CNAME record in Cloudflare pointing your hostname at the tunnel.";
    case "service":
      return "Registers cloudflared as a Windows service so it auto-starts on boot. Requires admin.";
    case "publicUrl":
      return "Persists the public URL into .env so phone-notification action buttons callback through the tunnel.";
    case "verify":
      return "Hits your hostname over the public internet to confirm the tunnel is up.";
  }
}

function renderStepActions(
  key: StepKey,
  args: {
    hostname: string;
    tunnelName: string;
    matchingTunnel: TunnelInfo | undefined;
    busy: boolean;
    actions: {
      runInstall: () => void;
      runLogin: () => void;
      runCreate: () => void;
      runWriteConfig: () => void;
      runDns: () => void;
      runInstallService: () => void;
      runSetPublicUrl: () => void;
      runVerify: () => void;
    };
    pingResult: { ok: boolean; status: number; message: string } | null;
  }
): React.ReactNode {
  const { hostname, tunnelName, matchingTunnel, busy, actions, pingResult } = args;
  switch (key) {
    case "domain":
      return (
        <a
          href="https://dash.cloudflare.com/sign-up"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-3 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 inline-block"
        >
          Open Cloudflare ↗
        </a>
      );
    case "install":
      return <Btn onClick={actions.runInstall} busy={busy}>Run winget install</Btn>;
    case "login":
      return <Btn onClick={actions.runLogin} busy={busy}>Run cloudflared login</Btn>;
    case "create":
      return (
        <Btn onClick={actions.runCreate} busy={busy} disabled={!tunnelName.trim()}>
          {matchingTunnel ? `Recheck tunnel "${tunnelName}"` : `Create tunnel "${tunnelName}"`}
        </Btn>
      );
    case "config":
      return (
        <Btn onClick={actions.runWriteConfig} busy={busy} disabled={!matchingTunnel || !hostname.trim()}>
          Write config.yml
        </Btn>
      );
    case "dns":
      return (
        <Btn onClick={actions.runDns} busy={busy} disabled={!matchingTunnel || !hostname.trim()}>
          Add DNS route
        </Btn>
      );
    case "service":
      return <Btn onClick={actions.runInstallService} busy={busy}>Install service</Btn>;
    case "publicUrl":
      return (
        <Btn onClick={actions.runSetPublicUrl} busy={busy} disabled={!hostname.trim()}>
          Save https://{hostname || "…"}
        </Btn>
      );
    case "verify":
      return (
        <div className="flex items-center gap-2">
          <Btn onClick={actions.runVerify} busy={busy} disabled={!hostname.trim()}>Ping {hostname || "…"}</Btn>
          {pingResult && (
            <span className={`text-[11px] ${pingResult.ok ? "text-emerald-400" : "text-amber-400"}`}>
              {pingResult.message}
            </span>
          )}
        </div>
      );
  }
}

function Step({
  n,
  done,
  title,
  description,
  message,
  busy,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  description: string;
  message: string | undefined;
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className={`rounded border p-3 ${done ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-background/30"}`}>
      <div className="flex items-start gap-3">
        <div
          className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-mono ${
            done ? "bg-emerald-500/20 text-emerald-400" : "bg-muted text-muted-foreground"
          }`}
        >
          {done ? "✓" : n}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            {title}
            {busy && <span className="text-[10px] text-amber-400">running…</span>}
          </h4>
          <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
          <div className="mt-2">{children}</div>
          {message && (
            <p className="mt-2 text-[11px] text-muted-foreground italic whitespace-pre-wrap break-words">{message}</p>
          )}
        </div>
      </div>
    </li>
  );
}

function Pill({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div
      className={`px-2 py-1 rounded border ${
        ok ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" : "border-border bg-background/40 text-muted-foreground"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="font-mono truncate" title={detail}>{detail}</div>
    </div>
  );
}

function Btn({
  onClick,
  busy,
  disabled,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {busy ? "…" : children}
    </button>
  );
}
