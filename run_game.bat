@echo off
cd /d "%~dp0"
echo Iniciando servidor local do Viriato em http://localhost:8000 ...
python -m http.server 8000
pause
