@echo off
setlocal

echo Starting TTP Web Development Environment
echo =========================================

set "BACKEND_HOST=127.0.0.1"
set "BACKEND_PORT=8000"
set "FRONTEND_HOST=127.0.0.1"
set "FRONTEND_PORT=5173"

call :check_port_in_use %BACKEND_PORT%
if %errorlevel% equ 0 (
    echo.
    echo Error: port %BACKEND_PORT% is already in use.
    echo Stop the old backend process first so the frontend does not connect to stale code.
    exit /b 1
)

call :check_port_in_use %FRONTEND_PORT%
if %errorlevel% equ 0 (
    echo.
    echo Error: port %FRONTEND_PORT% is already in use.
    echo Stop the old frontend process first.
    exit /b 1
)

echo Starting backend server on http://%BACKEND_HOST%:%BACKEND_PORT%
start "TTP Backend" cmd /k "cd /d %~dp0backend && python -m uvicorn app.main:app --reload --host %BACKEND_HOST% --port %BACKEND_PORT%"

set "BACKEND_READY=0"
for /l %%I in (1,1,20) do (
    call :backend_ready
    if not errorlevel 1 (
        set "BACKEND_READY=1"
        goto backend_ready_done
    )
    timeout /t 1 /nobreak > nul
)

:backend_ready_done
if "%BACKEND_READY%" neq "1" (
    echo.
    echo Error: backend did not become ready with all required API routes.
    echo Expected endpoints: /api/patterns, /api/templates, /api/generation/templates
    exit /b 1
)

echo Starting frontend dev server on http://%FRONTEND_HOST%:%FRONTEND_PORT%
start "TTP Frontend" cmd /k "cd /d %~dp0frontend && npm run dev -- --host %FRONTEND_HOST% --port %FRONTEND_PORT%"

echo.
echo =========================================
echo TTP Web is running!
echo Backend:  http://%BACKEND_HOST%:%BACKEND_PORT%
echo Frontend: http://%FRONTEND_HOST%:%FRONTEND_PORT%
echo API Docs: http://%BACKEND_HOST%:%BACKEND_PORT%/docs
echo =========================================
echo.
echo Press any key to exit this window...
pause > nul
exit /b 0

:check_port_in_use
powershell -NoProfile -Command "$listener = Get-NetTCPConnection -State Listen -LocalPort %1 -ErrorAction SilentlyContinue; if ($listener) { exit 0 } else { exit 1 }"
exit /b %errorlevel%

:check_url_ok
powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri '%~1' -TimeoutSec 2; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { exit 0 } else { exit 1 } } catch { exit 1 }"
exit /b %errorlevel%

:backend_ready
call :check_url_ok http://%BACKEND_HOST%:%BACKEND_PORT%/api/patterns
if errorlevel 1 exit /b 1
call :check_url_ok http://%BACKEND_HOST%:%BACKEND_PORT%/api/templates
if errorlevel 1 exit /b 1
call :check_url_ok http://%BACKEND_HOST%:%BACKEND_PORT%/api/generation/templates
if errorlevel 1 exit /b 1
exit /b 0
