@echo off
setlocal
cd /d "%~dp0"
title NEXUS Launcher

rem 1) installed release build
set "INSTALLED=%LOCALAPPDATA%\Programs\NEXUS\NEXUS.exe"
if exist "%INSTALLED%" (
  start "" "%INSTALLED%"
  exit /b 0
)

rem 2) local dev build via bundled electron
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" .
  exit /b 0
)

rem 3) first run: install deps then launch
echo Installing dependencies, please wait...
call npm install
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" .
  exit /b 0
)

echo Launch failed: no installed NEXUS and local dev launch unavailable.
echo Run "release\NEXUS Setup 2.0.3.exe" to install the release build.
pause
endlocal
