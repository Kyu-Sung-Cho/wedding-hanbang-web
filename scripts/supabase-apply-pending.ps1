param(
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
  Write-Host ""
  Write-Host "Supabase apply pending migrations"
  Write-Host ""
  Write-Host "This pushes pending migrations to the linked remote database."
  Write-Host "It asks for an explicit confirmation string before making changes."
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  pnpm supabase:apply:pending"
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

throw "This mutation path is retired. Use supabase:ship:safe with an explicit project ref."

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

Write-Host ""
Write-Host "Supabase apply pending migrations"
Write-Host ""
Write-Host "This WILL modify the linked remote database."
Write-Host "Before continuing, run pnpm supabase:check:safe and confirm the pending list is expected."
Write-Host ""

$confirmation = Read-Host "Type APPLY_REMOTE_MIGRATIONS to continue"
if ($confirmation -ne "APPLY_REMOTE_MIGRATIONS") {
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
  Write-Host "1/3 Pushing pending migrations..."
  pnpm supabase:push -- --password $dbPassword

  Write-Host ""
  Write-Host "2/3 Checking dry-run is clean..."
  pnpm supabase:push:dry -- --password $dbPassword

  Write-Host ""
  Write-Host "3/3 Probing anonymous access to sensitive tables..."
  pnpm supabase:security:probe

  Write-Host ""
  Write-Host "Done. Review the probe output above."
} finally {
  $dbPassword = $null
}
