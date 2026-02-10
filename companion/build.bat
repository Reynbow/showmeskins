@echo off
REM ── Show Me Skins Companion — Build Script ──────────────────────────────
REM Builds the Go binary and (optionally) the NSIS installer.

setlocal

echo [1/2] Building Go binary...
go build -ldflags="-s -w -H windowsgui" -o "dist\Show Me Skins Companion.exe" .
if %errorlevel% neq 0 (
    echo Build failed!
    exit /b 1
)
for %%I in ("dist\Show Me Skins Companion.exe") do echo       Binary size: %%~zI bytes

echo [2/2] Building NSIS installer...
where makensis >nul 2>nul
if %errorlevel% equ 0 (
    makensis installer.nsi
) else if exist "C:\Program Files (x86)\NSIS\makensis.exe" (
    "C:\Program Files (x86)\NSIS\makensis.exe" installer.nsi
) else (
    echo NSIS not found — skipping installer. Install NSIS to build the installer.
    exit /b 0
)

if %errorlevel% neq 0 (
    echo Installer build failed!
    exit /b 1
)
for %%I in ("dist\Show Me Skins Companion Setup 0.2.0.exe") do echo       Installer size: %%~zI bytes

echo.
echo Done! Output in dist\
