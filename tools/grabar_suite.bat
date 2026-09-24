@echo off
rem Abre Valeton Suite con el grabador activo. Haz UNA subida (IR, SnapTone o preset)
rem y cierra Valeton Suite: la grabacion queda en capturas\<nombre>.jsonl
setlocal
set NAME=%~1
if "%NAME%"=="" set /p NAME=Nombre de la grabacion (ir, snaptone, preset): 
cd /d "%~dp0.."
if not exist capturas mkdir capturas
taskkill /IM "Valeton Suite.exe" /F >nul 2>&1
echo.
echo Grabando en capturas\%NAME%.jsonl
echo 1. Espera a que Valeton Suite conecte con el pedal.
echo 2. Haz la subida (solo una).
echo 3. Cierra Valeton Suite para terminar.
echo.
python -u tools\suite_sniffer.py "capturas\%NAME%.jsonl" --spawn
pause
