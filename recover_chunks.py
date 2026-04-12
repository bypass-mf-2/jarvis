"""
Recover knowledge_chunks from ChromaDB metadata.

ChromaDB stores per-embedding metadata (chroma:document, sourceUrl, sourceTitle,
sourceType) as (id, key, value) triples in embedding_metadata. We pivot those
back into rows and INSERT into jarvis.db's knowledge_chunks, skipping any rows
whose content already exists in jarvis.db (deduped by content hash).

DRY RUN by default — pass --apply as the first argument to actually write.

Usage:
    .venv\\Scripts\\python.exe recover_chunks.py            # dry run, shows counts
    .venv\\Scripts\\python.exe recover_chunks.py --apply    # actually inserts
"""
import sqlite3, os, sys, hashlib, time

APPLY = "--apply" in sys.argv

print(f"=== recover_chunks.py {'(APPLY)' if APPLY else '(DRY RUN — pass --apply to write)'} ===")
print()

# ── Read chroma metadata, pivot triples to rows ────────────────────────────
chroma_db = os.path.join("chroma-data", "chroma.sqlite3")
chroma = sqlite3.connect(chroma_db)
cc = chroma.cursor()

print("Reading chroma metadata...")
rows = cc.execute(
    "SELECT id, key, string_value FROM embedding_metadata "
    "WHERE key IN ('chroma:document','sourceUrl','sourceTitle','sourceType')"
).fetchall()

# Pivot: { embed_id: { key: value } }
embeds = {}
for eid, key, val in rows:
    embeds.setdefault(eid, {})[key] = val

# Filter to embeddings with both content and sourceUrl
candidates = []
for eid, fields in embeds.items():
    content = fields.get("chroma:document")
    if not content or not content.strip():
        continue
    candidates.append({
        "embed_id": eid,
        "content": content,
        "sourceUrl": fields.get("sourceUrl") or "",
        "sourceTitle": fields.get("sourceTitle") or "",
        "sourceType": fields.get("sourceType") or "custom_url",
    })

print(f"  total embeddings with metadata: {len(embeds)}")
print(f"  candidates with non-empty content: {len(candidates)}")
print()

# ── Read existing jarvis.db chunks for dedup ───────────────────────────────
jdb = sqlite3.connect("jarvis.db")
jc = jdb.cursor()

print("Reading existing jarvis.db chunks for dedup...")
existing_hashes = set()
for (content,) in jc.execute("SELECT content FROM knowledge_chunks").fetchall():
    if content:
        h = hashlib.sha256(content.encode("utf-8", errors="replace")).hexdigest()
        existing_hashes.add(h)
print(f"  existing chunks: {len(existing_hashes)}")
print()

# ── Filter to non-duplicate candidates ─────────────────────────────────────
new_chunks = []
for c in candidates:
    h = hashlib.sha256(c["content"].encode("utf-8", errors="replace")).hexdigest()
    if h not in existing_hashes:
        new_chunks.append(c)
        existing_hashes.add(h)  # de-dup within this batch too

print(f"  new chunks to insert: {len(new_chunks)}")
print()

# ── Show a sample of what we'd insert ──────────────────────────────────────
print("=== sample of chunks to insert (first 3) ===")
for c in new_chunks[:3]:
    preview = c["content"][:120].replace("\n", " ")
    print(f"  [{c['sourceType']}] {c['sourceTitle'][:60]!r}")
    print(f"    {c['sourceUrl']}")
    print(f"    {preview!r}")
    print()

# ── Apply ──────────────────────────────────────────────────────────────────
if not APPLY:
    print(f"Dry run complete. Would insert {len(new_chunks)} new chunks into jarvis.db.knowledge_chunks.")
    print("Re-run with --apply to actually write.")
    print()
    print("RECOMMENDED: back up jarvis.db one more time before applying:")
    print("  copy jarvis.db jarvis.db.before-recovery")
    sys.exit(0)

print(f"Inserting {len(new_chunks)} chunks into jarvis.db...")
now = int(time.time() * 1000)
inserted = 0
for c in new_chunks:
    try:
        jc.execute(
            """INSERT INTO knowledge_chunks
               (sourceUrl, sourceTitle, sourceType, content, scrapedAt, createdAt)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (c["sourceUrl"], c["sourceTitle"], c["sourceType"], c["content"], now, now),
        )
        inserted += 1
    except Exception as e:
        print(f"  insert failed for embed {c['embed_id']}: {e}")

jdb.commit()
print(f"Done. Inserted {inserted} chunks.")
print()
print("Final counts:")
print(f"  knowledge_chunks: {jc.execute('SELECT COUNT(*) FROM knowledge_chunks').fetchone()[0]}")
print(f"  max id: {jc.execute('SELECT MAX(id) FROM knowledge_chunks').fetchone()[0]}")
