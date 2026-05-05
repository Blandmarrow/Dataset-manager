# start_dev.ps1 - Launch in dev mode (hot reload on both backend and frontend)
# Run in two separate terminals, or use this script which launches both.

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot

if (-not (Test-Path "$ROOT\venv\Scripts\Activate.ps1")) {
    Write-Host "Virtual environment not found. Run setup.ps1 first." -ForegroundColor Red
    exit 1
}

& "$ROOT\venv\Scripts\Activate.ps1"

Push-Location "$ROOT\backend"
python -m alembic upgrade head
Pop-Location

Write-Host "Starting backend on :8000 and frontend dev server on :5173..." -ForegroundColor Cyan
Write-Host "Open http://localhost:5173 in your browser." -ForegroundColor Green
Write-Host ""

# Start backend in background job
$backendJob = Start-Job -ScriptBlock {
    param($root)
    Set-Location $root
    & "$root\venv\Scripts\python.exe" -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir backend
} -ArgumentList $ROOT

# Start frontend dev server in foreground
Push-Location "$ROOT\frontend"
npm run dev
Pop-Location

# Cleanup backend job on exit
Stop-Job $backendJob -ErrorAction SilentlyContinue
Remove-Job $backendJob -ErrorAction SilentlyContinue
