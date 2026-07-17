@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable.
  echo Installe Node.js puis relance ce fichier.
  pause
  exit /b 1
)

start "Stock Manager Server" /D "%~dp0" cmd /k node server.js
timeout /t 1 /nobreak >nul
start "" "http://localhost:3000"
