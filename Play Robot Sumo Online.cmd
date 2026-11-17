@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 20 or later is required.
  pause
  exit /b 1
)
call npm ci --omit=dev --ignore-scripts --no-audit --no-fund
if errorlevel 1 (
  echo Could not install game dependencies. Check your internet connection.
  pause
  exit /b 1
)
node online.cjs --open
if errorlevel 1 pause
