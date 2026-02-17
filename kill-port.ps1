$connections = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
foreach ($conn in $connections) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
}
Write-Host "Port 3000 freed"
