@echo off
REM ── Show Me Skins Companion — Build Script ──────────────────────────────
REM Builds the Go binary and (optionally) the NSIS installer.
REM Version is used for the installer; bump when releasing.

setlocal
set VERSION=0.3.10

echo [1/2] Building Go binary...
REM Build to temp name first (in case exe is locked by running instance)
go build -ldflags="-s -w -H windowsgui -X main.Version=%VERSION%" -o "dist\Companion-Build.exe" .
if %errorlevel% neq 0 (
    echo Build failed!
    exit /b 1
)
copy /Y "dist\Companion-Build.exe" "dist\Show Me Skins Companion.exe" >nul
for %%I in ("dist\Show Me Skins Companion.exe") do echo       Binary size: %%~zI bytes

echo [2/2] Building NSIS installer...
where makensis >nul 2>nul
if %errorlevel% equ 0 (
    makensis /DPRODUCT_VERSION=%VERSION% installer.nsi
) else if exist "C:\Program Files (x86)\NSIS\makensis.exe" (
    "C:\Program Files (x86)\NSIS\makensis.exe" /DPRODUCT_VERSION=%VERSION% installer.nsi
) else (
    echo NSIS not found — skipping installer. Install NSIS to build the installer.
    exit /b 0
)

if %errorlevel% neq 0 (
    echo Installer build failed!
    exit /b 1
)
for %%I in ("dist\Show.Me.Skins.Companion.Setup.%VERSION%.exe") do echo       Installer size: %%~zI bytes

echo.
echo Done! Output in dist\
