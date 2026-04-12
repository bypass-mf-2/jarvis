"""
Inspect ChromaDB's embedding_metadata to see what fields are stored per embedding.
This tells us whether we can rebuild jarvis.db's knowledge_chunks from chroma alone.
"""
import sqlite3, os

chroma_db = os.path.join("chroma-data", "chroma.sqlite3")
c = sqlite3.connect(chroma_db).cursor()

print("=== embedding_metadata schema ===")
print(c.execute("SELECT sql FROM sqlite_master WHERE name='embedding_metadata'").fetchone()[0])
print()

print("=== distinct keys stored per embedding ===")
keys = c.execute("SELECT DISTINCT key FROM embedding_metadata").fetchall()
for (k,) in keys:
    cnt = c.execute("SELECT COUNT(*) FROM embedding_metadata WHERE key=?", (k,)).fetchone()[0]
    print(f"  {k}: {cnt} rows")
print()

print("=== sample row for one embedding ===")
sample_id = c.execute("SELECT id FROM embedding_metadata LIMIT 1").fetchone()
if sample_id:
    eid = sample_id[0]
    rows = c.execute("SELECT key, string_value, int_value, float_value, bool_value FROM embedding_metadata WHERE id=?", (eid,)).fetchall()
    print(f"id={eid}:")
    for r in rows:
        key, sv, iv, fv, bv = r
        val = sv or iv or fv or bv
        if isinstance(val, str) and len(val) > 200:
            val = val[:200] + "..."
        print(f"  {key} = {val!r}")
print()

print("=== embeddings table schema ===")
print(c.execute("SELECT sql FROM sqlite_master WHERE name='embeddings'").fetchone()[0])
print()

print("=== sample embeddings rows ===")
rows = c.execute("SELECT id, embedding_id FROM embeddings LIMIT 5").fetchall()
for r in rows:
    print(" ", r)
print()

print("=== total recoverable distinct embeddings ===")
total = c.execute("SELECT COUNT(DISTINCT id) FROM embedding_metadata").fetchone()[0]
print(f"  {total} distinct embedding ids have metadata")
