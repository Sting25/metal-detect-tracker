$nodePath = "C:\Program Files\nodejs"
$env:PATH = "$nodePath;$env:PATH"
Set-Location "C:\dev\Working\metal-detect-tracker"
node server.js
