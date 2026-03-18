param(
  [string]$SaasBase = "http://localhost:3001/saas",
  [string]$PythonBase = "http://localhost:8000",
  [string]$BearerToken = $env:PHASE2_BEARER_TOKEN,
  [string]$WorkspaceId = $env:PHASE2_WORKSPACE_ID,
  [string]$JobId = $env:PHASE2_JOB_ID,
  [switch]$DispatchPublish
)

$ErrorActionPreference = "Stop"

function Invoke-JsonGet {
  param(
    [string]$Url,
    [hashtable]$Headers = @{}
  )
  Invoke-RestMethod -Method Get -Uri $Url -Headers $Headers
}

function Invoke-JsonPost {
  param(
    [string]$Url,
    [object]$Body = @{},
    [hashtable]$Headers = @{}
  )
  Invoke-RestMethod -Method Post -Uri $Url -Headers ($Headers + @{ "Content-Type" = "application/json" }) -Body ($Body | ConvertTo-Json -Depth 8)
}

Write-Host "Phase 2 validation"
Write-Host "Checking service health..."

$saasHealth = Invoke-JsonGet -Url "$SaasBase/health"
$pythonAuth = Invoke-JsonGet -Url "$PythonBase/api/auth/config"

Write-Host "SaaS:" ($saasHealth | ConvertTo-Json -Compress)
Write-Host "Python:" ($pythonAuth | ConvertTo-Json -Compress)

if (-not $BearerToken -or -not $WorkspaceId -or -not $JobId) {
  Write-Host ""
  Write-Host "Set PHASE2_BEARER_TOKEN, PHASE2_WORKSPACE_ID, and PHASE2_JOB_ID to run publish validation steps."
  exit 0
}

$headers = @{
  "Authorization" = "Bearer $BearerToken"
  "x-workspace-id" = $WorkspaceId
}

Write-Host ""
Write-Host "Running validations for job $JobId..."
$validations = Invoke-JsonGet -Url "$SaasBase/jobs/$JobId/validations" -Headers $headers
Write-Host ($validations | ConvertTo-Json -Depth 8)

Write-Host ""
Write-Host "Running publish check..."
$publishCheck = Invoke-JsonPost -Url "$SaasBase/jobs/$JobId/publish-check" -Headers $headers
Write-Host ($publishCheck | ConvertTo-Json -Depth 8)

if ($DispatchPublish) {
  Write-Host ""
  Write-Host "Dispatching publish..."
  try {
    $publish = Invoke-JsonPost -Url "$SaasBase/jobs/$JobId/publish" -Headers $headers
    Write-Host ($publish | ConvertTo-Json -Depth 8)
  } catch {
    Write-Host "Publish request failed:"
    Write-Host $_.Exception.Message
    throw
  }
}
