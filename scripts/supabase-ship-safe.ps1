param(
  [switch]$Help,
  [switch]$SkipBuild,
  [switch]$SkipLint,
  [switch]$SkipAudit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

throw "Disabled: unscoped migration shipping is unsafe. Follow docs/operations/AMORA_PRODUCTION_RELEASE.md."

function Show-Help {
  Write-Host ""
  Write-Host "Supabase safe ship"
  Write-Host ""
  Write-Host "Runs local checks, lists/dry-runs pending Supabase migrations, asks once,"
  Write-Host "then applies migrations and verifies anonymous sensitive-table access."
  Write-Host ""
  Write-Host "It does not store secrets, reset the database, repair history, or use --include-all."
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  pnpm supabase:ship:safe"
  Write-Host ""
  Write-Host "Optional:"
  Write-Host "  pnpm supabase:ship:safe -- -SkipBuild"
  Write-Host "  pnpm supabase:ship:safe -- -SkipLint"
  Write-Host "  pnpm supabase:ship:safe -- -SkipAudit"
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

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)] [string] $Name,
    [Parameter(Mandatory = $true)] [scriptblock] $Script
  )

  Write-Host ""
  Write-Host "==> $Name"
  $global:LASTEXITCODE = 0
  & $Script
  if ($global:LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $global:LASTEXITCODE."
  }
}

if ($Help) {
  Show-Help
  exit 0
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

Write-Host ""
Write-Host "Supabase safe ship"
Write-Host "This runs checks first. It will ask again before modifying the remote database."
Write-Host ""

Invoke-Step "Git status" { git status -sb }
Invoke-Step "TypeScript check" { pnpm typecheck }
Invoke-Step "Unit tests" { pnpm test }

if (-not $SkipLint) {
  Invoke-Step "Lint" { pnpm lint }
} else {
  Write-Host ""
  Write-Host "Skipping lint because -SkipLint was provided."
}

if (-not $SkipBuild) {
  Invoke-Step "Production build" { pnpm build }
} else {
  Write-Host ""
  Write-Host "Skipping build because -SkipBuild was provided."
}

if (-not $SkipAudit) {
  Invoke-Step "Production dependency audit" { pnpm audit --prod }
} else {
  Write-Host ""
  Write-Host "Skipping audit because -SkipAudit was provided."
}

$dbPasswordSecure = Read-Host "Paste Supabase database password (hidden)" -AsSecureString
$dbPassword = Convert-SecureStringToPlainText $dbPasswordSecure

try {
  if ([string]::IsNullOrWhiteSpace($dbPassword)) {
    throw "Supabase database password is required."
  }

  Invoke-Step "List local/remote migrations" {
    pnpm supabase:migrations -- --password $dbPassword
  }

  Invoke-Step "Dry-run pending migrations" {
    pnpm supabase:push:dry -- --password $dbPassword
  }

  Write-Host ""
  Write-Host "Review the dry-run output above."
  Write-Host "This next step WILL modify the linked remote database."
  $confirmation = Read-Host "Type APPLY to push the migrations shown above"
  if ($confirmation -ne "APPLY") {
    Write-Host "Cancelled before remote database changes."
    exit 1
  }

  Invoke-Step "Push pending migrations" {
    pnpm supabase:push -- --password $dbPassword
  }

  Invoke-Step "Post-push dry-run check" {
    pnpm supabase:push:dry -- --password $dbPassword
  }

  Invoke-Step "Anonymous sensitive-table probe" {
    pnpm supabase:security:probe
  }

  Write-Host ""
  Write-Host "Done. Local checks passed, migrations were applied, and the anonymous probe passed."
} finally {
  $dbPassword = $null
}
