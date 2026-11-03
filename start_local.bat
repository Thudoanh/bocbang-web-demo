@echo off
title Boc Bang AI - Local Launcher
echo ========================================================
echo   Dang khoi dong Boc Bang AI (Backend + Frontend)...
echo ========================================================

start "BocBang Backend (FastAPI)" cmd /k "cd /d %~dp0backend && set PYTHONPATH=. && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

timeout /t 2 /nobreak >nul

start "BocBang Frontend (Vite)" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 3 /nobreak >nul

start http://localhost:5173/

echo.
echo Da khoi dong xong! Ban co the truy cap tai: http://localhost:5173
echo Swagger API docs: http://localhost:8000/api/v1/docs
echo.
