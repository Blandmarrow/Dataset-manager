# update.ps1 - Pull latest code and update dependencies

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot

Write-Host ""
Write-Host "=== Dataset Manager - Update ===" -ForegroundColor Cyan
Write-Host ""

# Check git
Write-Host "[1/4] Pulling latest changes..." -ForegroundColor Yellow
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  git not found - skipping pull. Update the files manually if needed." -ForegroundColor DarkGray
} else {
    git -C "$ROOT" pull
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: git pull failed. Resolve any conflicts and try again." -ForegroundColor Red
        exit 1
    }
    Write-Host "  Done." -ForegroundColor Green
}

# Ensure venv exists
if (-not (Test-Path "$ROOT\venv\Scripts\Activate.ps1")) {
    Write-Host "Virtual environment not found. Running setup first..." -ForegroundColor Yellow
    & "$ROOT\setup.ps1"
    Write-Host ""
    Write-Host "=== Update complete (full setup was run) ===" -ForegroundColor Green
    exit 0
}

& "$ROOT\venv\Scripts\Activate.ps1"

# Update Python dependencies
Write-Host "[2/4] Updating Python dependencies..." -ForegroundColor Yellow
& "$ROOT\venv\Scripts\pip.exe" install --upgrade pip --quiet
& "$ROOT\venv\Scripts\pip.exe" install -r "$ROOT\backend\requirements.txt"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: pip install failed." -ForegroundColor Red
    exit 1
}
Write-Host "  Done." -ForegroundColor Green

# Update npm dependencies and rebuild frontend
Write-Host "[3/4] Updating frontend dependencies..." -ForegroundColor Yellow
Push-Location "$ROOT\frontend"
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: npm install failed." -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  Done." -ForegroundColor Green

Write-Host "[4/4] Building frontend..." -ForegroundColor Yellow
Push-Location "$ROOT\frontend"
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Frontend build failed." -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  Done." -ForegroundColor Green

Write-Host ""
Write-Host "=== Update complete! ===" -ForegroundColor Green
Write-Host "Database migrations will run automatically on next start." -ForegroundColor DarkGray
Write-Host ""
