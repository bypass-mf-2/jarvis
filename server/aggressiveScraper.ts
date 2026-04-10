/**
 * ULTRA-AGGRESSIVE HYBRID SCRAPER
 * 
 * Combines scraping methods for maximum speed:
 * - SerpAPI (Google search results)
 * - ScrapingAnt (web scraping)
 * - Smart rate limiting & routing
 * - Cost optimization
 */

import { logger } from "./logger.js";



// ── Scraper Node Types ──────────────────────────────────────────────────────
interface ScraperNode {
  id: string;
  type: 'api' | 'proxy' | 'direct' | 'distributed';
  endpoint: string;
  rateLimit: number;      // requests per minute
  costPer1k: number;      // USD per 1000 requests
  priority: number;       // 1 = highest (use first)
  enabled: boolean;
}

// ── Configuration ───────────────────────────────────────────────────────────
const SCRAPER_NODES: ScraperNode[] = [
  {
    id: 'serpapi',
    type: 'api',
    endpoint: 'https://serpapi.com/search',
    rateLimit: 50,
    costPer1k: 10,
    priority: 1,
    enabled: !!(process.env.EXPO_PUBLIC_SERPAPI_KEY || process.env.SERPAPI_KEY),
  },
  {
    id: 'scrapingant',
    type: 'api',
    endpoint: 'https://api.scrapingant.com/v2/general',
    rateLimit: 100,
    costPer1k: 4.9,
    priority: 2,
    enabled: !!(process.env.EXPO_PUBLIC_SCRAPING_ANT_API_KEY || process.env.SCRAPING_ANT_API_KEY),
  },
];

// ── Usage Tracking ──────────────────────────────────────────────────────────
interface UsageStats {
  requests: number[];     // Timestamps of requests
  totalRequests: number;
  totalCost: number;      // USD
  successRate: number;
  avgResponseTime: number;
}

class ScraperFleet {
  private usage = new Map<string, UsageStats>();

  constructor() {
    for (const node of SCRAPER_NODES) {
      this.usage.set(node.id, {
        requests: [],
        totalRequests: 0,
        totalCost: 0,
        successRate: 1.0,
        avgResponseTime: 0,
      });
    }
  }

  // ── Smart Node Selection ─────────────────────────────────────────────────
  private getBestNode(): ScraperNode | null {
    const now = Date.now();
    const enabledNodes = SCRAPER_NODES.filter(n => n.enabled);

    // Sort by priority (1 = highest)
    enabledNodes.sort((a, b) => a.priority - b.priority);

    for (const node of enabledNodes) {
      const stats = this.usage.get(node.id)!;
      
      // Count requests in last minute
      const recentRequests = stats.requests.filter(t => now - t < 60000);
      
      // Check if under rate limit
      if (recentRequests.length < node.rateLimit) {
        return node;
      }
    }

    // All at capacity - return cheapest available
    return enabledNodes.sort((a, b) => a.costPer1k - b.costPer1k)[0] || null;
  }

  // ── Update Stats ─────────────────────────────────────────────────────────
  private updateStats(nodeId: string, success: boolean, responseTime: number, cost: number): void {
    const stats = this.usage.get(nodeId)!;
    const now = Date.now();

    stats.requests.push(now);
    stats.totalRequests++;
    stats.totalCost += cost;

    // Update success rate (weighted average)
    const weight = 0.1; // New data gets 10% weight
    stats.successRate = stats.successRate * (1 - weight) + (success ? 1 : 0) * weight;

    // Update avg response time
    stats.avgResponseTime = stats.avgResponseTime * 0.9 + responseTime * 0.1;

    // Clean old requests (keep last hour only)
    stats.requests = stats.requests.filter(t => now - t < 3600000);
  }

  // ── Search via SerpAPI ───────────────────────────────────────────────────
  private async searchSerpAPI(query: string): Promise<any> {
    const apiKey = process.env.EXPO_PUBLIC_SERPAPI_KEY || process.env.SERPAPI_KEY;
    const response = await fetch(
      `https://serpapi.com/search?engine=google&q=${encodeURIComponent(query)}&api_key=${apiKey}`
    );

    if (!response.ok) throw new Error(`SerpAPI error: ${response.status}`);
    return response.json();
  }

  // ── Search via ScrapingAnt ──────────────────────────────────────────────
  private async searchScrapingAnt(query: string): Promise<any> {
    const apiKey = process.env.EXPO_PUBLIC_SCRAPING_ANT_API_KEY || process.env.SCRAPING_ANT_API_KEY;
    if (!apiKey) throw new Error("ScrapingAnt API key missing");
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    // ScrapingAnt expects x-api-key as a HEADER, not a query param.
    const response = await fetch(
      `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(searchUrl)}&browser=false`,
      {
        headers: { "x-api-key": apiKey },
        signal: AbortSignal.timeout(20_000),
      }
    );

    if (!response.ok) throw new Error(`ScrapingAnt error: ${response.status}`);
    return response.text();
  }

  // ── Main Search Function ─────────────────────────────────────────────────
  async search(query: string): Promise<{ results: any; node: string; cost: number }> {
    const node = this.getBestNode();

    if (!node) {
      throw new Error('No scraper nodes available');
    }

    const startTime = Date.now();
    let results: any;
    let success = false;

    try {
      if (node.id === 'serpapi') {
        results = await this.searchSerpAPI(query);
      } else if (node.id === 'scrapingant') {
        results = await this.searchScrapingAnt(query);
      }

      success = true;
    } catch (err) {
      await logger.error('aggressiveScraper', `Search failed on ${node.id}: ${err}`);
      throw err;
    } finally {
      const responseTime = Date.now() - startTime;
      const cost = (node.costPer1k / 1000);
      this.updateStats(node.id, success, responseTime, cost);
    }

    return {
      results,
      node: node.id,
      cost: node.costPer1k / 1000,
    };
  }

  // ── Batch Search (parallel) ──────────────────────────────────────────────
  async batchSearch(queries: string[]): Promise<any[]> {
    await logger.info('aggressiveScraper', `Batch searching ${queries.length} queries`);

    const results = await Promise.allSettled(
      queries.map(q => this.search(q))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.length - successful;

    await logger.info('aggressiveScraper', `Batch complete: ${successful} succeeded, ${failed} failed`);

    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value);
  }

  // ── Get Stats ────────────────────────────────────────────────────────────
  getStats() {
    const stats: any = {};
    
    for (const [nodeId, data] of this.usage.entries()) {
      const node = SCRAPER_NODES.find(n => n.id === nodeId)!;
      stats[nodeId] = {
        enabled: node.enabled,
        type: node.type,
        totalRequests: data.totalRequests,
        totalCost: data.totalCost.toFixed(2),
        successRate: (data.successRate * 100).toFixed(1) + '%',
        avgResponseTime: Math.round(data.avgResponseTime) + 'ms',
        requestsLastHour: data.requests.length,
      };
    }

    return stats;
  }

  // ── Get Total Cost ───────────────────────────────────────────────────────
  getTotalCost(): number {
    let total = 0;
    for (const stats of this.usage.values()) {
      total += stats.totalCost;
    }
    return total;
  }
}

// ── Export Singleton ────────────────────────────────────────────────────────
export const scraperFleet = new ScraperFleet();

// ── Export Functions ────────────────────────────────────────────────────────
export async function aggressiveSearch(query: string) {
  return scraperFleet.search(query);
}

export async function aggressiveBatchSearch(queries: string[]) {
  return scraperFleet.batchSearch(queries);
}

export function getScraperStats() {
  return scraperFleet.getStats();
}

export function getTotalScrapingCost() {
  return scraperFleet.getTotalCost();
}