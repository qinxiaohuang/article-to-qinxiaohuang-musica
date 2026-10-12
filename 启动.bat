@echo off
chcp 65001 >nul
title QinXiaoHuang Music - Local Server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\server.ps1"
if errorlevel 1 pause
