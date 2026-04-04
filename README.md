
# jarvis
AI and Jarvis

# J.A.R.V.I.S — Just A Rather Very Intelligent System

> A fully local, self-improving AI assistant with voice interaction, continuous web learning, and a ChatGPT-style interface. Inspired by Tony Stark's AI. Runs entirely on your Windows machine.

---

## What Is This?

JARVIS is a personal AI assistant that runs **100% locally** on your computer. It combines:

- **Local LLM inference** via [Ollama](https://ollama.com) (LLaMA 3.2, Mistral, or any model you choose)
- **ChatGPT-style web UI** accessible in your browser at `http://localhost:3000`
- **Jarvis-style voice I/O** — speak to it, it speaks back
- **Continuous web learning** — scrapes RSS feeds, news sites, and custom URLs on a schedule
- **RAG (Retrieval-Augmented Generation)** — answers are grounded in your scraped knowledge base
- **Self-improvement engine** — analyzes its own logs and proposes code improvements
- **Persistent memory** — conversation history and knowledge stored in a local database

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    JARVIS AI System                      │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────┐   │
│  │  Browser │   │  Ollama  │   │    ChromaDB       │   │
│  │  UI      │◄──│  LLM     │◄──│  Vector Store     │   │
│  │ :3000    │   │ :11434   │   │  :8000            │   │
│  └────┬─────┘   └──────────┘   └────────┬─────────┘   │
│       │                                  │             │
│  ┌────▼──────────────────────────────────▼──────────┐  │
│  │              Express + tRPC Backend               │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │  │
│  │  │  Chat    │ │  RAG     │ │  Scraper Engine   │  │  │
│  │  │  Router  │ │ Pipeline │ │  (RSS/News/URL)   │  │  │
│  │  └──────────┘ └──────────┘ └──────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │         Self-Improvement Module               │  │  │
│  │  │  (Log Analysis → LLM Reflection → Patch)     │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              MySQL/TiDB Database                  │   │
│  │  conversations · messages · knowledge_chunks     │   │
│  │  scrape_sources · system_logs · patches          │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Prerequisites

| Requirement | Version | Download |
|---|---|---|
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| Python | 3.10+ | [python.org](https://python.org) |
| Ollama | Latest | [ollama.com](https://ollama.com) |
| pnpm | 8+ | Auto-installed by setup script |

**Hardware recommendations:**
- RAM: 8GB minimum, 16GB recommended
- Storage: 5GB free (for LLM models)
- GPU: Optional but speeds up inference significantly

---

## Quick Start (Windows)

### Step 1 — Run Setup (First Time Only)

Right-click `scripts\setup.ps1` → **Run with PowerShell**

This will:
1. Check Node.js and Python
2. Install pnpm and all Node.js dependencies
3. Install Python packages (ChromaDB, pyttsx3, etc.)
4. Download and install Ollama
5. Pull the LLaMA 3.2 model (~2GB)
6. Pull the nomic-embed-text embedding model
7. Create your `jarvis.env` configuration file

### Step 2 — Launch JARVIS

Double-click `scripts\start.bat`

Or in PowerShell:
```powershell
.\scripts\start.ps1
```

This starts three services:
- **Ollama** — local LLM server (port 11434)
- **ChromaDB** — vector database (port 8000)
- **JARVIS** — web server + UI (port 3000)

### Step 3 — Open the Interface

Your browser will open automatically to `http://localhost:3000`

---

## Features Guide

### Chat Interface

The main chat window works like ChatGPT. Type your message and press **Enter** to send. JARVIS will:
1. Search its knowledge base for relevant information (RAG)
2. Send your message + context to the local LLM
3. Stream back a response with markdown formatting

### Voice Interaction

Click the **microphone button** to record your voice. JARVIS transcribes it using Whisper and sends it as a message. Enable the **speaker button** to have responses read aloud using text-to-speech.

### Knowledge Base (Database icon)

View all knowledge chunks scraped from the web. Each chunk shows its source, content preview, and timestamp. JARVIS automatically uses this knowledge when answering your questions.

### Web Scraper (RSS icon)

Manage the sources JARVIS learns from:
- **Add sources** — RSS feeds, news sites, or any URL
- **Toggle sources** — enable/disable individual feeds
- **Scrape Now** — trigger an immediate scrape
- **Auto-scrape** — runs every 60 minutes by default

Default sources included: BBC News, Hacker News, Reuters Tech, MIT Technology Review, ArXiv AI.

### Self-Improvement (Lightning icon)

JARVIS can analyze its own performance logs and suggest code improvements:
1. Click **Analyze** to run a self-analysis cycle
2. Review the generated suggestion
3. **Approve** or **Reject** the patch
4. If approved and a code diff is present, click **Apply Patch**

> **Safety note:** Patches are never applied automatically. You must explicitly approve and apply each one.

### System Logs (Activity icon)

Real-time view of all system activity — scraper runs, LLM calls, errors, and self-improvement cycles.

---

## Configuration

Edit `jarvis.env` to customize behavior:

```env
# LLM Settings
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2          # Change to: mistral, llama3.1, phi3, etc.
OLLAMA_EMBED_MODEL=nomic-embed-text

# Vector Store
CHROMA_BASE_URL=http://localhost:8000

# Scraper interval (milliseconds)
SCRAPER_INTERVAL_MS=3600000    # 1 hour (default)

# Self-improvement interval (milliseconds)
IMPROVEMENT_INTERVAL_MS=21600000  # 6 hours (default)
```

### Changing the LLM Model

```powershell
# Pull any model from Ollama's library
ollama pull mistral
ollama pull llama3.1
ollama pull phi3
ollama pull codellama

# Then update jarvis.env:
# OLLAMA_MODEL=mistral
```

---

## Project Structure

```
jarvis-ai/
├── client/                    # React frontend
│   └── src/
│       ├── pages/Home.tsx     # Main chat UI
│       ├── index.css          # Jarvis dark theme
│       └── App.tsx            # Router
├── server/                    # Express backend
│   ├── ollama.ts              # Ollama LLM integration
│   ├── rag.ts                 # RAG pipeline
│   ├── scraper.ts             # Web scraping engine
│   ├── vectorStore.ts         # ChromaDB integration
│   ├── selfImprovement.ts     # Self-improvement module
│   ├── services.ts            # Background service scheduler
│   ├── logger.ts              # Structured logging
│   ├── db.ts                  # Database query helpers
│   └── routers.ts             # tRPC API routes
├── drizzle/
│   └── schema.ts              # Database schema
├── scripts/
│   ├── setup.ps1              # Windows setup script
│   ├── setup.bat              # Batch setup alternative
│   ├── start.bat              # Windows launcher
│   └── start.ps1              # PowerShell launcher
└── README.md                  # This file
```

---

## Troubleshooting

| Issue | Solution |
|---|---|
| "Ollama offline" warning | Run `ollama serve` in a terminal, or restart Ollama |
| Voice input not working | Allow microphone access in browser settings |
| Slow responses | Try a smaller model: `OLLAMA_MODEL=phi3` in jarvis.env |
| ChromaDB not starting | Run `pip install chromadb` then retry |
| Port 3000 in use | Change port: `PORT=3001 pnpm dev` |
| Model not found | Run `ollama pull llama3.2` in terminal |

---

## Adding Custom Knowledge

You can add any URL as a scrape source through the UI. JARVIS will:
1. Fetch the page content
2. Split it into semantic chunks
3. Generate vector embeddings
4. Store in ChromaDB for RAG retrieval

For best results, use RSS feeds from sites you want JARVIS to follow regularly.

---

## Privacy

Everything runs locally on your machine. No data is sent to external servers unless:
- Ollama is unavailable (falls back to cloud LLM)
- Voice transcription uses the Whisper API (requires internet)

To run fully offline, ensure Ollama is running and set `OLLAMA_MODEL` to a locally available model.

---

## License

MIT — use, modify, and distribute freely.
>>>>>>> 9dabd15 (v1.1)
