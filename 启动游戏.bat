@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动单词接龙...
start "" http://localhost:8080
node server.js
pause