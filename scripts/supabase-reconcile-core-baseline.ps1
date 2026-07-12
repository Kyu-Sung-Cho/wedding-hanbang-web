param(
  [switch]$Help,
  [Parameter(Mandatory = $false)] [string]$ExpectedProjectRef
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
  Write-Host ""
  Write-Host "Supabase legacy core baseline reconciliation"
  Write-Host ""
  Write-Host "Catalog-checks the linked database, then marks only migration"
  Write-Host "20260202000000 as applied. It never executes baseline SQL or --include-all."
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  pnpm run supabase:baseline:core -ExpectedProjectRef PROJECT_REF"
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

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)] [string]$Name,
    [Parameter(Mandatory = $true)] [scriptblock]$Script
  )

  Write-Host ""
  Write-Host "==> $Name"
  $global:LASTEXITCODE = 0
  $result = & $Script
  if ($global:LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $global:LASTEXITCODE."
  }
  return $result
}

function Assert-LinkedProject {
  $currentRef = (Get-Content -Raw -LiteralPath $script:linkedRefPath).Trim()
  if ($currentRef -ne $script:expectedRef) {
    throw "Linked Supabase project changed during baseline reconciliation."
  }
}

function Get-ReconciliationArtifactFingerprint {
  $paths = @(
    Get-ChildItem -LiteralPath "supabase/migrations" -Filter "*.sql" |
      Sort-Object FullName |
      ForEach-Object { $_.FullName }
  ) + @(
    (Resolve-Path "scripts/release-targets.json").Path,
    (Resolve-Path "scripts/run-reviewed-powershell.mjs").Path,
    (Resolve-Path "scripts/supabase-reconcile-core-baseline.ps1").Path,
    (Resolve-Path "scripts/supabase-write-fence.ps1").Path,
    (Resolve-Path "scripts/supabase-recovery-safe.mjs").Path,
    (Resolve-Path "scripts/sql/supabase-core-baseline-preflight.sql").Path
  )
  return (($paths | ForEach-Object {
    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $_
    "$($hash.Path)|$($hash.Hash)"
  }) -join "`n")
}

function Assert-ReconciliationArtifactsUnchanged {
  param(
    [Parameter(Mandatory = $true)] [string]$ExpectedHead,
    [Parameter(Mandatory = $true)] [string]$ExpectedFingerprint
  )

  $dirtyNow = @(git status --porcelain=v1 --untracked-files=all)
  $headNow = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $dirtyNow.Count -gt 0 -or
    $headNow -ne $ExpectedHead -or
    (Get-ReconciliationArtifactFingerprint) -ne $ExpectedFingerprint) {
    throw "Git HEAD or reviewed reconciliation artifacts changed during the operation."
  }
  Assert-LinkedProject
}

function ConvertFrom-SupabaseQueryRows {
  param([Parameter(Mandatory = $true)] $Raw)

  $document = ($Raw -join "`n") | ConvertFrom-Json
  if ($document -is [Array]) {
    return @($document)
  }
  if ($document.PSObject.Properties.Name -contains "rows") {
    return @($document.rows)
  }
  throw "Supabase query JSON did not contain a supported row collection."
}

function Read-BaselinePreflight {
  Assert-LinkedProject
  $raw = Invoke-Checked "Core baseline catalog preflight" {
    corepack pnpm exec supabase db query --linked `
      --file scripts/sql/supabase-core-baseline-preflight.sql --output json
  }
  $rows = @(ConvertFrom-SupabaseQueryRows $raw)
  if ($rows.Count -ne 1) {
    throw "Baseline preflight returned an unexpected result shape."
  }
  return $rows[0].baseline_preflight
}

function Get-ReviewedPendingSuffix {
  param(
    [Parameter(Mandatory = $true)] [string[]]$LocalVersions,
    [Parameter(Mandatory = $true)] [object[]]$AppliedVersions,
    [Parameter(Mandatory = $true)] [bool]$HistoryPresent
  )

  $remote = @($AppliedVersions | ForEach-Object { [string]$_ } | Sort-Object -Unique)
  $unknownRemote = @($remote | Where-Object { $_ -notin $LocalVersions })
  if ($unknownRemote.Count -gt 0) {
    throw "Remote migration history contains versions absent from this checkout."
  }

  # The only allowed out-of-order exception is this newly introduced baseline.
  $effectiveRemote = if ($HistoryPresent) {
    @($remote)
  } else {
    @($remote + "20260202000000" | Sort-Object -Unique)
  }
  $firstMissing = -1
  for ($index = 0; $index -lt $LocalVersions.Count; $index += 1) {
    if ($LocalVersions[$index] -notin $effectiveRemote) {
      $firstMissing = $index
      break
    }
  }
  if ($firstMissing -lt 0) {
    return @()
  }

  $pending = @($LocalVersions[$firstMissing..($LocalVersions.Count - 1)])
  if (@($pending | Where-Object { $_ -in $effectiveRemote }).Count -gt 0) {
    throw "Remote migration history is not a contiguous local prefix."
  }
  if ($pending[0] -lt "20260704120000") {
    throw "A pre-July migration other than the exact baseline remains missing."
  }
  return $pending
}

if ($Help) {
  Show-Help
  exit 0
}

if ([string]::IsNullOrWhiteSpace($ExpectedProjectRef)) {
  throw "-ExpectedProjectRef is required."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$targets = Get-Content -Raw -LiteralPath "scripts/release-targets.json" |
  ConvertFrom-Json
if ($ExpectedProjectRef -in @($targets.productionSupabaseProjectRefs) -and
  ($targets.productionDatabaseWriteFence -ne "verified-v1" -or
    $targets.productionDatabaseWriteFenceContract -ne
      "database-readonly-realtime-cron-v1")) {
  throw "Production baseline reconciliation is disabled until the reviewed direct-write fence is verified."
}
if ($ExpectedProjectRef -in @($targets.productionSupabaseProjectRefs) -and
  $targets.backupPolicy.status -ne "verified-v1") {
  throw "Production baseline reconciliation is disabled until encrypted recovery and an isolated restore drill are verified."
}
if ($ExpectedProjectRef -in @($targets.productionSupabaseProjectRefs)) {
  throw "Production baseline reconciliation remains disabled until it is bound to one live write-fence lifecycle."
}
$approvedNonProductionRefs = @($targets.approvedNonProductionSupabaseProjectRefs |
  ForEach-Object { [string]$_ })
if ($ExpectedProjectRef -notin $approvedNonProductionRefs) {
  throw "Baseline reconciliation requires a checked-in approved non-production project ref."
}

$linkedRefPath = Join-Path $repoRoot "supabase/.temp/project-ref"
if (-not (Test-Path -LiteralPath $linkedRefPath)) {
  throw "No linked Supabase project was found."
}
$linkedRef = (Get-Content -Raw -LiteralPath $linkedRefPath).Trim()
if ($linkedRef -ne $ExpectedProjectRef) {
  throw "Linked project ref does not match -ExpectedProjectRef."
}
$script:linkedRefPath = $linkedRefPath
$script:expectedRef = $ExpectedProjectRef

# Hold a read-share-only handle for the whole operation. Supabase CLI can
# still read the ref, but another process cannot rewrite/relink this workdir
# between the preflight and the migration-history mutation.
$linkLock = [System.IO.File]::Open(
  $linkedRefPath,
  [System.IO.FileMode]::Open,
  [System.IO.FileAccess]::Read,
  [System.IO.FileShare]::Read
)

try {

$dirty = @(git status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect Git status."
}
if ($dirty.Count -gt 0) {
  throw "Git worktree must be clean before migration-history reconciliation."
}
$reviewedHead = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($reviewedHead)) {
  throw "Unable to capture the reviewed Git HEAD."
}
$reviewedFingerprint = Get-ReconciliationArtifactFingerprint

$preflight = Read-BaselinePreflight
$appliedBefore = @($preflight.applied_versions | ForEach-Object { [string]$_ })
$localVersions = @(Get-ChildItem -LiteralPath "supabase/migrations" -Filter "*.sql" |
  ForEach-Object { $_.BaseName.Split('_')[0] } |
  Sort-Object -Unique)
$pendingBefore = @(Get-ReviewedPendingSuffix $localVersions $appliedBefore `
  ([bool]$preflight.history_present))
if ($preflight.history_present -eq $true) {
  Write-Host "Migration 20260202000000 is already present; no history mutation is needed."
  exit 0
}
if ("20260202000000" -in $appliedBefore) {
  throw "The only permitted missing pre-July version is 20260202000000."
}
if ($preflight.catalog_matches -ne $true -or $preflight.reconciliation_allowed -ne $true) {
  $findings = $preflight | ConvertTo-Json -Depth 8 -Compress
  throw "Core baseline catalog mismatch. No history was changed. Findings: $findings"
}

Write-Host ""
Write-Host "The catalog matches the reviewed 20260202000000 baseline."
Write-Host "This next step changes only Supabase migration history."
$confirmation = Read-Host "Type REPAIR_20260202000000_ONLY to continue"
if ($confirmation -ne "REPAIR_20260202000000_ONLY") {
  throw "Cancelled before migration-history repair."
}

$securePassword = Read-Host "Paste Supabase database password (hidden)" -AsSecureString
$plainPassword = Convert-SecureStringToPlainText $securePassword
$previousPassword = $env:SUPABASE_DB_PASSWORD

try {
  if ([string]::IsNullOrWhiteSpace($plainPassword)) {
    throw "Supabase database password is required."
  }
  $env:SUPABASE_DB_PASSWORD = $plainPassword

  # Re-read immediately before mutation. No user prompt or long-running check
  # occurs between this snapshot and the single-version repair call.
  Assert-ReconciliationArtifactsUnchanged $reviewedHead $reviewedFingerprint
  $fresh = Read-BaselinePreflight
  Assert-ReconciliationArtifactsUnchanged $reviewedHead $reviewedFingerprint
  $freshApplied = @($fresh.applied_versions | ForEach-Object { [string]$_ })
  $freshPending = @(Get-ReviewedPendingSuffix $localVersions $freshApplied false)
  if (($fresh.history_present -eq $true) -or
    ($fresh.catalog_matches -ne $true) -or
    ($fresh.reconciliation_allowed -ne $true) -or
    (@(Compare-Object $appliedBefore $freshApplied).Count -gt 0) -or
    (@(Compare-Object $pendingBefore $freshPending).Count -gt 0)) {
    throw "Catalog or migration history changed after approval. No repair was applied."
  }

  Assert-LinkedProject
  Assert-ReconciliationArtifactsUnchanged $reviewedHead $reviewedFingerprint
  Invoke-Checked "Repair exactly one migration-history version" {
    corepack pnpm exec supabase migration repair --linked `
      --status applied 20260202000000
  } | Out-Null

  Assert-LinkedProject
  $verified = Read-BaselinePreflight
  if ($verified.history_present -ne $true) {
    throw "Migration-history repair did not persist."
  }

  $applied = @($verified.applied_versions | ForEach-Object { [string]$_ })
  $remaining = @(Get-ReviewedPendingSuffix $localVersions $applied true)
  if (@(Compare-Object $pendingBefore $remaining).Count -gt 0) {
    throw "Pending migration suffix changed during history repair."
  }

  Write-Host ""
  Write-Host "Remaining unapplied local versions:"
  $remaining | ForEach-Object { Write-Host " - $_" }

  Invoke-Checked "Normal dry-run (no --include-all)" {
    Assert-LinkedProject
    corepack pnpm exec supabase db push --linked --dry-run
  } | Out-Null
  Write-Host "Core baseline history is reconciled. Review the July dry-run before shipping."
} finally {
  if ($null -eq $previousPassword) {
    Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
  } else {
    $env:SUPABASE_DB_PASSWORD = $previousPassword
  }
  $plainPassword = $null
}
} finally {
  $linkLock.Dispose()
}
