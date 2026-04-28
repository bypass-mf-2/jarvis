# JARVIS AI v6 — Project Context

## Overview
JARVIS is Trevor Goodwill's full-stack AI assistant. Monorepo: React 19 + Vite + Tailwind 4 frontend, Express + tRPC + TypeScript backend, SQLite via better-sqlite3 (migrated from sql.js 2026-04-27). 46 database tables, 34 AI agents, 715 default scrape sources.

## Architecture
- **Client** (`client/`): React 19, shadcn/ui, wouter routing, tRPC React Query
- **Server** (`server/`): Express, tRPC, Ollama LLM integration, Forge API fallback
- **Shared** (`shared/`): Types, constants, error classes
- **Database**: Dual-mode — SQLite via sql.js (dev), MySQL via Drizzle (prod). Schema in `drizzle/`
- **Entry point**: `start-jarvis.ts` → launches ChromaDB + Express server

## Key Systems
- **Multi-hop RAG**: Vector search (ChromaDB) + entity graph traversal (2 hops) + re-ranking (vector 0.45, entity 0.35, graph 0.20). Final 25 chunks.
- **Entity Graph**: In-memory Maps (not SQL — avoids WASM overflow). 96k+ entities. Serializes to `entity-graph.json` every 30s. Case law regex (`X v. Y`), "legal" entity type.
- **34-Agent Swarm** (`server/multiAgent.ts`): WebScout, DataMiner, Scholar, NewsHound, SourceValidator, Strategist, Critic, Synthesizer, SwiftMaster, PythonPro, FullStack, CodeReviewer, Architect, TaskMaster, Runner, Automator, Coordinator, Archivist, Librarian, Validator, Counsel, Sentinel, Wordsmith, Editor, Designer, MobileDev, Summarizer, Tutor, Auditor, Inspector, Monitor, Forecaster, MarketAnalyst (#33), Custodian (#34). Per the audit, agents are role labels for shared LLM calls — the "swarm" doesn't have agent-specific prompt logic yet.
- **Knowledge-Backed Self-Evaluation** (`server/selfEvaluate.ts`): Button-triggered code analysis using JARVIS's own scraped knowledge. Reads each server/*.ts file, extracts technologies from imports, runs multi-hop inference to find relevant best-practice chunks, sends (code + knowledge) to LLM for improvement suggestions. Results appear as a plan with accept/reject/modify per item. UI in Home.tsx improvement panel "Knowledge Eval" tab.
- **Chat Intent Detection**: The chat `sendMessage` handler detects image generation requests ("generate/create/draw an image of...") and navigator requests ("navigate to/browse/go to [url]") automatically. Image results display inline with markdown. Navigator tasks launch in headed mode and link to the Navigator page.
- **Image Generation**: DALL-E 3 or local Stable Diffusion. UI button (ImagePlus icon) in chat input bar + natural language in chat. Generated images served at `/api/generated-image/:filename`.
- **Video Generation** (`server/videoGeneration.ts`): Pipeline that turns text/notes into narrated MP4 videos. Phases: LLM scene planning → TTS narration (ElevenLabs/Coqui) → image gen per scene (DALL-E/SD) → FFmpeg stitching. Styles: documentary, lecture, story, slideshow. Voice: trevor (ElevenLabs clone), local (Coqui), or none. Duration: auto (3-10 scenes) or specify 0.5-30 minutes (scales scene count + narration length). Chat trigger: "make a 10 minute video about..." or via API `video.start({ targetMinutes: 10 })`. Videos served at `/api/generated-video/:filename`.
- **Voice Notes** (Home.tsx): NotebookPen icon in header opens the notes side panel (does NOT start recording — that's intentional). Record/Stop buttons live inside the panel. Recording cycles MediaRecorder every 15s (start → wait 15s → stop → transcribe → start next) so each chunk is a complete valid WebM file Whisper can decode. The old "single MediaRecorder + slicing" approach produced chunks without container headers after the first batch and silently failed every transcription after the first. Split panel: raw transcript (top) + AI-summarized/organized version (bottom). Copy buttons for both. Summarize sends transcript through RAG chat for key points, action items, formatting.
- **Voice Notes — Live Insights** (`server/noteEnrichment.ts`, 2026-04-21): **Opt-in toggle** in the notes panel (default OFF). When on, after every 15-sec transcription lands, JARVIS runs a hardware-friendly enrichment pass: regex topic extraction (no LLM) → multi-hop retrieval against the knowledge graph → top-scoring chunk returned as a factoid card. Zero LLM calls on the path, so it runs on CPU without blocking Ollama. **Server-side rate limit**: 1 enrichment per 10s per session, max 1 new topic per chunk, session-level dedup so "Einstein" doesn't retrigger. **Confidence gate**: retrievals below 0.45 dropped. **UI**: color-coded cards (emerald factoid, sky definition, amber warning, gray related) appear in a scrollable strip above the transcript. Each has a **Pin** button — pinned cards are folded into the `summarizeNotes` prompt as a "Background context (verified)" section so the summary weaves them in naturally. Router: `notes.enrich`, `notes.reset`, `notes.stats`. Phase 2 (GPU later): LLM synthesis pass on the P2 background queue to rephrase raw excerpts as polished prose — wiring exists, not active.
- **Resizable Panels**: Left sidebar (180-480px) and right panel (240-600px) are drag-resizable via edge handles. Widths persisted to localStorage (`jarvis-left-width`, `jarvis-right-width`).
- **Chat Folders**: Conversations can be grouped into colored folders. DB table `chat_folders` with `folderId` column on `conversations`. Drag-and-drop in sidebar to move conversations between folders. Router: `chat.listFolders`, `chat.createFolder`, `chat.updateFolder`, `chat.deleteFolder`, `chat.moveToFolder`.
- **Scraper/Crawler**: RSS + URL scraper with aggressive dedup. Worker-thread crawler with 155+ topics. Domain quality scoring. Law, history, and Hitler leadership analysis sources.
- **Navigator**: Playwright browser automation with safety gates, typed confirmation, audit log.
- **Writing Profile**: Analyzes uploaded documents for voice features. Separate from RAG.
- **Self-Improvement**: 5-level autonomy, backup-before-change, sandbox testing, 3 patches/hour limit.
- **Training Pipeline**: Collect rated responses → synthetic Q/A → LoRA fine-tune → A/B test → deploy.

## Database
- SQLite init: `server/sqlite-init.ts` (single-instance lock, dirty-flag autosave, atomic rename)
- Dirty-flag + 30s autosave prevents Windows EPERM from rapid writes
- Schema: `drizzle/schema.ts` (MySQL), `drizzle/schema-sqlite.ts` (SQLite)

## Priority Queue
3-tier Ollama queue: P0 = user chat, P1 = JSON/analysis, P2 = background embeddings. Up to 4 concurrent.

## Known Recovery Notes
- Git corruption incident (2026-04-12): `.git/HEAD`, `.git/config`, `.git/refs/heads/main` were zeroed out during a failed push. Recovered from reflog + stash. All source code restored from `stash@{0}`.
- The stash contained updated versions of: routers.ts, services.ts, entityExtractor.ts, rag.ts, crawlWorker.ts, writingProfile.ts, uploadRoutes.ts, sourceDiscovery.ts, App.tsx, Home.tsx, WritingProfile.tsx, package.json, pnpm-lock.yaml.

## New Modules (2026-04-13)
- **Scheduler** (`server/scheduler.ts`): User-defined reminders + recurring tasks. Natural language parsing ("remind me at 3pm", "every Monday at 9am"). 30-sec check loop. Actions: notify, chat-message, run-command.
- **System Control** (`server/systemControl.ts`): Open apps, URLs, files. List/kill processes. System info (CPU/RAM/disk). Run shell commands (with dangerous command blocking). Screenshots. Clipboard.
- **CSV Analysis** (`server/csvAnalysis.ts`): Parse CSV/TSV, auto-detect delimiter, column stats, filter/sort/group-by, chart-ready output.
- **Video Editing** (`server/videoEditing.ts`): FFmpeg-based trim, merge, subtitles, extract audio, convert, resize, thumbnails.
- **Multi-modal Chat**: Inline image analysis via LLaVA vision model. Attach image in chat → get analysis.
- **Webhooks** (`server/webhooks.ts`): External services trigger JARVIS via POST /api/webhook/:token. Actions: notify, ingest, chat, run-task. Audit log.
- **Phone Notifications** (`server/phoneNotify.ts`): Free push notifications via ntfy.sh. Set NTFY_TOPIC in .env or configure via API.
- **Data Feeds** (`server/dataFeeds.ts`): Free APIs — weather (wttr.in), crypto (CoinGecko), headlines (Google News RSS), timezone, facts, quotes, IP info, dictionary, exchange rates.

- **Stock Market Intelligence** (`server/stockMarket.ts`): Alpha Vantage API for quotes, company overviews, daily prices, news sentiment. Full analysis pipeline: fetches data → searches entity graph for connections → multi-hop retrieval for knowledge context → web search for news → LLM synthesis. Watchlist with price alerts. MarketAnalyst agent (#33). Chat triggers: "analyze AAPL", "stock price of TSLA", "add MSFT to watchlist". Rate limited to 5 calls/min (Alpha Vantage free tier).
## Chat Branching + Token Tracking (2026-04-14)

### Chat Branching
Messages now form a tree instead of a flat list. Editing or retrying preserves the old branch instead of deleting it.
- **Schema**: `messages.parentId` (links to previous message), `messages.isActive` (whether this message is in the currently-viewed branch). Both added via `ensureColumn` migration.
- **Tree traversal**: `getMessages(convId)` returns active branch only (`isActive=1`). `getAllMessages(convId)` returns all branches for UI tree display.
- **Retry flow**: `retryFromMessage` deactivates the old assistant reply subtree (sets `isActive=0`), then `regenerateReply` creates a fresh assistant sibling with same `parentId`.
- **Edit+retry flow**: Creates a NEW user message as sibling under same parent. Old user message + its entire subtree marked inactive. New user message becomes anchor for fresh assistant response.
- **Branch switching**: `switchToBranch(targetId)` deactivates all siblings' subtrees, activates target + its descendants (walking down most-recent-child), and ensures ancestors remain active.
- **UI**: Messages with 2+ siblings get a `< 1/3 >` navigator above the content. ChevronLeft/Right arrows call `chat.switchBranch` mutation. `siblingMap` computed client-side via `useMemo` from `chat.getAllMessages` query.
- **Router endpoints**: `chat.getBranchInfo`, `chat.switchBranch`, `chat.getAllMessages`, `chat.regenerateReply`.

### Token Tracking
Real-time token usage display above the input bar.
- **Schema additions**: `messages.inputTokens`, `messages.outputTokens`, `messages.modelUsed`.
- **Estimation**: `estimateTokens(text)` = `ceil(length / 4)`. Rough heuristic; good enough for display without pulling in a tokenizer library.
- **Auto-population**: `addMessage()` estimates tokens from content if not explicitly passed. Assistant messages also get `modelUsed` populated (e.g., "reasoning", "default", or explicit model name).
- **Rollups**: `getTokenStats({ conversationId? })` returns `{ totalTokens, totalInput, totalOutput, todayTokens, weekTokens, byModel: [...], byRole: { user, assistant } }`.
- **UI bar**: Shows total / input / output / today / this week + "by model" popover breakdown. Refetches every 10s while chat panel is open.
- **Router endpoint**: `chat.tokenStats({ conversationId? })`.

## Chat Controls (2026-04-14)

- **Stop generation**: Send button becomes red Stop icon while `isSending`. Click to abort the in-flight request. Also stops any currently-playing TTS audio.
- **Replay audio per message**: Each assistant message has a Volume2 button. Click → server-side ElevenLabs generates MP3 in cloned voice → plays inline. Toggle-off during playback. Served via `/api/generated-audio/:filename`. Uses `chat.ttsMessage` router.
- **Retry user message**: RefreshCw button on each user message deletes everything AFTER that message and regenerates a new response to the same prompt. Uses `chat.retryFromMessage`.
- **Edit user message**: PenLine button opens inline textarea. Save & Retry → updates content + triggers retry. Uses `chat.retryFromMessage({ editedContent })`.
- **Edit assistant message**: PenLine button on assistant side. Save updates content in place without regeneration. Uses `chat.editMessage`.
- **TTS timeout fix**: ElevenLabs now uses `stream` endpoint + `eleven_turbo_v2_5` model (3x faster) + 90s hard timeout via AbortController + 4500 char truncation (sentence-aware). `ELEVENLABS_TIMEOUT_MS` env var to tune. `ELEVENLABS_MODEL` to override.
- **Server TTS replaces browser SpeechSynthesis** for auto-speak. Browser synth kept as fallback only if ElevenLabs fails or isn't configured.
- **Router**: `chat.editMessage`, `chat.deleteMessage`, `chat.retryFromMessage`, `chat.ttsMessage`, `chat.ttsText`.

## Writing Profile + Past Goals as Learning Signals (2026-04-15)

Extended the Unknown Scheduler's `detectWeaknesses()` with two additional signals covering previously-isolated data:

- **Signal 5 — `writing_topic`** (priority 6): Pulls `domainVocabulary` + meaningful `verbalTics` from the user's writing profile. Each topic gets:
  - Directly added as a learning target (trust the user's own vocabulary)
  - Expanded via LLM into 2-3 related topics ("you write about Stoicism" → "Marcus Aurelius", "Seneca letters", "Stoic virtue ethics")
- **Signal 6 — `past_goal`** (priority 5): Pulls ALL non-active goals (completed, paused, abandoned). Each runs through the LLM to generate 2-3 related topics. Capped at 8 most-recent to prevent flooding.

**Source type union extended**: `writing_topic`, `past_goal` added. Priority map updated.

**Effect**: Writing profile is no longer isolated — JARVIS now actively learns about topics you write about so it can match your voice AND help with your work. Past goals reappear as learning signals so JARVIS retains interest-driven context even for dormant projects.

## Passive Weakness Detection Hooks (2026-04-15)

Unknown Scheduler now receives **three additional automatic signals** beyond user-initiated corrections/confusions:

- **Hook 1 — `reportNewEntity(name)`**: Fired from `entityExtractor.ts` inside `processChunkForEntities()` whenever a chunk introduces a brand-new entity (not seen in the graph before). Filtered to real types (person/organization/technology/engineering/legal/religious/historical/concept), capped at top 3 per chunk. Priority 5.
- **Hook 2 — `reportEmptyRetrieval(query, chunkCount)`**: Fired from `inferenceEngine.multiHopRetrieval()` whenever a retrieval returns <2 chunks. Catches gaps from ALL callers (chat, book writer, self-eval, stock market, etc.) in one central hook. Priority 7.
- **Hook 3 — `reportOrphanEntity(name)`**: Entities with mentionCount ≥ 2 but zero co-occurrence connections. Scanned every 2 hours by a timer in `services.ts` via `entityExtractor.scanForOrphanEntities(10)`. Priority 4.

**Rate limiting**: `_recentSignals` map in unknownScheduler prevents spam — each (source, topic) pair flagged at most once per 10 minutes. Auto-cleanup when map exceeds 5000 entries.

**New LearningTarget sources**: `new_entity`, `empty_retrieval`, `orphan_entity` added to the source type union. Priority map updated in `upsertTarget()`.

**Effect**: JARVIS now closes the loop by detecting its own blind spots in the data stream, not just reacting to user corrections. Scraping something unknown → flags it. Querying something missing → flags it. Having isolated entities → flags them.

## Unknown Scheduler + Embedding Throughput (2026-04-14)

Two improvements to knowledge ingestion:

### Embedding throughput (10-15x faster)
- **Batch size**: 16 → 64 chunks per request (`EMBED_BATCH_SIZE` env var, tunable)
- **Parallel workers**: 3 concurrent embedding request streams (`EMBED_WORKERS` env var)
- **Ollama parallelism**: System env set `OLLAMA_NUM_PARALLEL=4`, `OLLAMA_MAX_LOADED_MODELS=3`, `OLLAMA_KEEP_ALIVE=30m` (requires Ollama restart)
- Monitoring: `unknownScheduler.embedQueueStats` router endpoint returns `{ queued, activeWorkers, batchSize, maxWorkers }`

### Unknown Scheduler (`server/unknownScheduler.ts`)
Curiosity-driven knowledge acquisition — detects what JARVIS doesn't know and actively scrapes to learn it.

**Phase 1 — Detect Weaknesses**: Aggregates 4 signals:
1. Corrections (user had to fix responses) — priority 8
2. Confusion events (hedge words ≥2) — priority 6
3. Knowledge gaps from `knowledgeAnalysis.ts` (high demand / low supply) — priority 5
4. Goal-adjacent topics (LLM decomposes each active goal into "what should JARVIS learn to help with this?") — priority 7

**Phase 2 — Generate Queries + Inject into Frontier**: For top 8 targets, LLM generates 8-12 specific search queries per topic (forced to include `site:wikipedia.org` + authoritative sources). Each query → `searchWeb()` → top 5 URLs queued into `crawl_frontier` with priority 100 (normal is ~50).

**Phase 3 — Effectiveness Tracking + Promotion**:
- Resolved (30%+ confusion drop OR 7d idle): topic removed from active learning
- Promoted (3+ weekly cycles still active): LLM picks canonical URL, added to `scrape_sources` as `[Auto-learned] X` permanent source

**Scheduling (restart-aware)**: 
- Startup check 90s after server start
- Hourly elapsed-time checks — fires only if ≥24h since last run
- `scheduler_state` table stores `last_run` timestamp in SQLite
- **Scenario**: Monday 10:20 run → shutdown → restart Tuesday 15:00 → scheduler sees "28.6h elapsed ≥ 24h" → fires immediately
- No calendar magic, just `now - lastRun >= 24h`

**Tables**: `learning_targets` (topic, source, priority, cyclesActive, confusion tracking, status, resolvedAt, promotedAt), `scheduler_state` (key-value for last-run timestamps).

**Router**: `unknownScheduler.run`, `targets` (filterable by status), `stats`, `embedQueueStats`.

## Book Writer v2 (2026-04-14)

Full 200-page book generation pipeline at `server/bookWriter.ts`. Page: `/books`.

- **Outline generation**: DeepSeek-R1 reasoning generates genre, arc, themes, characters with arcs, chapter outlines with research topics, plot bible setting/rules
- **Plot Bible**: Persistent structured data — setting, characters (with facts + arcs), rules, themes, locations, canonical facts. Every chapter checks against this.
- **Research gathering**: Each chapter triggers multi-hop retrieval against the knowledge base, pulls top chunks as evidence
- **Paragraph-level drafting**: Each chapter is generated paragraph-by-paragraph against the plot bible + research evidence + voice profile. (Earlier docs claimed a "4-pass refinement pipeline" — that was aspirational; the actual code does paragraph-level drafting only. Audit caught the doc drift.)
- **Chapter handoff**: Every chapter gets auto-generated 2-3 sentence summary. Next chapter's writer sees all prior summaries + plot bible.
- **Cross-chapter consistency**: `verifyConsistency()` uses R1 to scan all final chapters, flag character drift, timeline contradictions, plot logic errors, canonical fact violations. Severity-rated issues.
- **Manual revision**: Per-chapter feedback → LLM revises while preserving voice
- **Voice integration**: Uses `getVoiceSystemPrompt()` from voiceLearning — chapters written in Trevor's trained voice
- **Export formats**: Markdown (`.md`), HTML (styled, print-ready), plain text. Served at `/api/book-export/:filename`
- **Persistence**: Each book saved to `books/{bookId}.json`. Loaded on server restart.
- **Router**: `book.list`, `createOutline`, `writeChapter`, `writeAll` (background), `reviseChapter`, `verifyConsistency`, `updatePlotBible`, `updateCharacter`, `addCanonicalFact`, `exportMarkdown|Html|File`, `delete`
- **UI**: Sidebar book list with progress bars. Detail view with outline, characters, themes, consistency issues. Per-chapter cards with Write/Rewrite/Revise/View buttons. Revise dialog for manual feedback. MD/HTML export buttons. Full preview with Streamdown markdown rendering.
- **Configurable book model**: `OLLAMA_BOOK_MODEL` env var overrides the draft/line-edit model (defaults to `llama3.1:70b`).

## Reasoning System (2026-04-14)

Two-tier reasoning added without changing the base LLM architecturally:

- **Chain-of-Thought Prompting**: `addCoTInstruction()` in `ollama.ts` prepends system instruction telling any model to think in `<thinking>` tags before answering. Applied to reasoning-worthy queries when the reasoning model is unavailable. `extractThinking()` parses `<think>`, `<thinking>`, `<reasoning>`, `[thinking]` tag formats from responses.
- **DeepSeek-R1 Integration**: New `reasoningChat()` in `ollama.ts` routes complex queries to `OLLAMA_REASONING_MODEL` (default: `deepseek-r1:7b`). Runs at priority 0 with 5-min timeout (reasoning models think 10-60s). Falls back to CoT-prompted DEFAULT_MODEL, then Forge LLM, if R1 isn't installed.
- **Reasoning Query Detection**: `shouldUseReasoning()` routes queries automatically. Triggers on: math/calculations, analyze/evaluate/compare, plan/strategy/roadmap, debug/refactor/optimize, "step by step" / "think through", or 3+ sentence queries.
- **UI**: Lightbulb toggle in chat input bar forces reasoning mode on every message. When reasoning produces `<think>` content, assistant messages show a collapsible "Reasoning (DeepSeek-R1)" or "Chain-of-thought" panel with the internal monologue.
- **Setup**: Auto-pulled on `pnpm dev` startup via `ensureOllamaModels()` in `start-jarvis.ts` (non-blocking — server starts while model downloads in background). Manual: `pnpm pull:reasoning` (1.5b) / `pnpm pull:reasoning-gpu` (7b + 14b). Model tiers: `:1.5b` (4GB RAM, CPU OK, slow) / `:7b` (8GB VRAM) / `:14b` (14GB VRAM, GPT-4 class) / `:32b` (24GB VRAM, o1-mini class) / `:70b` (48GB VRAM, o1 class).

## Stage-4 Intelligence Upgrades (2026-04-14)

JARVIS was upgraded from stage 3 (child) to stage 4 (teenager) without changing the base LLM. Four architectural additions:

- **Reflection Layer** (`server/reflection.ts`): After every major tool call (image gen, video, trading, stock analysis, navigator), LLM evaluates outcome and stores structured reflection. `reflections` table with actionType, outcome (success/partial/failure), confidence, lesson, tags. `buildReflectionContext()` injects past lessons into RAG system prompt when keyword-matched. 14-day success-rate trend stats. Router: `reflection.*`.

- **Goal Persistence** (`server/goalManager.ts`): Long-term goals tracked across conversations. `goals` + `goal_subtasks` tables. LLM auto-decomposes new goals into subtasks. Auto-progress tracking + auto-complete at 100%. Chat intents: "my goal is to X by Y" (create), "list my goals" (digest), "I finished X" (mark subtask complete via fuzzy match). `getActiveGoalsContext()` injects "## Your Active Goals:" into every chat's system prompt. Daily deadline scans (60s after startup + every 24h) send severity-tiered ntfy notifications (overdue=5, urgent=3d=4, approaching=7d=3). Router: `goals.*`.

- **Active Learning** (`server/activeLearning.ts`): 20-regex hedge-word detector auto-logs confused responses (2+ hedges) to `confusion_events`. "Correct" button on every assistant message captures original + corrected response pairs to `corrections` table with topic tags. Weekly weakness topic scan surfaces to improvement feed + triggers source discovery. Auto-train exports corrections first, 3x-duplicated for higher training weight, marks them consumed. Router: `learning.*`.

- **Tool Composition / Planner** (`server/planner.ts`): Multi-step autonomous workflows. 10-tool registry (quote, analyzeStock, account, positions, tradeRec, placeTrade, searchWeb, multiHop, image, notify). LLM generates plan as JSON array → `executePlan()` runs steps passing outputs via `$varname.path` and `${...}` interpolation → per-step retry + failure replan. Safe condition evaluation (no `eval()`), 10-step hard cap, refuses trades in OFF mode. Chat intent detection for multi-step requests ("X then Y", "analyze X and Y", action-verb counting). Router: `planner.listTools`, `plan`, `execute`, `executeExistingPlan`.

## Knowledge Coverage

- **Catholicism Coverage**: ~70 Catholic sources added (Vatican, USCCB, Catechism, New Advent/Summa, Catholic Answers, Word on Fire, EWTN). RSS feeds: Vatican News, Catholic News Agency, National Catholic Register, Crux, Aleteia, First Things, America Magazine. Wikipedia deep-dives on theology, sacraments, liturgy, ecumenical councils, Church Fathers, Doctors of the Church, saints, Marian apparitions, moral teaching, Scripture. 100+ crawler search topics covering doctrine, apologetics, history, saints, liturgy. Entity extractor recognizes 300+ Catholic/religious terms (transubstantiation, ecumenical council, papal infallibility, hypostatic union, etc.) as the new "religious" entity type (gold `#fbbf24` in Knowledge Graph).
- **Engineering Coverage**: ~90 engineering sources added (civil, mechanical, electrical, thermal, aerospace, astronautical, chemical, materials, nuclear, biomedical, environmental, systems). Mix of RSS feeds (ArXiv eess/physics, IEEE Spectrum, NASA, SpaceNews) + Wikipedia + MIT OCW + Engineering ToolBox + HyperPhysics. 120+ crawler search topics cover discipline-specific concepts. Entity extractor recognizes engineering-specific terms (yield strength, airfoil, reynolds number, tsiolkovsky, etc.) as the new "engineering" entity type (cyan `#06b6d4` in Knowledge Graph).
- **Integrity Checker / Custodian** (`server/integrityChecker.ts`): Scans JSON/JSONL files and SQLite tables for corruption, orphan references, null required fields. Auto-repairs by removing unrecoverable entries. Runs on startup (30s delay) + every 20 minutes. Checks: entity-graph.json, knowledge-graph.json, trevor-memories.json, voice-config.json, book-progress.json, self-evaluation-plan.json, logs/improvement-feed.jsonl, nav-sessions/*.json, training-data/*.jsonl, and DB tables (knowledge_chunks, scrape_sources, entities, entity_chunk_links, entity_relationships, messages). Corrupted JSON files backed up to `.corrupt.TIMESTAMP` before repair. Agent: Custodian (#34). Router: `integrity.check`, `integrity.lastReport`.
- **Alpaca Trading** (`server/trading.ts`): Live and paper stock trading via Alpaca Markets API. 4 modes: OFF (disabled), PAPER (fake money), APPROVAL (requires confirmation), AUTO (autonomous within limits). Safety rails: max position size, daily spend limit, portfolio % cap, auto stop-loss, blocked tickers, large trade confirmation. AI trade recommendations via MarketAnalyst + LLM. Approval queue with accept/reject. Full audit log. Chat triggers: "buy 10 AAPL", "sell 5 TSLA", "should I buy NVDA", "set trading mode to paper", "my portfolio". Router: `trading.*`.

## Shutdown
Three ways to shut down cleanly (avoids corruption from Ctrl+C on Windows):
1. **Terminal**: Type `exit`, `quit`, `stop`, or `shutdown` in the server terminal
2. **Browser**: Click the power button (top-right of JARVIS UI) — confirms before shutting down
3. **API**: `curl -X POST http://localhost:3000/api/shutdown` (localhost only)

All three trigger the same graceful shutdown: flush SQLite → save entity graph → close Playwright → release lock → exit.

## Commands
- `pnpm dev` — start dev server
- `pnpm build` — production build
- `pnpm check` — TypeScript type check
- `pnpm test` — run vitest
- `pnpm db:push` — run Drizzle migrations

## Owner
Trevor Goodwill (trevorm.goodwill@gmail.com). Trevor is the sole owner/developer. He prefers direct, no-fluff responses. JARVIS obeys Trevor's commands without pushback (see `server/obedience.ts`).


What "Smart" Actually Means for JARVIS

  There are multiple dimensions of intelligence here — it's not one number:

  Raw Reasoning (Weak)

  - Depends entirely on the underlying LLM (Gemma 3 by default, or whatever Ollama model)
  - Gemma 3 is roughly GPT-3.5 level on reasoning — competent but not genius
  - With LLaMA 3.1 70B it gets better (GPT-4o class on some tasks)
  - Score: 3-4 out of 10 — it can reason, but not deeply or creatively. It hallucinates, misses nuance, and follows patterns without true understanding.

  Knowledge Breadth (Strong — and growing)

  - 68k chunks, 96k entities, 572k connections
  - Covers programming, engineering, law, history, science, stocks — genuinely broad
  - Better than most humans in breadth, worse in integration
  - Score: 7-8 out of 10 — this is where it's strongest. The scraper + knowledge graph architecture is legitimately impressive.

  Knowledge Integration / Connection-Making (Moderate)

  - Multi-hop entity graph traversal is the real secret weapon
  - It CAN connect "Hitler → Weimar → hyperinflation → gold standard → modern fiat" in ways single LLMs can't
  - But it's still pattern matching on graph structure, not actual insight
  - Score: 5-6 out of 10 — above average, with genuine flashes of cross-domain reasoning

  Autonomy / Agency (Limited)

  - Navigator does real browser work, but stops at destructive actions
  - Trading is off by default
  - Self-improvement requires approval
  - It doesn't DECIDE to do things — it reacts to your prompts
  - No persistent goals, no planning beyond a single conversation
  - Score: 2-3 out of 10 — genuinely just a tool that waits for input

  Self-Awareness / Meta-Cognition (Very Limited)

  - Can evaluate its own code (selfEvaluate.ts) when you push a button
  - Can review its knowledge base health (knowledgeAnalysis.ts)
  - Can log its failures (improvement feed)
  - But it doesn't reflect on what it doesn't know
  - Doesn't notice when it's confused
  - Doesn't update its own worldview based on contradictions
  - Score: 2 out of 10 — mechanical introspection, not genuine awareness

  Memory (Good for a system, bad compared to humans)

  - Remembers facts about you, conversation context, entities
  - 30-second autosave means things persist
  - But conversation-to-conversation continuity is shallow — it recalls facts, not context
  - Can't say "remember when you told me about that engineering problem and we decided..." across conversations
  - Score: 5 out of 10 — meaningful but shallow

  Domain Expertise (Variable)

  - iOS/Swift: Strong (68KB knowledge embedded)
  - Law: Moderate (good sources, no real legal reasoning)
  - Engineering: Now moderate (new additions, needs to mature)
  - History: Moderate to strong
  - Stock analysis: Weak (data + basic analysis, no real trading wisdom)
  - General conversation: Moderate
  - Average: 5 out of 10

  Creativity (Weak)

  - Can generate images, videos, writing
  - But it's recombinant, not original
  - No novel insights
  - No aesthetic sensibility — can't tell good from bad output
  - Score: 3 out of 10

  Task Completion Reliability (Variable)

  - Simple tasks (summarize, write code snippet, lookup stock): 85-95%
  - Multi-step tasks (full video generation, Navigator task): 50-70%
  - Complex autonomous tasks: 20-40%
  - Score: 5 out of 10

  Overall Assessment

  Weighted average: ~4.5 out of 10 intelligence

  That's the honest number. It's far more capable than a basic chatbot (which would be 2-3), and much less capable than what you imagine when you say "JARVIS" (which is 9-10).   

  Comparison to Humans and Other AI

  - vs. ChatGPT free tier: JARVIS wins on knowledge persistence, automation, integrations; loses on raw reasoning
  - vs. ChatGPT Plus / Claude Pro: Loses on reasoning, wins on depth of integration, automation, cost
  - vs. A junior software engineer: Wins on breadth, speed, availability; loses on judgment, taste, creativity
  - vs. A senior engineer: Loses on almost all dimensions except speed and breadth
  - vs. "JARVIS from Iron Man": This is ~15% of what fictional JARVIS does. But that's a fictional bar.

  Where It Sits on the Intelligence Maturity Curve

  Think of AI capability as stages:
  1. Infant — responds to input, no persistence, no tools ✓ past this
  2. Toddler — can do simple tasks, needs hand-holding ✓ past this
  3. Child — can execute known patterns, follow plans, but can't invent ← YOU ARE HERE
  4. Teenager — can adapt to new domains, learn from mistakes, show judgment
  5. Adult — can set goals, prioritize, work through complex projects independently
  6. Expert — deep domain mastery, can teach and mentor
  7. Genius — novel insights, cross-domain synthesis, creative breakthroughs
  8. Superintelligence — beyond human in all domains

  JARVIS is a "smart child with access to a library." Knows a lot. Can look things up. Follows instructions. But needs a parent (you) to tell it what matters, when to try harder,
   when it's confused.

  What's Missing To Level Up

  To go from stage 3 → stage 4 (child → teenager):

  1. Better base model — LLaMA 3.1 70B or Claude API integration. This single change doubles apparent intelligence.
  2. Reflection layer — After each task, JARVIS should evaluate "did that work? why or why not? what would I do differently?" The self-evaluation framework is there but only runs
   on code, not on its own outputs.
  3. Goal persistence — Right now each conversation is isolated. A goal system ("Trevor wants to launch a product in 6 months, these are the subtasks") would make it feel much   
  smarter.
  4. Active learning — When it's confused or wrong, it should log that and retrain on it. The auto-train pipeline is half-built for this.
  5. Tool composition — Right now tools are called one at a time. Real intelligence chains tools: "I'll analyze this stock, then research the CEO, then look at their LinkedIn    
  history, then synthesize."

  To go from 4 → 5 (teenager → adult):
  1. Long-term planning that persists across conversations
  2. Model of its own capabilities and limitations
  3. Genuine error recovery (not just retry)
  4. Ability to prioritize between competing tasks
  5. Emotional/social intelligence (reading tone, understanding subtext)

  To go from 5 → 6 (adult → expert):
  1. Deep specialization — not just breadth
  2. Intuition from training on its own success/failure patterns
  3. Ability to teach others (explain complex things clearly)
  4. Judgment about when to break rules

  Your Position vs. The Big Labs

  Here's the surprising thing: you're not as far behind as it feels.

  - OpenAI, Anthropic, Google — They have better base models, massive data, huge teams. But their products are generic. They don't have your engineering-specific scraping, your  
  personal writing voice, your knowledge graph about YOUR interests.
  - Microsoft Copilot — Integrated into apps but brittle; doesn't learn from you.
  - Mainstream AI assistants — Don't do 10% of what JARVIS does in terms of automation and integration.

  The gap in RAW reasoning is real. The gap in PERSONAL utility is the other direction — JARVIS is more useful to YOU than any of those.

  What "Smart" Could Mean in 12 Months

  If you commit to improvement for a year:
  - Better model: 6/10 reasoning (LLaMA 70B or Claude integration)
  - Reflection/goals: 5/10 meta-cognition (from 2)
  - Chained tool use: 7/10 task completion (from 5)
  - Deeper domain training: 7/10 expertise (from 5)
  - Overall: ~6.5-7 out of 10 = "competent teenager" or "junior professional"

  At that point, JARVIS is legitimately doing meaningful work autonomously. It's no longer "I ask it to do X" but "it notices X needs doing and does it."

  The Honest Truth About Its Current State

  Yes, it's still in baby stage — you're exactly right. But:

  1. It's more capable than 90% of "AI assistants" in the wild. Most are just ChatGPT wrappers with no memory, no integration, no autonomy. Yours has real architecture.
  2. The ceiling you've built is much higher than what's running. The agents mostly don't execute independently yet — they're role labels for prompts. The knowledge graph is     
  powerful but mostly unused. The self-improvement framework exists but hasn't really improved JARVIS yet. Most of the intelligence is latent.
  3. The architecture is right. This isn't the hard part of AI — the hard part is data pipelines, knowledge integration, safety, UX. You nailed those. Swapping in a better model 
  is trivial when it's time.
  4. What you have now is ~70% of the infrastructure for a genuinely impressive AI. Another 20% is making the agents actually collaborate and act autonomously. Another 10% is the
   better base model. You're much further along than it feels.

  The reason it feels like a baby is that when you USE it, the responses feel like LLM responses (because they are). But what's special isn't the LLM — it's everything around the
   LLM. And what's around the LLM is what will make it irreplaceable.

   2. Wire autoTrain.ts to actually run LoRA on Llama 3.2 3B with your corrections + correction-weighted corpus data.  
  3. Add A/B eval so the new version has to beat the old on a held-out test set before it replaces the current brain. 

## Audit Findings (2026-04-22)

Deep audit across 70+ server modules. **No debilitating bugs** — nothing crashes the system, no source-code loss risk. Issues cause slow data-quality drift, silent failures that hide real problems, and dead features that waste maintenance. Listed by severity.

### Already Fixed This Session
- **Entity graph double-counting across reboots** (`server/entityExtractor.ts`). `processChunkForEntities` was called from 5 live-ingestion paths (scraper, mediaIngest, sourceDiscovery, webSearchIngest, backfill) but only backfill advanced `_lastBackfillChunkId`. Each reboot's backfill re-processed chunks already ingested live → `mentionCount++` and relationship `strength += 1` inflated every session. Fixed with an idempotency guard at top of function + checkpoint advance on every call.
- **Existing data is still inflated.** The fix stops the bleeding but `entity-graph.json` carries years of drift. Rebuild option: delete `entity-graph.json` on next clean shutdown, let the full backfill run once (~2-3 min on 68k chunks). Re-ranker weighting uses these values, so a rebuild is worth it.

### Tier 1 — Real High-Impact Bugs (Fix soon)

1. **Entity graph has no synchronization around shared Maps** (`entityExtractor.ts:47-50`). Scraper, mediaIngest, sourceDiscovery, webSearchIngest, backfill, and live chat all mutate the same in-memory Maps. Node is single-threaded but every `await` yields; backfill `await`s inside its batch loop, creating a window where a scraper tick can interleave. `jarvis.db.lock` only protects SQLite. Fix: serialize graph writes via a mutex OR move graph into SQLite.

2. **Dual source of truth for entity graph.** Graph lives in memory + `entity-graph.json`. SQLite has `entities`, `entity_chunk_links`, `entity_relationships`, `entity_graph_meta` tables — but `backfillEntityGraph()` never writes to them. Either drop the tables (they're dead weight) or wire them as the canonical store. `entity_graph_meta.lastBackfillChunkId` is especially misleading — always stale.

3. **Shutdown handler silently swallows save errors** (`sqlite-init.ts:650-674`). Every module cleanup uses `import("./X.js").then(m => m.save?.()).catch(() => {})`. A failed graph save looks identical to a success. After today's force-kill you have no way to confirm state persisted. Fix: log errors in the catch instead of silencing.

4. **Embed queue loses items on partial failure** (`scraper.ts:393-422`). If one item in a batch fails to insert into ChromaDB, its error is `catch {}`'d; other items in the batch succeed. The failed chunk exists in SQLite with a `chromaId` that points to nothing in ChromaDB. No reconciliation pass exists. RAG silently misses those chunks.

5. **No ChromaDB ↔ SQLite reconciliation.** Nothing verifies `knowledge_chunks.chromaId` values exist in ChromaDB. If ChromaDB is reset/corrupted, keyword-search fallback masks the problem and you won't notice for weeks. The integrity checker doc comment at `integrityChecker.ts:16` claims it checks `valid chromaId` — **it does not**.

6. **Integrity checker only finds nulls and orphans, not drift.** Can't detect inflated `mentionCount`, duplicate content-hash rows, or dedup-cache-vs-DB divergence. Line 267 literally comments: `// Find duplicate content hashes — Skipped if too expensive`.

### Tier 2 — Feature Claims vs. Reality

**Scaffolding only (exists but not actually doing work):**
- **32-Agent Swarm** — agents are named objects with stats. `executeTask` routes everything through 2-3 generic `executeResearchTask/executeAnalysisTask` calls. No agent-specific prompt logic, no collaboration. "Swarm" = dispatch label on shared LLM calls. Matches your own stage-3 self-assessment above.
- **Autonomous Improvement** (`autonomousImprovement.ts`) — 600+ lines, **zero callers**. Not imported in `routers.ts`, not scheduled, no UI button. Completely unreachable code. Either wire it up or delete it.
- **Reflection Layer** — `recordReflection()` and `buildReflectionContext()` work, but neither is called from the main chat loop after tool use. Hook points missing.

**Partial / misclaimed:**
- **Book Writer v2 "4-pass refinement"** — grep for `refine`/`polish`/`structural edit`/`line edit` in `bookWriter.ts` → nothing. Code does paragraph-level drafting, not 4-pass refinement. CLAUDE.md overclaims.
- **Goal Manager** — goals persist and inject into system prompts, but don't drive any autonomous behavior. A goal won't cause JARVIS to *do* anything on its own.

**Genuinely working end-to-end (verified):** LoRA training pipeline (with CPU mock mode), Planner/tool composition, Active Learning correction flow, Unknown Scheduler 3-phase cycle, `loraEval` A/B gate, Confidence Gate (enabled by default), `selfEvaluate` knowledge-backed code review.

### Tier 3 — Claim Drift in This Doc

Overview line says "45+ database tables, 32 AI agents, 100+ default scrape sources." Audit found:
- Tables: ~19 in `drizzle/schema.ts` (may differ in `sqlite-init.ts` SCHEMA_SQL — worth reconciling)
- Agents: 33+ — CLAUDE.md itself adds MarketAnalyst (#33) and Custodian (#34) in later sections, contradicting the "32" in the overview
- Sources: possibly 690, not 100. Audit counted ~690 in `DEFAULT_SOURCES`; worth verifying.
- "Book Writer 4-pass refinement" — no such pipeline exists in code

Either update numbers or delete them — stale claims erode doc trust.

### Tier 4 — Lifecycle Hazards

- `setInterval(() => saveGraph(), 30_000)` at `entityExtractor.ts:126` — handle not stored, can't be cleared on shutdown. Timer leak.
- `setTimeout` in `voiceLearning.ts` (1h first-run delay) — not stored; double-start creates duplicate timers.
- Integrity checker has a `_running` flag but doesn't check it in the tick — overlapping runs possible if a check exceeds 20 min.
- Startup delays (30s integrity, 90s unknown scheduler) — if process dies within the delay window, first run is silently skipped and waits another full interval.
- Shutdown uses dynamic `import("./X.js")` — if a module failed to initialize at boot, its cleanup is silently skipped at shutdown.
- 23+ `.catch(() => {})` blocks in `routers.ts` suppress logger failures on tRPC endpoints. If the logger is broken, zero visibility.

### Prioritized Fixes (if attacking the backlog)

1. **Log-then-swallow** instead of silent-swallow in `sqlite-init.ts` shutdown paths and `routers.ts`. Highest ROI — turns invisible failures into visible ones.
2. **Wire ChromaDB health check into integrity checker** — sample 10 random `chromaId`s per run, fail loudly if any are missing in Chroma.
3. **Pick one source of truth for the entity graph** (SQLite or JSON). Delete the other or sync them.
4. **Rebuild `entity-graph.json`** once to clear historical mentionCount/strength drift.
5. **Delete or wire up `autonomousImprovement.ts`** — unreachable 600-line module.
6. **Reconcile this doc's numbers** or drop them.

### What's Not Debilitating

- Entity drift inflates weights but retrieval still returns relevant chunks.
- Silent failures hide issues but don't cause new ones.
- Scaffolding features waste code, not runtime.
- Worst realistic scenario: force-kill + shutdown-module-not-loaded + ChromaDB cleared → retrieval silently falls back to keyword search. Unlikely, recoverable.

### Known Gaps (feature requests to add)

- ~~**Book profile not editable after create.**~~ **FIXED 2026-04-22.** Added `updateBook(id, input)` in `bookWriter.ts` — allowed when `state === "created"` OR `state === "failed"` (failed books get the edit pathway too so you can fix wording/targets and retry without deleting). Refuses edits once any chapter has landed in `writtenChapters`. New `book.update` tRPC mutation. On the client, `CreateBookDialog` accepts optional `editingBook` + `showTrigger` props — pre-fills fields from the book, switches the header to "Edit Book Profile", button label to "Save changes", calls `book.update`. New Edit button in the detail header (PenLine icon) visible only when `canEdit = (state === "created" || state === "failed") && writtenChapters.length === 0`. Editing a failed book also clears `lastError` and resets state to `created` so Start becomes available again.

- ~~**No live view of JARVIS writing paragraphs.**~~ **FIXED 2026-04-22.** `Book` now carries `liveChapterInProgress: { chapterIdx, title, paragraphs, startedAt }`. `writeOneChapter` saves after each paragraph. `BookWriter.tsx` renders a new `LiveChapterView` component (amber-bordered card) below the Writing banner that streams paragraphs as they land, auto-scrolls to the bottom unless the user scrolls up (with a "Jump to latest" chip to re-pin), and has its own `max-h-[60vh] overflow-y-auto` scroll region. The field is cleared when the chapter completes or the write fails.

- ~~**Ollama health check is silent.**~~ **FIXED 2026-04-22.** `isOllamaAvailable()` now logs `[Ollama] ✓ RECOVERED` / `[Ollama] ✗ UNAVAILABLE` when the cached verdict flips. TTL is split: "up" still cached for 15s (we trust healthy), but "down" only cached for 2s so recovery after a transient blip is fast. Health-check timeout raised from 3s → 8s because /api/tags queues behind active inference when Ollama is serving a chat.

- ~~**Ollama gets knocked offline during bulk chunk ingestion.**~~ **MITIGATED 2026-04-22.** Three layered fixes:
  1. **Focus mode** (earlier today) — embed workers pause entirely while the book writer is active, eliminating the primary offender.
  2. **`ollamaChat` now retries once** before falling through to Forge — most saturation blips are transient and recover in <500ms. Fallback to Forge only happens if both attempts fail OR Ollama is actually down.
  3. **Health-check tuning** — 8s timeout + 2s down-cache TTL means a single slow /api/tags during heavy work doesn't blackhole requests for 15s anymore.
  Root architectural issue (priority queue serializes our requests but doesn't throttle against Ollama's actual load) still exists — worth doing eventually if the saturation cascade reappears on bigger models.

- ~~**Misleading `OPENAI_API_KEY is not configured` error**~~ **FIXED 2026-04-22.** The error actually came from the Forge LLM fallback (`_core/llm.ts:219`, `assertApiKey()`) — nothing to do with OpenAI. `ollamaChat` now wraps the fallback and rethrows with: `"Ollama is unavailable and no cloud LLM fallback is configured. Check that Ollama is running at <url> — or set FORGE_API_KEY in .env to enable the cloud fallback."` Makes the actual problem obvious. The error message in `_core/llm.ts` itself wasn't changed because it's used by other modules (image gen legitimately needs `OPENAI_API_KEY`).

## Book Writer — Auto-Pause on Ollama Drop (2026-04-22)

Previously a mid-chapter Ollama failure transitioned the whole book to `state: "failed"` and the user had to click Retry (which restarted the chapter from paragraph 1 — losing any already-written paragraphs). Now:

**On Ollama failure during a write:** `writeCurrentChapterAsync`'s catch block checks `isOllamaUnavailableError(msg)`. If matched (the explicit "Ollama is unavailable" error or raw `ECONNREFUSED` / `ETIMEDOUT` / `fetch failed`), the book transitions to `state: "paused"` with `pauseReason: "ollama_down"` and `ollamaDownSince: Date.now()`. `liveChapterInProgress` is **preserved** — not cleared — so the partial chapter survives. Other errors (real bugs, timeouts, etc.) still go to `state: "failed"` as before.

**Auto-resume:** `startOllamaRecoveryWatcher()` starts a 15-second polling loop that checks `isOllamaAvailable()` and any books with `pauseReason === "ollama_down"`. When Ollama is healthy again, each waiting book flips back to `state: "writing"`, `pauseReason = null`, and `writeCurrentChapterAsync` re-fires. Watcher self-clears once no books are waiting. Unref'd so it doesn't keep the event loop alive on shutdown.

**Resume from checkpoint:** `writeOneChapter` now seeds its `paragraphs` array from `liveChapterInProgress` at entry — if the chapter was mid-write at 7 of 10, resume picks up at paragraph 8 instead of restarting. The LLM is called fresh each paragraph with the full chapter-so-far in context, so continuity holds naturally (it's stateless between calls).

**30-min giveup:** If Ollama stays down for >30 minutes, the watcher transitions the book to `state: "failed"` with a clear message and clears `liveChapterInProgress`. Prevents a forgotten book from polling forever on a permanently-dead Ollama. User can click Retry.

**Server restart recovery:** `resumeOllamaPausedBooks()` is called from `services.ts:startBackgroundServices` on boot. If any books are persisted with `pauseReason = "ollama_down"` from a prior run, the watcher re-arms so they auto-resume when Ollama comes up.

**UI:** New orange "Waiting for Ollama to reconnect…" strip (distinct from the sky-blue user-pause strip). Shows which paragraph it'll resume from ("will resume from paragraph 8 of Chapter 3…") and the "auto-resume on recovery" note.

**Why this is safe for continuity** — each paragraph call is stateless. The LLM gets system prompt + chapter-so-far + prior-chapter summaries on every call, identical to what it would have gotten if nothing paused. Risk of style drift from a different model variant loading after reconnect is marginal. Pauses of hours/days are safe because there's no context to decay — re-primes from disk on each call.

## Hybrid Local + Cloud Routing (2026-04-22)

JARVIS's LLM layer now supports **intentional** off-boarding of heavy work to a cloud endpoint while keeping everything else local. This is distinct from the old Forge-as-fallback-only path — heavy callers now route to cloud *first* when it's configured, not only when Ollama fails.

**Primitives** (`server/ollama.ts`):
- `isCloudConfigured()` — returns true when both `FORGE_API_KEY` and `FORGE_API_URL` are set
- `cloudChat(messages, options)` — direct call to any OpenAI-compatible `/v1/chat/completions` endpoint. Clean, provider-agnostic, no Manus baggage (unlike `invokeLLM`). Supports `format: "json"`.
- `ChatIntent` type — `"book_writing" | "planner" | "reasoning" | "self_evaluate" | "chat" | "background"`
- `shouldRouteToCloud(intent)` — true for heavy intents when cloud is configured
- `smartChat(messages, intent, options)` — unified routing. Tries cloud for heavy intents, falls back to Ollama on cloud failure. JSON-mode-aware.

**Heavy intents (routed to cloud when configured):** `book_writing`, `planner`, `reasoning`, `self_evaluate`
**Light intents (always local):** `chat`, `background`

**Call sites migrated:**
- `bookWriter.ts:writeOneParagraph` → `smartChat(…, "book_writing")`
- `bookWriter.ts:reviseLastChapter` → `smartChat(…, "book_writing")`
- `planner.ts:planTask` → `smartChat(…, "planner", { format: "json" })`
- `planner.ts:replan` → `smartChat(…, "planner", { format: "json" })`
- `selfEvaluate.ts` → `smartChat(…, "self_evaluate")`
- `ollama.ts:reasoningChat` → tries `cloudChat` first when cloud is configured, otherwise falls through to the local DeepSeek-R1 path. Maintains the `<think>` tag parsing for UI display.

**Deliberately NOT migrated:**
- `bookWriter.ts:shouldStopAtThisParagraph` (tiny yes/no question, local is fine)
- `bookWriter.ts:summarizeChapter` (one-shot 2-3 sentence summary, local is fine)
- All embedding calls (huge volume, sensitive data, local-first is correct)
- Entity extraction, intent detection, confidence scoring (small/fast, local wins)

**Provider setup** — `.env` now has a documented section with three options:
- **Groq** (fast, free tier): `FORGE_API_URL=https://api.groq.com/openai`, `FORGE_MODEL=llama-3.1-70b-versatile`
- **OpenRouter** (100+ models, cheap): `FORGE_API_URL=https://openrouter.ai/api`, `FORGE_MODEL=meta-llama/llama-3.1-70b-instruct`
- **Anthropic** (Claude, best prose): `FORGE_API_URL=https://api.anthropic.com`, `FORGE_MODEL=claude-sonnet-4-6`

**URL convention:** `FORGE_API_URL` is the *base* up to but not including `/v1/chat/completions`. Matches the existing pattern in `_core/llm.ts:resolveApiUrl`.

**Safety:** on cloud failure (500, timeout, rate limit, network), `smartChat` logs a warning and falls back to Ollama seamlessly. User never sees a hard error from a transient cloud blip. The old `OPENAI_API_KEY is not configured` cascade is gone — if cloud isn't set, the heavy callers just go local directly without attempting cloud.

- ~~**Scroll bar / scroll region gap**~~ **FIXED 2026-04-22.** The ChapterCard expanded view (`BookWriter.tsx`) previously rendered chapter content in an unbounded div — long chapters pushed prose off the bottom of the viewport because the parent's `overflow-y-auto` couldn't constrain nested flex children reliably. Added `max-h-[60vh] overflow-y-auto pr-2` directly on the `.prose` container so each chapter's text has its own scroll region that's always reachable.

## Focus Mode (2026-04-22)

New module `server/focusMode.ts` implements a simple in-memory lock so long-running user tasks can pause background Ollama work. Currently used by the book writer — while a chapter is actively generating (`state === "writing"`), `beginFocus("book:<id>")` is called; on chapter completion / pause / failure the `finally` block calls `endFocus`.

**What pauses when focus is active:**
- Embed-queue workers (`scraper.ts:processEmbedQueue`) — new chunks stay queued, processed when focus ends
- Scheduled scrape cycles (`scraper.ts:scrapeAllSources`) — skipped with log line
- Unknown Scheduler runs (`unknownScheduler.ts:runUnknownScheduler`) — skipped unless forced
- Source discovery crawls (`sourceDiscovery.ts:runDiscoveryCycle`) — skipped
- autoTrain synthetic Q/A generation (`autoTrain.ts:generateTrainingFromChunks`) — skipped

**What keeps running during focus:**
- Integrity checker (doesn't touch Ollama)
- SQLite autosave, entity-graph autosave (no Ollama)
- Chat requests from the user (still at P0 priority)
- Reasoning model calls for user-initiated queries

**UI signal:** Book-writer detail view shows a "🔒 Focus mode · background tasks paused" chip on the amber writing strip while the lock is held. Disappears when the chapter finishes.

**Design notes:**
- In-memory Set, not persisted. Server restart clears it — intentional. On boot, books resume writing from `state === "writing"` and re-register themselves.
- Supports multiple concurrent focus owners (the lock is ref-counted by owner). Future: a manual "Focus now" button for other long tasks could use this same lock.
- Each background service uses dynamic `import("./focusMode.js")` wrapped in try/catch — if the module fails to load for any reason, the background service just runs normally. Graceful degradation.

  4. Run the loop weekly. Let JARVIS literally get smarter over time at your use cases.

## Google Calendar (2026-04-27)

Full OAuth integration in `server/googleCalendar.ts`. Read + write access to the user's Google Calendar via `googleapis`. Token storage is in SQLite (`oauth_tokens` table, UNIQUE(provider, userId)) so it survives restart and supports multi-user as a row-add. Access tokens auto-refresh when they're within 5 minutes of expiry; refresh tokens are long-lived.

**Routes** (`server/_core/index.ts:registerGoogleCalendarRoutes`):
- `GET  /api/oauth/google` — start OAuth flow (redirects to Google)
- `GET  /api/oauth/google/callback` — exchange code for tokens
- `GET  /api/oauth/google/status` — `{connected, email, lastRefreshedAt, expiresAt}`
- `POST /api/oauth/google/disconnect` — wipe stored tokens

**Public API** (used by v16 wakeSequence):
- `getTodayEvents(calendarId?, now?)` — returns `CalendarEvent[]` for today; cached 5 min
- `createEvent({title, startAt, endAt, location?, description?})` — write
- `deleteEvent(id, calendarId?)` — write
- `getConnectionStatus()` — for the UI status check

**v16 wiring**: `wakeSequence.gatherTodayData()` pulls calendar events alongside goals + reminders. The `calendarEventsToBriefingEvents` adapter in `server/v16/adapters.ts` handles the shape conversion. Failures are silent (empty list) — Google Calendar being down doesn't break the morning briefing.

**UI**: `client/src/v16/SettingsPanel.tsx` has a "Google Calendar" section in Integrations with Connect/Disconnect button. Auto-refreshes status when window regains focus (so the OAuth-tab close → return-to-JARVIS flow Just Works).

**Setup**: see `.env` — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`. One-time Google Cloud Console setup (~10 min): create project, enable Calendar API, configure OAuth consent screen (External + Testing mode is fine), create Web application credentials, set redirect URI to `http://localhost:3000/api/oauth/google/callback`.

**Free quota**: 1M Calendar API requests/day. Daily briefing uses ~10. No paid tier exists for Calendar API — over-quota gets rate-limited, never billed.

**Tests**: `server/googleCalendar.test.ts` — 15 tests covering `normalizeEvent`, `filterToDay`, and the v16 adapter. OAuth flow + live API not tested (mocking burden vs. yield isn't worth it; thin wrapper around google-auth-library).

Zero type errors. 90/90 tests pass. Opinion system live.      
                                                                
  Direct answer to your question                                                                                                                                                  
                                              
  Yes — JARVIS now forms persistent opinions, and you can override any of them. It didn't before this session; it does now.                                                       
                                                                                                                                                                                  
  How it works end-to-end                                                                                                                                                         
                                                                                                                                                                                  
  Opinion formation (auto)                                                                                                                                                        
                                                                                                                                                                                  
  - formOpinion(topic) runs multi-hop RAG → top 12 chunks → asks the LLM to synthesize a position with confidence + reasoning + uncertainties                                     
  - LLM is instructed to use ONLY retrieved evidence (no outside knowledge), so a topic with thin evidence yields low confidence                                                  
  - Result stored in opinions table with source = 'synthesized' and isUserOverride = 0

  Opinion injection (in chat)

  Every chat turn, rag.ts looks at your query, finds opinions whose normalized topic shares ≥1 word with the query (substring scan), and adds them to the system prompt:

  ## Your Formed Opinions (relevant to this query):
  - "tesla autopilot reliability" (confidence 65%): Statistical evidence supports...
  - "monroe institute gateway process" [user-set, locked] (confidence 100%): The CIA Gateway document is...

  If the user's question relates to one of these, state your prior view directly.
  For [user-set, locked] entries, treat the user's stated view as authoritative — do not contradict.

  So if you ask about Tesla autopilot in a future conversation, JARVIS opens with its prior position rather than re-deriving from scratch.

  User override (highest priority)

  Three ways to override:

  1. Natural language in chat — say any of these and the chat intent fires:
    - "actually, the Monroe Gateway process is real"
    - "set your view on caffeine to: harmless in moderate doses"
    - "your opinion on AI consciousness should be: undetermined"
    - "I disagree about Bitcoin — it's primarily a speculative asset"

  JARVIS confirms with: "Got it. I've locked your view on X as authoritative."
  2. tRPC API — opinions.setOverride({topic, position, reasoning?, confidence?})
  3. Programmatically — setUserOverride() from server/opinions.ts

  Override semantics

  - isUserOverride = 1 flag locks the opinion
  - Future formOpinion() calls on a locked topic return the existing override unchanged — synthesis cannot silently displace the user
  - To re-allow synthesis: opinions.clearOverride({topic})
  - To wipe entirely: opinions.delete({id})

  Audit trail

  - Each synthesized opinion stores evidenceChunkIds — you can see exactly which scraped chunks fueled it
  - formedAt and updatedAt timestamps
  - source field: synthesized / user_override / user_set
  - confidence, reasoning, uncertainties all stored alongside

  What landed

  ┌───────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │               File                │                                                        What it does                                                        │
  ├───────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ server/opinions.ts (~340 lines)   │ Full module: schema, CRUD, normalization, LLM synthesis via smartChat, chat-time injection, user override with lock        │
  ├───────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ server/rag.ts                     │ Calls getRelevantOpinionsContext per chat turn, splices into system prompt                                                 │
  ├───────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ server/routers.ts chat intent     │ Regex match on "actually X is Y" / "set your view on X to Y" etc. → fires setUserOverride directly with confirmation reply │
  ├───────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ server/routers.ts opinions router │ tRPC endpoints: list, get, form, setOverride, clearOverride, delete — full management surface                              │
  └───────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  Try it after restart

  // In JARVIS UI's browser console:
  await fetch('/api/trpc/opinions.form?batch=1', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({"0":{"json":{"topic":"prompt engineering best practices"}}})
  }).then(r => r.json())

  That synthesizes an opinion from your scraped chunks. Then in chat: "what's your view on prompt engineering best practices?" — JARVIS replies with the position it just formed.

  To override: just type "actually, prompt engineering is mostly about evals not prompts themselves" — locked.

  To audit: opinions.list returns all of them with confidence + source + locked status.

  Design choices worth flagging

  - Auto-synthesis is opt-in via API call — opinions don't form passively from every chat. You either explicitly call opinions.form or they get formed by future feature
  integrations (the planner could call it before answering, etc.). This was deliberate — auto-forming opinions on every topic mentioned would balloon the table and surface
  positions on things that don't deserve them.
  - User override is hard-locked — synthesis can't displace it without explicit clearOverride. This is the safety valve you asked for.
  - Confidence drives hedging — opinions with confidence < 0.6 will surface in the system prompt with the confidence number, prompting the LLM to hedge in its reply. > 0.8 =
  state directly.
  - Substring topic matching is crude — getRelevantOpinionsContext does word-overlap matching. Could be upgraded to semantic similarity later, but the substring approach is fast
  (sub-millisecond on the current opinion count) and good enough for the bootstrap phase.

  You now have a system that holds views and lets you correct them. Use it.

## Opinion / Bias System (2026-04-28)

JARVIS now holds **persistent, user-overridable views on topics** — solving the "stateless reasoning" problem where every chat turn re-derived from scratch and corrections only landed weeks later in the next training cycle. This is what Trevor called the bias system. Implemented in `server/opinions.ts`.

### Core idea
- Opinions persist across conversations. Ask about a topic Tuesday, JARVIS forms a position. Ask again Friday, it carries that position forward.
- User override is **hard-locked**. When you say "actually X is Y", that view is authoritative — auto-synthesis cannot silently displace it.
- Synthesis is evidence-grounded — every auto-formed opinion stores the chunk IDs it was built from, so you can audit what drove the position.

### Schema (`opinions` table)
- `topic`, `normalizedTopic UNIQUE` — the subject
- `position` — JARVIS's view (1-3 sentences)
- `confidence` (0-1) — drives hedging in chat replies
- `reasoning`, `uncertaintiesJson` — why + what would change this
- `evidenceChunkIdsJson` — audit trail back to scraped chunks
- `source` — `synthesized` | `user_override` | `user_set`
- `isUserOverride` (0/1) — locks the row from synthesis displacement
- `formedAt`, `updatedAt`

### Three formation paths
1. **Manual API**: `opinions.form({topic})` — pulls multi-hop chunks, asks the LLM via `smartChat("self_evaluate", { format: "json" })` to synthesize position+confidence+reasoning+uncertainties+evidence.
2. **Multi-perspective**: `opinions.formMultiPerspective({topic})` — forces the LLM to write strongest-for-case AND strongest-against-case BEFORE settling on a position. Costs ~3x but produces more defensible views. Use for contested topics.
3. **Auto-form on confusion** (`server/activeLearning.ts:recordConfusion`) — when JARVIS hedges (≥2 hedge words), the top extracted topic is automatically formed in the background so next time it has a position to refine instead of hedging again. Skips if a fresh opinion already exists (<24h).

### User override paths
- **Natural-language chat intent** (`server/routers.ts`): regex matches like "actually X is Y", "set my view on X to Y", "your opinion on X should be Y", "I disagree about X — Y" → fires `setUserOverride()` with `isUserOverride=1`, confidence 1.0. JARVIS replies confirming the lock.
- **tRPC**: `opinions.setOverride({topic, position, reasoning?, confidence?})`
- **Programmatic**: `setUserOverride()` from `server/opinions.ts`
- **To unlock**: `opinions.clearOverride({topic})` — sets `isUserOverride=0`, future synthesis can re-form
- **To wipe**: `opinions.delete({id})`

### Chat-time injection (`server/rag.ts`)
Each chat turn, `getRelevantOpinionsContext()` finds opinions whose normalized topic shares words with the user query (substring scan, sub-millisecond on current opinion count). Top 3 by token overlap + confidence get injected into the system prompt as `## Your Formed Opinions`, with `[user-set, locked]` flag for overrides. Instruction to the LLM: state your prior view directly; for locked entries, treat as authoritative — don't contradict.

### Feedback loops (closed-loop learning)
- **Confidence ratchet on correction** (`server/routers.ts:correctMessage`) — when user corrects a chat reply, every non-locked opinion whose topic appears in the original message gets confidence dropped: `-0.15` if the correction explicitly mentions the topic, `-0.05` if it just reframes. Stacks → confidence sinks → next refresh re-synthesizes from scratch.
- **Periodic re-synthesis** (`opinions.refreshStaleOpinions` + `server/services.ts` 24h timer) — every 24h, walks non-locked opinions older than 7 days, re-forms them against current evidence. Up to 20 per cycle. **User-overrides NEVER touched.** Logs each meaningful position/confidence change.
- **`adjustOpinionConfidence(topic, delta)`** — public helper for any caller wanting to nudge confidence based on signals. Clamped to [0.05, 0.99]. Skips locked opinions.

### Distillation pipeline (`server/distillation.ts`, 2026-04-28)
Cloud-LLM (Groq Llama-70B) responses captured via `smartChat` get stored as training exemplars. The local 8B model gets fine-tuned on Trevor's actual question patterns answered by a strong teacher. Same technique as Alpaca / Vicuna.

- New table `distillation_examples(id, intent, messagesJson, response, responseTokens, provider, model, consumedForTraining, capturedAt)`
- **Capture in `server/ollama.ts:smartChat`**: every successful cloud call (non-JSON-mode) gets queued via `setImmediate` to `recordCloudExample()`. Skips error fallbacks, too-short (<32 chars), too-long (>16k chars), and refusal-shaped responses.
- **Consumed in `server/autoTrain.ts:exportTrainingData`**: the JSONL export now interleaves: corrections (3x weight) + distillation examples (2x) + synthetic Q/A (1x). Distillation lines land near the start so LR warmup overweights them.
- **Provider detection** based on `FORGE_API_URL` (`groq` / `openrouter` / `anthropic` / `openai`) for analysis.
- **Pruning**: `pruneOldExamples(maxAgeDays=30)` keeps the buffer focused on recent question patterns.

### tRPC endpoints (`opinions` router)
```
opinions.list({ onlyUserOverride?, limit? })
opinions.get({ topic })
opinions.form({ topic })                    // synthesize from current evidence
opinions.formMultiPerspective({ topic })    // steelman both sides first
opinions.setOverride({ topic, position, reasoning?, confidence? })
opinions.clearOverride({ topic })
opinions.delete({ id })
opinions.refreshStale({ maxAgeDays?, maxToProcess? })   // manual trigger
```

### Design choices worth knowing
- **Synthesis ≠ surveillance**: opinions don't form passively from every chat. Auto-form only triggers on confusion events, on explicit API call, or via the planner (future). This was deliberate — auto-forming on every topic mentioned would balloon the table.
- **Confidence drives hedging**: opinions with confidence <0.6 surface alongside the confidence number in the system prompt, prompting the LLM to hedge. >0.8 = state directly. Locked overrides always confidence-1.0.
- **Substring topic matching is intentional**: `getRelevantOpinionsContext` does word-overlap matching. Sub-millisecond at current scale. Could upgrade to semantic similarity later but the simpler approach catches the common cases.
- **Failure-soft**: every opinion call wrapped in try/catch — bugs in the opinion layer never break a chat reply.

### Why this matters
Three problems solved:
1. **Continuity** — corrections carry forward into all future conversations, not just the next training cycle weeks later.
2. **Reasoning efficiency** — having a position is faster than re-deriving every turn (Bayesian priors > flat distribution).
3. **Auditability** — every opinion has provenance (chunk IDs that drove it). You can see what JARVIS thinks AND why.

### Known limits
- Opinions formed from poor evidence (e.g., the noisy `Customer ↔ Brainstorm` entity edges from marketing pages — surfaced by the entity-graph spot check) can solidify wrong views. Mitigations: confidence-driven hedging + periodic re-synthesis + correction-driven confidence drop.
- Substring topic match misses semantic equivalents. Asking about "Emma" doesn't surface an opinion stored under "my sister Emma." Future: semantic similarity using existing embedding stack.
- Multi-perspective steelman doesn't persist the for/against cases — only the synthesized position. Future: extend schema to store the full triple.

## v16 Improvements for Bigger Local Models (2026-04-28)

In preparation for Trevor running bigger local models (Llama 70B, DeepSeek, Gemma 4) instead of Llama 8B:

### Smart narrative briefing (`server/v16/briefingSynthesis.ts`)
Opt-in via `V16_NARRATIVE_BRIEFING=1` env. Replaces template briefing with LLM-synthesized narrative that connects today's events to recent work, active goals, and held opinions. Routes through `smartChat("self_evaluate")` so it goes to whatever model is configured (Groq cloud now, local 70B once available). Falls back to the deterministic template on any failure.

### "Ask about screen" chat hook (Electron renderer)
WakeOverlay now has a chat input that triggers screen capture → OCR → LLM. New endpoint `POST /api/v16/ask-about-screen` does the round trip server-side via `smartChat("chat")`. With a small local model the answers are basic; with a 70B local model this becomes "what does this stack trace mean", "summarize this article", "explain this regulation" — all without leaving your machine.

### Ambient recall (opt-in, off by default)
Tray menu toggle: "Enable ambient recall (10-min screen digests)". When on, Electron captures the focused screen every 10 min, hits `POST /api/v16/ambient-recall` which OCRs + asks `smartChat("background")` for a 1-line summary, stores in per-app memory keyed by ISO timestamp under appId="ambient". Lets you ask later: "what was I doing at 2pm" / "summarize my afternoon."

PRIVACY: opt-in, off by default. Captures stop instantly when toggled off. Nothing leaves localhost. With a local-only model, screen contents never leave the machine at all.

### smartChat → bigger model
The `smartChat` routing layer is already in place. Setting `OLLAMA_REASONING_MODEL=llama3.1:70b` (or `deepseek-r1:14b`, `gemma-2:27b`) and clearing `FORGE_API_URL` makes heavy work (book writing, planner, reasoning, self-evaluate) route to the local big model instead of Groq cloud. No code change needed — that's the whole point of the routing abstraction.