@echo off
title JARVIS AI - Setup
color 0B

echo.
echo   ╔══════════════════════════════════════╗
echo   ║     J.A.R.V.I.S  AI  SETUP          ║
echo   ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0.."

echo   [1/5] Checking Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   ERROR: Node.js not found!
    echo   Install from: https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do echo   OK: Node.js %%i

echo   [2/5] Installing pnpm...
where pnpm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    npm install -g pnpm
)
echo   OK: pnpm ready

echo   [3/5] Installing Node.js dependencies...
call pnpm install
echo   OK: Node.js deps installed

echo   [4/5] Installing Python dependencies...
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   WARNING: Python not found. ChromaDB will be unavailable.
    echo   Install from: https://python.org
) else (
    pip install chromadb pyttsx3 pyaudio SpeechRecognition requests beautifulsoup4 feedparser --quiet
    echo   OK: Python deps installed
)

echo   [5/5] Checking Ollama...
where ollama >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   Ollama not found. Please download from: https://ollama.com
    echo   After installing, run: ollama pull llama3.2
) else (
    echo   Pulling llama3.2 model (this may take a while)...
    ollama pull llama3.2
    echo   Pulling nomic-embed-text...
    ollama pull nomic-embed-text
    echo   OK: Models ready
)

echo.
echo   ╔══════════════════════════════════════╗
echo   ║       SETUP COMPLETE!                ║
echo   ║   Run scripts\start.bat to launch    ║
echo   ╚══════════════════════════════════════╝
echo.
pause
