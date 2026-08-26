@echo off
rem Safehouse - one command to get a working dev server.
rem
rem   start.bat    checks the tools, starts the database, migrates it, then
rem                runs the dev server on http://localhost:4021
rem
rem It fixes what it safely can on its own - launching Docker Desktop, installing
rem project dependencies - and asks first before installing anything onto the
rem machine itself. Every step that fails says why and stops; nothing here
rem carries on hoping the next step will work.
rem
rem Ports come from C:\Projects\project-ports.md: 4021 dev server, 4020 the
rem packaged app (docker compose up --build), 5435 Postgres on the host.

setlocal enableextensions enabledelayedexpansion
cd /d "%~dp0"

call :ensure_node || goto :failed
call :ensure_env || goto :failed
call :ensure_dependencies || goto :failed
call :ensure_docker || goto :failed

echo Starting the database...
docker compose up -d --wait --wait-timeout 120 db || goto :failed
echo.

echo Applying migrations...
call npm run db:migrate || goto :failed
echo.

call :warn_if_port_taken 4021

echo Dev server: http://localhost:4021
echo Ctrl+C stops it. The database keeps running - "docker compose down" stops that.
echo.
call npm run dev
goto :end


rem --- Node ---------------------------------------------------------------
rem The app needs Node 24 or newer (see "engines" in package.json).
:ensure_node
where node >nul 2>nul
if errorlevel 1 (
  echo Node is not installed.
  call :offer_winget "OpenJS.NodeJS.LTS" "Node" "https://nodejs.org" || exit /b 1
  rem winget installed it, but this window's PATH was read before that happened.
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
  where node >nul 2>nul || (
    echo   Node is installed, but this window cannot see it yet.
    echo   Close this window, open a new one, and run start.bat again.
    exit /b 1
  )
)
for /f "tokens=1 delims=." %%v in ('node -v') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=!NODE_MAJOR:v=!"
if !NODE_MAJOR! lss 24 (
  echo Node !NODE_MAJOR! is installed, but Safehouse needs Node 24 or newer.
  call :offer_winget "OpenJS.NodeJS.LTS" "a current Node" "https://nodejs.org" || exit /b 1
  echo   Close this window, open a new one, and run start.bat again.
  exit /b 1
)
exit /b 0


rem --- Local settings -----------------------------------------------------
:ensure_env
if not exist ".env" (
  echo No .env found - copying .env.example.
  copy /y ".env.example" ".env" >nul || exit /b 1
  echo   Those are development passwords. Change them before real documents go in.
  echo.
  exit /b 0
)
rem An .env written before a setting was added fails much later, somewhere
rem confusing. Compare it against .env.example here instead.
set "MISSING="
for /f "usebackq tokens=1 delims==" %%k in (`findstr /r /c:"^[A-Z][A-Z0-9_]*=" ".env.example"`) do (
  findstr /b /c:"%%k=" ".env" >nul || set "MISSING=!MISSING! %%k"
)
if defined MISSING (
  echo Your .env is missing:!MISSING!
  echo Copy those lines over from .env.example, then run start.bat again.
  exit /b 1
)
exit /b 0


rem --- Dependencies -------------------------------------------------------
:ensure_dependencies
if not exist "node_modules" (
  echo Installing dependencies - the first run takes a few minutes...
  if exist "package-lock.json" (call npm ci) else (call npm install)
  if errorlevel 1 exit /b 1
  echo.
  goto :stamp_dependencies
)
rem A lockfile newer than node_modules means somebody changed dependencies.
node -e "const fs=require('fs');process.exit(fs.statSync('node_modules').mtimeMs < fs.statSync('package-lock.json').mtimeMs ? 1 : 0)" 2>nul
if errorlevel 1 (
  echo Dependencies changed since the last install - updating...
  call npm install || exit /b 1
  echo.
  goto :stamp_dependencies
)
exit /b 0

:stamp_dependencies
rem npm leaves node_modules untouched when it had nothing to do, which would
rem make the check above fire again on every run. Mark it done.
node -e "const fs=require('fs'),now=new Date();fs.utimesSync('node_modules',now,now)" 2>nul
exit /b 0


rem --- Docker -------------------------------------------------------------
:ensure_docker
where docker >nul 2>nul
if errorlevel 1 (
  echo Docker is not installed.
  call :offer_winget "Docker.DockerDesktop" "Docker Desktop" "https://docs.docker.com/desktop/setup/install/windows-install/" || exit /b 1
  echo   Start Docker Desktop, let it finish its first-run setup, then run
  echo   start.bat again.
  exit /b 1
)

docker info >nul 2>nul
if not errorlevel 1 exit /b 0

set "DOCKER_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if not exist "!DOCKER_EXE!" set "DOCKER_EXE=%ProgramW6432%\Docker\Docker\Docker Desktop.exe"
if not exist "!DOCKER_EXE!" set "DOCKER_EXE=%LOCALAPPDATA%\Docker\Docker Desktop.exe"
if not exist "!DOCKER_EXE!" (
  echo Docker is installed but not running, and Docker Desktop.exe is not where
  echo this script looked. Start Docker yourself, then run start.bat again.
  exit /b 1
)

echo Docker is not running - starting Docker Desktop...
start "" "!DOCKER_EXE!"

rem A cold start is slow; a minute or two is normal on this machine.
set /a WAITED=0
:docker_wait
ping -n 4 127.0.0.1 >nul
set /a WAITED+=3
docker info >nul 2>nul
if not errorlevel 1 (
  echo.
  echo   Docker came up after !WAITED! seconds.
  echo.
  exit /b 0
)
if !WAITED! geq 180 (
  echo.
  echo   Docker has not come up after three minutes. Check the Docker Desktop
  echo   window - it may be waiting for you - then run start.bat again.
  exit /b 1
)
<nul set /p "=."
goto :docker_wait


rem --- Small helpers ------------------------------------------------------
rem %1 winget package id, %2 what to call it, %3 where to get it by hand.
:offer_winget
where winget >nul 2>nul
if errorlevel 1 (
  echo   winget is not available here, so this script cannot install it for you.
  echo   Install %~2 from %~3 and run start.bat again.
  exit /b 1
)
choice /c YN /n /m "  Install %~2 now with winget? [Y/N] "
if errorlevel 2 (
  echo   Left alone. Install %~2 from %~3 when you are ready.
  exit /b 1
)
echo.
winget install --id %~1 --exact --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo   winget could not install %~2. Install it from %~3 by hand.
  exit /b 1
)
echo.
exit /b 0

rem Vite quietly moves to another port when its own is taken, which looks like
rem the app running twice. Say so before it happens.
:warn_if_port_taken
netstat -ano | findstr ":%~1 " | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo Note: something is already listening on port %~1. If that is another copy
  echo of this script, use its window instead - this one will land on a different
  echo port, printed below.
  echo.
)
exit /b 0


:failed
echo.
echo Startup stopped - the reason is above this line.
pause
exit /b 1

:end
endlocal
exit /b 0
