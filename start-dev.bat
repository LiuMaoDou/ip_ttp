@echo off
echo Starting TTP Web Development Environment
echo =========================================

:: Start backend
echo Starting backend server on http://localhost:8000
start cmd /k "cd /d %~dp0backend && python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

:: Wait for backend to start
timeout /t 3 /nobreak > nul

:: Start frontend
echo Starting frontend dev server on http://localhost:5173
start cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo =========================================
echo TTP Web is running!
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo API Docs: http://localhost:8000/docs
echo =========================================
echo.
echo Press any key to exit this window...
pause > nul
