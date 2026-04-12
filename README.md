# JARVIS v7.7 — Personal AI Operating System

A fully autonomous AI system with 21 agents, browser automation, continuous web learning, voice cloning, code execution, and self-improvement. Runs locally on commodity hardware. No cloud dependency. No subscription.

## What It Does

- **21-Agent Architecture** — 20-agent swarm (research, analysis, coding, planning, execution, memory, QA) + 1 Navigator browser-automation agent
- **Navigator (Browser Agent)** — Drives a real Chromium browser via Playwright. Multi-tab, session passthrough (saved logins), file downloads, high-stakes typed-confirmation safety gate. Give it a goal, watch it execute.
- **Writing Profile (Voice Learning)** — Upload your essays, lab reports, resumes, books. Jarvis analyzes your writing style (voice, vocabulary, tone, sentence length, verbal tics) and mirrors it in chat responses.
- **Continuous Web Scraping** — 75+ RSS/URL sources auto-scraped on schedule. Readability-based HTML extraction strips nav/footer/ads. Sitemap crawling turns one URL into thousands of pages. Smart deduplication. Domain quality scoring learns which sites produce useful content.
- **RAG Pipeline** — Vector search (ChromaDB) + keyword fallback. Chunks stored with 150-char overlap for boundary resilience. Domain feedback loop promotes high-value content.
- **Persistent Memory** — Learned facts, entity memory, conversation context. Survives restarts. Hourly consolidation.
- **Image Generation** — DALL-E 3 + Stable Diffusion
- **Voice Cloning** — ElevenLabs integration. Sounds exactly like you.
- **Code Execution** — Sandboxed JavaScript (isolated-vm), Python, Swift. 128 MB memory cap.
- **Coding AI** — Specialized models for iOS/Swift, Python, web dev. Code review agent.
- **Auto-Training** — Weekly synthetic QA generation from scraped content. LoRA fine-tuning pipeline. A/B testing between model versions.
- **Self-Improvement** — Analyzes its own error logs, proposes code patches, tests in sandbox, applies if safe. Manual approval required for anything beyond performance/documentation.
- **File Processing** — PDFs (pdf-parse v2), Word, Excel, PowerPoint, images (LLaVA vision), audio (transcription), video (frame extraction), code (all languages)
- **Manual LLM Control** — Temperature, top-P, max tokens, system prompt, RAG settings. All adjustable per-conversation.
- **Timestamped Logs** — Every terminal line has `[HH:MM:SS.mmm]` prefix. All events logged to DB for self-analysis.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  React + Vite + Tailwind + shadcn/ui  (client)              │
│  Routes: / (chat) | /writing-profile | /navigator           │
└──────────────────────┬───────────────────────────────────────┘
                       │ tRPC + REST
┌──────────────────────▼───────────────────────────────────────┐
│  Node.js + Express + tRPC + sql.js  (server)                │
│                                                              │
│  ┌─────────────┐ ┌──────────────┐ ┌────────────────┐        │
│  │  Chat/RAG   │ │  Scraper     │ │  Navigator     │        │
│  │  Pipeline   │ │  Pipeline    │ │  (Playwright)  │        │
│  └──────┬──────┘ └──────┬───────┘ └───────┬────────┘        │
│         │               │                 │                  │
│  ┌──────▼──────┐ ┌──────▼───────┐ ┌───────▼────────┐        │
│  │  Ollama     │ │  ChromaDB    │ │  Chromium      │        │
│  │  (local LLM)│ │  (vectors)   │ │  (headed/less) │        │
│  └─────────────┘ └──────────────┘ └────────────────┘        │
│                                                              │
│  jarvis.db (sql.js) — single-file SQLite with:              │
│   - Atomic writes (rename-based)                             │
│   - Single-instance lock (PID-based)                         │
│   - Clean SIGINT/SIGTERM shutdown with flush                 │
│   - Dirty-flag autosave (30s timer, not per-operation)       │
└──────────────────────────────────────────────────────────────┘
```

## Agents (21 total)

### Swarm Agents (multiAgent.ts)
| # | Name | Role | Specialization |
|---|------|------|----------------|
| 1 | WebScout | Researcher | Web search and info gathering |
| 2 | DataMiner | Researcher | Data extraction and parsing |
| 3 | Scholar | Researcher | Academic and technical research |
| 4 | NewsHound | Researcher | Current events |
| 5 | SourceValidator | Researcher | Credibility checks |
| 6 | Strategist | Analyst | Strategic analysis |
| 7 | Critic | Analyst | Critical evaluation |
| 8 | Synthesizer | Analyst | Information synthesis |
| 9 | SwiftMaster | Coder | iOS/Swift |
| 10 | PythonPro | Coder | Python |
| 11 | FullStack | Coder | Web development |
| 12 | CodeReviewer | Coder | Code review |
| 13 | Architect | Planner | System architecture |
| 14 | TaskMaster | Planner | Task breakdown |
| 15 | Runner | Executor | Code execution |
| 16 | Automator | Executor | Automation |
| 17 | Coordinator | Executor | Orchestration |
| 18 | Archivist | Memory | Long-term storage |
| 19 | Librarian | Memory | Knowledge retrieval |
| 20 | Validator | QA | Quality assurance |

### Navigator Agent (navigator.ts)
Browser automation via Playwright. Drives Chromium with LLM-planned actions (goto, click, type, extract, switchTab, scroll, etc.). Safety rails: domain allowlist, 30-step hard cap, destructive-action gating, screenshot audit trail, high-stakes typed confirmation with append-only audit log.

### Background Service Agents
| Agent | Schedule | Purpose |
|-------|----------|---------|
| Scraper | every 60s | Polls RSS/URL sources, chunks, embeds |
| Source Discovery | every 30m | Random web crawling + RSS discovery |
| Auto-Train | weekly | Synthetic QA + LoRA fine-tuning |
| Voice Learning | daily | Voice profile updates |
| Memory Consolidation | hourly | Conversation → learned facts |
| Writing Profile | on upload | Personal voice analysis from documents |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express, tRPC, sql.js (SQLite) |
| Frontend | React, Vite, Tailwind CSS, shadcn/ui, wouter |
| AI | Ollama (local LLMs: Gemma, LLaMA, CodeLLaMA, LLaVA) |
| Vector DB | ChromaDB |
| Browser | Playwright + Chromium |
| HTML Extraction | @mozilla/readability + linkedom |
| Training | PyTorch, Transformers, LoRA |
| Search | SerpAPI, ScrapingAnt |

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm, Ollama, Python 3.11+ (for ChromaDB)

# Install dependencies
pnpm install

# Install Chromium for the Navigator agent
npx playwright install chromium

# Pull AI models
ollama pull gemma3        # main chat model
ollama pull nomic-embed-text  # embedding model

# Start ChromaDB (in a separate terminal)
chroma run --path ./chroma-data

# Start JARVIS
pnpm dev
```

Open `http://localhost:5000` (or whatever port is shown in the logs).

### Shutting down cleanly
Press `Ctrl+C` once in the terminal and wait for:
```
🛑 SIGINT received — flushing jarvis.db…
✅ clean shutdown
```
Do NOT close the terminal window with the X button — that bypasses the DB flush.

## Cost Breakdown

### Build Cost
| Item | Cost |
|------|------|
| Development time (3 months, nights/weekends) | $0 (sweat equity) |
| Ollama (local LLMs) | $0 (open-source) |
| ChromaDB | $0 (open-source) |
| SerpAPI (search) | ~$50/month at scale |
| ScrapingAnt (web scraping) | ~$5/month |
| Hardware (consumer PC/laptop) | $0 (already owned) |
| Claude Code (development tool) | ~$200 |
| **Total build cost** | **~$250** |

### Running Cost
| Item | Monthly |
|------|---------|
| Ollama inference | $0 (runs locally) |
| Electricity (~200W average) | ~$15 |
| SerpAPI (1000 searches/month) | ~$50 |
| ScrapingAnt (10k requests/month) | ~$5 |
| Domain + hosting (optional) | $0-20 |
| **Total monthly** | **~$70-90** |

### Annual: ~$840-1,080/year all-in

### What this replaces (commercial equivalent pricing)

| Service | Annual Cost | JARVIS Equivalent |
|---------|------------|-------------------|
| ChatGPT Enterprise | $720/yr | Chat + RAG + memory |
| GitHub Copilot Enterprise | $468/yr | Coding AI + code review agents |
| Claude Teams | $360/yr | Analysis + writing agents |
| Perplexity Pro | $240/yr | Web search + knowledge base |
| Synthesia / ElevenLabs | $804/yr | Voice cloning |
| Midjourney | $360/yr | Image generation |
| Browserbase / Apify | $1,200/yr | Navigator (browser automation) |
| Custom data pipeline | $3,000-10,000/yr | Scraper + auto-training |
| **Total commercial stack** | **$7,152-$14,152/yr** | All of the above |

**JARVIS replaces ~$7,000-14,000/yr in SaaS for ~$1,000/yr running cost.**

### Revenue potential (if productized)
| Model | Price | Market |
|-------|-------|--------|
| Self-hosted license (one-time) | $500-2,000 | Individual developers, researchers |
| Managed SaaS (monthly) | $49-99/mo | Small teams, freelancers |
| Enterprise (annual) | $5,000-25,000/yr | Companies needing private AI |
| Consulting/customization | $150-300/hr | Integration, custom agents |

Conservative projection (year 1, solo):
- 50 self-hosted licenses at $1,000 avg = $50,000
- 20 SaaS customers at $79/mo = $18,960
- 5 consulting gigs at $5,000 avg = $25,000
- **Year 1 gross: ~$94,000**
- Costs (hosting, SerpAPI, support time): ~$12,000
- **Year 1 net: ~$82,000**

At scale (year 3, small team):
- 500 licenses at $1,000 avg = $500,000
- 200 SaaS customers at $79/mo = $189,600
- Enterprise contracts: $100,000
- **Year 3 gross: ~$790,000**
- Costs: ~$120,000
- **Year 3 net: ~$670,000**

**Asset valuation: 5-10x annual revenue = $3.9M-$7.9M by year 3**

## Safety Model

JARVIS has significant autonomous capability. The safety model is defense-in-depth:

1. **Single-instance lock** — `jarvis.db.lock` prevents two processes from corrupting the database
2. **Atomic DB writes** — write-to-tmp + rename prevents half-written files on crash
3. **Scraper toggle** — global on/off switch stops all background scraping, source discovery, web search, and auto-training. Checked per-source mid-cycle.
4. **Navigator safety gates** — destructive actions (submit, purchase, delete, confirm) always pause for approval. High-stakes mode requires typed phrase match. Append-only audit log.
5. **Domain allowlist** — per-Navigator-task restriction on which sites the agent can visit
6. **Session isolation** — captured login sessions stored locally, never logged, never transmitted
7. **Self-improvement gating** — code patches require manual approval. The dormant `autonomousImprovement.ts` module (LLM-driven auto-patcher) is NOT wired into any live server code.
8. **Clean shutdown** — SIGINT/SIGTERM handlers flush DB, release lock, kill ChromaDB, close Playwright browsers

## Project Structure

```
server/
  _core/         — Express setup, tRPC context, auth, Vite middleware
  routers.ts     — All tRPC routers (chat, scraper, navigator, writing, etc.)
  rag.ts         — RAG pipeline (vector search + web search + system prompt)
  ollama.ts      — Ollama client (chat, JSON, streaming, embeddings)
  scraper.ts     — RSS/URL scraper with Readability + sitemap probing
  navigator.ts   — Playwright browser agent (sessions, tabs, downloads, safety)
  writingProfile.ts — Personal writing style analyzer
  multiAgent.ts  — 20-agent swarm orchestrator
  autoTrain.ts   — Weekly LoRA fine-tuning pipeline
  chunking.ts    — Shared text chunker (sentence-split + overlap)
  htmlExtract.ts — @mozilla/readability wrapper
  sitemap.ts     — Sitemap.xml discovery and parsing
  sqlite-init.ts — DB initialization, locking, atomic saves, shutdown
  db.ts          — All SQL helpers (unified MySQL/SQLite bridge)
  ...

client/
  src/pages/
    Home.tsx           — Main chat interface + side panels
    WritingProfile.tsx — Personal writing sample upload + profile viewer
    Navigator.tsx      — Browser automation task runner
  src/lib/trpc.ts    — tRPC client
  src/App.tsx        — Router (wouter)
```

## License

MIT

## Author

Built by Trevor Goodwill.

*"Growth dies in comfortability."*
