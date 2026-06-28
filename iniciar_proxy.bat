@echo off
title Proxy de CORS Local
echo Iniciando o proxy de CORS local em http://localhost:8123/...
powershell -NoProfile -ExecutionPolicy Bypass -File .\proxy.ps1
pause
