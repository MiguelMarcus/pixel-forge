@echo off
cd /d "%~dp0"
python launch.py
if errorlevel 1 (
  echo Nao foi possivel iniciar o servidor. Abrindo o modo direto, sem analise em segundo plano.
  start "" "%~dp0index.html"
  pause
)
