; ────────────────────────────────────────────────────────────────────────────
; Show Me Skins Companion - Custom NSIS installer finish page
; Adds a tray-only notice, a launch checkbox, and an auto-start checkbox.
; ────────────────────────────────────────────────────────────────────────────

!ifndef BUILD_UNINSTALLER

  ; ── Custom finish page ──────────────────────────────────────────────────

  !macro customFinishPage
    !define MUI_FINISHPAGE_TEXT "Show Me Skins Companion has been installed!$\r$\n$\r$\nThis application runs in the system tray only - there is no application window.$\r$\n$\r$\nAfter launching, look for the gold hexagon icon in your system tray (bottom-right of your taskbar). Right-click it for options."

    ; "Launch now" checkbox — uses a function so we can launch async (avoids hang)
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_TEXT "Launch Show Me Skins Companion"
    !define MUI_FINISHPAGE_RUN_CHECKED
    !define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp

    ; "Start on login" checkbox — repurposes the SHOWREADME slot
    !define MUI_FINISHPAGE_SHOWREADME
    !define MUI_FINISHPAGE_SHOWREADME_TEXT "Start automatically when I log in to Windows"
    !define MUI_FINISHPAGE_SHOWREADME_CHECKED
    !define MUI_FINISHPAGE_SHOWREADME_FUNCTION WriteAutoStartKey

    !insertmacro MUI_PAGE_FINISH
  !macroend

  ; Launch the app without blocking the installer
  Function LaunchApp
    Exec '"$INSTDIR\${PRODUCT_FILENAME}.exe"'
  FunctionEnd

  Function WriteAutoStartKey
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" \
      "Show Me Skins Companion" '"$INSTDIR\${PRODUCT_FILENAME}.exe"'
  FunctionEnd

  ; Clear old auto-start entry during install (re-added by finish page if checked)
  !macro customInstall
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" \
      "Show Me Skins Companion"
  !macroend

!else

  ; ── Uninstaller - always remove the startup entry ───────────────────────

  !macro customUnInstall
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" \
      "Show Me Skins Companion"
  !macroend

!endif
