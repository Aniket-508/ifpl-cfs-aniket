# Shankh.ai - Start All Services
# This script starts the RAG service, backend, and frontend in separate terminals

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  Starting Shankh.ai Services" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# Get the script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Start RAG Service (Python FastAPI)
Write-Host "[1/3] Starting RAG Service on port 8000..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$scriptDir\packages\rag_service'; python server.py"

# Wait a bit for RAG service to start
Start-Sleep -Seconds 3

# Start Backend (Node.js)
Write-Host "[2/3] Starting Backend on port 4000..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$scriptDir\packages\backend'; node server.js"

# Wait a bit for backend to start
Start-Sleep -Seconds 2

# Start Frontend (Vite dev server)
Write-Host "[3/3] Starting Frontend on port 5173..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$scriptDir\packages\frontend'; npm run dev"

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "  All services started!" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  RAG Service:  http://localhost:8000" -ForegroundColor White
Write-Host "  Backend API:  http://localhost:4000" -ForegroundColor White
Write-Host "  Frontend:     http://localhost:5173" -ForegroundColor White
Write-Host ""
Write-Host "  Open your browser and go to http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to continue..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
