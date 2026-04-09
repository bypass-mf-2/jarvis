###############################################################################
#  JARVIS AI - Full Stack Launcher (PowerShell)
#  Double-click or run: powershell -ExecutionPolicy Bypass -File run-jarvis.ps1
###############################################################################

$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "JARVIS AI - Full Stack"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "      J.A.R.V.I.S  FULL STACK LAUNCHER" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# ── Pre-flight checks ────────────────────────────────────────────────────────
$hasNode   = Get-Command node -ErrorAction SilentlyContinue
$hasPnpm   = Get-Command pnpm -ErrorAction SilentlyContinue
$hasPython = Get-Command python -ErrorAction SilentlyContinue
$hasOllama = Get-Command ollama -ErrorAction SilentlyContinue

if (-not $hasNode) {
    Write-Host "  ERROR: Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not $hasPnpm) {
    Write-Host "  Installing pnpm..." -ForegroundColor Yellow
    npm install -g pnpm
}

Write-Host "  [CHECK] Dependencies OK" -ForegroundColor Green
Write-Host ""

# ── Install Node dependencies ─────────────────────────────────────────────────
if (-not (Test-Path "node_modules")) {
    Write-Host "  [1/6] Installing Node dependencies..." -ForegroundColor Yellow
    pnpm install
} else {
    Write-Host "  [1/6] Node dependencies OK" -ForegroundColor Green
}

# ── Install Python dependencies ───────────────────────────────────────────────
if ($hasPython) {
    Write-Host "  [2/6] Installing Python dependencies..." -ForegroundColor Yellow
    pip install -r requirements.txt -q 2>$null
} else {
    Write-Host "  [2/6] Skipping Python deps (not found)" -ForegroundColor Yellow
}

# ── Start Ollama ──────────────────────────────────────────────────────────────
Write-Host "  [3/6] Starting Ollama..." -ForegroundColor Yellow
if ($hasOllama) {
    $ollamaRunning = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
    if (-not $ollamaRunning) {
        Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Minimized
        Start-Sleep -Seconds 2
        Write-Host "         Ollama started" -ForegroundColor Green
    } else {
        Write-Host "         Ollama already running" -ForegroundColor Green
    }
} else {
    Write-Host "         Not found - using cloud fallback" -ForegroundColor Yellow
}

# ── Start ChromaDB ────────────────────────────────────────────────────────────
Write-Host "  [4/6] Starting ChromaDB..." -ForegroundColor Yellow
if ($hasPython) {
    if (-not (Test-Path "chroma-data")) { New-Item -ItemType Directory -Path "chroma-data" | Out-Null }
    $chromaJob = Start-Process -FilePath "chroma" -ArgumentList "run","--path","./chroma-data","--host","localhost","--port","8000" -WindowStyle Minimized -PassThru -ErrorAction SilentlyContinue
    if ($chromaJob) {
        Start-Sleep -Seconds 3
        Write-Host "         ChromaDB started on port 8000" -ForegroundColor Green
    } else {
        Write-Host "         ChromaDB failed to start (may need: pip install chromadb)" -ForegroundColor Yellow
    }
} else {
    Write-Host "         Skipped (no Python)" -ForegroundColor Yellow
}

# ── Find available port ───────────────────────────────────────────────────────
Write-Host "  [5/6] Finding available port..." -ForegroundColor Yellow
$port = 3000
for ($i = 0; $i -le 20; $i++) {
    $testPort = 3000 + $i
    $inUse = Get-NetTCPConnection -LocalPort $testPort -ErrorAction SilentlyContinue
    if (-not $inUse) {
        $port = $testPort
        break
    }
}
Write-Host "         Using port $port" -ForegroundColor Green

# ── Start JARVIS server ──────────────────────────────────────────────────────
Write-Host "  [6/6] Starting JARVIS backend + frontend..." -ForegroundColor Yellow
$env:PORT = $port
$jarvisProc = Start-Process -FilePath "pnpm" -ArgumentList "dev" -WorkingDirectory $PSScriptRoot -PassThru

Start-Sleep -Seconds 5

# ── Open browser ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ========================================" -ForegroundColor Green
Write-Host "      JARVIS IS ONLINE" -ForegroundColor Green
Write-Host "      http://localhost:$port" -ForegroundColor Green
Write-Host "  ========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Services running:" -ForegroundColor Cyan
Write-Host "    - Frontend + Backend : http://localhost:$port"
Write-Host "    - ChromaDB           : http://localhost:8000"
Write-Host "    - Ollama             : http://localhost:11434"
Write-Host ""

Start-Process "http://localhost:$port"

Write-Host "  Press Ctrl+C or close this window to stop all services." -ForegroundColor Yellow
Write-Host ""

# ── Wait and cleanup on exit ──────────────────────────────────────────────────
try {
    Wait-Process -Id $jarvisProc.Id
} catch {
    # User closed or Ctrl+C
} finally {
    Write-Host "  Shutting down services..." -ForegroundColor Yellow
    if ($jarvisProc -and -not $jarvisProc.HasExited) { Stop-Process -Id $jarvisProc.Id -Force -ErrorAction SilentlyContinue }
    if ($chromaJob -and -not $chromaJob.HasExited) { Stop-Process -Id $chromaJob.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "  All services stopped." -ForegroundColor Green
}
