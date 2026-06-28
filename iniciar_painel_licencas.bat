@echo off
title Painel de Licencas - Admin
echo Iniciando o servidor do Painel de Licencas...
echo Acesse no navegador: http://localhost:8200/admin
echo.
cd painel-licencas
powershell -NoProfile -ExecutionPolicy Bypass -File .\server.ps1
pause
