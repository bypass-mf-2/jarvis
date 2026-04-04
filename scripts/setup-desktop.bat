@echo off
echo ============================================
echo  J.A.R.V.I.S Desktop App Setup
echo ============================================
echo.

cd /d "%~dp0.."

echo [1/3] Installing Electron...
call pnpm add -D electron electron-builder
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install Electron
    pause
    exit /b 1
)

echo.
echo [2/3] Verifying installation...
call npx electron --version
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Electron installation failed
    pause
    exit /b 1
)

echo.
echo [3/3] Desktop app ready!
echo.
echo To launch JARVIS as a desktop app, run:
echo   scripts\launch-desktop.bat
echo.
echo Or use the browser version:
echo   scripts\start.bat
echo.
pause
