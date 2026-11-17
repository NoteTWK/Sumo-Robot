@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required to run Robot Sumo.
  pause
  exit /b 1
)
if not exist "node_modules\qrcode\package.json" (
  call npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  if errorlevel 1 (
    echo Could not install WebSocket support. Check your internet connection.
    pause
    exit /b 1
  )
)
node server.cjs --open
if errorlevel 1 pause
