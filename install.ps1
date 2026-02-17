$nodePath = "C:\Program Files\nodejs"
$env:PATH = "$nodePath;$env:PATH"
Set-Location "C:\dev\Working\metal-detect-tracker"
if (Test-Path "node_modules") { Remove-Item -Recurse -Force "node_modules" }
npm install
