/**
 * v16 Credentials panel — manage the encrypted vault.
 *
 * Three states:
 *   - Uninitialized → setup form (pick a master password)
 *   - Locked        → unlock form (enter master password)
 *   - Unlocked      → list view + add/edit/delete + lock button
 *
 * Master password input is type=password and never logged. A copy-to-clipboard
 * button on each field uses navigator.clipboard.writeText with a 30-second
 * auto-clear (best-effort — only works while the tab has focus).
 */

import { useCallback, useEffect, useMemo, useState } from "react";

interface CredentialMeta {
  id: number;
  name: string;
  url: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  accessedAt: number | null;
  accessCount: number;
}

interface CredentialFields {
  username?: string;
  password?: string;
  totpSecret?: string;
  notes?: string;
  extra?: Record<string, string>;
}

interface CredentialRecord extends CredentialMeta {
  fields: CredentialFields;
}

interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
  unlockedAt: number | null;
  autoLockMs: number;
  credentialCount: number;
}

const trpc = {
  async query(path: string, input?: unknown): Promise<any> {
    const url = `/api/trpc/${path}?batch=1&input=${encodeURIComponent(
      JSON.stringify({ "0": { json: input ?? null } }),
    )}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data?.[0]?.error) throw new Error(data[0].error?.json?.message ?? "tRPC error");
    return data?.[0]?.result?.data?.json;
  },
  async mutate(path: string, input?: unknown): Promise<any> {
    const r = await fetch(`/api/trpc/${path}?batch=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "0": { json: input ?? {} } }),
    });
    const data = await r.json();
    if (data?.[0]?.error) throw new Error(data[0].error?.json?.message ?? "tRPC error");
    return data?.[0]?.result?.data?.json;
  },
};

export function CredentialsPanel() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [list, setList] = useState<CredentialMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Editor state — null = closed, "new" = adding, otherwise existing id being edited
  const [editorTarget, setEditorTarget] = useState<"new" | number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await trpc.query("credentials.status");
      setStatus(s);
      if (s.unlocked) {
        const l = await trpc.query("credentials.list");
        setList(l ?? []);
      } else {
        setList([]);
      }
      setError(null);
    } catch (err) {
      setError(`Refresh failed: ${String(err)}`);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000); // poll for auto-lock changes
    return () => clearInterval(t);
  }, [refresh]);

  if (!status) {
    return (
      <div className="p-6 text-foreground">
        <p className="text-sm text-muted-foreground">Loading vault…</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto text-foreground space-y-4">
      <header>
        <h2 className="text-lg font-semibold">Credentials Vault</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Encrypted at rest with Argon2id + XChaCha20-Poly1305. Master password
          never leaves this machine. Auto-locks after{" "}
          <span className="font-mono">{Math.round(status.autoLockMs / 60_000)}</span> minutes idle.
        </p>
      </header>

      {error && (
        <pre className="text-[11px] p-2 rounded border border-destructive/40 bg-destructive/10 text-destructive whitespace-pre-wrap">
          {error}
        </pre>
      )}

      {!status.initialized && <SetupForm onDone={refresh} setBusy={setBusy} busy={busy} />}
      {status.initialized && !status.unlocked && (
        <UnlockForm onDone={refresh} setBusy={setBusy} busy={busy} />
      )}
      {status.unlocked && (
        <UnlockedView
          status={status}
          list={list}
          editorTarget={editorTarget}
          setEditorTarget={setEditorTarget}
          refresh={refresh}
          setError={setError}
        />
      )}
    </div>
  );
}

// ── Setup ────────────────────────────────────────────────────────────────────

function SetupForm({
  onDone,
  setBusy,
  busy,
}: {
  onDone: () => void;
  setBusy: (b: boolean) => void;
  busy: boolean;
}) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    setMsg(null);
    if (pw1.length < 8) {
      setMsg("Master password must be at least 8 characters.");
      return;
    }
    if (pw1 !== pw2) {
      setMsg("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await trpc.mutate("credentials.setup", { password: pw1 });
      if (!res?.ok) {
        setMsg(res?.message ?? "Setup failed.");
      } else {
        setPw1(""); setPw2("");
        onDone();
      }
    } catch (err) {
      setMsg(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded border border-border bg-background/50 p-4 space-y-3">
      <h3 className="text-sm font-semibold">First-time setup</h3>
      <p className="text-xs text-muted-foreground">
        Pick a strong master password. There is <span className="text-amber-400">no recovery</span> —
        if you forget it, every credential is unrecoverable. Write it down somewhere
        safe (a printed copy in a fireproof location is the classic answer).
      </p>
      <label className="block text-xs">
        <span className="text-muted-foreground">Master password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
          className="mt-0.5 w-full px-2 py-1 rounded border border-border bg-background font-mono"
        />
      </label>
      <label className="block text-xs">
        <span className="text-muted-foreground">Confirm</span>
        <input
          type="password"
          autoComplete="new-password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          className="mt-0.5 w-full px-2 py-1 rounded border border-border bg-background font-mono"
        />
      </label>
      {msg && <div className="text-xs text-amber-400">{msg}</div>}
      <button
        onClick={submit}
        disabled={busy || pw1.length < 8 || pw1 !== pw2}
        className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
      >
        {busy ? "Setting up…" : "Initialize vault"}
      </button>
    </section>
  );
}

// ── Unlock ───────────────────────────────────────────────────────────────────

function UnlockForm({
  onDone,
  setBusy,
  busy,
}: {
  onDone: () => void;
  setBusy: (b: boolean) => void;
  busy: boolean;
}) {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const res = await trpc.mutate("credentials.unlock", { password: pw });
      if (!res?.ok) {
        setMsg(res?.message ?? "Unlock failed.");
      } else {
        setPw("");
        onDone();
      }
    } catch (err) {
      setMsg(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded border border-border bg-background/50 p-4 space-y-3">
      <h3 className="text-sm font-semibold">🔒 Vault locked</h3>
      <label className="block text-xs">
        <span className="text-muted-foreground">Master password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && pw.length > 0 && submit()}
          className="mt-0.5 w-full px-2 py-1 rounded border border-border bg-background font-mono"
        />
      </label>
      {msg && <div className="text-xs text-amber-400">{msg}</div>}
      <button
        onClick={submit}
        disabled={busy || pw.length === 0}
        className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
      >
        {busy ? "Unlocking…" : "Unlock"}
      </button>
    </section>
  );
}

// ── Unlocked view ────────────────────────────────────────────────────────────

function UnlockedView({
  status,
  list,
  editorTarget,
  setEditorTarget,
  refresh,
  setError,
}: {
  status: VaultStatus;
  list: CredentialMeta[];
  editorTarget: "new" | number | null;
  setEditorTarget: (v: "new" | number | null) => void;
  refresh: () => void;
  setError: (s: string | null) => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = useMemo(
    () =>
      list.filter(
        (c) =>
          !filter ||
          c.name.toLowerCase().includes(filter.toLowerCase()) ||
          c.tags.some((t) => t.toLowerCase().includes(filter.toLowerCase())) ||
          (c.url ?? "").toLowerCase().includes(filter.toLowerCase()),
      ),
    [list, filter],
  );

  const lock = async () => {
    try {
      await trpc.mutate("credentials.lock");
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name, tag, or URL…"
          className="flex-1 px-2 py-1 rounded border border-border bg-background text-xs"
        />
        <button
          onClick={() => setEditorTarget("new")}
          className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
        >
          + Add
        </button>
        <button
          onClick={lock}
          className="text-xs px-3 py-1 rounded border border-border hover:bg-muted"
        >
          🔒 Lock
        </button>
      </div>

      <div className="text-[11px] text-muted-foreground">
        {status.credentialCount} credential{status.credentialCount === 1 ? "" : "s"} ·
        Auto-locks in {Math.round(status.autoLockMs / 60_000)} min
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          {list.length === 0 ? "No credentials yet." : "No matches."}
        </p>
      ) : (
        <ul className="space-y-1">
          {filtered.map((c) => (
            <li
              key={c.id}
              className="p-2 rounded border border-border bg-background/40 cursor-pointer hover:bg-muted/40"
              onClick={() => setEditorTarget(c.id)}
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{c.name}</span>
                {c.tags.map((t) => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300">
                    {t}
                  </span>
                ))}
                <span className="ml-auto text-[10px] text-muted-foreground/70">
                  {c.accessCount > 0 ? `used ${c.accessCount}×` : "never used"}
                </span>
              </div>
              {c.url && (
                <div className="text-[11px] text-muted-foreground font-mono truncate">{c.url}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editorTarget !== null && (
        <CredentialEditor
          target={editorTarget}
          onClose={() => setEditorTarget(null)}
          onSaved={() => {
            setEditorTarget(null);
            refresh();
          }}
          setError={setError}
        />
      )}
    </>
  );
}

// ── Editor (add / edit / delete) ────────────────────────────────────────────

function CredentialEditor({
  target,
  onClose,
  onSaved,
  setError,
}: {
  target: "new" | number;
  onClose: () => void;
  onSaved: () => void;
  setError: (s: string | null) => void;
}) {
  const isNew = target === "new";
  const [loading, setLoading] = useState(!isNew);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [notes, setNotes] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<CredentialMeta | null>(null);

  // Load existing record
  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const res = await trpc.mutate("credentials.get", { id: target as number, reason: "ui-edit" });
        if (!res?.ok) throw new Error(res?.message ?? "Get failed");
        const c = res.credential as CredentialRecord;
        setName(c.name);
        setUrl(c.url ?? "");
        setTags(c.tags.join(", "));
        setUsername(c.fields.username ?? "");
        setPassword(c.fields.password ?? "");
        setTotpSecret(c.fields.totpSecret ?? "");
        setNotes(c.fields.notes ?? "");
        setMeta({
          id: c.id, name: c.name, url: c.url, tags: c.tags,
          createdAt: c.createdAt, updatedAt: c.updatedAt,
          accessedAt: c.accessedAt, accessCount: c.accessCount,
        });
      } catch (err) {
        setError(String(err));
        onClose();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const save = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    try {
      const fields: CredentialFields = {
        username: username || undefined,
        password: password || undefined,
        totpSecret: totpSecret || undefined,
        notes: notes || undefined,
      };
      const tagArr = tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (isNew) {
        const res = await trpc.mutate("credentials.add", {
          name: name.trim(),
          url: url.trim() || undefined,
          tags: tagArr,
          fields,
        });
        if (!res?.ok) throw new Error(res?.message ?? "Add failed");
      } else {
        const res = await trpc.mutate("credentials.update", {
          id: target as number,
          name: name.trim(),
          url: url.trim() || null,
          tags: tagArr,
          fields,
        });
        if (!res?.ok) throw new Error(res?.message ?? "Update failed");
      }
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (isNew) return;
    if (!confirm(`Delete credential "${name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await trpc.mutate("credentials.delete", { id: target as number });
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setError(`${label} copied — clipboard auto-clears in 30s`);
      setTimeout(async () => {
        try {
          await navigator.clipboard.writeText("");
        } catch { /* ignore */ }
      }, 30_000);
    } catch (err) {
      setError(`Copy failed: ${String(err)}`);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="bg-background border border-border rounded p-4 text-xs">Loading…</div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">{isNew ? "Add credential" : `Edit "${meta?.name ?? ""}"`}</h3>
          <button
            onClick={onClose}
            className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted"
          >
            Close
          </button>
        </div>

        <div className="p-4 space-y-3">
          <Field label="Name" value={name} onChange={setName} placeholder="amazon" required />
          <Field label="URL" value={url} onChange={setUrl} placeholder="https://amazon.com" />
          <Field label="Tags (comma-separated)" value={tags} onChange={setTags} placeholder="shopping, primary" />

          <div className="pt-2 mt-2 border-t border-border">
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">Encrypted fields</h4>
            <FieldWithCopy
              label="Username"
              value={username}
              onChange={setUsername}
              onCopy={() => copyToClipboard(username, "Username")}
            />
            <FieldWithCopy
              label="Password"
              value={password}
              onChange={setPassword}
              onCopy={() => copyToClipboard(password, "Password")}
              type={showPassword ? "text" : "password"}
              extra={
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-muted"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              }
            />
            <FieldWithCopy
              label="TOTP secret"
              value={totpSecret}
              onChange={setTotpSecret}
              onCopy={() => copyToClipboard(totpSecret, "TOTP secret")}
              type={showPassword ? "text" : "password"}
            />
            <label className="block text-xs mt-2">
              <span className="text-muted-foreground">Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="mt-0.5 w-full px-2 py-1 rounded border border-border bg-background font-mono text-xs"
              />
            </label>
          </div>

          {meta && (
            <div className="text-[10px] text-muted-foreground/70 pt-2 border-t border-border space-y-0.5">
              <div>Created: {new Date(meta.createdAt).toLocaleString()}</div>
              <div>Updated: {new Date(meta.updatedAt).toLocaleString()}</div>
              <div>
                Last accessed:{" "}
                {meta.accessedAt ? new Date(meta.accessedAt).toLocaleString() : "never"} · {meta.accessCount} reads
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border flex items-center gap-2">
          <button
            onClick={save}
            disabled={busy || !name.trim()}
            className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {busy ? "Saving…" : isNew ? "Add" : "Save"}
          </button>
          {!isNew && (
            <button
              onClick={remove}
              disabled={busy}
              className="text-xs px-3 py-1 rounded border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-40 ml-auto"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">
        {label}
        {required && <span className="text-amber-400 ml-1">*</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full px-2 py-1 rounded border border-border bg-background font-mono"
      />
    </label>
  );
}

function FieldWithCopy({
  label,
  value,
  onChange,
  onCopy,
  type = "text",
  extra,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCopy: () => void;
  type?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="text-xs mb-2">
      <div className="text-muted-foreground mb-0.5 flex items-center gap-2">
        <span>{label}</span>
        {extra}
      </div>
      <div className="flex items-center gap-2">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          className="flex-1 px-2 py-1 rounded border border-border bg-background font-mono"
        />
        <button
          type="button"
          onClick={onCopy}
          disabled={!value}
          className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-muted disabled:opacity-40"
          title="Copy to clipboard (auto-clears in 30s)"
        >
          Copy
        </button>
      </div>
    </div>
  );
}
