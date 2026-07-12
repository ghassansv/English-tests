@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run this app.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required to run this app.
  echo Install Node.js with npm, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

set PORT=3000

powershell -NoProfile -Command "$connection = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($connection) { $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $connection.OwningProcess); if ($process.Name -eq 'node.exe' -and ($process.CommandLine -like '*server.js*' -or $process.CommandLine -like '*npm-cli.js* start*')) { Stop-Process -Id $connection.OwningProcess -Force; Start-Sleep -Seconds 1 } else { exit 2 } }"
if errorlevel 2 (
  echo Port 3000 is already used by another app.
  pause
  exit /b 1
)

echo Starting English Word Vault at http://localhost:%PORT%
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:%PORT%'"
call npm start

pause
