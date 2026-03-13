@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%.."

if exist "%ROOT_DIR%\codex.exe" (
  "%ROOT_DIR%\codex.exe" %*
  exit /b %ERRORLEVEL%
)

if exist "%ROOT_DIR%\codex-rs\target\release\codex.exe" (
  "%ROOT_DIR%\codex-rs\target\release\codex.exe" %*
  exit /b %ERRORLEVEL%
)

if exist "%ROOT_DIR%\codex-rs\target\debug\codex.exe" (
  "%ROOT_DIR%\codex-rs\target\debug\codex.exe" %*
  exit /b %ERRORLEVEL%
)

if /I not "%ARX_CODER_ISOLATED%"=="1" (
  where codex >nul 2>nul
  if %ERRORLEVEL%==0 (
    codex %*
    exit /b %ERRORLEVEL%
  )
)

where cargo >nul 2>nul
if %ERRORLEVEL%==0 (
  cargo run --quiet --manifest-path "%ROOT_DIR%\codex-rs\Cargo.toml" -p codex-cli -- %*
  exit /b %ERRORLEVEL%
)

echo No Codex executable found. 1>&2
echo Install codex, or build src-tauri\resources\coder\codex-main\codex-rs first. 1>&2
exit /b 127
