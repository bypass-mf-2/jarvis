# ============================================================
# JARVIS AI - Windows Setup Script
# Run this ONCE to install all dependencies
# Usage: Right-click > "Run with PowerShell" (as Administrator)
# ============================================================

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "JARVIS AI - Setup"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║     J.A.R.V.I.S  AI  SETUP          ║" -ForegroundColor Cyan
Write-Host "  ║  Just A Rather Very Intelligent Sys  ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Helper functions ──────────────────────────────────────────────────────────
function Write-Step($msg) { Write-Host "  ► $msg" -ForegroundColor Yellow }
function Write-OK($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "  ✗ $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "  · $msg" -ForegroundColor Gray }

function Test-CommandExists($cmd) {
    return $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

# ── Check Node.js ─────────────────────────────────────────────────────────────
Write-Step "Checking Node.js..."
if (-not (Test-CommandExists "node")) {
    Write-Err "Node.js not found. Please install from https://nodejs.org (v18+)"
    Write-Info "After installing Node.js, re-run this script."
    Read-Host "Press Enter to exit"
    exit 1
}
$nodeVersion = (node --version)
Write-OK "Node.js $nodeVersion found"

# ── Check Python ──────────────────────────────────────────────────────────────
Write-Step "Checking Python..."
if (-not (Test-CommandExists "python")) {
    Write-Err "Python not found. Please install from https://python.org (v3.10+)"
    Read-Host "Press Enter to exit"
    exit 1
}
$pyVersion = (python --version)
Write-OK "$pyVersion found"

# ── Install pnpm ──────────────────────────────────────────────────────────────
Write-Step "Installing pnpm..."
if (-not (Test-CommandExists "pnpm")) {
    npm install -g pnpm
    Write-OK "pnpm installed"
} else {
    Write-OK "pnpm already installed"
}

# ── Install Node.js dependencies ──────────────────────────────────────────────
Write-Step "Installing Node.js dependencies..."
Set-Location $PSScriptRoot\..
pnpm install
Write-OK "Node.js dependencies installed"

# ── Install Python dependencies ───────────────────────────────────────────────
Write-Step "Installing Python dependencies (ChromaDB, pyttsx3, etc.)..."
pip install chromadb pyttsx3 pyaudio SpeechRecognition requests beautifulsoup4 feedparser --quiet
Write-OK "Python dependencies installed"

# ── Check/Install Ollama ──────────────────────────────────────────────────────
Write-Step "Checking Ollama..."
if (-not (Test-CommandExists "ollama")) {
    Write-Info "Ollama not found. Downloading installer..."
    $ollamaUrl = "https://ollama.com/download/OllamaSetup.exe"
    $installerPath = "$env:TEMP\OllamaSetup.exe"
    Invoke-WebRequest -Uri $ollamaUrl -OutFile $installerPath
    Write-Info "Running Ollama installer (follow the prompts)..."
    Start-Process -FilePath $installerPath -Wait
    Write-OK "Ollama installed"
} else {
    Write-OK "Ollama already installed"
}

# ── Pull default LLM model ────────────────────────────────────────────────────
Write-Step "Pulling LLaMA 3.2 model (this may take a while on first run)..."
Write-Info "Model size: ~2GB. Grab a coffee ☕"
try {
    ollama pull llama3.2
    Write-OK "llama3.2 model ready"
} catch {
    Write-Err "Could not pull llama3.2. You can do this manually: ollama pull llama3.2"
}

# ── Pull embedding model ──────────────────────────────────────────────────────
Write-Step "Pulling embedding model (nomic-embed-text)..."
try {
    ollama pull nomic-embed-text
    Write-OK "nomic-embed-text ready"
} catch {
    Write-Err "Could not pull nomic-embed-text. Run: ollama pull nomic-embed-text"
}

# ── Create .env file ──────────────────────────────────────────────────────────
Write-Step "Creating .env configuration..."
$envFile = "$PSScriptRoot\..\jarvis.env"
if (-not (Test-Path $envFile)) {
    @"
# JARVIS AI Local Configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
OLLAMA_EMBED_MODEL=nomic-embed-text
CHROMA_BASE_URL=http://localhost:8000
SCRAPER_INTERVAL_MS=3600000
IMPROVEMENT_INTERVAL_MS=21600000
"@ | Out-File -FilePath $envFile -Encoding UTF8
    Write-OK ".env created at jarvis.env"
} else {
    Write-OK ".env already exists"
}

Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║       SETUP COMPLETE! 🎉             ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "  1. Run: scripts\start.bat  (or start.ps1)" -ForegroundColor Cyan
Write-Host "  2. Open: http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to exit"
