@echo off
rem Safehouse - one command to get a working dev server.
rem
rem   start.bat    checks the tools, starts the database, migrates it, makes
rem                the encryption key on a first run, offers the sample
rem                household when the vault is empty, then runs the dev server
rem                on http://localhost:4021 and opens it in the browser
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

rem Re-entered by itself, in the background, to open the browser once the
rem server answers (see the end of the main steps).
if "%~1"==":open_when_ready" goto :open_when_ready

call :ensure_node || goto :failed
call :ensure_env || goto :failed
call :ensure_dependencies || goto :failed
call :ensure_docker || goto :failed
call :check_reader

echo Starting the database...
docker compose up -d --wait --wait-timeout 120 db || goto :failed
echo.

echo Applying migrations...
call npm run db:migrate || goto :failed
echo.

call :ensure_key || goto :failed
call :offer_sample_household || goto :failed
call :warn_if_port_taken 4021

echo Dev server: http://localhost:4021 - it opens in your browser when ready.
echo Ctrl+C stops it. The database keeps running - "docker compose down" stops that.
echo.
start "" /b cmd /c call "%~f0" :open_when_ready
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
rem confusing. Compare it against .env.example here instead. A setting left
rem empty in the example is optional (the notification webhook), so only the
rem ones with a value there are required.
set "MISSING="
for /f "usebackq tokens=1,* delims==" %%k in (`findstr /r /c:"^[A-Z][A-Z0-9_]*=" ".env.example"`) do (
  if not "%%l"=="" (
    findstr /b /c:"%%k=" ".env" >nul || set "MISSING=!MISSING! %%k"
  )
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
set "DOCKER_EXE="
for %%p in ("%ProgramFiles%\Docker\Docker" "%ProgramW6432%\Docker\Docker" "%LOCALAPPDATA%\Docker") do (
  if not defined DOCKER_EXE if exist "%%~p\Docker Desktop.exe" set "DOCKER_EXE=%%~p\Docker Desktop.exe"
)

where docker >nul 2>nul
if errorlevel 1 if defined DOCKER_EXE (
  rem Installed, but this window's PATH was read before the installer set it.
  for %%d in ("!DOCKER_EXE!") do set "PATH=%%~dpdresources\bin;!PATH!"
)
where docker >nul 2>nul
if errorlevel 1 (
  if defined DOCKER_EXE (
    echo Docker Desktop is installed, but this window cannot find its docker
    echo command. Close this window, open a new one, and run start.bat again.
    exit /b 1
  )
  echo Docker is not installed.
  call :offer_winget "Docker.DockerDesktop" "Docker Desktop" "https://docs.docker.com/desktop/setup/install/windows-install/" || exit /b 1
  echo   Start Docker Desktop, let it finish its first-run setup, then run
  echo   start.bat again.
  exit /b 1
)

call :docker_engine
if "!ENGINE!"=="linux" exit /b 0

if "!ENGINE!"=="windows" (
  rem The database image is Linux; in Windows-containers mode the pull fails
  rem with a manifest error that names neither cause nor cure.
  echo Docker is running Windows containers. Safehouse needs Linux containers.
  set "DOCKER_CLI="
  for %%d in ("!DOCKER_EXE!") do if exist "%%~dpdDockerCli.exe" set "DOCKER_CLI=%%~dpdDockerCli.exe"
  if not defined DOCKER_CLI (
    echo   Right-click the Docker icon by the clock, choose "Switch to Linux
    echo   containers", then run start.bat again.
    exit /b 1
  )
  echo   Switching Docker to Linux containers...
  "!DOCKER_CLI!" -SwitchLinuxEngine
) else (
  if not defined DOCKER_EXE (
    echo Docker is installed but not running, and Docker Desktop.exe is not where
    echo this script looked. Start Docker yourself, then run start.bat again.
    exit /b 1
  )
  echo Docker is not running - starting Docker Desktop...
  start "" "!DOCKER_EXE!"
)

rem A cold start is slow; a minute or two is normal on this machine.
set /a WAITED=0
:docker_wait
ping -n 4 127.0.0.1 >nul
set /a WAITED+=3
call :docker_engine
if "!ENGINE!"=="linux" (
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

rem Sets ENGINE to linux or windows when the daemon answers, empty when it
rem does not.
:docker_engine
set "ENGINE="
for /f "delims=" %%o in ('docker info --format "{{.OSType}}" 2^>nul') do set "ENGINE=%%o"
exit /b 0


rem --- The reader -----------------------------------------------------------
rem Optional in development: without Tesseract, uploads are filed and simply
rem not read (app/ocr.server.ts). Say so here, because in the app it looks like
rem a reader that found nothing.
:check_reader
where tesseract >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\Tesseract-OCR\tesseract.exe" (
  set "PATH=%ProgramFiles%\Tesseract-OCR;!PATH!"
)
where tesseract >nul 2>nul
if errorlevel 1 (
  echo Note: Tesseract is not installed, so uploads are filed but not read and
  echo no fields are proposed from scans. To turn reading on:
  echo   winget install --id UB-Mannheim.TesseractOCR --exact
  echo.
  exit /b 0
)
rem The container reads the passport model from /usr/share; here it is the
rem repository's own tessdata folder.
if not defined SAFEHOUSE_TESSDATA_DIR set "SAFEHOUSE_TESSDATA_DIR=%CD%\tessdata"
if not exist "!SAFEHOUSE_TESSDATA_DIR!\mrz.traineddata" (
  echo Note: no passport model in tessdata\, so passport and ID strips are not
  echo read. tessdata\README.md says where it comes from.
  echo.
)
exit /b 0


rem --- The encryption key ---------------------------------------------------
rem Every document is sealed under this key (D12), and the dashboard reads it,
rem so a first run makes one. key:make refuses to overwrite an existing key -
rem a new key would make every document already filed unreadable - so this
rem only ever runs when there is none.
:ensure_key
set "KEY_FILE=./keys/safehouse.key"
for /f "usebackq tokens=1,* delims==" %%a in (`findstr /b /c:"SAFEHOUSE_KEY_FILE=" ".env"`) do set "KEY_FILE=%%b"
set "KEY_FILE=!KEY_FILE:/=\!"
if exist "!KEY_FILE!" exit /b 0
echo No encryption key yet - making one at !KEY_FILE!...
call npm run key:make || exit /b 1
echo   Back it up somewhere other than this machine. Lose it and every document
echo   filed under it is gone, backups included. See docs\OPERATIONS.md.
echo.
exit /b 0


rem --- An empty vault -----------------------------------------------------
rem With no accounts, Safehouse opens on /setup to create the first
rem administrator: the real first run. For a look around, the fictional
rem sample household is one keypress away. No is the default, after 10 seconds.
:offer_sample_household
set "ACCOUNTS="
for /f %%n in ('docker compose exec -T db psql -U safehouse -d safehouse -tAc "select count(*) from users" 2^>nul') do set "ACCOUNTS=%%n"
if not "!ACCOUNTS!"=="0" exit /b 0
echo The vault is empty. The browser will open on the page that creates the
echo first administrator.
choice /c YN /n /t 10 /d N /m "  Fill it with the fictional sample household instead? [Y/N] "
if errorlevel 2 (
  echo.
  exit /b 0
)
echo.
call npm run db:seed || exit /b 1
echo   Sign in as priya@example.invalid, the administrator, with the password
echo   the seed printed above.
echo.
exit /b 0


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


:open_when_ready
rem Up to two minutes: the first compile can be slow.
for /l %%i in (1,1,120) do (
  curl -s -o nul http://localhost:4021/sign-in >nul 2>nul && (
    start "" http://localhost:4021
    exit /b 0
  )
  ping -n 2 127.0.0.1 >nul
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
