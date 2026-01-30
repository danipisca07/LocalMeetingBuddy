@echo off
echo Setting up Visual Studio Environment...
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\Tools\VsDevCmd.bat"
if %errorlevel% neq 0 (
    echo Failed to load VsDevCmd.bat
    echo Please ensure Visual Studio Build Tools are installed.
    exit /b %errorlevel%
)
echo Environment loaded successfully.
echo Running npm install...
npm install naudiodon
