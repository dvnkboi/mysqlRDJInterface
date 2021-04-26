New-Item -ItemType Directory -Force -Path Logs
node . 3>&1 2>&1 | Out-File -FilePath ("Logs\\" + (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss") + ".txt")