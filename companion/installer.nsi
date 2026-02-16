; ═══════════════════════════════════════════════════════════════════════════════
; Show Me Skins Companion — NSIS Installer
; Standalone installer for the Go-based companion binary.
; ═══════════════════════════════════════════════════════════════════════════════

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; ── App metadata ──────────────────────────────────────────────────────────────
; PRODUCT_VERSION can be overridden: makensis /DPRODUCT_VERSION=0.3.0 installer.nsi

!ifndef PRODUCT_VERSION
!define PRODUCT_VERSION "0.3.9"
!endif

!define PRODUCT_NAME "Show Me Skins Companion"
!define PRODUCT_EXE  "Show Me Skins Companion.exe"
!define PRODUCT_PUBLISHER "Show Me Skins"
!define PRODUCT_URL "https://www.showmeskins.com"

Var CreateDesktopShortcut
Var CreateStartMenuShortcut

Name "${PRODUCT_NAME}"
; Use dotted filename to match GitHub release asset URL pattern
OutFile "dist\Show.Me.Skins.Companion.Setup.${PRODUCT_VERSION}.exe"
InstallDir "$LOCALAPPDATA\${PRODUCT_NAME}"
InstallDirRegKey HKCU "Software\${PRODUCT_NAME}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

; ── MUI settings ──────────────────────────────────────────────────────────────

!define MUI_ABORTWARNING

; ── Pages ─────────────────────────────────────────────────────────────────────

!insertmacro MUI_PAGE_DIRECTORY
Page custom ShortcutsPageCreate ShortcutsPageLeave "Shortcuts"
!insertmacro MUI_PAGE_INSTFILES

; Custom finish page
!define MUI_FINISHPAGE_TEXT "${PRODUCT_NAME} has been installed!$\r$\n$\r$\nThis application runs in the system tray only — there is no application window.$\r$\n$\r$\nAfter launching, look for the hexagon icon in your system tray (bottom-right of your taskbar). Right-click it for options."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${PRODUCT_NAME}"
!define MUI_FINISHPAGE_RUN_CHECKED
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Start automatically when I log in to Windows"
!define MUI_FINISHPAGE_SHOWREADME_CHECKED
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION WriteAutoStartKey
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; ── Language ──────────────────────────────────────────────────────────────────

!insertmacro MUI_LANGUAGE "English"

; ── Shortcuts options page ───────────────────────────────────────────────────

Var Dialog
Var DesktopCheckbox
Var StartMenuCheckbox

Function ShortcutsPageCreate
  nsDialogs::Create 1018
  pop $Dialog

  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateCheckbox} 0 0 100% 12u "Create a desktop shortcut"
  Pop $DesktopCheckbox
  ${NSD_Check} $DesktopCheckbox

  ${NSD_CreateCheckbox} 0 18u 100% 12u "Create a Start Menu shortcut"
  Pop $StartMenuCheckbox
  ${NSD_Check} $StartMenuCheckbox

  nsDialogs::Show
FunctionEnd

Function ShortcutsPageLeave
  ${NSD_GetState} $DesktopCheckbox $CreateDesktopShortcut
  ${NSD_GetState} $StartMenuCheckbox $CreateStartMenuShortcut
FunctionEnd

; ── Installer section ─────────────────────────────────────────────────────────

Section "Install"
  SetOutPath "$INSTDIR"

  ; Kill any running instance before overwriting
  nsExec::ExecToLog 'taskkill /F /IM "${PRODUCT_EXE}"'
  nsExec::ExecToLog 'taskkill /F /IM "Companion-Build.exe"'

  ; Remove old exe and any leftover Companion-Build.exe from failed updates
  Delete "$INSTDIR\${PRODUCT_EXE}"
  Delete "$INSTDIR\Companion-Build.exe"

  ; Extract directly as final exe name (avoids rename leaving old file on upgrade)
  File "/oname=${PRODUCT_EXE}" "dist\Companion-Build.exe"

  ; Remove any stale auto-start entry (re-added by finish page if checked)
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"

  ; Save install dir to registry
  WriteRegStr HKCU "Software\${PRODUCT_NAME}" "InstallDir" "$INSTDIR"

  ; Create shortcuts based on user selection
  ${If} $CreateDesktopShortcut == 1
    CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}" "" "$INSTDIR\${PRODUCT_EXE}" 0
  ${EndIf}
  ${If} $CreateStartMenuShortcut == 1
    CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
    CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}" "" "$INSTDIR\${PRODUCT_EXE}" 0
  ${EndIf}

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Add/Remove Programs entry
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "URLInfoAbout" "${PRODUCT_URL}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "NoRepair" 1

  ; Estimated installed size in KB (~8 MB)
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "EstimatedSize" 8192
SectionEnd

; ── Finish page functions ─────────────────────────────────────────────────────

Function LaunchApp
  ; Launch detached so the installer closes immediately
  ExecShell "" '"$INSTDIR\${PRODUCT_EXE}"'
FunctionEnd

Function WriteAutoStartKey
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" \
    "${PRODUCT_NAME}" '"$INSTDIR\${PRODUCT_EXE}"'
FunctionEnd

; ── Uninstaller section ───────────────────────────────────────────────────────

Section "Uninstall"
  ; Kill running instance
  nsExec::ExecToLog 'taskkill /F /IM "${PRODUCT_EXE}"'

  ; Remove auto-start entry
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"

  ; Remove shortcuts (created by us in current or previous installs)
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

  ; Remove files (including Companion-Build.exe from any failed upgrade)
  Delete "$INSTDIR\${PRODUCT_EXE}"
  Delete "$INSTDIR\Companion-Build.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  ; Remove registry entries
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
  DeleteRegKey HKCU "Software\${PRODUCT_NAME}"
SectionEnd
