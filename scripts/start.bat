@echo off
setlocal enabledelayedexpansion
title JARVIS AI - Launcher
color 0B

echo.
echo   ╔══════════════════════════════════════╗
echo   ║     J.A.R.V.I.S  AI  LAUNCHER       ║
echo   ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0.."

REM ── Check Node.js ────────────────────────────────────────────────────────────
echo   [0/4] Checking dependencies...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   ERROR: Node.js not found in PATH
    echo   Please ensure Node.js is installed and added to PATH
    echo   Download from: https://nodejs.org
    pause
    exit /b 1
)

where pnpm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   ERROR: pnpm not found. Installing globally...
    call npm install -g pnpm
    if %ERRORLEVEL% NEQ 0 (
        echo   ERROR: Could not install pnpm
        pause
        exit /b 1
    )
)

echo   OK: Dependencies found

REM ── Find available port ──────────────────────────────────────────────────────
echo   [1/4] Finding available port...
set PORT=3000
for /l %%i in (0,1,20) do (
    set /a PORT_TEST=3000+%%i
    netstat -ano | find "!PORT_TEST!" >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        set PORT=!PORT_TEST!
        goto port_found
    )
)
:port_found
echo   Using port !PORT!

REM ── Start Ollama ─────────────────────────────────────────────────────────────
echo   [2/4] Starting Ollama...
where ollama >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   WARNING: Ollama not found. JARVIS will use cloud fallback.
    echo   To use local LLM, install from: https://ollama.com
) else (
    tasklist | find /i "ollama" >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        start "Ollama" /min cmd /c "ollama serve"
        timeout /t 2 /nobreak >nul
    ) else (
        echo   Ollama already running
    )
)

REM ── Start ChromaDB ────────────────────────────────────────────────────────────
echo   [3/4] Starting ChromaDB...
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   WARNING: Python not found. ChromaDB unavailable.
) else (
    tasklist | find /i "chromadb" >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        start "ChromaDB" /min cmd /c "python -m chromadb.cli.cli run --host localhost --port 8000"
        timeout /t 2 /nobreak >nul
    ) else (
        echo   ChromaDB already running
    )
)

REM ── Start JARVIS ─────────────────────────────────────────────────────────────
echo   [4/4] Starting JARVIS server on port !PORT!...
set PORT=!PORT!
start "JARVIS Server" cmd /k "cd /d "%~dp0.." && pnpm dev"
timeout /t 5 /nobreak >nul

REM ── Open browser ─────────────────────────────────────────────────────────────
echo.
echo   ╔══════════════════════════════════════╗
echo   ║   JARVIS IS ONLINE                   ║
echo   ║   Opening http://localhost:!PORT!    ║
echo   ╚══════════════════════════════════════╝
echo.

timeout /t 2 /nobreak >nul
start "" "http://localhost:!PORT!"

echo   All services running. Close this window to stop JARVIS.
echo   (Note: Ollama and ChromaDB windows may need manual closing)
pause
