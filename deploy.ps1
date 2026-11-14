# One-step deploy: commit everything, push to GitHub, deploy to Vercel production.
#   .\deploy.ps1                      (default message)
#   .\deploy.ps1 "What changed"
param([string]$Message = "Update from test round")
Set-Location $PSScriptRoot
npm test
if ($LASTEXITCODE -ne 0) { Write-Host "Tests failed - not deploying." -ForegroundColor Red; exit 1 }
git add -A
git commit -m $Message
git push
npx vercel --prod
