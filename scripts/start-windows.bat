@echo off
REM ============================================================================
REM JARVIS AI - Windows Launcher
REM Starts JARVIS with SQLite database and Ollama integration
REM ============================================================================

setlocal enabledelayedexpansion

echo.
echo ╔════════════════════════════════════════════════════════════════════════╗
echo ║                         J.A.R.V.I.S AI                                 ║
echo ║                   Just A Rather Very Intelligent System                ║
echo ╚════════════════════════════════════════════════════════════════════════╝
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ ERROR: Node.js is not installed or not in PATH
    echo.
    echo Please install Node.js from: https://nodejs.org/
    echo Make sure to add it to PATH during installation
    pause
    exit /b 1
)

echo ✓ Node.js found: 
node --version
echo.

REM Check if pnpm is installed
where pnpm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ ERROR: pnpm is not installed or not in PATH
    echo.
    echo Installing pnpm globally...
    npm install -g pnpm
    if %ERRORLEVEL% NEQ 0 (
        echo ❌ Failed to install pnpm
        pause
        exit /b 1
    )
)

echo ✓ pnpm found: 
pnpm --version
echo.

REM Check if Ollama is running
echo Checking Ollama status...
curl -s http://localhost:11434/api/tags >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo ✓ Ollama is running on localhost:11434
    echo.
) else (
    echo ⚠ WARNING: Ollama is not running
    echo.
    echo JARVIS will use cloud fallback for LLM inference (slower, needs internet)
    echo.
    echo To use local LLaMA 3.2 (free, offline, fast):
    echo   1. Install Ollama from https://ollama.com
    echo   2. Run: ollama pull llama3.2
    echo   3. Run: ollama serve
    echo   4. Then restart JARVIS
    echo.
    echo See OLLAMA_SETUP.md for detailed instructions
    echo.
    pause
)

REM Check for SQLite database
if not exist "jarvis.db" (
    echo Creating SQLite database...
    echo This will be created automatically on first run
    echo.
)

REM Install dependencies if needed
echo Installing dependencies...
pnpm install
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo ════════════════════════════════════════════════════════════════════════
echo Starting JARVIS development server...
echo ════════════════════════════════════════════════════════════════════════
echo.
echo 📡 Server will start on: http://localhost:3000
echo 💾 Database: jarvis.db (SQLite)
echo 🧠 LLM: LLaMA 3.2 (local) or cloud fallback
echo.
echo Press Ctrl+C to stop the server
echo.

REM Start the dev server
pnpm dev

pause
