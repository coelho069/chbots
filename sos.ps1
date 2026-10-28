# SOS CH BOTS - build e abre
Set-Location D:\teste\pilotos
Write-Host "1/5 Fechando CH BOTS..." -f Cyan
taskkill /F /IM "CH BOTS.exe" /T 2>$null | Out-Null
Start-Sleep 2

Write-Host "2/5 Limpando builds antigos..." -f Cyan
Get-ChildItem -Directory -Filter "build-out*" | ForEach-Object {
  Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "3/6 Testes de regressão..." -f Cyan
npm test
if ($LASTEXITCODE -ne 0) { Write-Host "ERRO nos testes (npm test)" -f Red; exit 1 }

$out = "build-out-" + (Get-Date -Format "HHmmss")
Write-Host "4/6 Build do codigo..." -f Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "ERRO no npm run build" -f Red; exit 1 }

Write-Host "5/6 Empacotando em $out..." -f Cyan
npx electron-builder --win --dir "--config.directories.output=$out"
if ($LASTEXITCODE -ne 0) { Write-Host "ERRO no electron-builder" -f Red; exit 1 }

$exe = "$out\win-unpacked\CH BOTS.exe"
if (-not (Test-Path "$out\win-unpacked\icudtl.dat")) { Write-Host "ERRO: build incompleto (icudtl.dat faltando)" -f Red; exit 1 }

Write-Host "6/6 Abrindo $exe" -f Green
Start-Process $exe