@echo off
title Autonomous Prime
set "ROOT=%~dp0"
cd /d "%ROOT%"
if exist "tools\ffmpeg\bin" set "PATH=%CD%\tools\ffmpeg\bin;%PATH%"
if exist "tools\ffmpeg\bin\ffmpeg.exe" set "FFMPEG_BIN=%CD%\tools\ffmpeg\bin\ffmpeg.exe"
if exist "tools\ffmpeg\bin\ffmpeg.exe" set "FFMPEG_PATH=%CD%\tools\ffmpeg\bin\ffmpeg.exe"
if exist "tools\ffmpeg\bin\ffprobe.exe" set "FFPROBE_BIN=%CD%\tools\ffmpeg\bin\ffprobe.exe"
if exist "tools\ffmpeg\bin\ffprobe.exe" set "FFPROBE_PATH=%CD%\tools\ffmpeg\bin\ffprobe.exe"

if not exist ".venv\Scripts\python.exe" (
  python scripts\bootstrap.py %*
) else (
  .venv\Scripts\python.exe scripts\bootstrap.py %*
)
if errorlevel 1 (
  echo.
  echo Bootstrap exited with an error.
  pause
  exit /b 1
)

:: Install SaaS API dependencies if node_modules is missing
if not exist "api\node_modules" (
  echo [SAAS] Installing Node.js dependencies for SaaS API...
  cd api
  npm install
  cd ..
)

:: Install Commerce API dependencies if node_modules is missing
if not exist "services\commerce-api\node_modules" (
  if exist "services\commerce-api\package.json" (
    echo [COMMERCE] Installing Node.js dependencies for Commerce API...
    cd services\commerce-api
    npm install
    cd ..\..
  )
)

.venv\Scripts\python.exe scripts\stack_launcher.py --open-browser %*
if errorlevel 1 (
  echo.
  echo Launcher exited with an error.
  pause
)
