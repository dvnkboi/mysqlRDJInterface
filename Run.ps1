New-Item -ItemType Directory -Force -Path Logs
npm start | Out-File -FilePath ("Logs\\" + (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss") + ".txt")