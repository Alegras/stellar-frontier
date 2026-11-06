# STELLAR FRONTIER — запуск игры одним файлом (Windows PowerShell)
# Поднимает Vite dev-сервер и открывает игру в браузере: http://127.0.0.1:5173/
# Ничего устанавливать не нужно, если зависимости уже стоят (node_modules есть).

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$web = Join-Path $root "apps\web"
$vite = Join-Path $web "node_modules\vite\bin\vite.js"

# 1) ищем node
$node = (Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $node) {
  $bundled = "C:\Users\vawum\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $bundled) { $node = $bundled }
}
if (-not $node) {
  Write-Host "Node.js не найден. Установите Node 20+ или запустите через bundled pnpm:" -ForegroundColor Red
  Write-Host "  node <...>\pnpm.mjs -C apps/web dev"
  exit 1
}

# 2) запускаем Vite (dev-сервер с HMR)
if (Test-Path $vite) {
  Write-Host "STELLAR FRONTIER: запускаю dev-сервер..." -ForegroundColor Yellow
  Write-Host "Игра откроется: http://127.0.0.1:5173/  (Ctrl+C — остановить)" -ForegroundColor Gray
  Start-Job -ScriptBlock { Start-Sleep -Seconds 3; Start-Process "http://127.0.0.1:5173/" } | Out-Null
  Push-Location $web
  try { & $node $vite --host 127.0.0.1 --port 5173 }
  finally { Pop-Location }
} else {
  Write-Host "node_modules не найдены. Установите зависимости:" -ForegroundColor Red
  Write-Host "  node <...>\pnpm.mjs install"
  exit 1
}
