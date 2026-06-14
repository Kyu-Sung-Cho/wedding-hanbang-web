param(
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
  Write-Host ""
  Write-Host "Supabase safe check"
  Write-Host ""
  Write-Host "This script lists migrations and runs db push --dry-run."
  Write-Host "It does not push migrations, repair history, reset the database, or write secrets to files."
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  pnpm supabase:check:safe"
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

Write-Host ""
Write-Host "Supabase safe check"
Write-Host "This will only list migrations and run a dry-run."
Write-Host "It will NOT modify the remote database."
Write-Host ""

$dbPasswordSecure = Read-Host "Paste Supabase database password (hidden)" -AsSecureString
$dbPassword = Convert-SecureStringToPlainText $dbPasswordSecure

try {
  if ([string]::IsNullOrWhiteSpace($dbPassword)) {
    throw "Supabase database password is required."
  }

  Write-Host ""
  Write-Host "1/2 Listing local/remote migrations..."
  pnpm supabase:migrations -- --password $dbPassword

  Write-Host ""
  Write-Host "2/2 Running dry-run..."
  pnpm supabase:push:dry -- --password $dbPassword

  Write-Host ""
  Write-Host "Done. If dry-run reports pending migrations, do not run push yet."
} finally {
  $dbPassword = $null
}
