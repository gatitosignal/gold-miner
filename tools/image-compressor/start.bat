@echo off
setlocal
cd /d "%~dp0"
set "PYTHONUTF8=1"

where py >nul 2>nul
if %errorlevel%==0 (
  set "PYTHON_CMD=py -3"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo 未找到 Python。请先安装 Python 3.10 或更高版本，并勾选 Add Python to PATH。
    pause
    exit /b 1
  )
  set "PYTHON_CMD=python"
)

if not exist ".venv\Scripts\python.exe" (
  echo 首次启动：正在创建独立运行环境……
  %PYTHON_CMD% -m venv .venv
  if errorlevel 1 goto :error
)

".venv\Scripts\python.exe" -c "import PIL" >nul 2>nul
if errorlevel 1 (
  echo 首次启动：正在安装 Pillow……
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 goto :error
)

".venv\Scripts\pythonw.exe" gui.py
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo 启动失败，请查看上方错误信息。
pause
exit /b 1
