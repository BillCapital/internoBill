@echo off
chcp 65001 >nul
title BillCapital - Sistema Interno (servidor local)
cd /d "%~dp0"

if not exist "package.json" (
  echo No se encontro package.json en esta carpeta.
  echo Coloca este archivo dentro de la carpeta del proyecto INVENTARIO-CALENDARIO.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo ============================================================
  echo   Primera vez: instalando dependencias ^(puede tardar^)...
  echo ============================================================
  call npm install
  if errorlevel 1 (
    echo.
    echo  Hubo un error instalando dependencias. Revisa que Node.js este instalado.
    pause
    exit /b 1
  )
)

echo.
echo  Iniciando el servidor local...
echo  - El navegador se abrira solo en unos segundos.
echo  - NO cierres esta ventana mientras uses la app.
echo  - Para detener el servidor: cierra esta ventana o presiona Ctrl+C.
echo.

call npm run dev -- --open

echo.
echo  El servidor se detuvo.
pause
