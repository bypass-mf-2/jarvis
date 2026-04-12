/**
 * Shared text chunking — used by scraper.ts, crawlWorker.ts, fileIngestion.ts.
 *
 * Design choices:
 *  - Sentence-boundary splitting so chunks never cut mid-sentence (bad for RAG).
 *  - Configurable overlap carries the tail of each chunk into the start of the
 *    next one. Info that straddles a chunk boundary is still retrievable from
 *    both neighboring chunks — without overlap, a search that matches the
 *    middle of the overlap region hits neither chunk.
 *  - A minimum chunk length filter drops the "two-word trailing fragment"
 *    chunks that otherwise pollute the vector store with noise.
 */

export interface ChunkOptions {
  /** Target max chars per chunk. Default 1200 (fits ~300 tokens). */
  maxChars?: number;
  /** Chars of overlap carried from one chunk to the next. Default 150. */
  overlapChars?: number;
  /** Minimum chunk length to keep. Default 80. */
  minChars?: number;
}

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const maxChars = opts.maxChars ?? 1200;
  const overlap = Math.max(0, Math.min(opts.overlapChars ?? 150, maxChars - 1));
  const minChars = opts.minChars ?? 80;

  if (!text || text.length < minChars) return [];

  // Split on sentence-ending punctuation followed by whitespace. Falls back
  // to newline splits when the text has no punctuation (e.g., some PDFs).
  let sentences = text.split(/(?<=[.!?])\s+/);
  if (sentences.length === 1) {
    sentences = text.split(/\n{2,}/);
  }

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const joined = current ? current + " " + sentence : sentence;

    if (joined.length > maxChars && current) {
      chunks.push(current.trim());
      // Seed the next chunk with the tail of the current one so context
      // carries across the boundary. Snap to a word boundary so we don't
      // start mid-word.
      const tail = current.slice(Math.max(0, current.length - overlap));
      const wordStart = tail.search(/\S/);
      current = (wordStart >= 0 ? tail.slice(wordStart) : "") + " " + sentence;
    } else {
      current = joined;
    }

    // If a single "sentence" is larger than maxChars (common for PDFs with
    // no punctuation), hard-split it. Without this the whole paragraph
    // would become one giant chunk, which explodes embedding cost and
    // wrecks retrieval relevance.
    while (current.length > maxChars * 1.5) {
      const cut = current.lastIndexOf(" ", maxChars);
      const breakAt = cut > maxChars * 0.5 ? cut : maxChars;
      chunks.push(current.slice(0, breakAt).trim());
      current = current.slice(Math.max(0, breakAt - overlap));
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks.filter((c) => c.length >= minChars);
}
