# Jarvis AI - Project TODO

## Phase 2: Schema & Structure
- [x] Database schema: conversations, messages, knowledge_chunks, scrape_jobs, system_logs tables
- [x] Project structure and shared types

## Phase 3: Backend Core
- [x] Ollama integration helper (chat, embeddings)
- [x] Chat tRPC router (send message, stream response, history)
- [x] System status router (model info, scraper status)

## Phase 4: Memory & RAG
- [x] Conversation history DB helpers
- [x] ChromaDB vector store integration (server-side)
- [x] RAG pipeline: embed query → retrieve chunks → augment prompt
- [x] Knowledge management router (list, delete chunks)

## Phase 5: Web Scraping Engine
- [x] RSS feed scraper with scheduled background task
- [x] News site scraper (axios + cheerio-style content extraction)
- [x] Custom URL scraper on demand
- [x] Scrape job management router (add/remove/list sources, trigger manual scrape)
- [x] Auto-embed scraped content into ChromaDB

## Phase 6: Self-Improvement Module
- [x] System performance log collector
- [x] LLM-based log analysis and reflection
- [x] Code diff generator and safe patch applier
- [x] Self-improvement router (trigger analysis, view suggestions, apply patch)

## Phase 7: Frontend UI
- [x] Dark Jarvis-themed UI (deep navy/cyan palette)
- [x] Chat page with streaming markdown responses
- [x] Voice input button (Whisper transcription)
- [x] Voice output toggle (TTS via browser SpeechSynthesis)
- [x] Sidebar: Knowledge base browser
- [x] Sidebar: Scraper sources manager
- [x] Sidebar: Self-improvement log viewer
- [x] System status panel (model, scraper, memory stats)

## Phase 8: Windows Setup & Docs
- [x] setup.bat / setup.ps1 Windows installer
- [x] start.bat launcher
- [x] requirements.txt / package.json for all deps
- [x] README.md with full installation guide
- [x] Ollama model download instructions

## Phase 9: Tests & Delivery
- [x] Vitest test suite (18 tests, all passing)
- [x] TypeScript type check (0 errors)
- [x] Checkpoint saved


## Bug Fixes
- [x] Remove OAuth auth — localhost auto-owner
- [x] Add scrollbars to chat and sidebar panels
- [x] Fix localhost connection issue (port binding + error handling)
- [x] Remove visual editor buttons (Manus platform feature)
- [x] Add patch validation before self-improvement applies changes

## Windows Compatibility Fixes
- [x] Install cross-env and update package.json scripts


## Database Initialization
- [x] Create seed script for default RSS sources
- [x] Auto-trigger initial scrape on first startup


## Bug Fixes (Round 2)
- [x] Fix Enter key not sending messages in chat textbox


## SQLite Migration & Ollama Setup
- [x] Migrate schema from MySQL to SQLite
- [x] Update server to use SQLite connection
- [x] Create Ollama installation guide
- [x] Update Windows launchers for SQLite + Ollama


## Server Stability Fixes
- [x] Fix SQLite binding issue causing dev server crashes (switched to sql.js)


## Database Async Initialization Bug
- [x] Fix async database initialization so services can access it
- [x] Ensure RSS sources are seeded before scraper runs
- [x] Expand default RSS sources from 5 to 16 feeds


## Custom URL Scraping Feature
- [x] Add generic URL scraper for arbitrary web pages (already in scraper.ts)
- [x] Add tRPC endpoint to add custom sources (scraper.addSource)
- [x] Add tRPC endpoint to scrapeURL for one-off arbitrary URLs
- [x] Add UI controls in scraper panel to add/manage sources (already in Home.tsx)


## Localhost Seeding Fix
- [x] Add seedSources tRPC endpoint
- [x] Add "Seed Sources & Scrape Web" button on welcome screen
- [x] Add "Seed" button in scraper panel

## Database Access Fix (Localhost)
- [x] Rewrite db.ts as smart bridge (MySQL when available, SQLite fallback)
- [x] Fix all imports to use unified db.ts bridge
- [x] Remove analytics script that causes errors on localhost

## Electron Desktop App
- [x] Create Electron main process wrapper
- [x] Create desktop launcher scripts (setup-desktop.bat, launch-desktop.bat)
- [x] Generate JARVIS app icon
