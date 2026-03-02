@echo off
echo Starting Expo Asset App...
echo.
echo [1/2] Checking dependencies...
if not exist "node_modules" call npm.cmd install
if not exist "server\node_modules" cd server && call npm.cmd install && cd ..
if not exist "client\node_modules" cd client && call npm.cmd install && cd ..

echo.
echo [2/2] Launching services...
echo Server will run on port 5000 (with in-memory DB)
echo Client will run on port 5173
echo.
echo Press Ctrl+C to stop both services.
echo.

call npm.cmd run dev
pause
