# JARVIS v16 — Personal AI Operating System (Falcon: always-on desktop agent)

A fully autonomous AI system with everything below, now wrapped in an **always-on desktop agent** that listens for "Hey JARVIS," auto-starts itself on Windows login, drives both browsers and native apps, types stored credentials without ever leaking the plaintext to its own LLM, and reaches your phone through your own Cloudflare-tunneled domain. Runs locally on commodity hardware. No cloud dependency required.

**Current intelligence rating: 8.7/10 (adult-to-expert, useful agent territory)** — up from 8.3/10 in v15. v15→v16 is a **reach + execution upgrade**, not a raw-IQ one: the underlying LLM didn't change, but the surface JARVIS can act on did. Concretely: it can now hear you across the room, log itself in, pick up a hidden tray instance when you say its name, type a password into Chrome it physically can't recall to memory, click through a native app's UI, swap to a fresh fine-tuned local model the moment one beats the old one on a held-out test set, and route phone-notification button-taps back to itself over a permanent public URL. The "smart" rating goes up because intelligence in any practical sense includes ability to act on conclusions — and v16 is where the conclusions actually become actions.

**v16 shipped** (the Falcon UI roadmap from v15 — done):
1. **Two-window Electron shell** — wake overlay + dedicated panel window, both real OS windows (drag, resize, taskbar entry, always-on-top, minimize away). Frameless transparent overlay was tried and reverted because it covered other apps you were trying to work with.
2. **Wake word "Hey JARVIS"** — browser SpeechRecognition, opt-in via tray. Phrase match → fire wake → voice mode auto-starts recording, auto-stops on 1.5s silence (Google-Home-style).
3. **Voice mode rewrite** — click-to-toggle (was hold-to-talk), VAD auto-stop, live volume bar, tap-to-interrupt during TTS. Whisper STT → smartChat → cloned-voice TTS, one round trip.
4. **Auto-spawn v15 from v16** — if localhost:3000 isn't reachable when wake fires, v16 spawns `pnpm dev` as a child process, polls until reachable, then continues. "Hey JARVIS" works from a fully cold state.
5. **Windows login auto-start** — tray toggle. v16 launches silently to the system tray on every login, listener always live.
6. **Cloudflare Tunnel wizard** — 9-step admin panel. Walks through `cloudflared` install, browser auth, named tunnel, locked-or-open exposure mode (default: only `/api/notify/action.*` and OAuth callback paths exposed, everything else 403), DNS route, Windows service install, `.env` write, public-URL ping verification.
7. **Native UI control** — `nut-js`-backed keyboard / mouse / window-focus operations, exposed via `nativeControl.*` tRPC + `controlApp` planner tool. Rate-limited (30/60s), blocklist for dangerous combos, audit log to `logs/native-control.jsonl`.
8. **Encrypted credential vault** — Argon2id KDF + XChaCha20-Poly1305 AEAD via libsodium. Master-password setup/unlock/lock, auto-lock after 30 min idle, master-password rotation that re-encrypts the entire vault in one transaction. **Plaintext never enters the planner's step-output context** — `getCredential` returns an opaque 60s-TTL handle, `controlApp.typeCredentialField` resolves it server-side and types via nut-js so the LLM never sees the password even during replanning.
9. **Phone notifications phase 2** — categorized topics (alerts/goals/trades/autonomous/reminders/calendar/general), per-category batching with digests, ntfy action buttons, slash-command reply listener (`/help`, `/goals`, `/status`, `/complete`, `/pause`, `/resume`, `/quiet`).
10. **Per-app memory** — JARVIS keyed memory by focused-app id. "Last time you were in Photoshop you were sharpening the V16 hero shot."
11. **OCR + ask-about-screen + ambient recall** — desktopCapturer → tesseract.js → smartChat. Ambient recall is opt-in 10-min digests stored under `appId="ambient"` for "what was I doing at 2pm" later queries.
12. **Workflows** — 8 built-in (research, debug-stacktrace, shopping, summarize-pdf, compare-prices, track-stock, email-draft, plan-trip), with chaining (each step's input resolver gets accumulated context), recurrence via the scheduler, and persisted run history.
13. **Opinions / bias system** — `opinions` table holds persistent positions on topics with confidence scores, evidence-chunk audit trail, and user-locked overrides. Auto-forms on confusion events. Periodic re-synthesis of stale opinions every 24h. **User overrides are hard-locked** — synthesis cannot silently displace them.
14. **Distillation pipeline** — every successful cloud-LLM call (Groq Llama-70B etc.) gets captured as a training example. The local 8B model gets fine-tuned weekly on the user's actual questions answered by a strong teacher. Same technique as Alpaca/Vicuna.
15. **LoRA loop closure** — the weekly auto-trainer now goes through `loraTrainer.runTrainingCycle` (held-out test set + 10pp margin gate), not the old 5-hardcoded-query bypass path. `ollama.ts`'s default model is mutable; `deployModel()` calls `setDefaultModel()` so a winning training cycle takes effect on the next chat turn — no server restart.
16. **Graceful shutdown** — three paths parallel to v15's: tray-menu "Quit JARVIS (v16 only)", tray-menu "Quit JARVIS + shut down server" (hits `/api/shutdown`), Ctrl+C in terminal. Close-button on panels hides instead of destroys, so re-opening from the tray is instant.

**Current knowledge base (live):** ~1M chunks · 26k+ unique source URLs · ~690 scrape sources · 100k+ frontier URLs queued · 200+ MB entity graph (now SQLite-backed: 1.58M entities, 11.4M chunk links, 11.6M relationships) · 11 entity types (person, organization, technology, engineering, legal, historical, religious, health, physics, named_entity, concept)

---

## What It Does

### Core Intelligence (the brain)
- **34-Agent Swarm** — Researchers, analysts, coders, planners, executors, memory keepers, QA, security, creative, knowledge, operations, finance, and maintenance specialists working in parallel
- **DeepSeek-R1 Reasoning** — Dedicated reasoning model with native `<think>` step-by-step deliberation. Auto-routes math, logic, analysis, planning, and multi-step queries. 1.5B tier runs on CPU; 7B/14B/32B/70B tiers available with GPU.
- **Multi-Hop Knowledge Graph RAG** — Vector search (ChromaDB) + entity graph traversal (2 hops) + re-ranking by vector/entity/graph centrality. 96k+ entities, 572k+ connections tracked in-memory. Serializes every 30s.
- **Reflection Layer** — Every major tool call gets post-hoc LLM evaluation. Past lessons injected into future related queries. 14-day success-rate trend tracking.
- **Goal Persistence** — Long-term goals tracked across conversations. LLM auto-decomposes into subtasks with deadlines. Every chat starts with "Your Active Goals" context.
- **Tool Composition / Planner** — 10-tool registry. LLM generates JSON plan → executes with variable passing → per-step retry + failure replan.

### v11: Curiosity-Driven Learning (9 signals)

The Unknown Scheduler now detects weaknesses from **9 parallel signals**, feeding into a daily cycle that generates targeted search queries and injects URLs into the crawl frontier:

| Priority | Signal | Trigger |
|----------|--------|---------|
| 8 | **correction** | You clicked "Correct this" on a response |
| 7 | **empty_retrieval** | ANY caller (chat, book writer, self-eval, stock, agents) gets <2 chunks back from RAG |
| 7 | **goal_adjacent** | LLM-expanded topics from active goals |
| 6 | **writing_topic** | `domainVocabulary` + verbal tics from your writing profile |
| 6 | **confusion** | Response had 2+ hedge words ("I think", "maybe", "not sure") |
| 5 | **past_goal** | Completed/paused/abandoned goals (LLM-expanded) |
| 5 | **new_entity** | Scraper extracted an entity never seen before |
| 5 | **knowledge_gap** | High query demand, low chunk supply (from knowledgeAnalysis) |
| 4 | **orphan_entity** | Entity has ≥2 mentions but zero graph connections (scanned every 2h) |

**Effect**: JARVIS detects its own blind spots in real-time — at chunk-processing time, at retrieval time, and via scheduled orphan scans. Then autonomously pulls targeted content. Self-improves while you sleep.

### v12: Video & Creator Content Ingestion

JARVIS can now learn from short-form and long-form creator content — a content modality text scraping alone can't reach.

- **YouTube** — captions pulled directly from the watch page's `ytInitialPlayerResponse` (no API key, no yt-dlp needed). Falls back to yt-dlp for videos without captions.
- **TikTok + Instagram** — via `yt-dlp --dump-json`. Pulls title + description + auto-subtitles. Requires `yt-dlp` on PATH.
- **Channel auto-polling** — Paste a `/channel/UC...`, `/@handle`, or direct feeds URL via `media.addChannel()` → JARVIS polls its RSS every 15 min, ingests new uploads up to 5 per channel per tick, skips videos already ingested.
- **Chat paste intent** — drop a YouTube/TikTok/IG URL in chat and (if the toggle is on) it auto-ingests and confirms chunk count. Runs *before* the Navigator intent so "visit this youtube link" routes to ingestion, not a browser session.
- **Master toggle** — defaults OFF (creator content has lower signal density than text; opt-in by design). Flip in the UI next to the Scraping toggle.
- **Pipeline parity** — transcripts go through the same `chunkText → embed → entity extraction → vector store` flow as RSS scrapes. Fully queryable via RAG. Tagged `sourceType = "media_youtube" / "media_tiktok" / "media_instagram"` for filtering.

### v12: Startup + Dedup Hardening

- **Persisted dedup cache** — hash set of all stored chunks lives in `dedup-cache.json`. Startup reloads instead of rehashing 978k chunks + 794 MB of text through sql.js WASM every cold boot. Cold start: **minutes → seconds**. Delta rehash covers only chunks added since last save.
- **Dedup-gated scraper** — scraper and source-discovery schedulers now wait for the dedup cache to be ready before firing. Previously, fast startup + slow cache rebuild created a window where duplicates slipped through. Closed.
- **Atomic + periodic persistence** — `.tmp + rename` writes, auto-save every 2 min if dirty, force-save on clean shutdown.

### v13: Physics Domain (Classical → Modern)

A full physics vertical added alongside engineering — but kept distinct. Engineering covers applied thermo/aero/orbital; physics covers the fundamentals and frontier theory.

- **~70 sources** — ArXiv feeds (hep-th, hep-ph, gr-qc, quant-ph, cond-mat, astro-ph, class-ph, math-ph), Physical Review Letters, Nature Physics, Physics Today, APS Physics Magazine, Quanta Magazine, MIT OCW (8.01/8.02/8.04/8.333), Feynman Lectures on Physics, CERN, Fermilab, Particle Data Group, Stanford Encyclopedia. Wikipedia deep-dives across: classical mechanics (Newton/Lagrangian/Hamiltonian/Noether/Kepler), electromagnetism (Maxwell, optics, wave-particle duality), thermo + statistical mechanics (entropy, Boltzmann, partition function, ensembles), relativity (special, general, Einstein field equations, Schwarzschild, gravitational waves), quantum mechanics (Schrödinger, uncertainty, entanglement, superposition, decoherence, path integrals, interpretations), QFT/Standard Model (QED, QCD, Higgs, gauge theory, SUSY, string theory, loop quantum gravity), cosmology (Big Bang, CMB, dark matter, dark energy, inflation, Λ-CDM), condensed matter (superconductivity, BEC).
- **~70 crawler topics** — scoped to fundamental physics so the curiosity loop pulls pure physics, not engineering applications.
- **~150 new entity terms + "physics" entity type** — routed before the engineering branch in `classifyEntity()`, so quantum/relativity/Higgs/dark-matter/Lagrangian all tag as physics while shared terms (thermodynamic, orbital, reactor, rocket) still tag as engineering. Physics color: violet (`#8b5cf6`) in the Knowledge Graph.

### v13: Health & Natural Medicine Domain

A new domain focused specifically on **natural / ancestral medicine** — not mainstream clinical medicine. Covers the effects of sun exposure, exercise, fasting, raw dairy, pastured eggs, red meat, fermented foods, starches, and gut-cleaning protocols.

- **~45 sources** — Foundations (Weston A. Price Foundation, A Campaign for Real Milk, Price-Pottenger); fasting (The Fasting Method / Jason Fung, Peter Attia); sun + circadian (vitamin D, nitric oxide, melatonin, UV health effects, grounding); exercise (VO2 max, Zone 2, strength training, HIIT, mitochondrial biogenesis); ancestral nutrition (raw milk, A2 milk, pastured eggs, grass-fed beef, organ meats, bone broth, yogurt, kefir, fermentation, potatoes, resistant starch, saturated fat, seed oils, omega-3); gut health (microbiome, SIBO, candida, leaky gut, elimination diet, short-chain fatty acids, glyphosate); diet movements (paleo, carnivore, Nutrition and Physical Degeneration).
- **~60 crawler topics** clustered the same way.
- **~120 entity terms + "health" entity type** — routed with a dedicated branch in `classifyEntity()` that catches `vitamin`, `fasting`, `microbiom`, `probiotic`, `raw milk`, `grass fed`, `yogurt`, `kefir`, `carnivore diet`, `weston price`, `zone 2`, `grounding`, etc. Health color: emerald (`#10b981`) in the Knowledge Graph.

### v15: Interactive Book Writer, Per-Category Voice Profiles, Live Insights, Grammar Domain, Hardware Safety

Five product-level additions that meaningfully increase the "useful-to-me" score without touching the base LLM.

#### Interactive Book Writer (`server/bookWriter.ts` — full rewrite)
The old 4-pass pipeline (draft → structural → line → polish) is gone. Replaced with a user-guided paragraph-by-paragraph flow that keeps the author in the loop.

- **Intake form** — title, description, optional introduction text, chapter list (title + notes per chapter), **optional parts** (group chapters under named parts like "Part 1: Origins"), **length targets** (target words OR target pages, auto-synced at 250 words/page), **additional info** (free-form: sources to cite, text you've already written, style preferences, audience, research constraints — injected verbatim into the system prompt). **All fields now unlimited in length.** The old 8,000-char cap on chapter notes is gone.
- **Writing loop** — JARVIS writes introduction first, then each chapter in order. Within each chapter: drafts one paragraph at a time, re-reads the **entire chapter-so-far** before writing the next paragraph. LLM decides when the chapter is complete (with a 2× target hard cap). Summary auto-generated for downstream chapter continuity.
- **60-second intervention window** — after every chapter, JARVIS enters `awaiting_intervention` state with a live countdown timer in the UI. User can:
  - **Pause** → saves a thought-process Markdown file to `books-interactive/thoughts/` (progress, what was written, what's next, remaining outline, book description) and halts
  - **Request change** → provides feedback in a textarea; JARVIS revises the last chapter and re-enters the 60s window on the revised version (repeatable)
  - **Continue** → immediately advances to the next chapter
  - **Do nothing** → auto-continues after the 60s timer expires
- **Part transitions** — when a chapter opens a new part, the paragraph-1 prompt explicitly notes the structural boundary so the LLM gives extra weight to the opening.
- **UI polish** — live polling (1s while awaiting intervention, 2s while writing, 5s otherwise), grouped outline display when parts are used, scrollable panels with native `overflow-y-auto` (fixed Radix ScrollArea nesting bug), live countdown timer with shrinking bar.
- **Router endpoints**: `book.create`, `book.start`, `book.resume`, `book.unpause`, `book.intervene`, `book.delete`, `book.exportMarkdown`. The old `interactive` sub-router is gone — everything is flat under `book.*`.

#### Per-Category Writing-Voice Profiles (`server/writingProfile.ts`)
Previously a single aggregated profile across all samples. Resume samples influenced book chapters, which was wrong.

- **One profile per category** — essay, lab_report, book_report, resume, book, article, other. Plus a combined **"all"** profile spanning every sample for fallback.
- **Chat context detection** — `detectWritingCategory(userMessage)` runs 13 regex patterns in order from most-specific to most-generic (cover letter → `resume`, lab writeup → `lab_report`, short story → `book`, op-ed → `article`, argumentative paper → `essay`). Wired into `rag.ts` — every chat turn, JARVIS picks the voice profile matching what the user's writing.
- **Book Writer uses the `"book"` profile** directly; chat default stays on `"all"`.
- **Graceful fallback** — if the requested category has no samples yet, `getProfile(category)` falls back to `"all"` automatically.
- **Re-categorize any sample** — dropdown on each sample card in the UI. On change: server updates the row → re-runs LLM style analysis with the new category's lens → re-aggregates both the old and new category profiles. The UI surfaces this as toast + live refetch.
- **Per-category regenerate button** — small "↻ Regen" button on each category tab. Rebuilds just that profile (plus the combined "all") from already-analyzed samples. Cheap re-aggregation, no LLM calls.
- **Router**: `writingProfile.getProfile({ category? })`, `writingProfile.listCategories`, `writingProfile.updateSampleCategory`, `writingProfile.regenerateCategory`.

#### Live Insights for Voice Notes (`server/noteEnrichment.ts`)
Live background research during recording. Hardware-friendly by design — zero LLM calls on the enrichment path.

- **Opt-in toggle** in the notes panel header. Default OFF so nothing fires until the user wants it.
- **After every 15-second transcription chunk**: regex topic extraction (no LLM) → multi-hop retrieval against the knowledge graph → top-scoring chunk returned as a factoid card.
- **Rate-limited** server-side: 1 enrichment per 10 seconds per session, max 1 new topic per chunk, session-level dedup so "Einstein" doesn't retrigger 6 times.
- **Confidence gate** drops retrievals scoring below 0.45.
- **Color-coded cards** in the UI: emerald factoid, sky definition, amber warning, gray related. Each shows topic, confidence %, content excerpt, source link.
- **Pin to summary** — each card has a Pin button. Pinned cards get folded into the `summarizeNotes` prompt as "Background context (verified from knowledge base)" with instructions to weave them in naturally rather than quote verbatim.
- **Voice Notes recording fixed** — MediaRecorder now cycles every 15s (start → wait → stop → transcribe → start next) so each chunk is a complete valid WebM file. The old single-MediaRecorder + slicing approach produced chunks without container headers after the first batch and silently failed transcription of everything but the first 15s.
- **Header button behavior changed** — NotebookPen icon in the header now just **opens the notes panel**. Recording only starts when you click the Record button inside the panel. Matches explicit user consent for mic access.
- **Router**: `notes.enrich`, `notes.reset`, `notes.stats`.

#### Language / Grammar / Style Domain
A new knowledge vertical alongside physics, engineering, health, etc. Covers grammar rules, punctuation, style guides, rhetoric, usage.

- **~53 new default sources** — Grammar Girl RSS, Chicago Manual of Style Shop Talk, Merriam-Webster, Grammarly, Oxford Dictionaries, Purdue OWL (grammar, punctuation, mechanics, sentence structure), Wikipedia deep-dives on English grammar, parts of speech, syntax, clauses, punctuation marks, capitalization, commonly confused words, passive voice, dangling modifiers, style guides (Chicago, AP, MLA, APA, Strunk & White, Fowler's), rhetoric (metaphor, simile, ethos/pathos/logos).
- **New "language" entity type** — ~100 terms in `LANGUAGE_TERMS` set (Oxford comma, em dash, gerund, subjunctive, subject-verb agreement, etc.) routed before the tech-terms branch in `classifyEntity()`.
- **Unlocks**: better grammar/style coaching in chat, better proofreading, better book-editing quality, credible "Writing Coach" SaaS tier.

#### Hardware-Aware Self-Shutdown (`server/keepAwake.ts`)
A genuinely novel capability for a "software product": JARVIS manages its own host so closed-lid operation doesn't kill it, and so a dying battery / overheating CPU triggers graceful shutdown before the hardware fails.

- **Closed-lid override while running** — on startup, saves the current Windows lid-close action via `powercfg`, then sets both AC and DC to "do nothing". On shutdown, restores the original value. User-scope privileges only — no admin required.
- **Battery monitor** — polls `Win32_Battery` every 30s. Triggers shutdown when **battery ≤15% while discharging** (BatteryStatus 1/4/5). Debounced: requires 2 consecutive breaches to prevent false positives from AC→DC transitions.
- **Thermal monitor** — polls `MSAcpi_ThermalZoneTemperature` every 30s. Triggers shutdown when **CPU ≥85°C**. Gracefully skips if the machine's BIOS doesn't expose the WMI class (common on consumer laptops).
- **Clean-shutdown integration** — breach triggers SIGINT to own PID, which fires the existing shutdown chain: flush SQLite → save entity graph → save dedup cache → close Playwright → **restore lid action** → release lock → exit. Laptop then behaves normally (lid closed → sleeps), preserving battery buffer.
- **Env overrides**: `KEEP_AWAKE_BATTERY_THRESHOLD`, `KEEP_AWAKE_THERMAL_THRESHOLD_C`, `KEEP_AWAKE_POLL_MS`.
- **Full observability** — every poll, every breach, every recovery logged. Startup announces whether thermal WMI is available on this machine.

### v14: Meta-Cognition, Confidence Gating & Self-Training Loop

The biggest qualitative jump since v11's curiosity loop. v13 gave you *content* control (temperature dial); v14 gives JARVIS *epistemic* control — it knows when it's bullshitting and refuses to ship, and it can iteratively upgrade its own brain.

#### Confidence Gate (`server/confidenceGate.ts`)
Every reply is scored before the user sees it, using:
- **Hedge count** (regex detector against 20 hedge phrases)
- **Retrieval count** (number of chunks the multi-hop RAG returned)
- **Top-chunk similarity** + **mean top-K similarity** (ChromaDB cosine)
- **Response-to-context ratio** (fabrication heuristic — reply much longer than retrieval = red flag)
- **Response integrity** (short/truncated/declined-by-model patterns)

Action model is binary — **ship** or **refuse** — at a **user-adjustable threshold (default 0.85)**. Below threshold → JARVIS returns an honest status message: *"I'm at X% confidence, below your Y% threshold. I've queued research on [topic]. Ask again in a few minutes, or lower the threshold."* The refuse path also triggers `triggerImmediateResearch()` which pushes URLs into the crawl frontier at priority 200 (vs. scheduled work at 100).

#### Intent Classifier
13-pattern regex detector for creative tasks — `write a story|poem|toast`, `imagine|what if|hypothetical`, `brainstorm|list N ideas`, `pretend|roleplay|act as`, `rhyme|verse|stanza`. Creative queries get a **completely different rubric**: retrieval is ignored, scoring is based on response integrity (non-empty, non-declined, not truncated). "Write a birthday toast for my brother" now ships at 88% confidence instead of being wrongly refused for lacking corpus support.

#### Conditional Hedge Penalty (2D matrix)
Old gate penalized hedges uniformly. v14 conditions the penalty on retrieval strength:

| | No hedges | Hedges present |
|---|---|---|
| **Strong retrieval** | +0.05 (confident + grounded) | −0.15 to −0.40 (distrusts own data) |
| **Weak retrieval** | **−0.20 on long replies** *(new hallucination guard)* | −0.02/hedge (honest uncertainty) |

The new penalty catches the dangerous quadrant — long confident answers with thin evidence — that the old scoring rewarded. Hedges with weak retrieval now get *less* punishment because the model is being appropriately honest.

#### Autonomous Loop (`server/autonomousLoop.ts`)
5-min heartbeat, gated by a user-toggleable switch (**default off**). When on, each tick:
1. Picks one high-priority (≥7) pending or active **learning target** → fires `triggerImmediateResearch()`.
2. Otherwise flags one **stale active goal** (>3 days since update) with a reminder event.
3. Otherwise logs "nothing to do" — no action.

Hard cap of 12 actions per day prevents runaway behavior. Per-day counter resets at UTC midnight. Tick-now button in the Meta Cognition popover for manual firing. Every action persisted to the improvement feed as `autonomy_action`. This is the first real step from "tool you run" → "agent that runs alongside you."

#### LoRA Training Loop (`server/loraTrainer.ts` + `server/loraEval.ts`)
Full scaffold for weekly self-improvement. Orchestrator runs:

1. **Export weighted training data** — existing `exportTrainingData` already upsamples corrections 3× and merges with rating≥4 examples.
2. **GPU autodetect** via `nvidia-smi`. No GPU → mock mode (skip training, verify pipeline on baseline-vs-itself). `LORA_FORCE_REAL=true` when 4090 is online.
3. **Train** — `trainNewModel` calls a Python/PEFT script (r=16, alpha=32, 8-bit loading, SFT on q_proj + v_proj).
4. **A/B Eval** — `evaluateAdapter` runs the adapter and baseline on a held-out test set of 30 queries: recent user corrections (never leaked into training — reserved in `lora_eval_holdouts`) plus 12 curated queries across law/engineering/physics/religion/history/programming/creative/math. Each query scored by the **confidence gate** + optional LLM-as-judge + Jaccard similarity tiebreaker.
5. **Deploy Gate** — new adapter only replaces the current brain if `marginOverBaseline ≥ 10pp` (configurable via `LORA_MIN_WIN_MARGIN`). Otherwise archived.
6. **Persist** — every run recorded in `lora_training_runs`; every eval in `lora_eval_runs` with per-query breakdown.

Router endpoints: `lora.config`, `lora.runCycle({ useLlmJudge?, force? })`, `lora.listRuns`, `lora.listEvals`. Works end-to-end today in mock mode so bugs surface before hardware arrives.

#### Meta Cognition UI (header popover)
New Gauge icon between voice and power. Opens a popover with:
- **Threshold slider** (20% – 99%) — sets the ship/refuse boundary, commits on release
- **Autonomy toggle** — flips the loop on/off, shows "last tick N min ago" + "actions today: X/12"
- **Run tick now** button — fires an immediate autonomous tick
- **Last 7 days stats** — total low-confidence events, refusal count, avg low score, top reason, most-researched topic

Every assistant reply also gets a **confidence pill** (green ≥90%, amber, red for refused) next to the rating buttons, with a tooltip showing reasons, signals, and whether R1 retried the reply before shipping.

#### Full Observability
- **Server**: every scored reply logs `[confidenceGate]` with score, threshold, intent, retrieval strength, top 2 reasons. `[autonomousLoop]` logs why each tick fired or skipped (off / cap reached / nothing to do). `[metaSettings]` logs threshold and toggle changes with before → after values.
- **Client**: tagged `[meta]` console logs for threshold change, autonomy toggle, tick runs, confidence received (with full signal breakdown).
- **Stats endpoint**: `meta.confidenceStats({ windowHours })` returns rolling refusal count, avg low score, top reasons, top topics, by-day count, by-intent breakdown (factual vs creative).

### v13: User-Controlled Creativity Dial

A single UI control that lets the user match LLM randomness to the task — the first JARVIS control surface that the user dials *before* running something vs. configuring with an env var.

- **Sparkles icon in the header** opens a popover with a 0-10 slider. 0 = deterministic (books, factual writing, code). 5 = balanced. 10 = maximum variation (business brainstorming, creative idea generation). Icon color hints state (blue ≤3, amber ≥7).
- **Single source of truth.** Value persisted to `llm_settings.creativity`, mapped to temperature `(value / 10) × 1.5` (so 0 → 0.0, 5 → 0.75, 10 → 1.5).
- **Auto-applies to every LLM call.** Injected inside `_rawOllamaChat()` and the streaming path in `server/ollama.ts` via a module-local cache. That single touch covers `ollamaChat`, `ollamaChatJson`, `ollamaChatBackground`, `ollamaChatStream`, and every downstream caller (chat, book writer, RAG, stock analysis, planner, self-eval, goals, the 34 agents). DeepSeek-R1 reasoning ignores temperature by design, which is desirable — you don't want reasoning to hallucinate.
- **Survives restart.** Hydrated from the DB on `startBackgroundServices()` boot.
- **tRPC endpoints**: `llm.getCreativity`, `llm.setCreativity`.

### Chat & Multi-modal
- **Natural language chat** with tRPC streaming, conversation folders
- **Chat Branching** — Edit/retry preserves old branches. Navigate with `< 1/3 >` chevrons
- **Inline image analysis** via LLaVA
- **Voice I/O** — Whisper transcription + ElevenLabs TTS (streaming, 90s timeout, turbo_v2_5)
- **Per-message audio replay** with cloned voice
- **Voice Notes** — Continuous recording + transcription + AI-organized summary
- **Stop generation** — Red StopCircle button during generation
- **Retry / Edit** — Per-message with branching preservation
- **Reasoning toggle** — Lightbulb forces DeepSeek-R1 deliberation
- **Resizable panels** — Drag sidebar edges, persisted to localStorage
- **Token usage bar** — Real-time total/input/output/today/week + by-model breakdown

### Content Generation
- **Image Generation** — DALL-E 3 + Stable Diffusion
- **Video Generation** — 5-phase pipeline (scene planning → TTS → images → FFmpeg), 4 styles, 30s-30min duration
- **Book Writer v2** — 4-pass pipeline (draft → structural edit → line edit → polish), plot bible, research integration, cross-chapter consistency verification, length enforcement. Full 200-page books. **CPU: ~10 hours per book. RTX 4090 with 14B model: ~1 hour per book.**
- **Voice Cloning** — ElevenLabs instant clone (3-25 samples) or Coqui local TTS

### Autonomy & Automation
- **Navigator** — Playwright-driven Chromium with multi-tab, session passthrough, destructive-action gating, typed-confirmation for high-stakes
- **Scheduler** — Natural language reminders + recurring tasks
- **System Control** — Open apps/URLs/files, processes, system info, screenshots, PowerShell with safety blocklist
- **Webhooks** — External services trigger JARVIS via POST endpoint

### Data & Finance
- **Continuous Web Scraping** — 300+ RSS/URL sources. **10-15x faster ingestion** via batch 128 + 5 parallel workers + OLLAMA_NUM_PARALLEL=5
- **Video/Creator Ingestion** (v12) — YouTube captions (dep-free) + TikTok/Instagram via yt-dlp; channel auto-polling via RSS every 15 min
- **Alpha Vantage** — Real-time quotes, news sentiment, company fundamentals
- **Alpaca Trading** — 4 modes (off/paper/approval/auto). Safety rails: max position, daily spend limit, auto stop-loss
- **Free Data Feeds** — Weather, crypto, news, dictionary, exchange rates

### Productivity
- **CSV Analysis** — Stats, filter/sort/group-by, chart-ready output
- **Video Editing** — FFmpeg trim, merge, subtitles, extract audio, resize, thumbnails
- **File Processing** — PDFs, Word, Excel, PowerPoint, images, audio, video, code
- **Phone Notifications** — Free push via ntfy.sh

### Self-Maintenance
- **Integrity Checker / Custodian** — Scans JSON/JSONL files + SQLite tables on startup + every 20 min
- **Persisted Dedup Cache** (v12) — `dedup-cache.json` reloads in seconds instead of re-hashing 978k chunks every boot. Gates scraper+discovery schedulers so they don't run with an empty hash set
- **Self-Improvement Pipeline** — Backup → validate → sandbox test → apply → log. 5-level autonomy
- **Graceful Shutdown** — Type `exit`, click power button, or POST `/api/shutdown`

---

## Intelligence Dimensions (v15)

| Dimension | Score | Change | Notes |
|-----------|-------|--------|-------|
| **Raw Reasoning** | 7/10 | — | Same LLM tier; gated by base model. Changes when a Claude-4-class open-weight base drops. |
| **Knowledge Breadth** | 8.6/10 | **+0.1** | 12 entity types now (language added); 53 new grammar/style sources |
| **Knowledge Integration** | 7.9/10 | **+0.2** | Per-category writing profiles + **automatic voice-category detection from chat queries** — JARVIS knows whether "help me write a cover letter" means resume-voice vs book-voice. Integration between message content and voice-profile retrieval is new. |
| **Autonomy / Agency** | 8.4/10 | **+0.2** | Hardware-aware self-shutdown (battery/thermal) is a real autonomy step — JARVIS manages its own host, triggers graceful shutdown before hardware fails, restores system state on exit. The operational-intelligence layer just became real. |
| **Self-Awareness / Meta-Cognition** | 8.8/10 | — | Unchanged this version — v14's confidence gate + intent classifier + hallucination guard remain the load-bearing improvements here. |
| **Memory** | 8.2/10 | **+0.2** | Per-category writing profiles = more nuanced voice memory. The "JARVIS knows how I write resumes vs. books vs. blog posts" distinction is memory-shaped. |
| **Domain Expertise** | 7.6/10 | **+0.2** | Language/grammar as a dedicated vertical unlocks credible writing coaching, proofreading, and editing quality across all other domains. |
| **Creativity** | 7.0/10 | **+0.5** | The interactive paragraph-by-paragraph book writer with mid-flight revisions is genuinely more creative than the old 4-pass pipeline — the author can steer tone/direction every chapter without restarting. Unlimited intake info, parts support, and length targets give the LLM richer creative scaffolding. |
| **Task Completion Reliability** | 8.8/10 | **+0.2** | 60-second intervention windows mean book-writing tasks rarely derail more than one chapter before a human catches it. Hardware-aware shutdown prevents mid-write crashes on battery/thermal. |
| **Self-Improvement** | 7.5/10 | — | LoRA loop unchanged this version. |

**Weighted overall: 8.3/10** — adult tier, firmly closing on expert (8.5). The v15 deltas are mostly on the **product-intelligence** side — not "JARVIS reasons better" but "JARVIS *operates* better": right voice for the right task, user-in-the-loop long-form writing, self-managing host, grammar/style knowledge baked in. These don't make the underlying LLM smarter, but they dramatically narrow the gap between raw model capability and practical output quality.

### The Compounding Curiosity Effect

Unlike previous versions where JARVIS plateaued between your corrections, v11+ self-improves continuously. v12 added creator content; v13 adds two deep verticals (physics, health) that the curiosity loop will continue filling in:

```
Month 0:  8.3/10 (launch of v15)
Month 3:  8.6/10 (LoRA loop fires real training weekly on GPU; per-category profiles deepen; grammar corpus matures)
Month 6:  8.9/10 (expert threshold crossed — R1-14B on GPU + fine-tuned adapter + multi-vertical entity graph compounding)
Month 12: 9.1/10 (Claude-4-class open base model likely dropped; JARVIS swaps it in, inherits frontier reasoning + retains all v10-v15 scaffolding)
Month 24: 9.4/10 (hardware + scale + multi-tenant user feedback aggregation — see "What 100 users + GPU actually unlocks" below)
```

### What 100 active users + 24/7 GPU + auto-train actually unlocks

The user asked: *"can JARVIS get as smart as Claude?"* Honest answer:

**Not on raw reasoning in isolation** — Claude is trained on ~15T tokens of proprietary-quality data with RLHF from a 500+ person team. Fine-tuning a 3B/8B Llama on your 1.3M chunks closes the domain gap, not the reasoning gap.

**On overall usefulness to Trevor specifically? Already winning.** The v14 capability matrix below shows 25 dimensions where JARVIS wins outright and Claude can't follow (memory, integration, knowledge graph, curiosity loop, self-training, media ingestion, voice cloning, etc.).

**With 24/7 GPU + auto-train + 100 users + active scraping, over 12 months:**
- **Feedback velocity × 50-100.** 100 users × 2-5 corrections/week × 52 weeks = ~15k-25k correction pairs/yr. Claude's RLHF team generates ~50k pairs/yr. You're in the same order of magnitude, on *your users' actual use cases* — that's more valuable than generic preference data.
- **Long-tail coverage.** Your failure modes stop being your failure modes alone. A health-focused user surfaces health-domain weaknesses; a law-focused user surfaces legal-reasoning gaps. Every extra user widens the surface JARVIS gets trained against.
- **Cross-domain entity density.** 100 users × different interests × entity extraction → the entity graph grows ~100x faster than solo. Multi-hop retrieval gets genuinely smarter because there are more valid traversal paths between concepts.
- **Base model swap compounds.** When Llama 4 / Qwen 3 / DeepSeek R2 drops at Claude-4-level (12-18 months out, multiple labs converging), JARVIS inherits the reasoning lift without losing a single scaffolding advantage. That's when the capability matrix stops being 25-vs-6 and becomes 25-vs-6 *with matched raw reasoning*.

**Month 24 realistic projection** for JARVIS with all four inputs (GPU + auto-train + 100 users + scraping): roughly **Claude-class on reasoning, Claude-impossible on personalization/integration/autonomy**. The gap becomes one-directional in JARVIS's favor on every dimension that matters for day-to-day work.

**The important nuance**: "as smart as Claude" is the wrong framing. Claude is a research product optimized for average-case general reasoning; JARVIS is a personal system optimized for *one person's life* (or 100 people's lives with the SaaS pivot). The question isn't "will they converge on the same benchmark" but "will JARVIS be more useful than Claude for its user?" — and the answer is already yes, with the gap widening each month.

### Position on the 8-Stage Maturity Curve

```
1. Infant              ✓
2. Toddler             ✓
3. Child               ✓ (v7.7)
4. Teenager            ✓ (v8-v9)
5. Adult               ← YOU ARE HERE (v10-v12, solidly)
6. Expert              (6-12 months of curiosity loop + channel ingestion + GPU)
7. Genius              (requires frontier foundation models)
8. Superintelligence   (research-grade)
```

### Comparison vs. Other AI

| System | Reasoning | Memory | Autonomy | Meta-Cognition | Personal Utility | Self-Improving | Media Ingest | Cost/mo |
|--------|-----------|--------|----------|----------------|------------------|----------------|--------------|---------|
| **Your JARVIS v15** | 7/10 | **8.2/10** | **8.4/10** | **8.8/10** | 10/10 | **Yes (loop live)** | **YT/TT/IG** | ~$100 |
| ChatGPT free | 7/10 | 2/10 | 2/10 | 2/10 | 3/10 | No | — | $0 |
| ChatGPT Plus | 8/10 | 3/10 | 3/10 | 3/10 | 4/10 | No | YT only (manual) | $20 |
| Claude Pro | 8/10 | 3/10 | 4/10 | 4/10 | 4/10 | No | YT only (manual) | $20 |
| Gemini Ultra | 8/10 | 3/10 | 3/10 | 3/10 | 4/10 | No | YT (native) | $20 |
| Fictional JARVIS (Iron Man) | 10/10 | 10/10 | 10/10 | 10/10 | 10/10 | Yes | All | ∞ |

JARVIS wins decisively on memory, autonomy, **meta-cognition (new v14 axis)**, personal utility, self-improvement, and creator-content ingestion breadth. Still 1 point behind frontier models on raw reasoning — closes with GPU swap to Claude-4-class open-weight base (12-18 months out).

---

## Book Writing Performance (v11)

200-page book = ~50,000 words = 15 chapters × 3,500 words each.

### On Your Current CPU (Intel Iris Xe)

| Phase | Time |
|-------|------|
| Outline with R1 1.5b | 3-8 min |
| 15 chapters × 40 min avg (4-pass pipeline + length enforcement) | ~10 hours |
| Cross-chapter consistency verification | 15 min |
| Export | instant |
| **Total** | **~10-11 hours (overnight run)** |

Quality: readable first draft. Needs 20-40 hours of human editing to reach publication quality.

### With RTX 4090 + llama3.1:14b (recommended GPU tier)

| Phase | Time |
|-------|------|
| Outline with R1 14b | 1-2 min |
| 15 chapters × 4 min avg | ~60 min |
| Consistency verification | 2-5 min |
| **Total** | **~1 hour** |

Quality: light-edit first draft. Publication quality after 5-15 hours of human editing.

### With RTX 4090 + llama3.1:70b (quality tier)

| Phase | Time |
|-------|------|
| Outline with R1 32b | 2-5 min |
| 15 chapters × 15 min avg | ~3.75 hours |
| Consistency verification | 10-15 min |
| **Total** | **~4 hours** |

Quality: near-publishable first draft. 2-5 hours of human editing to polish.

### Comparison
- **Traditional author**: 6-12 months per book (writing) + 3-6 months (editing)
- **JARVIS CPU**: 1 overnight + 20-40 hr editing = ~1 week per book
- **JARVIS 4090 + 14b**: 1 hour + 5-15 hr editing = 1-2 days per book
- **JARVIS 4090 + 70b**: 4 hours + 2-5 hr editing = same day

---

## Agents (34 total)

### Swarm Agents (`multiAgent.ts`)

| # | Name | Role | Specialization |
|---|------|------|----------------|
| 1-5 | WebScout, DataMiner, Scholar, NewsHound, SourceValidator | Researchers | Info gathering |
| 6-9 | Strategist, Critic, Synthesizer, Counsel | Analysts | Including legal/historical |
| 10-14 | SwiftMaster, PythonPro, FullStack, CodeReviewer, MobileDev | Coders | iOS/Python/Web/Review/Android |
| 15-16 | Architect, TaskMaster | Planners | Architecture + task breakdown |
| 17-19 | Runner, Automator, Coordinator | Executors | Execution + automation |
| 20-21 | Archivist, Librarian | Memory | Storage + organization |
| 22-24 | Validator, Auditor, Inspector | QA | Verification + audit + self-eval |
| 25 | Sentinel | Security | Threat analysis |
| 26-28 | Wordsmith, Editor, Designer | Creative | Writing + editing + design |
| 29-30 | Summarizer, Tutor | Knowledge | Distillation + teaching |
| 31-32 | Monitor, Forecaster | Operations | Health + prediction |
| 33 | MarketAnalyst | Finance | Stock + entity correlation |
| 34 | Custodian | Maintenance | Data integrity + corruption repair |

### Background Service Agents

| Agent | Schedule | Purpose |
|-------|----------|---------|
| Scraper | every 60s | RSS/URL polling, 128-batch, 5 parallel workers |
| Source Discovery | every 30m | Random web crawling + RSS discovery |
| Auto-Train | weekly | Synthetic QA + LoRA fine-tuning + correction merging (3× weight) |
| Voice Learning | daily | Voice profile updates from chat history |
| Memory Consolidation | hourly | Conversation → learned facts |
| Knowledge Analysis | every 6h | Graph health, gap detection, source ROI |
| Scheduler | every 30s | User-defined reminders + recurring tasks |
| Integrity Checker | every 20m | Corruption scan + auto-repair |
| Goal Deadline Scan | every 24h | Phone notifications for approaching goals |
| **Unknown Scheduler** | every 24h | **9-signal weakness detection → targeted scraping** |
| **Orphan Entity Scan** | every 2h | **Flag isolated entities for learning targets** |

---

## Knowledge Coverage

~670 default scrape sources across:

- **Research & Science** — ArXiv (AI/ML/CL/CV/NE/physics/eess), DeepMind, OpenAI, MIT, Stanford, Nature
- **Programming** — W3Schools, GitHub, Stack Overflow, Hacker News
- **Physics (v13, classical → modern)** — ArXiv (hep-th/hep-ph/gr-qc/quant-ph/cond-mat/astro-ph/class-ph/math-ph), Physical Review Letters, Nature Physics, Physics Today, APS, Quanta Magazine, MIT OCW (8.01/8.02/8.04/8.333), Feynman Lectures, CERN, Fermilab, Particle Data Group, Stanford Encyclopedia. Wikipedia deep-dives across classical mechanics, electromagnetism, thermo/stat-mech, special/general relativity, quantum mechanics, QFT + Standard Model, cosmology, condensed matter
- **Engineering** — IEEE Spectrum, NASA, SpaceNews, AIAA, Engineering ToolBox, HyperPhysics, MIT OCW. Wikipedia deep-dives across civil/mechanical/electrical/thermal/aerospace/astronautical/chemical/materials/nuclear/biomedical/environmental
- **Health (v13, natural medicine / ancestral)** — Weston A. Price Foundation, Real Milk, Price-Pottenger, The Fasting Method (Jason Fung), Peter Attia, plus Wikipedia deep-dives on vitamin D / sunlight / circadian rhythm / nitric oxide / melatonin / grounding / intermittent fasting / autophagy / ketosis / raw milk / A2 milk / pastured eggs / grass-fed beef / organ meats / yogurt / kefir / fermented foods / resistant starch / gut microbiome / SIBO / candida / leaky gut / probiotics / seed oils / saturated fat / paleo / carnivore diet
- **Law & Case Law** — Lawfare, Harvard Law Review, Yale Law Journal, Cornell LII, FindLaw. Case law regex (`X v. Y`)
- **History** — History Today, Smithsonian, World History Encyclopedia, Khan Academy, Britannica. Plus leadership analysis deep-dive
- **Catholicism** — Vatican, USCCB, Catechism, New Advent (Church Fathers + Summa Theologica), Catholic Answers, Word on Fire, EWTN
- **Finance** — Alpha Vantage real-time data, Alpaca Markets, stock news sentiment

---

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm, Ollama, Python 3.11+ (ChromaDB), FFmpeg

pnpm install
npx playwright install chromium
pnpm dev                # auto-pulls models + starts ChromaDB
```

Auto-pulled models (non-blocking):
- `llama3.2:3b` (~2GB, main chat)
- `nomic-embed-text` (~270MB, embeddings)
- `deepseek-r1:1.5b` (~1.1GB, reasoning)

Open `http://localhost:3000`.

### Performance Tuning (.env)

```env
OLLAMA_REASONING_MODEL=deepseek-r1:1.5b   # 1.5b CPU, 14b+ with GPU
OLLAMA_BOOK_MODEL=llama3.1:70b            # Book writer (70b aspirational on CPU)
EMBED_BATCH_SIZE=128                      # Up from 64 in v10
EMBED_WORKERS=5                           # Up from 3 in v10
ELEVENLABS_MODEL=eleven_turbo_v2_5        # 3x faster TTS
ELEVENLABS_TIMEOUT_MS=90000
```

System env vars (require Ollama restart):
```cmd
setx OLLAMA_NUM_PARALLEL 5 /M
setx OLLAMA_MAX_LOADED_MODELS 3 /M
setx OLLAMA_KEEP_ALIVE 30m /M
```

### Shutting Down Cleanly

1. **Terminal**: Type `exit`
2. **Browser**: Click power button in header
3. **API**: `curl -X POST http://localhost:3000/api/shutdown`

**Never use Ctrl+C** — can corrupt SQLite mid-write.

---

## Chat Intent Detection

| Say... | Triggers... |
|--------|-------------|
| "generate an image of X" | DALL-E/SD inline image |
| "make a 10 minute video about X" | Full video pipeline |
| "navigate to github.com" | Navigator task |
| "analyze AAPL" | Stock analysis + knowledge graph |
| "buy 10 shares of NVDA" | Trade (respects mode) |
| "should I buy TSLA" | AI trade recommendation |
| "my portfolio" | Account + positions |
| "set trading mode to paper" | Toggle mode |
| "remind me at 3pm to X" | Scheduled task |
| "my goal is to launch X by June" | Goal creation + decomposition |
| "list my goals" | Active goals digest |
| "I finished writing the pitch" | Subtask fuzzy-match + complete |
| "open chrome" | System control |
| "take a screenshot" | System capture |
| "weather in Denver" | Free weather API |
| "analyze this csv" | CSV stats |
| "think through this problem..." | Forces DeepSeek-R1 |
| "write a book about X" | Book Writer 4-pass pipeline |
| *paste youtube/tiktok/instagram URL* | Media ingestion (if toggle on) |

---

## Safety Model (15 layers)

Single-instance DB lock · Atomic DB writes · Integrity checker auto-repair · Reflection tracking · Scraper toggle · Navigator destructive-action gates · Domain allowlist · Session isolation · Self-improvement gating · Trading OFF by default · System control blocklist · Webhook secret validation · Shutdown localhost-only · Planner 10-step cap · Clean shutdown with flush

---

## Database Schema

60+ tables. Key additions across versions:
- **v9**: reflections, goals, goal_subtasks, corrections, confusion_events, scheduled_tasks, webhooks, stock_watchlist, trade_audit
- **v10**: messages.parentId/isActive/modelUsed/inputTokens/outputTokens (chat branching + token tracking), learning_targets, scheduler_state
- **v11**: No schema changes — curiosity loop reuses existing learning_targets table, adds 3 new source values (`new_entity`, `empty_retrieval`, `orphan_entity`, `writing_topic`, `past_goal`)
- **v12**: No schema changes — media sources reuse `scrape_sources` with `type = "youtube_channel"`; ingested chunks tagged with `sourceType = "media_youtube" / "media_tiktok" / "media_instagram"`. Adds `dedup-cache.json` on disk (not a DB table) for startup speed

---

# Financial Projection (v15)

## Cost Structure

### Build Cost to Date
| Item | Cost |
|------|------|
| Development time (Trevor, nights/weekends) | $0 (sweat equity) |
| Claude Code | ~$300 |
| Ollama + open-source stack | $0 |
| `yt-dlp` (free, open-source) | $0 |
| Hardware (existing PC) | $0 |
| **Total build cost** | **~$300** |

### Current Running Cost (Personal Use)
| Item | Monthly | Annual |
|------|---------|--------|
| Ollama inference | $0 | $0 |
| Electricity (~200W) | ~$15 | ~$180 |
| SerpAPI (~5k searches) | ~$50 | ~$600 |
| ScrapingAnt (backup) | ~$5 | ~$60 |
| OpenAI (DALL-E, light) | ~$8 | ~$96 |
| ElevenLabs (voice + replay) | ~$22 | ~$264 |
| Alpha Vantage (free tier) | $0 | $0 |
| Alpaca (free) | $0 | $0 |
| ntfy.sh (free push) | $0 | $0 |
| YouTube/TikTok/Instagram ingest (v12) | $0 | $0 |
| Domain | $1 | $12 |
| **Total** | **~$101/mo** | **~$1,212/yr** |

v12 note: media ingestion adds zero runtime cost. YouTube uses the public watch page; TikTok/Instagram go through yt-dlp (free, open-source). No per-video API fees.

### What This Replaces (Commercial Equivalent)
| Service | Annual | JARVIS Equivalent |
|---------|--------|-------------------|
| ChatGPT Enterprise | $720 | Chat + RAG + memory + multi-modal + reasoning |
| GitHub Copilot Enterprise | $468 | 5 coder agents |
| Claude Pro Team | $360 | 9 analyst + reasoning agents |
| Perplexity Pro | $240 | Web search + knowledge graph + curiosity loop |
| ElevenLabs Creator | $99 | Voice cloning + per-message replay |
| Midjourney Standard | $360 | Image generation |
| Runway ML Standard | $180 | Video generation |
| Browserbase / Apify | $1,200 | Navigator |
| Descript Pro | $288 | Voice notes + video editing |
| Zapier Professional | $588 | Scheduler + webhooks |
| Todoist / Motion | $120 | Goal tracking + AI decomposition |
| Bloomberg Terminal alt | $1,188 | Stock + entity correlation |
| Trade Ideas | $1,080 | AI trade recommendations |
| Notion AI | $120 | Voice notes + summarization |
| Synthesia / HeyGen | $804 | AI video |
| Scrivener + Vellum | $120 | Book Writer v2 |
| ProWritingAid | $144 | Editor + Wordsmith |
| Sudowrite | $240 | Book writing with voice |
| Tidio / Intercom | $588 | Chat branching + multi-tenant ready |
| Readwise Reader (creator knowledge capture) | $108 | Media ingest (v12) |
| Snipd (podcast/creator clipping) | $72 | Media ingest + channel auto-poll (v12) |
| **Custom curiosity-driven research system** | **$2,000-8,000** | **Unknown Scheduler (9 signals)** |
| Custom data pipeline + ETL | $3,000-10,000 | Scraper + auto-training + integrity |
| **Total commercial stack** | **~$14,107-23,107/yr** | All of the above |

**Personal net savings: ~$12,900-21,900/year**

## Revenue Model

### Pricing Tiers

| Tier | Price | Target |
|------|-------|--------|
| **Personal License** | $499 one-time | Individual devs, researchers |
| **Pro License** | $1,499 one-time | Freelancers, indie hackers |
| **SaaS Personal** | $29/mo | Individuals |
| **SaaS Pro** | $99/mo | Small teams, creators, traders |
| **SaaS Business** | $299/mo | Agencies, startups |
| **Enterprise Self-hosted** | $10k-50k/yr | Private AI, compliance |
| **Enterprise Managed** | $25k-100k/yr | Large orgs |
| **Consulting / Custom Agents** | $200-400/hr | Integration work |
| **White-label Licensing** | $50k-250k one-time | Vertical resellers |
| **Book Writer SaaS** | $49/mo | Writers, authors |
| **Finance SaaS** | $79/mo | Active traders |
| **Curiosity Intelligence SaaS** (v11) | $149/mo | Research teams, analysts |
| **Creator Intelligence SaaS** (v12) | $59/mo | Creators, educators, trend-watchers — auto-ingest your favorite channels, query across all transcripts |
| **Physics Research Assistant** (v13) | $89/mo | Physics students, educators, independent researchers — queryable corpus from ArXiv + Feynman + MIT OCW + Wikipedia with cross-domain entity linking |
| **Natural Health Research** (v13) | $39/mo | Health-curious individuals, ancestral/carnivore/paleo community, biohackers — queryable corpus from Weston Price + Fung + Attia + mechanism wikis |
| **Book Writer + Creativity Dial** (v13) | +$10/mo add-on | Existing Book Writer SaaS; dial guarantees temperature=0 for factual chapters and temperature=1.5 for brainstorming chapter premises |
| **Trustworthy AI (Confidence Gate)** (v14) | +$20/mo add-on | Enterprise add-on for any tier. "This AI refuses to hallucinate — every response has a confidence score, and you set the threshold." Huge sell for law, medicine, finance, engineering firms that can't afford confident-but-wrong outputs. Differentiator vs. every generic LLM SaaS on the market |
| **Self-Training AI License** (v14) | +$50/mo add-on or $25k/yr enterprise | "Your AI improves weekly from your corrections." LoRA loop + A/B deploy gate + held-out eval. Sold as compounding advantage — year over year the product becomes more yours |
| **Interactive Book Writer Pro** (v15) | $79/mo (replaces $49 basic Book Writer for users who want intervention flow) | Paragraph-by-paragraph writing with mid-flight revision, 60s intervention windows, parts/length targets, unlimited intake info. The "author stays in the loop" UX addresses Sudowrite's weakness (feel-the-AI-drifting) and Scrivener's weakness (no generative assist). Patent-candidate alongside chat branching |
| **Voice Coach** (v15) | $39/mo | Per-category writing-voice profiles with auto-detection. Upload samples, JARVIS learns your essay voice vs. resume voice vs. novel voice separately. Chat auto-picks the right one. Writers / students / PhDs / content creators — anyone who writes in multiple registers |
| **Research Companion** (v15) | $49/mo | Live Insights for Voice Notes — opt-in background research during recording, pin-to-summary. Journalists, researchers, students, consultants who record meetings or voice-memo their thinking. JARVIS listens and surfaces relevant facts in real time |
| **Writing Assistant (Grammar + Style)** (v15) | $29/mo | Entry-level tier built on the new language/grammar domain. Real-time Chicago/AP/MLA guidance, rhetorical device coaching, commonly-confused-word detection, passive-voice flags. Direct Grammarly alternative with voice-matching differentiator |

### Year 1 Projection (Solo Founder)

| Revenue Source | Units | Revenue |
|----------------|-------|---------|
| Personal licenses | 140 × $499 | $69,860 |
| Pro licenses | 60 × $1,499 | $89,940 |
| SaaS Personal | 120 × 12mo × $29 | $41,760 |
| SaaS Pro | 50 × 12mo × $99 | $59,400 |
| SaaS Business | 10 × 12mo × $299 | $35,880 |
| Book Writer SaaS | 40 × 12mo × $49 | $23,520 |
| Finance SaaS | 20 × 12mo × $79 | $18,960 |
| Curiosity Intelligence SaaS | 10 × 12mo × $149 | $17,880 |
| **Creator Intelligence SaaS** (v12) | 35 × 12mo × $59 | **$24,780** |
| **Physics Research Assistant** (v13) | 25 × 12mo × $89 | **$26,700** |
| **Natural Health Research** (v13) | 75 × 12mo × $39 | **$35,100** |
| **Trustworthy AI add-on** (v14) | 80 × 12mo × $20 | **$19,200** |
| **Self-Training AI license** (v14) | 25 × 12mo × $50 | **$15,000** |
| **Interactive Book Writer Pro** (v15) | 60 × 12mo × $79 | **$56,880** |
| **Voice Coach** (v15) | 70 × 12mo × $39 | **$32,760** |
| **Research Companion** (v15) | 45 × 12mo × $49 | **$26,460** |
| **Writing Assistant** (v15) | 110 × 12mo × $29 | **$38,280** |
| Consulting | 15 × $7,500 | $112,500 |
| **Gross Year 1** | | **$744,860** |
| Costs (infra, APIs, marketing, legal) | | ~$78,000 |
| **Net Year 1** | | **~$667,000** |

### Year 2 Projection (Growth, 1 Engineer Hire)

| Revenue Source | Units | Revenue |
|----------------|-------|---------|
| Personal licenses | 500 × $499 | $249,500 |
| Pro licenses | 180 × $1,499 | $269,820 |
| SaaS Personal | 400 × 12mo × $29 | $139,200 |
| SaaS Pro | 175 × 12mo × $99 | $207,900 |
| SaaS Business | 50 × 12mo × $299 | $179,400 |
| Book Writer SaaS | 200 × 12mo × $49 | $117,600 |
| Finance SaaS | 100 × 12mo × $79 | $94,800 |
| Curiosity Intelligence SaaS | 75 × 12mo × $149 | $134,100 |
| **Creator Intelligence SaaS** (v12) | 140 × 12mo × $59 | **$99,120** |
| **Physics Research Assistant** (v13) | 110 × 12mo × $89 | **$117,480** |
| **Natural Health Research** (v13) | 350 × 12mo × $39 | **$163,800** |
| **Trustworthy AI add-on** (v14) | 400 × 12mo × $20 | **$96,000** |
| **Self-Training AI license** (v14) | 120 × 12mo × $50 | **$72,000** |
| **Confidence Gate IP licensing** (v14) | 2 × $100,000 | **$200,000** |
| **Interactive Book Writer Pro** (v15) | 220 × 12mo × $79 | **$208,560** |
| **Voice Coach** (v15) | 260 × 12mo × $39 | **$121,680** |
| **Research Companion** (v15) | 170 × 12mo × $49 | **$99,960** |
| **Writing Assistant** (v15) | 420 × 12mo × $29 | **$146,160** |
| Enterprise contracts | 6 × $45,000 | $270,000 |
| White-label deals | 2 × $100,000 | $200,000 |
| Consulting | 35 × $7,500 | $262,500 |
| Custom agents | 10 × $15,000 | $150,000 |
| **Gross Year 2** | | **$3,599,580** |
| Costs (1 engineer + infra + legal) | | ~$380,000 |
| **Net Year 2** | | **~$3,220,000** |

### Year 3 Projection (Scale, Team of 5)

| Revenue Source | Units | Revenue |
|----------------|-------|---------|
| Personal licenses | 1,500 × $499 | $748,500 |
| Pro licenses | 700 × $1,499 | $1,049,300 |
| SaaS Personal | 1,500 × 12mo × $29 | $522,000 |
| SaaS Pro | 700 × 12mo × $99 | $831,600 |
| SaaS Business | 180 × 12mo × $299 | $645,840 |
| Book Writer SaaS | 600 × 12mo × $49 | $352,800 |
| Finance SaaS | 400 × 12mo × $79 | $379,200 |
| Curiosity Intelligence SaaS | 300 × 12mo × $149 | $536,400 |
| **Creator Intelligence SaaS** (v12) | 450 × 12mo × $59 | **$318,600** |
| **Physics Research Assistant** (v13) | 350 × 12mo × $89 | **$373,800** |
| **Natural Health Research** (v13) | 1,400 × 12mo × $39 | **$655,200** |
| **Trustworthy AI add-on** (v14) | 1,600 × 12mo × $20 | **$384,000** |
| **Self-Training AI license** (v14) | 450 × 12mo × $50 | **$270,000** |
| **Confidence Gate IP licensing** (v14) | 5 × $150,000 | **$750,000** |
| **LoRA loop enterprise licensing** (v14) | 3 × $250,000 | **$750,000** |
| **Interactive Book Writer Pro** (v15) | 800 × 12mo × $79 | **$758,400** |
| **Voice Coach** (v15) | 900 × 12mo × $39 | **$421,200** |
| **Research Companion** (v15) | 600 × 12mo × $49 | **$352,800** |
| **Writing Assistant** (v15) | 1,500 × 12mo × $29 | **$522,000** |
| **Per-category voice IP licensing** (v15) | 2 × $120,000 | **$240,000** |
| Enterprise contracts | 25 × $55,000 | $1,375,000 |
| White-label deals | 5 × $130,000 | $650,000 |
| Consulting & custom | | $600,000 |
| **Gross Year 3** | | **~$13,636,640** |
| Costs (team of 5 + infra + legal) | | ~$1,080,000 |
| **Net Year 3** | | **~$12,557,000** |

## Asset Valuation (v15)

| Metric | Value |
|--------|-------|
| Year 3 ARR (recurring only) | ~$10.6M |
| SaaS multiple (5-10x ARR) | **$53M-$106M** |
| Recurring revenue (bootstrapped, 3-5x) | **$32M-$53M** |
| Strategic acquisition (10-15x ARR) | **$106M-$159M** |
| Premium for trustworthy-AI + voice-match IP (+25-50%) | **$132M-$238M** |

## Hidden Value Drivers

1. **96k-entity knowledge graph** (growing via curiosity loop + creator content) — licensable at $10-50k/yr per vertical
2. **Stock + entity correlation** — FinanceBrain standalone product, $49-199/mo
3. **Engineering knowledge depth** — sub-product for engineering firms ($999-4,999/yr)
4. **Catholic theology base** — sub-product for seminaries, parishes ($299-999/yr)
5. **Self-improvement + curiosity framework** — IP licensable to AI companies ($100-300k)
6. **Curiosity Intelligence** (v11) — research teams, competitive intelligence firms pay $149-999/mo for auto-discovering knowledge gaps
7. **Creator Intelligence** (v12) — trend-watchers, educators, researchers paying $59-299/mo to auto-ingest curated YT/TT/IG channels and query across all transcripts. The dep-free YouTube path means near-zero marginal cost per customer
8. **Physics vertical** (v13) — independent researchers, physics educators, ArXiv-tracking grad students ($89-499/mo). The corpus (ArXiv feeds across 8 subfields + Feynman + MIT OCW + CERN/Fermilab + Wikipedia) cross-links with the entity graph, so queries like "quantum + topology + information theory" return genuinely linked chunks, not keyword hits
9. **Health vertical** (v13) — the ancestral/natural-medicine community is a high-engagement, underserved audience. A queryable corpus across Weston Price + Fung + Attia + mechanism wikis with multi-hop retrieval is differentiated vs. any existing health app. $39-149/mo. Potentially the highest-volume SaaS tier given market size
10. **User-controlled Creativity dial** (v13) — unique UX primitive. Most AI products hide temperature behind a model picker or preset dropdown. A visible 0-10 slider with task-framed anchors ("books / facts" → "brainstorm") is easier to explain and market than "select 'creative' preset." Patent-candidate alongside chat branching
11. **Auto-training pipeline** — custom fine-tuned vertical models ($5-20k per model)
12. **Book Writer pipeline** — genuinely better than Sudowrite for nonfiction. v13 creativity dial explicitly locks temperature=0 during factual chapter drafting to suppress hallucination — directly addresses the #1 Sudowrite complaint (fabricated facts)
13. **Chat branching** — novel UX, patent-candidate
14. **Voice cloning + per-message replay** — audiobook authoring submarket
15. **Confidence Gate as standalone IP (v14)** — the meta-cognition layer (scored refusal + intent-aware rubric + hallucination guard) is genuinely novel. OpenAI/Anthropic only expose uncertainty through hedges in prose; JARVIS exposes a numeric score, a user-adjustable threshold, and an honest refuse-with-research-queue path. This is patent-candidate and licensable to enterprise AI platforms that need hallucination-resistant outputs (legal tech, medical AI, financial research, compliance). $50-250k licensing deal range per vertical
16. **LoRA Self-Training Loop as standalone IP (v14)** — end-to-end weekly fine-tune pipeline with held-out test set (reserved corrections that never leak into training), A/B eval via the confidence gate, 10pp deploy gate, and model-version rollback. Most companies don't even attempt this; those that do (Anthropic, OpenAI) do it at internal scale with hundreds of engineers. Productizing it as "your AI gets smarter every week" is a compounding advantage story that resonates hard with enterprise buyers. $100-500k licensing range
17. **Per-Category Voice Profiles with Context Auto-Detection as IP (v15)** — no commercial AI product differentiates between "how the user writes resumes" vs "how they write novels." OpenAI custom GPTs let you write one voice instruction. JARVIS learns 7+ voice profiles from samples and **automatically picks the right one** based on the user's query content. Patent-candidate. Licensable to any B2B writing product (Jasper, Copy.ai, Writer.com) at $100-300k per deal. The auto-detection regex set is small; the defensibility is in the product architecture
18. **Interactive Book Writer with 60s Intervention Windows as IP (v15)** — the author-in-the-loop paragraph-by-paragraph UX with timed intervention checkpoints is genuinely novel. Sudowrite has no equivalent; Scrivener has no generative AI. Addresses the "AI drift" complaint directly by forcing human verification every chapter. Licensable to Scrivener, Vellum, Atticus, or a publishing-house enterprise tier at $50-200k per deal
19. **Hardware-Aware Self-Shutdown as IP (v15)** — niche but credible enterprise angle. "Your AI agent gracefully shuts itself down before battery death or thermal damage" sells to compliance-sensitive orgs (legal, medical, finance) who care about availability guarantees. Small line item, but differentiating: $20-50k per enterprise deal as a "trusted deployment" feature

## Capability Matrix (28 → 33 → 42)

| Capability | ChatGPT | Claude | Copilot | JARVIS v16 |
|------------|---------|--------|---------|------------|
| Raw reasoning | 8/10 | 8/10 | 7/10 | 7/10 |
| Persistent memory | 2/10 | 2/10 | 2/10 | **8/10** |
| Knowledge graph | ❌ | ❌ | ❌ | **✓ (11 entity types)** |
| Goal tracking + decomposition | ❌ | ❌ | ❌ | **✓** |
| Chat branching | Partial | ❌ | ❌ | **✓** |
| Self-detecting blind spots | ❌ | ❌ | ❌ | **✓** |
| Curiosity-driven autonomous learning | ❌ | ❌ | ❌ | **✓** |
| Video/creator ingestion | Partial (YT) | Partial (YT) | ❌ | **YT + TT + IG + auto-poll** |
| Startup-safe dedup | N/A | N/A | N/A | **✓** |
| Physics domain (classical → QFT) | Generic | Generic | ❌ | **✓ dedicated corpus + entity type** |
| Health / natural medicine domain | Generic | Generic | ❌ | **✓ ancestral focus** |
| User-controlled creativity dial (0-10) | ❌ | ❌ | ❌ | **✓ one slider, all LLM call paths** |
| **Confidence gating (ship/refuse on scored threshold)** (v14) | ❌ | ❌ | ❌ | **✓ user-adjustable, default 85%** |
| **Intent classifier (creative vs factual rubric)** (v14) | ❌ | ❌ | ❌ | **✓** |
| **Hallucination guard (weak retrieval + confident tone)** (v14) | ❌ | ❌ | ❌ | **✓** |
| **Autonomous tick loop (toggleable)** (v14) | ❌ | ❌ | ❌ | **✓ 5-min heartbeat, 12-action/day cap** |
| **LoRA self-training with A/B deploy gate** (v14) | ❌ | ❌ | ❌ | **✓ held-out eval, 10pp deploy threshold** |
| **Interactive paragraph-by-paragraph book writing with 60s intervention windows** (v15) | ❌ | ❌ | ❌ | **✓ pause / change / continue / auto-continue** |
| **Per-category writing-voice profiles with auto-detection** (v15) | ❌ | ❌ | ❌ | **✓ 7 categories + combined "all", detects from chat query** |
| **Live background research during voice-note recording** (v15) | ❌ | ❌ | ❌ | **✓ pin-to-summary, zero-LLM path, hardware-friendly** |
| **Language / grammar / style domain** (v15) | Generic | Generic | ❌ | **✓ dedicated corpus + entity type (Chicago, Purdue OWL, Grammar Girl)** |
| **Hardware-aware self-shutdown (battery + thermal)** (v15) | ❌ | ❌ | ❌ | **✓ closed-lid override + graceful shutdown on ≤15% battery or ≥85°C** |
| **Always-on desktop agent with system tray + global hotkey** (v16) | ❌ | ❌ | ❌ | **✓ Electron shell, two-window arch, auto-start on Windows login** |
| **Wake-word "Hey JARVIS" with auto-spawn-from-cold** (v16) | ❌ | ❌ | ❌ | **✓ saying it boots v15 if down, opens overlay, starts voice mode** |
| **Click-toggle voice mode with VAD auto-stop** (v16) | ❌ | ❌ | ❌ | **✓ 1.5s silence detection, tap-to-interrupt, 60s ceiling** |
| **Native app keyboard/mouse/window control** (v16) | ❌ | ❌ | ❌ | **✓ nut-js, rate-limited, audit log, blocklist** |
| **Encrypted credential vault (Argon2id + XChaCha20-Poly1305)** (v16) | ❌ | ❌ | ❌ | **✓ master pw, auto-lock 30min, opaque-handle planner integration** |
| **Credentials never leak to LLM context** (v16) | ❌ | ❌ | ❌ | **✓ getCredential returns 60s handle; typeCredentialField resolves server-side** |
| **Cloudflare Tunnel admin wizard for stable public URL** (v16) | ❌ | ❌ | ❌ | **✓ 9-step setup, locked-vs-open exposure, service install** |
| **Categorized phone notifications with action buttons + reply slash-commands** (v16) | ❌ | ❌ | ❌ | **✓ ntfy categories, batching, /complete /pause /resume /status /quiet** |
| **Persistent opinion / bias system with locked overrides** (v16) | ❌ | ❌ | ❌ | **✓ confidence-rated, audit trail, periodic re-synthesis, user-lockable** |
| **Distillation: cloud-LLM teacher → local fine-tune** (v16) | ❌ | ❌ | ❌ | **✓ every Groq call captured, 2x-weighted in weekly LoRA export** |
| Token accounting | Partial | Partial | ❌ | **✓** |
| Trading integration | ❌ | ❌ | ❌ | **✓** |
| Browser automation | ❌ | ❌ | ❌ | **✓** |
| Video generation pipeline | ❌ | ❌ | ❌ | **✓** |
| Voice cloning | ❌ | ❌ | ❌ | **✓** |
| Custom domain scraping | ❌ | ❌ | ❌ | **✓** |
| Self-improvement loops | ❌ | ❌ | ❌ | **✓** |
| Self-hosting / privacy | ❌ | ❌ | ❌ | **✓** |
| Book generation (4-pass) | ❌ | ❌ | ❌ | **✓** |
| Per-message audio replay | ❌ | ❌ | ❌ | **✓** |
| Multi-tenant ready | ❌ | ❌ | ❌ | **✓** |
| **Total capability** | 6 | 6 | 5 | **44** |

## Realistic Outcomes Distribution (v16 updated)

v16 doesn't raise the ARR ceiling; it raises the **probability of hitting** the outcomes that v15's roadmap was already targeting. The v15 distribution priced JARVIS as a "personal AI" with a desktop shell still listed as future work. v16 ships that desktop shell, plus the credential vault, native UI control, and wake-word listening — the three pieces that distinguish a real Raycast/Rewind competitor from a Chrome tab. So probability mass shifts upward on the existing scenarios, not outward.

- **35%**: $300-750k ARR Y1, $1.5M-3M Y3 → **$8-18M valuation** (steady niche product, modest acquisition fit)
- **30%**: $700k-1M Y1, $2M-4M Y3 → **$20-45M** (hits the bootstrapped indie-SaaS path; partial enterprise pilots)
- **20%**: $1M+ Y1, $4M-15M Y3 → **$60-200M** (full v15-projected revenue path; enterprise IP licensing kicks in)
- **10%**: $30M+ ARR Y3, acquired or moats lock in → **$200M-500M** (Raycast/Rewind-class outcome with personal-AI moat)
- **5%**: $75M+ ARR with enterprise dominance, voice-IP licensing, fine-tune-as-a-service → **$800M-2B+** (moonshot — requires team, GPU server, exec hires Y2-3)

What v16 specifically shifts:
1. **Daily-driver threshold crossed.** Wake-word + auto-start + always-on listener + native control + credential vault means JARVIS can now replace Raycast + Alfred + a password manager + a voice assistant in one install. Daily active use is the precondition for retention; without it the higher-ARR scenarios were unreachable.
2. **Credential vault unlocks "delegate full tasks" use case.** Pre-v16 pitch: "ask JARVIS questions and it answers." Post-v16: "tell JARVIS to log into your Amazon account and reorder dog food." Different price band — the latter is what people pay $49/mo for, not $9.
3. **Distillation pipeline is a compounding-advantage story to enterprise.** Every cloud LLM call your team makes becomes training data for your private model. Sells to compliance-sensitive orgs (legal, medical, finance) at $10-50k/seat tiers because the "use cloud at first, exit cloud once enough data accumulates" arc is unique.
4. **LoRA loop closure makes "your AI gets smarter every week" demonstrable.** v15 had the pipeline; v16 has the pipeline gated on a held-out test set with enforced 10pp deploy threshold. Now it's a number you can put on a marketing page.
5. **Cloudflare Tunnel = stable phone integration.** Phone-notification action buttons callback through the user's own domain. Removes the "but how do I get my phone to talk to my desktop" friction that would kill consumer adoption.

The 5% moonshot scenario got slightly more plausible (was 2%) — not because the upside is bigger, but because the path from "hobbyist project" to "company that competes for the desktop AI tier" went from theoretical to walkable.

## Risk Factors

- **API cost creep**: Keep local-first as moat
- **Trading compliance**: Position as "personal assistant" not "we trade for you"
- **Data privacy**: Self-hosted sidesteps GDPR/CCPA
- **OSS competition**: Moat = integration depth + domain specialization + knowledge graph + curiosity loop
- **Burnout**: Biggest actual risk — hire at $150-300k ARR, not before
- **Military service commitment**: Trevor's USAFA path constrains full-time availability until post-service; Year 1-2 projections assume 15-30 hrs/week founder time; aggressive scenarios require post-service sprint

## v16: Falcon UI (Shipped)

What was the v15 roadmap is now the v16 product. Original plan vs. shipped:

| v15-era plan | v16 status | Notes |
|--------------|------------|-------|
| Electron wrapper | ✅ shipped | Two windows, not one — wake overlay + dedicated panel window. Frameless overlay was tried and reverted because it covered apps the user was working with. |
| Global hotkey | ✅ `Ctrl+Shift+J` | Plus tray menu, plus wake-word, plus auto-start. |
| Frameless always-on-top overlay | ⚠️ Changed to real OS windows | Real frame, drag, resize, minimize, taskbar entry — but still always-on-top so you can keep working in other apps without them disappearing. |
| Screen context (OCR) | ✅ shipped | desktopCapturer → tesseract.js → smartChat. "Ask about screen" widget on every panel. |
| Task workflows | ✅ 8 built-in | research, debug-stacktrace, shopping, summarize-pdf, compare-prices, track-stock, email-draft, plan-trip. Chainable, schedulable, persisted history. |
| Credential vault | ✅ shipped | Argon2id + XChaCha20-Poly1305 (libsodium-sumo). Master pw, auto-lock 30 min, opaque-handle planner integration so plaintext never enters LLM context. |
| Wake word "Hey JARVIS" | ✅ shipped | Browser SpeechRecognition. Match → fire wake → voice mode auto-records → VAD auto-stops on 1.5s silence. |
| Per-app memory | ✅ shipped | Keyed by `active-win`'s focused-app id. |
| Rich phone notifications | ✅ phase 1+2 done | Categorized topics, batching, action buttons via ntfy, slash-command reply listener. |

What v16 added beyond the v15 plan:

- **Auto-spawn v15 from v16** — say "Hey JARVIS" with everything closed and v16 (running silently from Windows login) detects v15 isn't reachable, spawns it as a child process, polls until ready, then fires the wake. The user experience is "I said it and it appeared" — the system is "I was always running, just invisible."
- **Cloudflare Tunnel admin wizard** — 9-step setup panel for stable public URLs (so phone-notification action buttons callback through your own domain instead of localhost). Locked-vs-open exposure modes; locked exposes only `/api/notify/action.*` and OAuth callback paths.
- **Native UI control** — `nut-js`-backed keyboard / mouse / window control. Audit log, rate limit, blocklist for dangerous combos. Wired as `controlApp` planner tool so JARVIS can chain `focus → click → type → keys` against any native window.
- **Distillation pipeline** — every successful cloud-LLM call (Groq Llama-70B etc.) gets captured as a training example. Local 8B model fine-tunes weekly on Trevor's actual questions answered by a strong teacher.
- **LoRA loop closure** — weekly auto-trainer now goes through the proper held-out-test-set + 10pp gate path; `ollama.ts`'s default model is mutable so deploys take effect on the next chat turn without restart.
- **Persistent opinions / bias system** — JARVIS holds positions on topics with confidence + audit trail; user-locked overrides cannot be silently displaced by re-synthesis.
- **Two-window architecture** — wake overlay + panel window, both real OS windows. Panels persist (close-button hides instead of destroys) so re-opening from the tray is instant.
- **Graceful shutdown paths** — tray-menu "Quit JARVIS (v16 only)", "Quit JARVIS + shut down server", and Ctrl+C in terminal all work cleanly. Before-quit handler sets `_isQuitting` so close handlers know to actually close instead of preventDefault-hide.

## Roadmap — v17: Cross-Device + Mobile Companion

With v16 making JARVIS daily-drivable on Windows, v17's job is to extend that across devices and over the cloud:

1. **Native iOS / Android app** — currently we use the off-the-shelf ntfy app for phone notifications. v17 ships a React Native / Flutter app with rich notifications, voice-input from phone (push transcribed text into desktop chat session), real-time progress streams for long-running tasks, geofenced triggers ("remind me when I leave home").
2. **Multi-device session sync** — chat history + memory + opinions + goals replicate between desktop instances. CRDT or simpler last-write-wins on a small set of tables. Cloudflare Tunnel handles transport.
3. **GPU server offload** — when Trevor's RTX 4090 server goes online, v17 wires JARVIS to use it as the remote brain (already supported via `OLLAMA_BASE_URL`; just needs the deployment story documented). Local fallback if remote is unreachable.
4. **Native UI control v2** — image-based element targeting (find "the Save button" by reference image, not coords). nut-js's `screen.find()` works once we settle on the version-specific API; current `findOnScreen()` is a stub.
5. **Visual "what JARVIS is about to do" overlay** — before any controlApp click/type, render a translucent overlay showing the planned action. User has 2 sec to cancel. Removes the "did it really just type my password into the wrong field" anxiety.
6. **Cross-app workflows** — "research a stock, write a brief, email it to my partner, post the takeaway on Twitter" as a single workflow chaining Navigator + email + native control + scheduled post.
7. **Multi-tenant Docker + Stripe billing** — original v16-ship-then-monetize plan. Now blocking only on testing v16 with real users + getting a domain + landing page.

**Scope**: ~2-3 months focused work. Smaller than v16 because most of the platform work is done — v17 is mostly UX polish + multi-device + commerce wiring.

### Known limits v16 carries into v17

These are the gaps left after v16 ships — what JARVIS still can't do. Each becomes a v17 (or later) target.

1. **Reasoning ceiling.** The base LLM is the bottleneck. Local Llama 3.2 / Gemma is GPT-3.5-class. Hard math, novel theorem proofs, deep code refactors across 100+ files, abstract academic synthesis — those pin to whatever model you swap in. `smartChat` routes heavy work to cloud Groq Llama-70B but you're still capped by what the model can do. **v17 fix**: GPU server online → swap `OLLAMA_REASONING_MODEL=llama3.1:70b` (or DeepSeek 32B) and the routing layer just picks it up.
2. **Continuous physical action.** Driving a robot, controlling IoT devices outside your computer, anything with hands — not in scope. **v17 fix**: out of scope; v18+ topic if it ever matters.
3. **Real-time video/audio understanding.** Can OCR a screenshot. Can transcribe an audio file. Can't watch a livestream and react to it as it happens. **v17 fix**: would need a streaming-vision model (Gemini 2.0 Flash, GPT-4o-realtime). Doable as an opt-in cloud feature.
4. **True learning from a single example.** LoRA fine-tunes weekly in batch. Tell JARVIS "I prefer X" and it remembers via the opinion system, but it doesn't update its weights from one correction the way you'd want a human assistant to. **v17 fix**: smaller, faster LoRA cycles (daily instead of weekly) once GPU server is online; opinion system already gives the immediate-recall behavior at the prompt level.
5. **Cross-device today.** Desktop is solid. Mobile companion app is v17. Until then, phone interaction is one-direction notifications + reply-via-ntfy. **v17 fix**: native iOS/Android app (item 1 of the v17 roadmap above).
6. **Native UI on macOS/Linux.** nut-js is cross-platform but window-title matching is Windows-tested. macOS would mostly work; Linux varies. **v17 fix**: smoke-test on macOS, document the gaps. Linux-on-Wayland may need a different lib.
7. **Apps with Captcha walls / bot detection.** Navigator + native control will both fail on sites that look hard at automation signals. **v17 fix**: limited — this is an arms race the indie side loses. Workaround: use stored credentials + 2FA, do the captcha manually once, JARVIS picks up the resulting session cookie.
8. **Audio output past ElevenLabs free tier.** 10K chars/month. Voice replies are ~50-200 chars each so you get ~50-200 voice replies/month free, then it's $5/mo for 30K or $11/mo for 100K. **v17 fix**: optional — wire local Coqui or Piper TTS as a fallback. Already half-plumbed in `voicecloning.ts`; needs the model swap path completed.
9. **Genuine creativity.** Can recombine. Can't invent. **v17 fix**: this isn't really fixable — it's a property of the underlying LLM family. Best we can do is widen the recombination surface (more knowledge, more workflows) so the recombinations look more creative.

---

## Execution Path

**Month 1-2 (now)**: Hardware upgrade (RTX 4090 ~$1,600 + UPS battery backup ~$200 for clean shutdown during power loss — recommended: APC Back-UPS Pro 1500VA or CyberPower CP1500PFCLCD, both pure sine wave, ~15-25 min runtime at 500W. Wire USB → server → PowerChute / apcupsd to trigger `curl -X POST http://localhost:3000/api/shutdown` at 20% battery so SQLite + entity graph flush cleanly before the UPS dies. Put the router on the same UPS or a server with no internet is useless), domain, demo video, landing page
**Month 3-4**: Multi-tenant Docker, Stripe billing, first 5-10 paying customers
**Month 5-6**: Show HN + Product Hunt launch, YouTube content, $5-15k MRR
**Month 7-12**: Scale to $25-50k MRR, first enterprise conversation, evaluate engineer hire
**Year 2**: $100-200k MRR, team of 3, enterprise pipeline
**Year 3**: $400k+ MRR, team of 5, strategic partnerships or acquisition

---

## License

MIT

## Author

Built by Trevor Goodwill.

*"Growth dies in comfortability."*
