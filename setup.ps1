# setup.ps1 - First-time setup for Dataset Manager
# Run this once before using start.ps1

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot

Write-Host ""
Write-Host "=== Dataset Manager - First-Time Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check Python
Write-Host "[1/5] Checking Python..." -ForegroundColor Yellow
$pythonVersion = python --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Python not found. Please install Python 3.10+ and add it to PATH." -ForegroundColor Red
    exit 1
}
Write-Host "  Found: $pythonVersion" -ForegroundColor Green

# Check Node.js
Write-Host "[2/5] Checking Node.js..." -ForegroundColor Yellow
$nodeVersion = node --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Node.js not found. Please install Node.js 18+ and add it to PATH." -ForegroundColor Red
    exit 1
}
Write-Host "  Found: Node $nodeVersion" -ForegroundColor Green

# Create virtual environment
Write-Host "[3/5] Creating Python virtual environment..." -ForegroundColor Yellow
if (Test-Path "$ROOT\venv") {
    Write-Host "  venv already exists, skipping creation." -ForegroundColor DarkGray
} else {
    python -m venv --system-site-packages "$ROOT\venv"
    Write-Host "  venv created at $ROOT\venv (inherits system ML packages)" -ForegroundColor Green
}

# Install Python dependencies
Write-Host "[4/5] Installing Python dependencies..." -ForegroundColor Yellow
& "$ROOT\venv\Scripts\pip.exe" install --upgrade pip --quiet
& "$ROOT\venv\Scripts\pip.exe" install -r "$ROOT\backend\requirements.txt"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: pip install failed." -ForegroundColor Red
    exit 1
}
Write-Host "  Python dependencies installed." -ForegroundColor Green

# Install Node dependencies and build frontend
Write-Host "[5/5] Installing frontend dependencies and building..." -ForegroundColor Yellow
Push-Location "$ROOT\frontend"
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: npm install failed." -ForegroundColor Red
    Pop-Location
    exit 1
}
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: npm run build failed." -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  Frontend built." -ForegroundColor Green

# Copy .env if it doesn't exist
if (-not (Test-Path "$ROOT\.env")) {
    Copy-Item "$ROOT\.env.example" "$ROOT\.env"
    Write-Host ""
    Write-Host "  Created .env from .env.example. Edit it to add your HF_TOKEN if you plan to use PaliGemma-2." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Setup complete! ===" -ForegroundColor Green
Write-Host "Run .\start.ps1 to launch the app." -ForegroundColor Cyan
Write-Host ""
