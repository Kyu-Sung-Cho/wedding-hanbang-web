param(
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
  Write-Host ""
  Write-Host "Supabase safe setup"
  Write-Host ""
  Write-Host "This script logs in, links the remote project, lists migrations, and runs db push --dry-run."
  Write-Host "It does not push migrations, repair history, reset the database, or write secrets to files."
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  pnpm supabase:setup:safe"
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

function Get-DefaultProjectRef {
  $envPath = Join-Path $PSScriptRoot "..\apps\web\.env.local"
  if (-not (Test-Path $envPath)) {
    return ""
  }

  $line = Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match "^NEXT_PUBLIC_SUPABASE_URL\s*=\s*https://([^.]+)\.supabase\.co\s*$" } |
    Select-Object -First 1

  if ($line -match "https://([^.]+)\.supabase\.co") {
    return $Matches[1]
  }

  return ""
}

if ($Help) {
  Show-Help
  exit 0
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

Write-Host ""
Write-Host "Supabase safe setup"
Write-Host "This will only login, link, list migrations, and run a dry-run."
Write-Host "It will NOT modify the remote database."
Write-Host ""

$defaultProjectRef = Get-DefaultProjectRef
if ($defaultProjectRef) {
  $projectRef = Read-Host "Project ref [$defaultProjectRef]"
  if ([string]::IsNullOrWhiteSpace($projectRef)) {
    $projectRef = $defaultProjectRef
  }
} else {
  $projectRef = Read-Host "Project ref"
}

if ([string]::IsNullOrWhiteSpace($projectRef)) {
  throw "Project ref is required."
}

$tokenSecure = Read-Host "Paste Supabase personal access token (hidden)" -AsSecureString
$dbPasswordSecure = Read-Host "Paste Supabase database password (hidden)" -AsSecureString

$token = Convert-SecureStringToPlainText $tokenSecure
$dbPassword = Convert-SecureStringToPlainText $dbPasswordSecure

try {
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "Supabase personal access token is required."
  }
  if ([string]::IsNullOrWhiteSpace($dbPassword)) {
    throw "Supabase database password is required."
  }

  Write-Host ""
  Write-Host "1/5 Checking CLI version..."
  pnpm supabase:version

  Write-Host ""
  Write-Host "2/5 Logging in..."
  pnpm supabase:login -- --token $token --name hanbang-prod

  Write-Host ""
  Write-Host "3/5 Linking project..."
  pnpm supabase:link -- --project-ref $projectRef --password $dbPassword

  Write-Host ""
  Write-Host "4/5 Listing local/remote migrations..."
  pnpm supabase:migrations -- --password $dbPassword

  Write-Host ""
  Write-Host "5/5 Running dry-run..."
  pnpm supabase:push:dry -- --password $dbPassword

  Write-Host ""
  Write-Host "Done. If dry-run reports pending migrations, do not run push yet."
} finally {
  $token = $null
  $dbPassword = $null
}
