@echo off
rem GP-5 Editor (web): levanta el servidor local y abre Chrome/Edge.
cd /d "%~dp0"
if exist "dist\GP-5 Web\GP-5 Web.exe" ( start "" "dist\GP-5 Web\GP-5 Web.exe" & exit /b )
where node >nul 2>&1 && ( node serve.js & exit /b )
echo Necesitas Node.js, o genera el exe con: npm run build:web
pause
