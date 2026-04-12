@echo off
setlocal enabledelayedexpansion
title JARVIS AI - Full Stack Launcher
color 0B

echo.
echo   ========================================
echo       J.A.R.V.I.S  FULL STACK LAUNCHER
echo   ========================================
echo.

cd /d "%~dp0"

REM ── Pre-flight checks ───────────────────────────────────────────────────────
echo   [CHECK] Verifying dependencies...

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   ERROR: Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

where pnpm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   Installing pnpm...
    call npm install -g pnpm
)

where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   WARNING: Python not found. ChromaDB will be skipped.
    set HAS_PYTHON=0
) else (
    set HAS_PYTHON=1
)

echo   OK: Core dependencies found
echo.

REM ── Install Node dependencies if needed ─────────────────────────────────────
if not exist "node_modules" (
    echo   [1/6] Installing Node dependencies...
    call pnpm install
) else (
    echo   [1/6] Node dependencies OK
)

REM ── Install Python dependencies if needed ───────────────────────────────────
if !HAS_PYTHON!==1 (
    echo   [2/6] Installing Python dependencies...
    pip install -r requirements.txt -q 2>nul
) else (
    echo   [2/6] Skipping Python deps (no Python)
)

REM ── Start Ollama ────────────────────────────────────────────────────────────
echo   [3/6] Starting Ollama...
where ollama >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo         Ollama not found - using cloud fallback
) else (
    tasklist /fi "imagename eq ollama.exe" 2>nul | find /i "ollama.exe" >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        start "Ollama" /min cmd /c "ollama serve"
        timeout /t 2 /nobreak >nul
        echo         Ollama started
    ) else (
        echo         Ollama already running
    )
)

REM ── Start ChromaDB ──────────────────────────────────────────────────────────
echo   [4/6] Starting ChromaDB...
if !HAS_PYTHON!==1 (
    if not exist "chroma-data" mkdir chroma-data
    tasklist /fi "imagename eq python.exe" 2>nul | find /i "chromadb" >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        start "ChromaDB" /min cmd /c "chroma run --path ./chroma-data --host localhost --port 8000"
        timeout /t 3 /nobreak >nul
        echo         ChromaDB started on port 8000
    ) else (
        echo         ChromaDB already running
    )
) else (
    echo         Skipped (no Python)
)

REM ── Find available port ─────────────────────────────────────────────────────
echo   [5/6] Finding available port...
set PORT=3000
for /l %%i in (0,1,20) do (
    set /a PORT_TEST=3000+%%i
    netstat -ano 2>nul | find ":!PORT_TEST! " >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        set PORT=!PORT_TEST!
        goto :port_found
    )
)
:port_found
echo         Using port !PORT!

REM ── Start JARVIS (backend + frontend dev server) ────────────────────────────
echo   [6/6] Starting JARVIS backend + frontend...
set PORT=!PORT!
start "JARVIS Server" cmd /k "cd /d "%~dp0" && set PORT=!PORT! && pnpm dev"

REM ── Wait and open browser ───────────────────────────────────────────────────
echo.
timeout /t 5 /nobreak >nul

echo   ========================================
echo       JARVIS IS ONLINE
echo       http://localhost:!PORT!
echo   ========================================
echo.
echo   Services running:
echo     - Frontend + Backend : http://localhost:!PORT!
echo     - ChromaDB           : http://localhost:8000
echo     - Ollama             : http://localhost:11434
echo.

start "" "http://localhost:!PORT!"

echo   Press any key to STOP all services...
pause >nul

REM ── Cleanup ─────────────────────────────────────────────────────────────────
echo.
echo   Shutting down services...
taskkill /fi "windowtitle eq JARVIS Server*" /f >nul 2>&1
taskkill /fi "windowtitle eq ChromaDB*" /f >nul 2>&1
taskkill /fi "windowtitle eq Ollama*" /f >nul 2>&1
echo   All services stopped.
timeout /t 2 /nobreak >nul
