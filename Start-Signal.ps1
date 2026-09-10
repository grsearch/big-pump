$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$signalNode = Get-Command node -ErrorAction SilentlyContinue
if ($signalNode) { $signalNodePath = $signalNode.Source } else {
    $signalNodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $signalNodePath)) { throw '需要 Node.js 24 或以上版本。' }
Write-Host 'Pump Signal 正在启动。请打开 http://localhost:3000 。按 Ctrl+C 结束。'
& $signalNodePath scripts/start.mjs
