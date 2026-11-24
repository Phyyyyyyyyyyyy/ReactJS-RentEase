@echo off
rem Start RentEase for development: the API (Node.js) on :8000 and the React dev server on :5173.
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js is not installed. Get version 22.13 or newer from https://nodejs.org/
  goto :error
)
if not exist "backend\node_modules" (
  echo First-time setup: installing backend packages...
  pushd backend & call npm install & popd
)
if not exist "frontend\node_modules" (
  echo First-time setup: installing frontend packages...
  pushd frontend & call npm install & popd
)
start "RentEase API" cmd /k "cd backend && npm start"
start "RentEase web (React)" cmd /k "cd frontend && npm run dev"
echo Opening RentEase at http://localhost:5173/ ...
timeout /t 3 >nul
start "" http://localhost:5173/
exit /b 0

:error
pause
exit /b 1
