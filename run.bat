@echo off
rem Start RentEase for development: Django API on :8000 and the React dev server on :5173.
cd /d "%~dp0"
if not exist "backend\venv\Scripts\python.exe" (
  echo First-time setup: creating the Python environment...
  python -m venv backend\venv || goto :error
  backend\venv\Scripts\python.exe -m pip install -r backend\requirements.txt || goto :error
)
if not exist "backend\.env" (
  echo Missing backend\.env. Copy backend\.env.example to backend\.env and fill it in.
  goto :error
)
if not exist "frontend\node_modules" (
  echo First-time setup: installing frontend packages...
  pushd frontend & call npm install & popd
)
backend\venv\Scripts\python.exe backend\manage.py migrate || goto :error
start "RentEase API (Django)" cmd /k "backend\venv\Scripts\python.exe backend\manage.py runserver 127.0.0.1:8000"
start "RentEase web (React)" cmd /k "cd frontend && npm run dev"
echo Opening RentEase at http://localhost:5173/ ...
timeout /t 3 >nul
start "" http://localhost:5173/
exit /b 0

:error
pause
exit /b 1
