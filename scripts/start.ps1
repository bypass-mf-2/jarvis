# ============================================================
# JARVIS AI - PowerShell Launcher (Improved)
# Starts Ollama, ChromaDB, and JARVIS with error handling
# ============================================================

$Host.UI.RawUI.WindowTitle = "JARVIS AI"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║     J.A.R.V.I.S  AI  LAUNCHER       ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Set-Location "$PSScriptRoot\.."

function Test-CommandExists($cmd) {
    return $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Find-AvailablePort($startPort = 3000) {
    for ($port = $startPort; $port -lt $startPort + 20; $port++) {
        try {
            $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
            $listener.Start()
            $listener.Stop()
            return $port
        } catch {
            # Port in use, try next
        }
    }
    return $startPort
}

# ── Check dependencies ────────────────────────────────────────────────────────
Write-Host "  [0/4] Checking dependencies..." -ForegroundColor Yellow
if (-not (Test-CommandExists "node")) {
    Write-Host "  ERROR: Node.js not found in PATH" -ForegroundColor Red
    Write-Host "  Install from: https://nodejs.org" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Test-CommandExists "pnpm")) {
    Write-Host "  Installing pnpm..." -ForegroundColor Yellow
    npm install -g pnpm
}
Write-Host "  OK: Dependencies found" -ForegroundColor Green

# ── Find available port ───────────────────────────────────────────────────────
Write-Host "  [1/4] Finding available port..." -ForegroundColor Yellow
$port = Find-AvailablePort 3000
Write-Host "  Using port $port" -ForegroundColor Green

# ── Start Ollama ──────────────────────────────────────────────────────────────
Write-Host "  [2/4] Starting Ollama..." -ForegroundColor Yellow
if (Test-CommandExists "ollama") {
    $ollamaProcess = Get-Process ollama -ErrorAction SilentlyContinue
    if ($null -eq $ollamaProcess) {
        Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Minimized
        Start-Sleep -Seconds 2
        Write-Host "  Ollama started" -ForegroundColor Green
    } else {
        Write-Host "  Ollama already running" -ForegroundColor Green
    }
} else {
    Write-Host "  WARNING: Ollama not found — using cloud fallback" -ForegroundColor DarkYellow
    Write-Host "  Install from: https://ollama.com" -ForegroundColor Gray
}

# ── Start ChromaDB ────────────────────────────────────────────────────────────
Write-Host "  [3/4] Starting ChromaDB..." -ForegroundColor Yellow
if (Test-CommandExists "python") {
    $chromaProcess = Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*chromadb*" }
    if ($null -eq $chromaProcess) {
        Start-Process -FilePath "python" -ArgumentList "-m chromadb.cli.cli run --host localhost --port 8000" -WindowStyle Minimized
        Start-Sleep -Seconds 2
        Write-Host "  ChromaDB started" -ForegroundColor Green
    } else {
        Write-Host "  ChromaDB already running" -ForegroundColor Green
    }
} else {
    Write-Host "  WARNING: Python not found — vector search unavailable" -ForegroundColor DarkYellow
}

# ── Start JARVIS ──────────────────────────────────────────────────────────────
Write-Host "  [4/4] Starting JARVIS server on port $port..." -ForegroundColor Yellow
$env:PORT = $port
$jarvisProcess = Start-Process -FilePath "pnpm" -ArgumentList "dev" -PassThru -WindowStyle Normal
Start-Sleep -Seconds 5

# ── Open browser ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   JARVIS IS ONLINE ✓                 ║" -ForegroundColor Green
Write-Host "  ║   http://localhost:$port              ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

Start-Process "http://localhost:$port"

Write-Host "  Press Ctrl+C or close this window to stop JARVIS." -ForegroundColor Gray
$jarvisProcess.WaitForExit()
