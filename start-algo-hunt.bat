@echo off
setlocal
title Algo Hunt
rem ===========================================================================
rem  Algo Hunt - double-click to get the latest version and start the app.
rem
rem  Put this file and the ".env" settings file together in a folder, for
rem  example "Algo Hunt" on the Desktop. Every time it is opened it:
rem    1. downloads the app into an "algo-hunt" folder next to it (the first
rem       time), or gets the latest version from GitHub (every time after),
rem    2. copies the .env settings into the app and runs  npm install,
rem    3. runs  npm run build,
rem    4. runs  npm run start  and opens http://localhost:3000 in the browser.
rem  Keep the window open while you use Algo Hunt. Close it to stop.
rem
rem  Needs Git (https://git-scm.com) and Node.js 24 LTS (https://nodejs.org).
rem  The "algo-hunt" folder always matches GitHub: changes made in it by hand
rem  are replaced. The .env file next to this one is never changed.
rem ===========================================================================

rem ---- Settings (filled in by the admin) ------------------------------------
set "REPO=harshgupta20/algo-hunt"
set "BRANCH=main"
rem  A GitHub token that can read the repository: GitHub - Settings - Developer
rem  settings - Fine-grained tokens - only this repository - Contents: Read-only.
rem  Leave it as it is if the repository is public.
set "GITHUB_TOKEN=PASTE_YOUR_GITHUB_TOKEN_HERE"
set "PORT=3000"
rem ---------------------------------------------------------------------------

set "HERE=%~dp0"
set "APP=%HERE%algo-hunt"
set "PLAIN_URL=https://github.com/%REPO%.git"
set "URL=%PLAIN_URL%"
if not "%GITHUB_TOKEN%"=="PASTE_YOUR_GITHUB_TOKEN_HERE" if not "%GITHUB_TOKEN%"=="" set "URL=https://x-access-token:%GITHUB_TOKEN%@github.com/%REPO%.git"
rem Never stop to ask for a GitHub password - a missing or expired token is reported instead.
set "GIT_TERMINAL_PROMPT=0"
set "GCM_INTERACTIVE=never"

echo.
echo  ============================================================
echo    Algo Hunt
echo  ============================================================

rem ---- Checks ----------------------------------------------------------------
if exist "%HERE%package.json" goto in_project
where git >nul 2>nul
if errorlevel 1 goto no_git
where node >nul 2>nul
if errorlevel 1 goto no_node
if not exist "%HERE%.env" goto no_env

rem Already running? Then just open it (never two copies at once).
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if errorlevel 1 goto get_latest
echo.
echo  Algo Hunt is already running - opening it in your browser.
start "" "http://localhost:%PORT%"
timeout /t 5 >nul
exit /b 0

rem ---- 1. Latest version -----------------------------------------------------
:get_latest
echo.
echo  [1/4] Getting the latest version of Algo Hunt...
if exist "%APP%\.git" goto pull

:clone
echo        Downloading the app - this takes a minute or two...
rem A half-finished earlier download would block this one.
if exist "%APP%" rd /s /q "%APP%"
git clone --quiet --branch %BRANCH% "%URL%" "%APP%"
if errorlevel 1 goto clone_failed
rem Keep the token out of the app folder's settings.
git -C "%APP%" remote set-url origin "%PLAIN_URL%"
goto show_version

:pull
git -C "%APP%" fetch --quiet "%URL%" %BRANCH%
if errorlevel 1 goto offline
git -C "%APP%" reset --quiet --hard FETCH_HEAD
if errorlevel 1 goto fresh_copy
goto show_version

:fresh_copy
echo        The app folder is damaged - downloading a fresh copy...
goto clone

:offline
echo        Could not reach GitHub ^(no internet, or the token has expired^).
echo        Starting the version already on this computer.
goto show_version

:show_version
for /f %%v in ('git -C "%APP%" rev-parse --short HEAD') do set "VERSION=%%v"
for /f %%d in ('git -C "%APP%" log -1 --date^=short --format^=%%ad') do set "VERSION_DATE=%%d"
echo        Version %VERSION% from %VERSION_DATE%

rem ---- 2. Settings + packages ------------------------------------------------
echo.
echo  [2/4] Installing packages - can take a few minutes the first time...
copy /y "%HERE%.env" "%APP%\.env" >nul
cd /d "%APP%"
call npm install --no-audit --no-fund --loglevel=error
if not errorlevel 1 goto build
if not exist "node_modules" goto install_failed
echo        Installing failed - continuing with the packages already installed.

rem ---- 3. Build --------------------------------------------------------------
:build
echo.
echo  [3/4] Preparing the app - about 1 to 3 minutes, please wait...
call npm run build
if errorlevel 1 goto build_failed

rem ---- 4. Start --------------------------------------------------------------
echo.
echo  [4/4] Starting Algo Hunt...
rem Open the browser as soon as the app answers (quietly, in this same window).
start "" /b powershell -NoProfile -Command "$ProgressPreference = 'SilentlyContinue'; for ($i = 0; $i -lt 120; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:%PORT%/login' | Out-Null; Start-Process 'http://localhost:%PORT%'; break } catch { Start-Sleep -Seconds 1 } }"
echo.
echo  ============================================================
echo    Algo Hunt opens in your browser:  http://localhost:%PORT%
echo    Keep this window open while you use it.
echo    To stop Algo Hunt, close this window.
echo  ============================================================
echo.
call npm run start
echo.
echo  Algo Hunt has stopped. Double-click this file to start it again.
goto end

rem ---- Problems --------------------------------------------------------------
:in_project
echo.
echo  This file is meant to be copied into its own folder ^(for example "Algo Hunt"
echo  on the Desktop^) together with the .env file - not run inside the project.
goto end

:no_git
echo.
echo  Git is not installed on this computer.
echo  Install it from https://git-scm.com ^(keep the default options^), then start again.
goto end

:no_node
echo.
echo  Node.js is not installed on this computer.
echo  Install the LTS version from https://nodejs.org, then start again.
goto end

:no_env
echo.
echo  The settings file ".env" is missing. Put it in this folder:
echo    %HERE%
echo  then start again. Your admin has it.
goto end

:clone_failed
echo.
echo  The app could not be downloaded from GitHub.
echo  Check the internet connection. If it keeps failing, the GitHub token in this
echo  file may be missing or expired - tell your admin.
goto end

:install_failed
echo.
echo  Installing the packages failed - see the messages above.
echo  Check the internet connection and start again, or send a photo of this window to your admin.
goto end

:build_failed
echo.
echo  Preparing the app failed - see the messages above.
echo  Send a photo of this window to your admin.
goto end

:end
echo.
pause
exit /b 1
