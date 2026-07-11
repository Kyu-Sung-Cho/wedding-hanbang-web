param(
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
  Write-Host ""
  Write-Host "Supabase normalize legacy migration history"
  Write-Host ""
  Write-Host "This replaces short legacy migration history versions with canonical timestamp versions."
  Write-Host "It does not push SQL files, reset the database, or write secrets to files."
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  pnpm supabase:normalize:history"
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

throw "Legacy history normalization is retired; no unchecked linked-project mutation is allowed."

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$legacyVersions = @(
  "20260325",
  "20260408",
  "20260527"
)

$canonicalAppliedVersions = @(
  "20260325000000",
  "20260325000001",
  "20260408000000"
)

Write-Host ""
Write-Host "Supabase normalize legacy migration history"
Write-Host ""
Write-Host "This will mark short legacy history versions as reverted:"
$legacyVersions | ForEach-Object { Write-Host " - $_" }
Write-Host ""
Write-Host "Then it will mark these canonical versions as applied:"
$canonicalAppliedVersions | ForEach-Object { Write-Host " - $_" }
Write-Host ""
Write-Host "It will NOT mark 20260614100000_create_cohort_member_reports.sql as applied."
Write-Host "That migration creates a table that is currently missing remotely, so it should remain pending."
Write-Host ""

$confirmation = Read-Host "Type NORMALIZE_LEGACY_HISTORY to continue"
if ($confirmation -ne "NORMALIZE_LEGACY_HISTORY") {
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
  Write-Host "1/4 Reverting short legacy history versions..."
  pnpm exec supabase migration repair --linked --status reverted @legacyVersions --password $dbPassword

  Write-Host ""
  Write-Host "2/4 Marking canonical history versions as applied..."
  pnpm exec supabase migration repair --linked --status applied @canonicalAppliedVersions --password $dbPassword

  Write-Host ""
  Write-Host "3/4 Listing migrations..."
  pnpm supabase:migrations -- --password $dbPassword

  Write-Host ""
  Write-Host "4/4 Running dry-run..."
  pnpm supabase:push:dry -- --password $dbPassword

  Write-Host ""
  Write-Host "Done. Expected dry-run should only show genuinely pending current migrations."
} finally {
  $dbPassword = $null
}
