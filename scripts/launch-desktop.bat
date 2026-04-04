@echo off
echo ============================================
echo  Launching J.A.R.V.I.S Desktop App
echo ============================================
echo.

cd /d "%~dp0.."

:: Check if Electron is installed
call npx electron --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Electron not installed. Running setup first...
    call scripts\setup-desktop.bat
)

:: Check if Ollama is running
curl -s http://localhost:11434/api/tags >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Starting Ollama...
    start "" ollama serve
    timeout /t 3 /nobreak >nul
)

echo Starting J.A.R.V.I.S desktop app...
call npx electron electron/main.cjs
