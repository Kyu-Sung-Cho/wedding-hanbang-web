param(
  [ValidateSet("Plan", "Capture", "Activate", "Verify", "MarkMigrationStarted", "MarkMigrationVerified", "Deactivate", "Recover")]
  [string]$Action = "Plan",
  [Parameter(Mandatory = $true)]
  [string]$ExpectedProjectRef,
  [string]$ReleaseIpv4Cidr,
  [string]$ReleaseIpv6Cidr,
  [string]$SnapshotPath,
  [string]$PostMigrationEvidencePath,
  [ValidateRange(5, 120)]
  [int]$DrainTimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$script:Contract = "database-readonly-realtime-cron-v1"
$script:RunningOnWindows = [Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
  [Runtime.InteropServices.OSPlatform]::Windows
)

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

if ($ExpectedProjectRef -notmatch '^[a-z0-9]{20}$') {
  throw "-ExpectedProjectRef must be a 20-character Supabase project ref."
}

$targets = Get-Content -Raw -LiteralPath "scripts/release-targets.json" |
  ConvertFrom-Json
$isProductionTarget = $ExpectedProjectRef -in @(
  $targets.productionSupabaseProjectRefs | ForEach-Object { [string]$_ }
)
if ($isProductionTarget -and
  $targets.productionDatabaseWriteFence -ne "verified-v1") {
  throw "Protected production remains blocked while the checked-in write-fence fuse is not verified-v1."
}
if ($isProductionTarget) {
  throw "Protected production write-fence actions remain disabled until the audited lifecycle and automated evidence producer are implemented."
}
$approvedNonProductionRefs = @(
  $targets.approvedNonProductionSupabaseProjectRefs |
    ForEach-Object { [string]$_ }
)
if ($Action -ne "Plan" -and $ExpectedProjectRef -notin $approvedNonProductionRefs) {
  throw "Remote write-fence actions require a checked-in approved non-production project ref."
}

# Keep the production fuse above every credential prompt and remote boundary.
$script:ManagementApiBase = "https://api.supabase.com"
$script:EnforcedNetworkStatuses = @("applied")
$script:PendingNetworkStatuses = @("stored")
$script:ProtectedRoles = @(
  "authenticator"
  "supabase_auth_admin"
  "supabase_storage_admin"
  "dashboard_user"
)
$script:LinkedRefPath = Join-Path $repoRoot "supabase/.temp/project-ref"
$script:StatusSqlPath = Join-Path $repoRoot "scripts/sql/supabase-write-fence-status.sql"

function Convert-SecureStringToPlainText {
  param([Parameter(Mandatory = $true)] [Security.SecureString]$Secure)

  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Read-FenceSecret {
  param([Parameter(Mandatory = $true)] [string]$Prompt)

  $secure = Read-Host $Prompt -AsSecureString
  $plain = Convert-SecureStringToPlainText $secure
  if ([string]::IsNullOrWhiteSpace($plain)) {
    throw "A required hidden credential was not provided."
  }
  return $plain
}

function Get-OptionalProperty {
  param(
    [Parameter(Mandatory = $true)] $Object,
    [Parameter(Mandatory = $true)] [string]$Name,
    $Default = $null
  )

  if ($null -ne $Object -and
    $Object.PSObject.Properties.Name -contains $Name) {
    return $Object.$Name
  }
  return $Default
}

function Assert-LinkedProject {
  if (-not (Test-Path -LiteralPath $script:LinkedRefPath)) {
    throw "No linked Supabase project was found."
  }
  $linkedRef = (Get-Content -Raw -LiteralPath $script:LinkedRefPath).Trim()
  if ($linkedRef -ne $ExpectedProjectRef) {
    throw "Linked Supabase project does not match -ExpectedProjectRef."
  }
}

function Get-CleanReviewedGitIdentity {
  $dirty = @(git status --porcelain=v1 --untracked-files=all)
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect Git worktree state."
  }
  if ($dirty.Count -ne 0) {
    throw "Git worktree must be clean before a write-fence lifecycle action."
  }

  $head = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$') {
    throw "Unable to capture the reviewed Git HEAD."
  }
  $tree = (git rev-parse 'HEAD^{tree}').Trim()
  if ($LASTEXITCODE -ne 0 -or $tree -notmatch '^[0-9a-f]{40}$') {
    throw "Unable to capture the reviewed Git tree."
  }

  return [pscustomobject]@{
    head = $head
    tree = $tree
  }
}

function Assert-ReleaseCidr {
  param(
    [Parameter(Mandatory = $true)] [string]$Cidr,
    [Parameter(Mandatory = $true)] [ValidateSet("IPv4", "IPv6")] [string]$Family
  )

  $parts = $Cidr.Split('/')
  if ($parts.Count -ne 2) {
    throw "$Family release CIDR must contain one address and an exact host prefix."
  }
  $address = $null
  if (-not [Net.IPAddress]::TryParse($parts[0], [ref]$address)) {
    throw "$Family release CIDR has an invalid address."
  }
  $expectedFamily = if ($Family -eq "IPv4") {
    [Net.Sockets.AddressFamily]::InterNetwork
  } else {
    [Net.Sockets.AddressFamily]::InterNetworkV6
  }
  $expectedPrefix = if ($Family -eq "IPv4") { "32" } else { "128" }
  if ($address.AddressFamily -ne $expectedFamily -or $parts[1] -ne $expectedPrefix) {
    throw "$Family release CIDR must be a single-host /$expectedPrefix CIDR."
  }
}

function Get-SnapshotRoot {
  $stateRoot = if ($script:RunningOnWindows) {
    $env:LOCALAPPDATA
  } elseif (-not [string]::IsNullOrWhiteSpace($env:XDG_STATE_HOME)) {
    $env:XDG_STATE_HOME
  } elseif (-not [string]::IsNullOrWhiteSpace($HOME)) {
    Join-Path $HOME ".local/state"
  } else {
    ""
  }
  if ([string]::IsNullOrWhiteSpace($stateRoot)) {
    throw "A platform-local application state directory is required for the write-fence journal."
  }
  return [IO.Path]::GetFullPath(
    (Join-Path $stateRoot "WeddingHanbang/release-fence/$ExpectedProjectRef")
  )
}

function Test-PathInsideJournalRoot {
  param(
    [Parameter(Mandatory = $true)] [string]$Candidate,
    [Parameter(Mandatory = $true)] [string]$Root
  )

  $trimmedRoot = $Root.TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
  $rootWithSeparator = $trimmedRoot + [IO.Path]::DirectorySeparatorChar
  $comparison = if ($script:RunningOnWindows) {
    [StringComparison]::OrdinalIgnoreCase
  } else {
    [StringComparison]::Ordinal
  }
  return $Candidate.StartsWith($rootWithSeparator, $comparison)
}

function Resolve-FenceSnapshotPath {
  param([switch]$ForCapture)

  $root = Get-SnapshotRoot
  if ([string]::IsNullOrWhiteSpace($SnapshotPath)) {
    if (-not $ForCapture) {
      throw "-SnapshotPath is required for this action."
    }
    $id = [Guid]::NewGuid().ToString("D")
    return Join-Path $root "$id.json"
  }

  $candidate = [IO.Path]::GetFullPath($SnapshotPath)
  if (-not (Test-PathInsideJournalRoot $candidate $root)) {
    throw "SnapshotPath must stay inside the local release-fence journal directory."
  }
  if ($ForCapture -and (Test-Path -LiteralPath $candidate)) {
    throw "Capture refuses to overwrite an existing write-fence journal."
  }
  return $candidate
}

function Resolve-PostMigrationEvidencePath {
  if ([string]::IsNullOrWhiteSpace($PostMigrationEvidencePath)) {
    throw "-PostMigrationEvidencePath is required for this action."
  }

  $root = Get-SnapshotRoot
  $candidate = [IO.Path]::GetFullPath($PostMigrationEvidencePath)
  if (-not (Test-PathInsideJournalRoot $candidate $root) -or
    [IO.Path]::GetExtension($candidate) -ne ".json") {
    throw "Post-migration evidence must be a JSON file inside the local journal directory."
  }
  if (-not [string]::IsNullOrWhiteSpace($SnapshotPath) -and
    $candidate -eq [IO.Path]::GetFullPath($SnapshotPath)) {
    throw "Post-migration evidence must be separate from the fence snapshot."
  }
  return $candidate
}

function Read-PostMigrationEvidence {
  param(
    [Parameter(Mandatory = $true)] [string]$Path,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Post-migration evidence does not exist."
  }
  $evidence = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  if ($evidence.schemaVersion -ne 1 -or
    $evidence.contract -ne "post-migration-release-evidence-v1" -or
    $evidence.projectRef -ne $ExpectedProjectRef -or
    $evidence.fenceId -ne $Snapshot.fenceId -or
    $evidence.reviewedHead -ne $Snapshot.reviewedHead) {
    throw "Post-migration evidence identity does not match the active fence."
  }

  $requiredChecks = @(
    "migrationHistoryExact"
    "databaseContractPassed"
    "dataApiWriteDenied"
    "authWriteDenied"
    "storageWriteDenied"
    "releaseConnectionWritable"
  )
  foreach ($check in $requiredChecks) {
    if ((Get-OptionalProperty $evidence.checks $check $false) -ne $true) {
      throw "Post-migration evidence is missing a required passing check."
    }
  }

  try {
    $verifiedAt = [DateTimeOffset]::Parse(
      [string]$evidence.verifiedAtUtc,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind
    )
    $migrationStep = @($Snapshot.steps | Where-Object {
      $_.name -eq "migration" -and $_.status -eq "started"
    })
    if ($migrationStep.Count -ne 1) {
      throw "Missing migration-start journal boundary."
    }
    $startedAt = [DateTimeOffset]::Parse(
      [string]$migrationStep[0].recordedAtUtc,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind
    )
  } catch {
    throw "Post-migration evidence has an invalid verification timestamp."
  }

  $now = [DateTimeOffset]::UtcNow
  if ($verifiedAt -lt $startedAt -or $verifiedAt -lt $now.AddMinutes(-30) -or
    $verifiedAt -gt $now.AddMinutes(5)) {
    throw "Post-migration evidence timestamp is outside the allowed release window."
  }

  $digest = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  return [pscustomobject]@{
    contract = "post-migration-release-evidence-v1"
    digestSha256 = $digest
    verifiedAtUtc = $verifiedAt.ToUniversalTime().ToString("o")
    allRequiredChecksPassed = $true
  }
}

function Write-FenceSnapshot {
  param(
    [Parameter(Mandatory = $true)] [string]$Path,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $directory = Split-Path -Parent $Path
  [IO.Directory]::CreateDirectory($directory) | Out-Null
  $temporary = "$Path.tmp"
  $json = $Snapshot | ConvertTo-Json -Depth 30
  [IO.File]::WriteAllText(
    $temporary,
    $json,
    [Text.UTF8Encoding]::new($false)
  )
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Assert-NoSecretFields {
  param(
    $Object,
    [int]$Depth = 0
  )

  if ($null -eq $Object -or $Object -is [string] -or
    $Object.GetType().IsValueType) {
    return
  }
  if ($Depth -gt 30) {
    throw "Write-fence snapshot nesting exceeds the sanitized schema."
  }
  if ($Object -is [Collections.IEnumerable] -and
    $Object -isnot [Management.Automation.PSCustomObject]) {
    foreach ($item in $Object) {
      Assert-NoSecretFields $item ($Depth + 1)
    }
    return
  }

  foreach ($property in $Object.PSObject.Properties) {
    if ($property.Name -match '(?i)(token|password|secret|authorization|api.?key|service.?key)') {
      throw "Write-fence snapshot contains a forbidden secret-bearing field."
    }
    Assert-NoSecretFields $property.Value ($Depth + 1)
  }
}

function Assert-FenceSnapshotSafety {
  param([Parameter(Mandatory = $true)] $Snapshot)

  Assert-NoSecretFields $Snapshot
  $allowedTopLevel = @(
    "schemaVersion", "contract", "fenceId", "projectRef", "state", "production",
    "capturedAtUtc", "reviewedHead", "reviewedTree", "roleFenceAppliedAtUtc",
    "releaseCidrs", "previous", "steps",
    "migrationStarted", "migrationVerified", "postMigrationEvidence"
  )
  $unexpected = @($Snapshot.PSObject.Properties.Name | Where-Object {
    $_ -notin $allowedTopLevel
  })
  if ($unexpected.Count -ne 0) {
    throw "Write-fence snapshot contains fields outside the sanitized schema."
  }

  $fenceGuid = [Guid]::Empty
  if (-not [Guid]::TryParse([string]$Snapshot.fenceId, [ref]$fenceGuid) -or
    [string]$Snapshot.reviewedHead -notmatch '^[0-9a-f]{40}$' -or
    [string]$Snapshot.reviewedTree -notmatch '^[0-9a-f]{40}$' -or
    $Snapshot.production -isnot [bool] -or
    $Snapshot.migrationStarted -isnot [bool] -or
    $Snapshot.migrationVerified -isnot [bool]) {
    throw "Write-fence snapshot has invalid immutable identity or lifecycle fields."
  }

  $allowedStates = @(
    "captured", "activating", "active", "activation_failed", "restoring", "released",
    "migration_in_progress", "migration_verified", "manual_recovery_required"
  )
  if ([string]$Snapshot.state -notin $allowedStates) {
    throw "Write-fence snapshot has an unknown lifecycle state."
  }
  if ($Snapshot.migrationVerified -eq $true -and
    $Snapshot.migrationStarted -ne $true) {
    throw "Write-fence snapshot has an impossible migration lifecycle."
  }

  $v4 = @($Snapshot.releaseCidrs.ipv4)
  $v6 = @($Snapshot.releaseCidrs.ipv6)
  if ($v4.Count -ne 1 -or $v6.Count -gt 1) {
    throw "Write-fence snapshot must retain one release IPv4 host and at most one IPv6 host."
  }
  Assert-ReleaseCidr ([string]$v4[0]) "IPv4"
  if ($v6.Count -eq 1) {
    Assert-ReleaseCidr ([string]$v6[0]) "IPv6"
  }

  $allowedStepNames = @(
    "network", "realtime", "auth", "roles", "cron", "verify", "activation",
    "restore", "migration", "migration_verification"
  )
  $allowedStepStatuses = @("pending", "applied", "failed", "started")
  $stepNames = @()
  foreach ($step in @($Snapshot.steps)) {
    if ([string]$step.name -notin $allowedStepNames -or
      [string]$step.status -notin $allowedStepStatuses -or
      [string]$step.recordedAtUtc -notmatch '^\d{4}-\d{2}-\d{2}T') {
      throw "Write-fence snapshot contains an invalid journal step."
    }
    $stepNames += [string]$step.name
  }
  if (@($stepNames | Group-Object | Where-Object { $_.Count -ne 1 }).Count -ne 0) {
    throw "Write-fence snapshot contains duplicate journal steps."
  }
  $rolesApplied = @($Snapshot.steps | Where-Object {
    $_.name -eq "roles" -and $_.status -eq "applied"
  }).Count -eq 1
  if ($rolesApplied) {
    $roleFenceAppliedAt = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse(
        [string]$Snapshot.roleFenceAppliedAtUtc,
        [ref]$roleFenceAppliedAt
      )) {
      throw "Write-fence snapshot has an invalid protected-session cutoff."
    }
  }

  if ($null -eq $Snapshot.previous -or
    $null -eq $Snapshot.previous.management -or
    $null -eq $Snapshot.previous.database) {
    throw "Write-fence snapshot is missing its exact-restore baseline."
  }
  $baselineStatus = ([string]$Snapshot.previous.management.network.status).Trim().ToLowerInvariant()
  $baselineEntitlement = ([string]$Snapshot.previous.management.network.entitlement).Trim().ToLowerInvariant()
  if ($baselineStatus -ne "applied" -or $baselineEntitlement -ne "allowed") {
    throw "Write-fence snapshot lacks an applied, entitled network restore baseline."
  }
}

function Read-FenceSnapshot {
  param([Parameter(Mandatory = $true)] [string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Write-fence snapshot does not exist."
  }
  $snapshot = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  if ($snapshot.contract -ne $script:Contract -or
    $snapshot.projectRef -ne $ExpectedProjectRef -or
    $snapshot.schemaVersion -ne 1) {
    throw "Write-fence snapshot identity does not match this action."
  }
  Assert-FenceSnapshotSafety $snapshot
  $expectedProduction = $snapshot.projectRef -in @(
    $targets.productionSupabaseProjectRefs | ForEach-Object { [string]$_ }
  )
  if ($snapshot.production -ne $expectedProduction -or
    $snapshot.production -ne $isProductionTarget) {
    throw "Write-fence snapshot production identity does not match the protected-ref policy."
  }
  return $snapshot
}

function Assert-SnapshotHead {
  param([Parameter(Mandatory = $true)] $Snapshot)

  $identity = Get-CleanReviewedGitIdentity
  if ($identity.head -ne [string]$Snapshot.reviewedHead -or
    $identity.tree -ne [string]$Snapshot.reviewedTree) {
    throw "Current Git HEAD or tree no longer matches the captured write-fence review identity."
  }
}

function Set-FenceStep {
  param(
    [Parameter(Mandatory = $true)] $Snapshot,
    [Parameter(Mandatory = $true)] [string]$Name,
    [Parameter(Mandatory = $true)] [string]$Status
  )

  $steps = @($Snapshot.steps | Where-Object { $_.name -ne $Name })
  $steps += [pscustomobject]@{
    name = $Name
    status = $Status
    recordedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
  }
  $Snapshot.steps = $steps
}

function Test-FenceStepApplied {
  param(
    [Parameter(Mandatory = $true)] $Snapshot,
    [Parameter(Mandatory = $true)] [string]$Name
  )

  return @($Snapshot.steps | Where-Object {
    $_.name -eq $Name -and $_.status -eq "applied"
  }).Count -eq 1
}

function Test-FenceStepTouched {
  param(
    [Parameter(Mandatory = $true)] $Snapshot,
    [Parameter(Mandatory = $true)] [string]$Name
  )

  return @($Snapshot.steps | Where-Object {
    $_.name -eq $Name -and $_.status -in @("pending", "applied")
  }).Count -eq 1
}

function Invoke-FenceManagementRequest {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Get", "Post", "Patch")]
    [string]$Method,
    [Parameter(Mandatory = $true)] [string]$Path,
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    $Body = $null
  )

  $expectedPrefix = "/v1/projects/$ExpectedProjectRef/"
  if (-not $Path.StartsWith($expectedPrefix, [StringComparison]::Ordinal)) {
    throw "Management API path is outside the expected project boundary."
  }

  $request = @{
    Method = $Method
    Uri = "$($script:ManagementApiBase)$Path"
    Headers = @{ Authorization = "Bearer $AccessToken" }
    TimeoutSec = 15
    ErrorAction = "Stop"
  }
  if ($null -ne $Body) {
    $request.ContentType = "application/json"
    $request.Body = $Body | ConvertTo-Json -Depth 10 -Compress
  }

  try {
    return Invoke-RestMethod @request
  } catch {
    throw "Supabase Management API $Method operation failed at a sanitized project-scoped path."
  }
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

function Invoke-FenceDatabaseQuery {
  param(
    [Parameter(Mandatory = $true)] [string]$Sql,
    [switch]$ExpectSingleJsonRow
  )

  Assert-LinkedProject
  $singleLineSql = ($Sql -replace '\r?\n', ' ').Trim()
  if ([string]::IsNullOrWhiteSpace($singleLineSql)) {
    throw "Database operation received empty SQL."
  }

  $global:LASTEXITCODE = 0
  $raw = corepack pnpm exec supabase db query --linked --output json $singleLineSql
  if ($global:LASTEXITCODE -ne 0) {
    throw "A sanitized write-fence database operation failed."
  }
  if (-not $ExpectSingleJsonRow) {
    return $null
  }

  $rows = @(ConvertFrom-SupabaseQueryRows $raw)
  if ($rows.Count -ne 1) {
    throw "Write-fence database status returned an unexpected result shape."
  }
  return $rows[0]
}

function Read-FenceDatabaseStatus {
  Assert-LinkedProject
  $global:LASTEXITCODE = 0
  $raw = corepack pnpm exec supabase db query --linked `
    --file $script:StatusSqlPath --output json
  if ($global:LASTEXITCODE -ne 0) {
    throw "Unable to read the sanitized write-fence database status."
  }
  $rows = @(ConvertFrom-SupabaseQueryRows $raw)
  if ($rows.Count -ne 1 -or $null -eq $rows[0].write_fence_status) {
    throw "Write-fence database status returned an unexpected result shape."
  }
  return $rows[0].write_fence_status
}

function Select-SanitizedRealtimeConfig {
  param([Parameter(Mandatory = $true)] $Config)

  return [pscustomobject]@{
    privateOnly = Get-OptionalProperty $Config "private_only"
    connectionPool = Get-OptionalProperty $Config "connection_pool"
    maxConcurrentUsers = Get-OptionalProperty $Config "max_concurrent_users"
    maxEventsPerSecond = Get-OptionalProperty $Config "max_events_per_second"
    maxBytesPerSecond = Get-OptionalProperty $Config "max_bytes_per_second"
    maxChannelsPerClient = Get-OptionalProperty $Config "max_channels_per_client"
    maxJoinsPerSecond = Get-OptionalProperty $Config "max_joins_per_second"
    maxPresenceEventsPerSecond = Get-OptionalProperty $Config "max_presence_events_per_second"
    maxPayloadSizeInKb = Get-OptionalProperty $Config "max_payload_size_in_kb"
    suspend = [bool](Get-OptionalProperty $Config "suspend" $false)
    presenceEnabled = Get-OptionalProperty $Config "presence_enabled"
  }
}

function Select-SanitizedNetworkConfig {
  param([Parameter(Mandatory = $true)] $Response)

  $config = Get-OptionalProperty $Response "config" ([pscustomobject]@{})
  return [pscustomobject]@{
    ipv4 = @((Get-OptionalProperty $config "dbAllowedCidrs" @()) |
      ForEach-Object { [string]$_ } | Sort-Object -Unique)
    ipv6 = @((Get-OptionalProperty $config "dbAllowedCidrsV6" @()) |
      ForEach-Object { [string]$_ } | Sort-Object -Unique)
    status = [string](Get-OptionalProperty $Response "status" "")
    entitlement = [string](Get-OptionalProperty $Response "entitlement" "")
  }
}

function Get-LiveManagementState {
  param([Parameter(Mandatory = $true)] [string]$AccessToken)

  $network = Invoke-FenceManagementRequest -Method Get `
    -Path "/v1/projects/$ExpectedProjectRef/network-restrictions" `
    -AccessToken $AccessToken
  $realtime = Invoke-FenceManagementRequest -Method Get `
    -Path "/v1/projects/$ExpectedProjectRef/config/realtime" `
    -AccessToken $AccessToken
  $auth = Invoke-FenceManagementRequest -Method Get `
    -Path "/v1/projects/$ExpectedProjectRef/config/auth" `
    -AccessToken $AccessToken

  return [pscustomobject]@{
    network = Select-SanitizedNetworkConfig $network
    realtime = Select-SanitizedRealtimeConfig $realtime
    auth = [pscustomobject]@{
      disableSignup = [bool](Get-OptionalProperty $auth "disable_signup" $false)
    }
  }
}

function New-FenceSnapshot {
  param(
    [Parameter(Mandatory = $true)] [string]$Path,
    [Parameter(Mandatory = $true)] [string]$AccessToken
  )

  Assert-ReleaseCidr $ReleaseIpv4Cidr "IPv4"
  if (-not [string]::IsNullOrWhiteSpace($ReleaseIpv6Cidr)) {
    Assert-ReleaseCidr $ReleaseIpv6Cidr "IPv6"
  }
  # Bind every remote capture to one committed tree before the first remote read.
  $identity = Get-CleanReviewedGitIdentity
  $management = Get-LiveManagementState $AccessToken
  $baselineStatus = ([string]$management.network.status).Trim().ToLowerInvariant()
  $baselineEntitlement = ([string]$management.network.entitlement).Trim().ToLowerInvariant()
  if ($baselineStatus -ne "applied" -or $baselineEntitlement -ne "allowed") {
    throw "Captured network baseline is not proven applied and entitled."
  }
  $database = Read-FenceDatabaseStatus
  $postCaptureIdentity = Get-CleanReviewedGitIdentity
  if ($postCaptureIdentity.head -ne $identity.head -or
    $postCaptureIdentity.tree -ne $identity.tree) {
    throw "Git review identity changed while the fence baseline was captured."
  }

  $snapshot = [pscustomobject][ordered]@{
    schemaVersion = 1
    contract = $script:Contract
    fenceId = [Guid]::NewGuid().ToString("D")
    projectRef = $ExpectedProjectRef
    state = "captured"
    production = $isProductionTarget
    capturedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
    reviewedHead = $identity.head
    reviewedTree = $identity.tree
    roleFenceAppliedAtUtc = $null
    releaseCidrs = [pscustomobject]@{
      ipv4 = @($ReleaseIpv4Cidr)
      ipv6 = if ([string]::IsNullOrWhiteSpace($ReleaseIpv6Cidr)) {
        @()
      } else {
        @($ReleaseIpv6Cidr)
      }
    }
    previous = [pscustomobject]@{
      management = $management
      database = $database
    }
    steps = @()
    migrationStarted = $false
    migrationVerified = $false
    postMigrationEvidence = $null
  }
  Write-FenceSnapshot $Path $snapshot
  return $snapshot
}

function Set-NetworkFence {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $body = [ordered]@{
    dbAllowedCidrs = @($Snapshot.releaseCidrs.ipv4)
    dbAllowedCidrsV6 = @($Snapshot.releaseCidrs.ipv6)
  }
  Invoke-FenceManagementRequest -Method Post `
    -Path "/v1/projects/$ExpectedProjectRef/network-restrictions/apply" `
    -AccessToken $AccessToken -Body $body | Out-Null
}

function Set-RealtimeFence {
  param([Parameter(Mandatory = $true)] [string]$AccessToken)

  Invoke-FenceManagementRequest -Method Patch `
    -Path "/v1/projects/$ExpectedProjectRef/config/realtime" `
    -AccessToken $AccessToken -Body ([ordered]@{ suspend = $true }) | Out-Null
  Invoke-FenceManagementRequest -Method Post `
    -Path "/v1/projects/$ExpectedProjectRef/config/realtime/shutdown" `
    -AccessToken $AccessToken | Out-Null
}

function Set-AuthFence {
  param([Parameter(Mandatory = $true)] [string]$AccessToken)

  Invoke-FenceManagementRequest -Method Patch `
    -Path "/v1/projects/$ExpectedProjectRef/config/auth" `
    -AccessToken $AccessToken `
    -Body ([ordered]@{ disable_signup = $true }) | Out-Null
}

function Set-DatabaseRoleFence {
  $roleSql = @'
ALTER ROLE authenticator IN DATABASE postgres SET default_transaction_read_only TO on;
ALTER ROLE supabase_auth_admin IN DATABASE postgres SET default_transaction_read_only TO on;
ALTER ROLE supabase_storage_admin IN DATABASE postgres SET default_transaction_read_only TO on;
ALTER ROLE dashboard_user IN DATABASE postgres SET default_transaction_read_only TO on;
'@
  Invoke-FenceDatabaseQuery -Sql $roleSql

  # The ALTER ROLE transaction must commit before this separate connection
  # boundary. Every later protected session then inherits read-only state.
  $terminationSql = @'
WITH cutoff AS MATERIALIZED (
  SELECT clock_timestamp() AS applied_at_utc
), targets AS MATERIALIZED (
  SELECT activity.pid
  FROM pg_catalog.pg_stat_activity activity
  CROSS JOIN cutoff
  WHERE activity.datname = current_database()
    AND activity.pid <> pg_backend_pid()
    AND activity.backend_start < cutoff.applied_at_utc
    AND activity.usename IN (
      'authenticator',
      'supabase_auth_admin',
      'supabase_storage_admin',
      'dashboard_user'
    )
), terminated AS (
  SELECT pg_terminate_backend(target.pid) AS terminated
  FROM targets target
)
SELECT json_build_object(
  'appliedAtUtc', (SELECT applied_at_utc FROM cutoff),
  'terminationFailures', count(*) FILTER (WHERE NOT terminated)
) AS role_fence_activation
FROM terminated;
'@
  $row = Invoke-FenceDatabaseQuery -Sql $terminationSql -ExpectSingleJsonRow
  $activation = $row.role_fence_activation
  if ($null -eq $activation -or [long]$activation.terminationFailures -ne 0) {
    throw "A protected pooled session could not be terminated."
  }
  $appliedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse(
      [string]$activation.appliedAtUtc,
      [ref]$appliedAt
    )) {
    throw "Database role fence did not return a valid activation boundary."
  }
  return $appliedAt.ToUniversalTime().ToString("o")
}

function Set-CronFence {
  Invoke-FenceDatabaseQuery -Sql `
    "ALTER SYSTEM SET cron.launch_active_jobs TO off; SELECT pg_reload_conf();"
}

function Assert-ReleaseConnectionWritable {
  $sql = @'
BEGIN;
CREATE TABLE public.release_fence_write_probe(id integer);
INSERT INTO public.release_fence_write_probe(id) VALUES (1);
ROLLBACK;
'@
  Invoke-FenceDatabaseQuery -Sql $sql
}

function Wait-NetworkFenceEnforced {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($DrainTimeoutSeconds)
  do {
    $management = Get-LiveManagementState $AccessToken
    $networkStatus = ([string]$management.network.status).Trim().ToLowerInvariant()
    $networkEntitlement = ([string]$management.network.entitlement).Trim().ToLowerInvariant()
    if ($networkEntitlement -ne "allowed") {
      throw "Network restriction entitlement cannot prove enforcement."
    }
    if ($networkStatus -notin $script:EnforcedNetworkStatuses -and
      $networkStatus -notin $script:PendingNetworkStatuses) {
      throw "Network restriction status cannot prove enforcement."
    }

    $actualV4 = @($management.network.ipv4 | Sort-Object -Unique)
    $expectedV4 = @($Snapshot.releaseCidrs.ipv4 | Sort-Object -Unique)
    $actualV6 = @($management.network.ipv6 | Sort-Object -Unique)
    $expectedV6 = @($Snapshot.releaseCidrs.ipv6 | Sort-Object -Unique)
    $cidrsMatch = @(
      Compare-Object $actualV4 $expectedV4
      Compare-Object $actualV6 $expectedV6
    ).Count -eq 0
    if ($networkStatus -in $script:EnforcedNetworkStatuses -and $cidrsMatch) {
      return $management
    }
    Start-Sleep -Milliseconds 1000
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "Network restriction did not become enforced before the bounded timeout."
}

function Wait-FenceDrain {
  param([Parameter(Mandatory = $true)] $Snapshot)

  $roleFenceAppliedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse(
      [string]$Snapshot.roleFenceAppliedAtUtc,
      [ref]$roleFenceAppliedAt
    )) {
    throw "Write-fence snapshot lacks a valid protected-session cutoff."
  }
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($DrainTimeoutSeconds)
  do {
    $status = Read-FenceDatabaseStatus
    $activeTransactions = [long]$status.drain.activeTransactions
    $runningCronJobs = [long]$status.drain.runningCronJobs
    $protectedRoleSessions = [long]$status.drain.protectedRoleSessions
    $oldProtectedSessions = $false
    if ($protectedRoleSessions -gt 0) {
      $oldest = [DateTimeOffset]::MinValue
      $oldestRaw = [string]$status.drain.oldestProtectedRoleSessionAtUtc
      if (-not [DateTimeOffset]::TryParse($oldestRaw, [ref]$oldest)) {
        throw "Protected-session drain evidence is malformed."
      }
      $oldProtectedSessions = $oldest -lt $roleFenceAppliedAt
    }
    if ($activeTransactions -eq 0 -and $runningCronJobs -eq 0 -and
      -not $oldProtectedSessions) {
      return $status
    }
    Start-Sleep -Milliseconds 1000
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "Write-fence drain did not reach zero before the bounded timeout."
}

function Assert-FenceActive {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $management = Wait-NetworkFenceEnforced $AccessToken $Snapshot
  if ($management.realtime.suspend -ne $true -or
    $management.auth.disableSignup -ne $true) {
    throw "Realtime or Auth management fence is not active."
  }

  $database = Wait-FenceDrain $Snapshot
  foreach ($role in $script:ProtectedRoles) {
    $roleStatus = $database.roles.PSObject.Properties[$role].Value
    if ($null -eq $roleStatus -or $roleStatus.exists -ne $true -or
      $roleStatus.configuredValue -ne "on") {
      throw "A required Supabase service role is not database-readonly."
    }
  }
  if ($database.cron.launchActiveJobs -ne "off") {
    throw "pg_cron launcher remains active."
  }
  Assert-ReleaseConnectionWritable
}

function Restore-CronFence {
  param([Parameter(Mandatory = $true)] $Snapshot)

  $cron = $Snapshot.previous.database.cron
  $autoOverridePresent = [bool](Get-OptionalProperty $cron "autoOverridePresent" $false)
  $autoOverrideValue = [string](Get-OptionalProperty $cron "autoOverrideValue" "")
  if ($autoOverridePresent) {
    if ($autoOverrideValue -notin @("on", "off")) {
      throw "Captured cron auto-override is not safely restorable."
    }
    Invoke-FenceDatabaseQuery -Sql `
      "ALTER SYSTEM SET cron.launch_active_jobs TO $autoOverrideValue; SELECT pg_reload_conf();"
  } else {
    Invoke-FenceDatabaseQuery -Sql `
      "ALTER SYSTEM RESET cron.launch_active_jobs; SELECT pg_reload_conf();"
  }
}

function Restore-DatabaseRoleFence {
  param([Parameter(Mandatory = $true)] $Snapshot)

  $statements = @()
  foreach ($role in $script:ProtectedRoles) {
    $roleSnapshot = $Snapshot.previous.database.roles.PSObject.Properties[$role].Value
    $priorValue = [string](Get-OptionalProperty $roleSnapshot "configuredValue" "")
    if ($priorValue -in @("on", "off")) {
      $statements += "ALTER ROLE $role IN DATABASE postgres SET default_transaction_read_only TO $priorValue;"
    } else {
      $statements += "ALTER ROLE $role IN DATABASE postgres RESET default_transaction_read_only;"
    }
  }
  Invoke-FenceDatabaseQuery -Sql ($statements -join "`n")

  # Terminate in a second committed command so every surviving/reconnected
  # protected session inherits the restored baseline.
  $terminateSql = @'
SELECT pg_terminate_backend(pid)
FROM pg_catalog.pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND usename IN (
    'authenticator',
    'supabase_auth_admin',
    'supabase_storage_admin',
    'dashboard_user'
  );
'@
  Invoke-FenceDatabaseQuery -Sql $terminateSql
}

function Restore-ManagementFence {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  if ((Test-FenceStepTouched $Snapshot "auth")) {
    Invoke-FenceManagementRequest -Method Patch `
      -Path "/v1/projects/$ExpectedProjectRef/config/auth" `
      -AccessToken $AccessToken -Body ([ordered]@{
        disable_signup = [bool]$Snapshot.previous.management.auth.disableSignup
      }) | Out-Null
  }
  if ((Test-FenceStepTouched $Snapshot "network")) {
    Invoke-FenceManagementRequest -Method Post `
      -Path "/v1/projects/$ExpectedProjectRef/network-restrictions/apply" `
      -AccessToken $AccessToken -Body ([ordered]@{
        dbAllowedCidrs = @($Snapshot.previous.management.network.ipv4)
        dbAllowedCidrsV6 = @($Snapshot.previous.management.network.ipv6)
      }) | Out-Null
  }
  if ((Test-FenceStepTouched $Snapshot "realtime")) {
    Invoke-FenceManagementRequest -Method Patch `
      -Path "/v1/projects/$ExpectedProjectRef/config/realtime" `
      -AccessToken $AccessToken -Body ([ordered]@{
        suspend = [bool]$Snapshot.previous.management.realtime.suspend
      }) | Out-Null
  }
}

function Test-DatabaseRoleBaselineMatches {
  param(
    [Parameter(Mandatory = $true)] $Actual,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $expected = $Snapshot.previous.database
  if ([string]$Actual.contract -ne [string]$expected.contract -or
    [string]$Actual.database -ne [string]$expected.database) {
    return $false
  }
  foreach ($role in $script:ProtectedRoles) {
    $actualRole = Get-OptionalProperty $Actual.roles $role $null
    $expectedRole = Get-OptionalProperty $expected.roles $role $null
    if ($null -eq $actualRole -or $null -eq $expectedRole -or
      [bool]$actualRole.exists -ne [bool]$expectedRole.exists -or
      [string](Get-OptionalProperty $actualRole "configuredValue" "") -ne
        [string](Get-OptionalProperty $expectedRole "configuredValue" "")) {
      return $false
    }
  }

  return $true
}

function Test-CronBaselineMatches {
  param(
    [Parameter(Mandatory = $true)] $Actual,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $actualCron = $Actual.cron
  $expectedCron = $Snapshot.previous.database.cron
  if ([string]$actualCron.launchActiveJobs -ne [string]$expectedCron.launchActiveJobs -or
    [bool]$actualCron.autoOverridePresent -ne [bool]$expectedCron.autoOverridePresent -or
    [string](Get-OptionalProperty $actualCron "autoOverrideValue" "") -ne
      [string](Get-OptionalProperty $expectedCron "autoOverrideValue" "")) {
    return $false
  }
  return $true
}

function Test-DatabaseBaselineMatches {
  param(
    [Parameter(Mandatory = $true)] $Actual,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  return (Test-DatabaseRoleBaselineMatches $Actual $Snapshot) -and
    (Test-CronBaselineMatches $Actual $Snapshot)
}

function Wait-ManagementStateRestored {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $expected = $Snapshot.previous.management
  $expectedStatus = ([string]$expected.network.status).Trim().ToLowerInvariant()
  $expectedEntitlement = ([string]$expected.network.entitlement).Trim().ToLowerInvariant()
  if ($expectedStatus -ne "applied" -or $expectedEntitlement -ne "allowed") {
    throw "Captured network baseline cannot be exactly restored automatically."
  }

  $expectedRealtime = $expected.realtime | ConvertTo-Json -Depth 10 -Compress
  $expectedAuth = $expected.auth | ConvertTo-Json -Depth 10 -Compress
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($DrainTimeoutSeconds)
  do {
    $actual = Get-LiveManagementState $AccessToken
    $actualStatus = ([string]$actual.network.status).Trim().ToLowerInvariant()
    $actualEntitlement = ([string]$actual.network.entitlement).Trim().ToLowerInvariant()
    if ($actualStatus -notin $script:EnforcedNetworkStatuses -and
      $actualStatus -notin $script:PendingNetworkStatuses) {
      throw "Restored network status cannot prove the captured baseline."
    }
    if ($actualEntitlement -ne "allowed") {
      throw "Restored network entitlement cannot prove enforcement."
    }

    $actualV4 = @($actual.network.ipv4 | Sort-Object -Unique)
    $expectedV4 = @($expected.network.ipv4 | Sort-Object -Unique)
    $actualV6 = @($actual.network.ipv6 | Sort-Object -Unique)
    $expectedV6 = @($expected.network.ipv6 | Sort-Object -Unique)
    $networkMatches = @(
      Compare-Object $actualV4 $expectedV4
      Compare-Object $actualV6 $expectedV6
    ).Count -eq 0
    $realtimeMatches = ($actual.realtime | ConvertTo-Json -Depth 10 -Compress) -eq
      $expectedRealtime
    $authMatches = ($actual.auth | ConvertTo-Json -Depth 10 -Compress) -eq
      $expectedAuth
    if ($actualStatus -eq $expectedStatus -and
      $actualEntitlement -eq $expectedEntitlement -and $networkMatches -and
      $realtimeMatches -and $authMatches) {
      return
    }
    Start-Sleep -Milliseconds 1000
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "Management controls did not return to the exact captured baseline before timeout."
}

function Wait-DatabaseRoleStateRestored {
  param([Parameter(Mandatory = $true)] $Snapshot)

  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($DrainTimeoutSeconds)
  do {
    $actual = Read-FenceDatabaseStatus
    if ((Test-DatabaseRoleBaselineMatches $actual $Snapshot)) {
      return
    }
    Start-Sleep -Milliseconds 1000
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "Database role controls did not return to the exact captured baseline before timeout."
}

function Wait-DatabaseStateRestored {
  param([Parameter(Mandatory = $true)] $Snapshot)

  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($DrainTimeoutSeconds)
  do {
    $actual = Read-FenceDatabaseStatus
    if ((Test-DatabaseBaselineMatches $actual $Snapshot)) {
      return
    }
    Start-Sleep -Milliseconds 1000
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "Database controls did not return to the exact captured baseline before timeout."
}

function Assert-FenceRestored {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  Wait-ManagementStateRestored $AccessToken $Snapshot
  Wait-DatabaseStateRestored $Snapshot
  Wait-ManagementStateRestored $AccessToken $Snapshot
  Wait-DatabaseStateRestored $Snapshot
  Assert-ReleaseConnectionWritable
}

function Restore-Fence {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot,
    [Parameter(Mandatory = $true)] [string]$Path
  )

  if ($Snapshot.migrationStarted -eq $true -and $Snapshot.migrationVerified -ne $true) {
    $Snapshot.state = "manual_recovery_required"
    Write-FenceSnapshot $Path $Snapshot
    throw "Migration started without separate post-migration evidence; the fence remains active."
  }
  $Snapshot.state = "restoring"
  Set-FenceStep $Snapshot "restore" "pending"
  Write-FenceSnapshot $Path $Snapshot
  try {
    # Keep the database service roles read-only while Auth, Realtime, and
    # network controls return to their captured baseline. If any management
    # transition is partial or times out, the catch block re-applies the fence
    # before service-role writes are reopened.
    Restore-ManagementFence $AccessToken $Snapshot
    Wait-ManagementStateRestored $AccessToken $Snapshot

    if ((Test-FenceStepTouched $Snapshot "roles")) {
      Restore-DatabaseRoleFence $Snapshot
    }
    Wait-DatabaseRoleStateRestored $Snapshot

    # Cron is the final writer to resume. A job must never run while either
    # management controls or database role restoration is still unverified.
    if ((Test-FenceStepTouched $Snapshot "cron")) {
      Restore-CronFence $Snapshot
    }
    Assert-FenceRestored $AccessToken $Snapshot
    $Snapshot.state = "released"
    Set-FenceStep $Snapshot "restore" "applied"
    Write-FenceSnapshot $Path $Snapshot
  } catch {
    $refenced = $false
    try {
      Set-NetworkFence $AccessToken $Snapshot
      Set-RealtimeFence $AccessToken
      Set-AuthFence $AccessToken
      $Snapshot.roleFenceAppliedAtUtc = Set-DatabaseRoleFence
      Set-CronFence
      Assert-FenceActive $AccessToken $Snapshot
      $refenced = $true
    } catch {
      $refenced = $false
    }
    $Snapshot.state = "manual_recovery_required"
    Set-FenceStep $Snapshot "restore" "failed"
    Write-FenceSnapshot $Path $Snapshot
    if ($refenced) {
      throw "Write-fence restore failed; live controls were re-fenced and manual exact restoration is required."
    }
    throw "Write-fence restore failed and live controls could not be proven; follow the emergency recovery runbook immediately."
  }
}

function Invoke-FenceActivation {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot,
    [Parameter(Mandatory = $true)] [string]$Path
  )

  if ($Snapshot.state -ne "captured") {
    throw "Only a captured snapshot can be activated."
  }
  Assert-SnapshotHead $Snapshot
  $Snapshot.state = "activating"
  Write-FenceSnapshot $Path $Snapshot

  try {
    Set-FenceStep $Snapshot "network" "pending"
    Write-FenceSnapshot $Path $Snapshot
    Set-NetworkFence $AccessToken $Snapshot
    Set-FenceStep $Snapshot "network" "applied"
    Write-FenceSnapshot $Path $Snapshot

    Set-FenceStep $Snapshot "realtime" "pending"
    Write-FenceSnapshot $Path $Snapshot
    Set-RealtimeFence $AccessToken
    Set-FenceStep $Snapshot "realtime" "applied"
    Write-FenceSnapshot $Path $Snapshot

    Set-FenceStep $Snapshot "auth" "pending"
    Write-FenceSnapshot $Path $Snapshot
    Set-AuthFence $AccessToken
    Set-FenceStep $Snapshot "auth" "applied"
    Write-FenceSnapshot $Path $Snapshot

    Set-FenceStep $Snapshot "roles" "pending"
    Write-FenceSnapshot $Path $Snapshot
    $Snapshot.roleFenceAppliedAtUtc = Set-DatabaseRoleFence
    Set-FenceStep $Snapshot "roles" "applied"
    Write-FenceSnapshot $Path $Snapshot

    Set-FenceStep $Snapshot "cron" "pending"
    Write-FenceSnapshot $Path $Snapshot
    Set-CronFence
    Set-FenceStep $Snapshot "cron" "applied"
    Write-FenceSnapshot $Path $Snapshot

    Assert-FenceActive $AccessToken $Snapshot
    Set-FenceStep $Snapshot "verify" "applied"
    $Snapshot.state = "active"
    Write-FenceSnapshot $Path $Snapshot
  } catch {
    $Snapshot.state = "activation_failed"
    Set-FenceStep $Snapshot "activation" "failed"
    Write-FenceSnapshot $Path $Snapshot
    try {
      Restore-Fence $AccessToken $Snapshot $Path
    } catch {
      $Snapshot.state = "manual_recovery_required"
      Write-FenceSnapshot $Path $Snapshot
    }
    throw "Write-fence activation failed; completed steps were rolled back or journaled for recovery."
  }
}

if ($Action -eq "Plan") {
  [pscustomobject]@{
    contract = $script:Contract
    projectRef = $ExpectedProjectRef
    production = $isProductionTarget
    remoteCallsExecuted = $false
    operations = @(
      "restrict_database_network"
      "suspend_and_shutdown_realtime"
      "disable_auth_signup"
      "set_service_roles_read_only"
      "stop_and_drain_pg_cron"
      "verify_release_connection_writable"
    )
  } | ConvertTo-Json
  exit 0
}

if ($Action -eq "MarkMigrationStarted") {
  $path = Resolve-FenceSnapshotPath
  $snapshot = Read-FenceSnapshot $path
  Assert-SnapshotHead $snapshot
  if ($snapshot.state -ne "active" -or $snapshot.migrationStarted -eq $true) {
    throw "Migration can only be marked once from an active verified fence."
  }
  $snapshot.migrationStarted = $true
  $snapshot.migrationVerified = $false
  $snapshot.postMigrationEvidence = $null
  $snapshot.state = "migration_in_progress"
  Set-FenceStep $snapshot "migration" "started"
  Write-FenceSnapshot $path $snapshot
  Write-Output "Migration start was journaled; automatic fence restoration is now disabled."
  exit 0
}

if ($Action -eq "MarkMigrationVerified") {
  $path = Resolve-FenceSnapshotPath
  $snapshot = Read-FenceSnapshot $path
  Assert-SnapshotHead $snapshot
  if ($snapshot.state -ne "migration_in_progress" -or
    $snapshot.migrationStarted -ne $true -or
    $snapshot.migrationVerified -eq $true) {
    throw "Post-migration evidence can only verify one in-progress migration."
  }
  if ($isProductionTarget) {
    throw "Production cannot accept operator-authored post-migration evidence; the automated black-box producer is not yet verified."
  }
  $evidencePath = Resolve-PostMigrationEvidencePath
  $summary = Read-PostMigrationEvidence $evidencePath $snapshot
  $snapshot.postMigrationEvidence = $summary
  $snapshot.migrationVerified = $true
  $snapshot.state = "migration_verified"
  Set-FenceStep $snapshot "migration_verification" "applied"
  Write-FenceSnapshot $path $snapshot
  Write-Output "Separate post-migration evidence was validated and journaled."
  exit 0
}

Assert-LinkedProject
if ($Action -eq "Capture") {
  if ([string]::IsNullOrWhiteSpace($ReleaseIpv4Cidr)) {
    throw "Capture requires an explicit single-host -ReleaseIpv4Cidr."
  }
}

$previousManagementAccessToken = $env:SUPABASE_ACCESS_TOKEN
$previousDatabasePassword = $env:SUPABASE_DB_PASSWORD
$managementToken = $null
$promptedDatabasePassword = $null
$linkLock = [IO.File]::Open(
  $script:LinkedRefPath,
  [IO.FileMode]::Open,
  [IO.FileAccess]::Read,
  [IO.FileShare]::Read
)
try {
  # Recheck after acquiring the read-share-only handle; relinking remains
  # impossible until every remote lifecycle action and restoration completes.
  Assert-LinkedProject
  $managementToken = Read-FenceSecret "Paste a project-scoped Supabase Management token (hidden)"
  $env:SUPABASE_ACCESS_TOKEN = $managementToken
  if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_PASSWORD)) {
    $promptedDatabasePassword = Read-FenceSecret "Paste the Supabase database password (hidden)"
    $env:SUPABASE_DB_PASSWORD = $promptedDatabasePassword
  }

  switch ($Action) {
    "Capture" {
      $path = Resolve-FenceSnapshotPath -ForCapture
      New-FenceSnapshot $path $managementToken | Out-Null
      Write-Output $path
    }
    "Activate" {
      $path = Resolve-FenceSnapshotPath
      $snapshot = Read-FenceSnapshot $path
      Invoke-FenceActivation $managementToken $snapshot $path
      Write-Output "Write fence is active."
    }
    "Verify" {
      $path = Resolve-FenceSnapshotPath
      $snapshot = Read-FenceSnapshot $path
      Assert-SnapshotHead $snapshot
      Assert-FenceActive $managementToken $snapshot
      Write-Output "Write fence verification passed."
    }
    "Deactivate" {
      $path = Resolve-FenceSnapshotPath
      $snapshot = Read-FenceSnapshot $path
      Restore-Fence $managementToken $snapshot $path
      Write-Output "Write fence was restored to its captured state."
    }
    "Recover" {
      $path = Resolve-FenceSnapshotPath
      $snapshot = Read-FenceSnapshot $path
      Restore-Fence $managementToken $snapshot $path
      Write-Output "Write fence recovery completed."
    }
  }
} finally {
  if ($null -eq $previousDatabasePassword) {
    Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
  } else {
    $env:SUPABASE_DB_PASSWORD = $previousDatabasePassword
  }
  if ($null -eq $previousManagementAccessToken) {
    Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
  } else {
    $env:SUPABASE_ACCESS_TOKEN = $previousManagementAccessToken
  }
  $managementToken = $null
  $promptedDatabasePassword = $null
  $previousManagementAccessToken = $null
  $linkLock.Dispose()
}
