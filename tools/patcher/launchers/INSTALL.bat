@echo off
rem Zapusk ukrainizatora. Vmist fajlu navmysne bez kyrylyci: cmd.exe chytaje
rem .bat u potochnij kodovij storinci, i ukrajinski litery tut peretvorylysia b
rem na krakozjabry. Use Ukrainian text is printed by the program itself.
chcp 65001 >nul 2>&1
title Ukrainizator KINGDOM HEARTS
cd /d "%~dp0"
if not exist "KH-UA-Patcher.exe" (
  echo KH-UA-Patcher.exe not found next to this file.
  echo Unpack the whole archive, not just this .bat
  pause
  exit /b 1
)
"%~dp0KH-UA-Patcher.exe" %*
if errorlevel 1 pause
