/**
 * Encrypted credential vault.
 *
 * Stores per-site credentials (username, password, optional TOTP seed, notes,
 * url) as encrypted blobs in SQLite. The encryption key is derived from a
 * single user-chosen master password via Argon2id and never persisted —
 * only the working copy lives in memory while the vault is "unlocked".
 *
 * Threat model:
 *   - Resists offline attack on stolen jarvis.db: master password is the
 *     only crackable target; Argon2id (interactive params) makes brute force
 *     ~1 sec/guess at consumer-CPU rates. ~2^60 keyspace at 10 chars random.
 *   - Resists "service running, attacker reads sqlite directly": same as above.
 *     ChaCha20-Poly1305 ciphertext + nonce reveals nothing without key.
 *   - Does NOT resist a live process compromise — once unlocked the key is
 *     in RAM. Auto-lock window limits the blast radius. Don't run JARVIS as
 *     a different user than the one whose secrets it holds.
 *
 * Crypto:
 *   - KDF:    Argon2id (libsodium crypto_pwhash, INTERACTIVE params: 2 ops, 64 MiB)
 *   - AEAD:   XChaCha20-Poly1305 (libsodium crypto_aead_xchacha20poly1305_ietf)
 *   - Salt:   16 bytes random per vault, persisted in vault_meta
 *   - Nonce:  24 bytes random per encryption, persisted alongside ciphertext
 *
 * The verifier:
 *   - vault_meta stores a fixed string "jarvis-vault-ok-v1" encrypted with
 *     the derived key. unlockVault() decrypts it; success ⇒ password right.
 *
 * Auto-lock:
 *   - Unlock starts a timer. Idle (no get/list calls) for AUTO_LOCK_MS
 *     ⇒ key is zeroed and the vault returns to locked state.
 *   - Each call resets the timer.
 */

import sodium from "libsodium-wrappers-sumo";
import { getDatabase, markDbDirty } from "./sqlite-init.js";
import { logger } from "./logger.js";
import * as fs from "fs";
import * as path from "path";

// ── Tunables ─────────────────────────────────────────────────────────────────

const AUTO_LOCK_MS = Number(process.env.VAULT_AUTO_LOCK_MS ?? 30 * 60_000); // 30 min
const VERIFIER_PLAINTEXT = "jarvis-vault-ok-v1";
const KDF_OPSLIMIT_NAME = "OPSLIMIT_INTERACTIVE";
const KDF_MEMLIMIT_NAME = "MEMLIMIT_INTERACTIVE";

const AUDIT_LOG_PATH = path.join(process.cwd(), "logs", "credential-vault.jsonl");

// ── Module state ─────────────────────────────────────────────────────────────

let _ready: Promise<void> | null = null;
let _key: Uint8Array | null = null; // derived encryption key, lives only when unlocked
let _autoLockTimer: ReturnType<typeof setTimeout> | null = null;
let _lastUnlockedAt = 0;

async function ensureReady(): Promise<void> {
  if (!_ready) {
    _ready = sodium.ready.then(() => {
      ensureSchema();
    });
  }
  await _ready;
}

// ── Schema ───────────────────────────────────────────────────────────────────

function ensureSchema(): void {
  const db = getDatabase();
  db.run(`
    CREATE TABLE IF NOT EXISTS credential_vault_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      kdf_salt BLOB NOT NULL,
      verifier_nonce BLOB NOT NULL,
      verifier_ciphertext BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      kdf_ops INTEGER NOT NULL,
      kdf_mem INTEGER NOT NULL,
      kdf_alg INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      tags TEXT,
      url TEXT,
      ciphertext BLOB NOT NULL,
      nonce BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      accessed_at INTEGER,
      access_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS credentials_name_idx ON credentials(name)`);
}

// ── Audit log (file-based, separate from DB so it survives DB corruption) ────

function appendAudit(action: string, args: Record<string, unknown>, ok: boolean, message?: string): void {
  try {
    if (!fs.existsSync(path.dirname(AUDIT_LOG_PATH))) {
      fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    }
    const line = JSON.stringify({ at: Date.now(), action, args, ok, message });
    fs.appendFileSync(AUDIT_LOG_PATH, line + "\n");
  } catch { /* never block on audit */ }
}

export interface AuditEntry {
  at: number;
  action: string;
  args: Record<string, unknown>;
  ok: boolean;
  message?: string;
}

export function readAudit(limit = 100): AuditEntry[] {
  try {
    if (!fs.existsSync(AUDIT_LOG_PATH)) return [];
    const lines = fs.readFileSync(AUDIT_LOG_PATH, "utf-8").trim().split("\n");
    return lines
      .slice(-limit)
      .map((l) => {
        try { return JSON.parse(l) as AuditEntry; } catch { return null; }
      })
      .filter((x): x is AuditEntry => x !== null);
  } catch {
    return [];
  }
}

// ── Key derivation + verifier ────────────────────────────────────────────────

function deriveKey(password: string, salt: Uint8Array): Uint8Array {
  const passBytes = sodium.from_string(password);
  const opslimit = (sodium as unknown as Record<string, number>)[`crypto_pwhash_${KDF_OPSLIMIT_NAME}`];
  const memlimit = (sodium as unknown as Record<string, number>)[`crypto_pwhash_${KDF_MEMLIMIT_NAME}`];
  return sodium.crypto_pwhash(
    sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES, // 32 bytes
    passBytes,
    salt,
    opslimit,
    memlimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

function aeadEncrypt(plaintext: Uint8Array, key: Uint8Array): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES); // 24
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    null, // associated data — unused
    null,
    nonce,
    key,
  );
  return { nonce, ciphertext };
}

function aeadDecrypt(ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null,
    nonce,
    key,
  );
}

// ── Auto-lock plumbing ───────────────────────────────────────────────────────

function armAutoLock(): void {
  if (_autoLockTimer) clearTimeout(_autoLockTimer);
  _autoLockTimer = setTimeout(() => {
    void logger.info("vault", `Auto-locking vault after ${AUTO_LOCK_MS}ms idle`);
    lockVault();
  }, AUTO_LOCK_MS);
}

function touch(): void {
  _lastUnlockedAt = Date.now();
  armAutoLock();
}

// ── Public API: setup / unlock / lock / status ───────────────────────────────

export interface VaultStatus {
  initialized: boolean;       // master password has been set
  unlocked: boolean;          // working key is in memory
  unlockedAt: number | null;
  autoLockMs: number;
  credentialCount: number;
}

export async function getStatus(): Promise<VaultStatus> {
  await ensureReady();
  const db = getDatabase();
  let initialized = false;
  try {
    const r = db.exec("SELECT 1 FROM credential_vault_meta WHERE id = 1");
    initialized = r.length > 0 && r[0].values.length > 0;
  } catch { /* table missing → treat as uninitialized */ }
  let count = 0;
  try {
    const r = db.exec("SELECT COUNT(*) FROM credentials");
    count = (r[0]?.values[0]?.[0] as number) ?? 0;
  } catch { /* same */ }
  return {
    initialized,
    unlocked: _key !== null,
    unlockedAt: _key ? _lastUnlockedAt : null,
    autoLockMs: AUTO_LOCK_MS,
    credentialCount: count,
  };
}

export interface SetupResult { ok: boolean; message: string }

/**
 * First-time setup. Refuses if a master password already exists (use
 * changeMasterPassword for that). Derives the verifier and stashes meta.
 */
export async function setupMasterPassword(password: string): Promise<SetupResult> {
  await ensureReady();
  if (password.length < 8) {
    return { ok: false, message: "Master password must be at least 8 characters." };
  }
  const status = await getStatus();
  if (status.initialized) {
    return { ok: false, message: "Vault is already initialized. Use changeMasterPassword to rotate." };
  }
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES); // 16
  const key = deriveKey(password, salt);
  const verifier = aeadEncrypt(sodium.from_string(VERIFIER_PLAINTEXT), key);
  const opslimit = (sodium as unknown as Record<string, number>)[`crypto_pwhash_${KDF_OPSLIMIT_NAME}`];
  const memlimit = (sodium as unknown as Record<string, number>)[`crypto_pwhash_${KDF_MEMLIMIT_NAME}`];

  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT INTO credential_vault_meta
       (id, kdf_salt, verifier_nonce, verifier_ciphertext, created_at, kdf_ops, kdf_mem, kdf_alg)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.bind([
    salt as unknown as Uint8Array,
    verifier.nonce as unknown as Uint8Array,
    verifier.ciphertext as unknown as Uint8Array,
    Date.now(),
    opslimit,
    memlimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  ]);
  stmt.step();
  stmt.free();
  markDbDirty();

  // Hold key in memory — vault is unlocked after setup.
  _key = key;
  touch();
  appendAudit("setup", {}, true);
  await logger.info("vault", "✅ Vault initialized + unlocked");
  return { ok: true, message: "Vault initialized. Vault is now unlocked." };
}

export interface UnlockResult { ok: boolean; message: string }

export async function unlockVault(password: string): Promise<UnlockResult> {
  await ensureReady();
  const db = getDatabase();
  const r = db.exec(
    "SELECT kdf_salt, verifier_nonce, verifier_ciphertext FROM credential_vault_meta WHERE id = 1",
  );
  if (r.length === 0 || r[0].values.length === 0) {
    return { ok: false, message: "Vault not initialized — call setupMasterPassword first." };
  }
  const [salt, nonce, ct] = r[0].values[0] as [Uint8Array, Uint8Array, Uint8Array];
  const key = deriveKey(password, salt);
  try {
    const plain = aeadDecrypt(ct, nonce, key);
    const text = sodium.to_string(plain);
    if (text !== VERIFIER_PLAINTEXT) {
      // Decryption succeeded but verifier mismatched — should never happen
      // with AEAD but defend against future schema additions.
      sodium.memzero(key);
      appendAudit("unlock", {}, false, "verifier mismatch");
      return { ok: false, message: "Wrong password." };
    }
  } catch {
    // AEAD verification failed = wrong password (or DB corruption)
    sodium.memzero(key);
    appendAudit("unlock", {}, false, "AEAD verification failed");
    return { ok: false, message: "Wrong password." };
  }
  if (_key) sodium.memzero(_key);
  _key = key;
  touch();
  appendAudit("unlock", {}, true);
  await logger.info("vault", "🔓 Vault unlocked");
  return { ok: true, message: "Vault unlocked." };
}

export function lockVault(): void {
  if (_key) {
    sodium.memzero(_key);
    _key = null;
  }
  if (_autoLockTimer) {
    clearTimeout(_autoLockTimer);
    _autoLockTimer = null;
  }
  appendAudit("lock", {}, true);
  void logger.info("vault", "🔒 Vault locked");
}

export function isUnlocked(): boolean {
  return _key !== null;
}

export interface ChangeResult { ok: boolean; message: string }

/**
 * Rotate master password. Re-encrypts every credential under the new key.
 * Requires the OLD password (so an attacker with momentary access can't
 * silently rotate). Atomic-ish: we collect all decrypted plaintexts first,
 * then write all new ciphertexts in one transaction. If we crash mid-write,
 * the verifier still references the old key — vault remains usable.
 */
export async function changeMasterPassword(
  oldPassword: string,
  newPassword: string,
): Promise<ChangeResult> {
  await ensureReady();
  if (newPassword.length < 8) {
    return { ok: false, message: "New password must be at least 8 characters." };
  }
  const unlock = await unlockVault(oldPassword);
  if (!unlock.ok) return { ok: false, message: "Old password incorrect." };

  const db = getDatabase();
  // Decrypt all credentials under the old key
  const cur = _key!;
  const r = db.exec("SELECT id, ciphertext, nonce FROM credentials");
  const decryptedRows: Array<{ id: number; plain: Uint8Array }> = [];
  if (r.length > 0) {
    for (const row of r[0].values) {
      const [id, ct, nonce] = row as [number, Uint8Array, Uint8Array];
      decryptedRows.push({ id, plain: aeadDecrypt(ct, nonce, cur) });
    }
  }
  // Derive new key + new verifier
  const newSalt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const newKey = deriveKey(newPassword, newSalt);
  const newVerifier = aeadEncrypt(sodium.from_string(VERIFIER_PLAINTEXT), newKey);

  // Re-encrypt all credentials + replace meta. Single transaction.
  db.run("BEGIN");
  try {
    db.run("DELETE FROM credential_vault_meta");
    const opslimit = (sodium as unknown as Record<string, number>)[`crypto_pwhash_${KDF_OPSLIMIT_NAME}`];
    const memlimit = (sodium as unknown as Record<string, number>)[`crypto_pwhash_${KDF_MEMLIMIT_NAME}`];
    const insMeta = db.prepare(
      `INSERT INTO credential_vault_meta
         (id, kdf_salt, verifier_nonce, verifier_ciphertext, created_at, kdf_ops, kdf_mem, kdf_alg)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insMeta.bind([
      newSalt as unknown as Uint8Array,
      newVerifier.nonce as unknown as Uint8Array,
      newVerifier.ciphertext as unknown as Uint8Array,
      Date.now(),
      opslimit,
      memlimit,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    ]);
    insMeta.step();
    insMeta.free();
    const upd = db.prepare("UPDATE credentials SET ciphertext = ?, nonce = ?, updated_at = ? WHERE id = ?");
    for (const { id, plain } of decryptedRows) {
      const enc = aeadEncrypt(plain, newKey);
      upd.bind([
        enc.ciphertext as unknown as Uint8Array,
        enc.nonce as unknown as Uint8Array,
        Date.now(),
        id,
      ]);
      upd.step();
      upd.reset();
      sodium.memzero(plain);
    }
    upd.free();
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    sodium.memzero(newKey);
    appendAudit("changeMasterPassword", {}, false, String(err));
    return { ok: false, message: `Rotation failed: ${String(err)}` };
  }
  markDbDirty();
  // Replace working key
  if (_key) sodium.memzero(_key);
  _key = newKey;
  touch();
  appendAudit("changeMasterPassword", {}, true);
  await logger.info("vault", "🔁 Master password rotated");
  return { ok: true, message: "Master password rotated." };
}

// ── Public API: credential CRUD ──────────────────────────────────────────────

export interface CredentialFields {
  username?: string;
  password?: string;
  totpSecret?: string;
  notes?: string;
  /** Free-form key/value for site-specific extras. */
  extra?: Record<string, string>;
}

export interface CredentialMeta {
  id: number;
  name: string;
  url: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  accessedAt: number | null;
  accessCount: number;
}

export interface CredentialRecord extends CredentialMeta {
  fields: CredentialFields;
}

function getKey(action: string): Uint8Array {
  if (!_key) {
    appendAudit(action, {}, false, "vault locked");
    throw new Error("Vault is locked. Unlock first with the master password.");
  }
  return _key;
}

export interface AddCredentialInput {
  name: string;
  url?: string;
  tags?: string[];
  fields: CredentialFields;
}

export async function addCredential(input: AddCredentialInput): Promise<CredentialMeta> {
  await ensureReady();
  const key = getKey("addCredential");
  if (!input.name?.trim()) throw new Error("Credential name is required.");
  const fieldsJson = JSON.stringify(input.fields ?? {});
  const enc = aeadEncrypt(sodium.from_string(fieldsJson), key);
  const now = Date.now();
  const tagsJson = input.tags ? JSON.stringify(input.tags) : null;
  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT INTO credentials (name, tags, url, ciphertext, nonce, created_at, updated_at, access_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  );
  stmt.bind([
    input.name.trim(),
    tagsJson,
    input.url ?? null,
    enc.ciphertext as unknown as Uint8Array,
    enc.nonce as unknown as Uint8Array,
    now,
    now,
  ]);
  stmt.step();
  stmt.free();
  const id = (db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] as number) ?? 0;
  markDbDirty();
  touch();
  appendAudit("addCredential", { name: input.name }, true);
  return {
    id,
    name: input.name.trim(),
    url: input.url ?? null,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
    accessedAt: null,
    accessCount: 0,
  };
}

export interface UpdateCredentialInput {
  id: number;
  name?: string;
  url?: string | null;
  tags?: string[];
  fields?: CredentialFields;
}

export async function updateCredential(input: UpdateCredentialInput): Promise<CredentialMeta> {
  await ensureReady();
  const key = getKey("updateCredential");
  const existing = getCredentialMetaInternal(input.id);
  if (!existing) throw new Error(`Credential id=${input.id} not found.`);
  const db = getDatabase();
  const updates: string[] = [];
  const params: unknown[] = [];
  if (input.name && input.name.trim() !== existing.name) {
    updates.push("name = ?");
    params.push(input.name.trim());
  }
  if (input.url !== undefined) {
    updates.push("url = ?");
    params.push(input.url ?? null);
  }
  if (input.tags !== undefined) {
    updates.push("tags = ?");
    params.push(JSON.stringify(input.tags));
  }
  if (input.fields !== undefined) {
    // Re-encrypt with new nonce. NEVER reuse a nonce/key pair.
    const enc = aeadEncrypt(sodium.from_string(JSON.stringify(input.fields)), key);
    updates.push("ciphertext = ?");
    updates.push("nonce = ?");
    params.push(enc.ciphertext as unknown as Uint8Array);
    params.push(enc.nonce as unknown as Uint8Array);
  }
  if (updates.length === 0) {
    return existing;
  }
  updates.push("updated_at = ?");
  params.push(Date.now());
  params.push(input.id);
  const stmt = db.prepare(`UPDATE credentials SET ${updates.join(", ")} WHERE id = ?`);
  stmt.bind(params as never);
  stmt.step();
  stmt.free();
  markDbDirty();
  touch();
  appendAudit("updateCredential", { id: input.id, name: input.name ?? existing.name }, true);
  return getCredentialMetaInternal(input.id)!;
}

export async function deleteCredential(id: number): Promise<{ ok: boolean }> {
  await ensureReady();
  getKey("deleteCredential");
  const db = getDatabase();
  const stmt = db.prepare("DELETE FROM credentials WHERE id = ?");
  stmt.bind([id]);
  stmt.step();
  stmt.free();
  markDbDirty();
  touch();
  appendAudit("deleteCredential", { id }, true);
  return { ok: true };
}

/** List metadata only — no decryption, safe to call with vault locked. */
export async function listCredentials(): Promise<CredentialMeta[]> {
  await ensureReady();
  const db = getDatabase();
  const r = db.exec(
    `SELECT id, name, url, tags, created_at, updated_at, accessed_at, access_count
     FROM credentials ORDER BY name ASC`,
  );
  if (r.length === 0) return [];
  return r[0].values.map((row): CredentialMeta => {
    const [id, name, url, tagsJson, createdAt, updatedAt, accessedAt, accessCount] = row as [
      number, string, string | null, string | null, number, number, number | null, number,
    ];
    let tags: string[] = [];
    if (tagsJson) {
      try { tags = JSON.parse(tagsJson); } catch { /* ignore */ }
    }
    return { id, name, url, tags, createdAt, updatedAt, accessedAt, accessCount };
  });
}

/** Read + decrypt a credential by name OR id. Requires unlocked vault. */
export async function getCredential(
  selector: { id?: number; name?: string },
  options: { reason?: string } = {},
): Promise<CredentialRecord> {
  await ensureReady();
  const key = getKey("getCredential");
  const db = getDatabase();
  const where = selector.id !== undefined ? "id = ?" : "name = ?";
  const arg = selector.id ?? selector.name;
  if (arg === undefined) throw new Error("Provide id or name.");
  const r = db.exec(
    `SELECT id, name, url, tags, ciphertext, nonce, created_at, updated_at, accessed_at, access_count
     FROM credentials WHERE ${where} LIMIT 1`,
    [arg],
  );
  if (r.length === 0 || r[0].values.length === 0) {
    appendAudit("getCredential", { selector, reason: options.reason }, false, "not found");
    throw new Error(`No credential matching ${JSON.stringify(selector)}`);
  }
  const [
    id, name, url, tagsJson, ciphertext, nonce, createdAt, updatedAt, accessedAt, accessCount,
  ] = r[0].values[0] as [
    number, string, string | null, string | null, Uint8Array, Uint8Array, number, number, number | null, number,
  ];
  let plain: Uint8Array;
  try {
    plain = aeadDecrypt(ciphertext, nonce, key);
  } catch (err) {
    appendAudit("getCredential", { selector, reason: options.reason }, false, "decrypt failed");
    throw new Error(`Decrypt failed (DB corruption?): ${err}`);
  }
  let fields: CredentialFields = {};
  try {
    fields = JSON.parse(sodium.to_string(plain));
  } catch { /* leave empty */ }
  sodium.memzero(plain);

  // Bump access counters
  const now = Date.now();
  const upd = db.prepare("UPDATE credentials SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?");
  upd.bind([now, id]);
  upd.step();
  upd.free();
  markDbDirty();
  touch();

  let tags: string[] = [];
  if (tagsJson) {
    try { tags = JSON.parse(tagsJson); } catch { /* ignore */ }
  }
  appendAudit("getCredential", { id, name, reason: options.reason ?? null }, true);
  return {
    id, name, url, tags,
    createdAt, updatedAt,
    accessedAt: now,
    accessCount: accessCount + 1,
    fields,
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function getCredentialMetaInternal(id: number): CredentialMeta | null {
  const db = getDatabase();
  const r = db.exec(
    `SELECT id, name, url, tags, created_at, updated_at, accessed_at, access_count
     FROM credentials WHERE id = ? LIMIT 1`,
    [id],
  );
  if (r.length === 0 || r[0].values.length === 0) return null;
  const [
    rid, name, url, tagsJson, createdAt, updatedAt, accessedAt, accessCount,
  ] = r[0].values[0] as [
    number, string, string | null, string | null, number, number, number | null, number,
  ];
  let tags: string[] = [];
  if (tagsJson) {
    try { tags = JSON.parse(tagsJson); } catch { /* ignore */ }
  }
  return { id: rid, name, url, tags, createdAt, updatedAt, accessedAt, accessCount };
}
