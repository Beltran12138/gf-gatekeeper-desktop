@echo off
cd /d "%~dp0"
echo Starting Girlfriend Gatekeeper...
python main.py
if errorlevel 1 (
    echo.
    echo Error! Make sure dependencies are installed:
    echo   pip install -r requirements.txt
    pause
)
