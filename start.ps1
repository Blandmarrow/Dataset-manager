# start.ps1 - Launch Dataset Manager
# Run setup.ps1 first if this is your first time.

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot

# Check venv exists
if (-not (Test-Path "$ROOT\venv\Scripts\Activate.ps1")) {
    Write-Host "Virtual environment not found. Running setup first..." -ForegroundColor Yellow
    & "$ROOT\setup.ps1"
}

# Activate venv
& "$ROOT\venv\Scripts\Activate.ps1"

Write-Host ""
Write-Host "=== Dataset Manager ===" -ForegroundColor Cyan

# Run DB migrations
Write-Host "Running database migrations..." -ForegroundColor Yellow
Push-Location "$ROOT\backend"
python -m alembic upgrade head
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Database migration failed." -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  Migrations applied." -ForegroundColor Green

# Build frontend if dist is missing or any source file is newer than the last build
$distIndex = "$ROOT\frontend\dist\index.html"
$needsBuild = -not (Test-Path $distIndex)

if (-not $needsBuild) {
    $distTime = (Get-Item $distIndex).LastWriteTime
    $changed = Get-ChildItem "$ROOT\frontend" -Recurse -File |
        Where-Object { $_.FullName -notmatch '\\(node_modules|dist)\\' -and $_.LastWriteTime -gt $distTime }
    if ($changed) { $needsBuild = $true }
}

if ($needsBuild) {
    Write-Host "Building frontend..." -ForegroundColor Yellow
    Push-Location "$ROOT\frontend"
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Frontend build failed." -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Host "  Frontend built." -ForegroundColor Green
}

# Launch server
Write-Host ""
Write-Host "Starting server at http://localhost:8000" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

Set-Location "$ROOT"
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
