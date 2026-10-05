@echo off
rem Starts the creator bridge with Python if it is installed, otherwise with Blender's own Python.
cd /d "%~dp0"
where python >nul 2>nul && (python creator_bridge.py & pause & goto :eof)
set "B="
for /d %%D in ("%ProgramFiles%\Blender Foundation\Blender *") do set "B=%%D\blender.exe"
if defined B (
  "%B%" -b --factory-startup --python creator_bridge.py
) else (
  echo Install Blender 4.2 or newer first: https://www.blender.org/download/
)
pause
