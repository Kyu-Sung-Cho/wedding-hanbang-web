param(
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

throw "Disabled: broad history baselining is unsafe. Follow docs/operations/AMORA_PRODUCTION_RELEASE.md."

function Show-Help {
  Write-Host ""
  Write-Host "Supabase baseline history repair"
  Write-Host ""
  Write-Host "This marks old drifted migrations as applied in Supabase migration history."
  Write-Host "It does not push SQL files, reset the database, or write secrets to files."
  Write-Host "Run this only after dry-run shows the old migrations as already represented in the remote schema."
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  pnpm supabase:baseline:history"
  Write-Host ""
}

function Convert-SecureStringToPlainText {
  param([Parameter(Mandatory = $true)] [Security.SecureString] $Secure)

  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

if ($Help) {
  Show-Help
  exit 0
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$baselineVersions = @(
  "20260224000000",
  "20260225000000",
  "20260301000000",
  "20260301000001",
  "20260301000002",
  "20260301100000",
  "20260302000000",
  "20260325000000",
  "20260325000001",
  "20260408000000",
  "20260423000000",
  "20260424000000",
  "20260424000001",
  "20260424000002",
  "20260427000000",
  "20260427000001",
  "20260427000002",
  "20260429000000",
  "20260429000001",
  "20260504000000",
  "20260507000000",
  "20260507100000",
  "20260507200000",
  "20260507300000",
  "20260507400000",
  "20260511000000",
  "20260511010000",
  "20260511020000",
  "20260511030000",
  "20260513999000",
  "20260514000000",
  "20260514010000",
  "20260514020000",
  "20260514100000",
  "20260517000000",
  "20260531000000",
  "20260605000000",
  "20260605000001",
  "20260607000000",
  "20260607010000",
  "20260607020000",
  "20260607030000",
  "20260609000000",
  "20260610090000",
  "20260610110000",
  "20260611100000",
  "20260611150000",
  "20260611160000",
  "20260612120000",
  "20260612130000"
)

Write-Host ""
Write-Host "Supabase baseline history repair"
Write-Host ""
Write-Host "This will mark old migrations as already applied in the remote migration history."
Write-Host "It will NOT execute those migration SQL files."
Write-Host "It will NOT fix security by itself."
Write-Host ""
Write-Host "After this, dry-run should only show the latest unapplied migrations."
Write-Host ""
Write-Host "Versions to mark as applied:"
$baselineVersions | ForEach-Object { Write-Host " - $_" }
Write-Host ""

$confirmation = Read-Host "Type BASELINE_HISTORY_ONLY to continue"
if ($confirmation -ne "BASELINE_HISTORY_ONLY") {
  Write-Host "Cancelled."
  exit 1
}

$dbPasswordSecure = Read-Host "Paste Supabase database password (hidden)" -AsSecureString
$dbPassword = Convert-SecureStringToPlainText $dbPasswordSecure

try {
  if ([string]::IsNullOrWhiteSpace($dbPassword)) {
    throw "Supabase database password is required."
  }

  Write-Host ""
  Write-Host "1/3 Repairing migration history..."
  pnpm exec supabase migration repair --linked --status applied @baselineVersions --password $dbPassword

  Write-Host ""
  Write-Host "2/3 Listing migrations..."
  pnpm supabase:migrations -- --password $dbPassword

  Write-Host ""
  Write-Host "3/3 Running dry-run..."
  pnpm supabase:push:dry -- --password $dbPassword

  Write-Host ""
  Write-Host "Done. Do not run push yet unless the remaining dry-run list is expected."
} finally {
  $dbPassword = $null
}
