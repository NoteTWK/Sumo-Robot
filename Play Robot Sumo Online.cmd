@echo off
title Robot Sumo Online
cd /d "%~dp0"
echo Starting Robot Sumo Online. Please keep this window open.
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 20 or later is required.
  pause
  exit /b 1
)
if not exist "node_modules\qrcode\package.json" goto install
if not exist "node_modules\ws\package.json" goto install
goto launch
:install
echo Installing game dependencies. Please wait...
call npm ci --omit=dev --ignore-scripts --no-audit --no-fund
if errorlevel 1 (
    echo Could not install game dependencies. Check your internet connection.
    pause
    exit /b 1
)
:launch
node online.cjs --open
if errorlevel 1 pause
