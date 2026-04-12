/**
 * HTML → readable text extraction.
 *
 * Uses Mozilla's Readability (the engine behind Firefox Reader Mode) on top
 * of linkedom, a lightweight DOM parser. Readability finds the main article
 * element on a page and strips navigation, ads, sidebars, and footers.
 *
 * Fallback: if Readability can't identify a main article (search pages,
 * dashboards, index pages), the caller should fall back to its regex-based
 * stripHtml path.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface ReadableResult {
  title: string;
  text: string;       // plain text with anchor URLs preserved inline
  byline: string | null;
  excerpt: string | null;
  length: number;     // char count of the extracted article body
}

/**
 * Extract the main article body from an HTML page. Returns null if the page
 * doesn't have something Readability recognizes as an article (e.g., the
 * Reddit homepage or a Google search results page).
 *
 * The text output preserves anchor URLs inline as "link text (url)" so
 * downstream chunks retain reference destinations — important for RAG
 * answers that say "the paper is at https://…".
 */
export function extractReadableContent(html: string, baseUrl?: string): ReadableResult | null {
  try {
    const { document } = parseHTML(html) as any;

    // Readability mutates the document, so clone if you need the original.
    // We don't, so pass it straight in.
    const reader = new Readability(document, {
      // Keep classes off — we're stripping to plain text anyway.
      keepClasses: false,
    });
    const article = reader.parse();
    if (!article || !article.content) return null;

    // article.textContent is plain text but drops anchor URLs. We want the
    // hrefs preserved, so re-parse the extracted HTML and flatten manually.
    const { document: extractedDoc } = parseHTML(article.content) as any;

    // Resolve relative anchors to absolute URLs, then inline the href.
    const anchors = extractedDoc.querySelectorAll("a[href]");
    for (const a of anchors) {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
      let resolved = href;
      if (baseUrl) {
        try { resolved = new URL(href, baseUrl).toString(); } catch { /* keep raw */ }
      }
      const text = a.textContent || "";
      a.replaceWith(`${text} (${resolved})`);
    }

    // textContent collapses runs of whitespace badly on some pages; clean up.
    const raw = (extractedDoc.body?.textContent || extractedDoc.documentElement?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();

    if (raw.length < 200) return null;

    return {
      title: (article.title || "").trim(),
      text: raw,
      byline: article.byline ?? null,
      excerpt: article.excerpt ?? null,
      length: raw.length,
    };
  } catch {
    return null;
  }
}
