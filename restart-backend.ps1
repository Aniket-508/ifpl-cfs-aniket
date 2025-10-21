# Restart Backend Script
# Use this to restart just the backend service

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  Restarting Shankh.ai Backend" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# Kill existing backend processes on port 4000
Write-Host "Stopping existing backend..." -ForegroundColor Yellow
$processesToKill = Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($processesToKill) {
    foreach ($pid in $processesToKill) {
        Write-Host "  Killing process $pid" -ForegroundColor Gray
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

Write-Host "✓ Backend stopped" -ForegroundColor Green
Write-Host ""

# Start backend
Write-Host "Starting backend with updated configuration..." -ForegroundColor Yellow
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$scriptDir\packages\backend'; node server.js"

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "  Backend Restarted!" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Backend running on http://localhost:4000" -ForegroundColor White
Write-Host "  Check the new backend terminal for startup messages" -ForegroundColor White
Write-Host ""
Write-Host "  Look for:" -ForegroundColor Cyan
Write-Host "    - RAG Service: http://127.0.0.1:8000 ✓" -ForegroundColor Gray
Write-Host "    - RAG: ✓" -ForegroundColor Gray
Write-Host ""
Write-Host "Press any key to continue..."
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
