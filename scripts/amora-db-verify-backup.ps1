param(
  [string] $BackupDirectory,

  [string] $ExpectedProjectRef,

  [string] $ExpectedBackupSetId,

  [string] $ExpectedManifestSha256,

  [ValidateRange(1, 1440)]
  [int] $MaximumAgeMinutes = 30,

  [string] $NodeCli = 'node.exe',

  [switch] $SelfTest,

  [string] $SelfTestBackupRoot,

  [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'amora-db-backup-common.ps1')

$ExpectedTables = @(
  'ai_interactions_log',
  'amora_actions',
  'amora_couple_profiles',
  'amora_turn_counters',
  'chat_feedback',
  'chat_messages',
  'chat_summaries',
  'couples',
  'decision_nodes',
  'profiles',
  'wedding_journeys'
)
$ExpectedFiles = @(
  'logical-data.json.hbam2',
  'logical-data.json.key.dpapi',
  'manifest.json',
  'schema-inventory.json.hbam2',
  'schema-inventory.json.key.dpapi'
)
$RequiredFunctionIdentities = @(
  'update_updated_at_column()',
  'is_couple_member(uuid)',
  'reserve_amora_turn(uuid,integer,integer)',
  'apply_journey_progress_patch(uuid,jsonb,text[])',
  'join_couple(text,text)',
  'generate_invite_code()',
  'redact_old_ai_interactions(interval)',
  'create_profile_on_signup()'
)

function Show-Help {
  Write-Host ''
  Write-Host 'Verify an Amora encrypted logical backup'
  Write-Host ''
  Write-Host 'Requires an externally recorded backup-set ID and manifest SHA-256, enforces'
  Write-Host 'freshness, decrypts only in memory, and runs the authenticated PGlite JSONB check.'
  Write-Host ''
  Write-Host 'Usage:'
  Write-Host '  corepack pnpm amora:db:verify-backup -BackupDirectory <dir> `'
  Write-Host '    -ExpectedProjectRef <ref> -ExpectedBackupSetId <uuid> `'
  Write-Host '    -ExpectedManifestSha256 <sha256>'
  Write-Host ''
  Write-Host '-Help performs no filesystem, DPAPI, Node, or database operation.'
}

function ConvertTo-ValidatedTimestamp {
  param(
    [Parameter(Mandatory = $true)] [string] $Value,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  try {
    return [DateTimeOffset]::Parse(
      $Value,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind
    )
  } catch { throw "$Label is not a valid timestamp." }
}

function Assert-ExactTableAllowlist {
  param(
    [Parameter(Mandatory = $true)] [string[]] $Actual,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  if ($Actual.Count -ne $ExpectedTables.Count -or
      @(Compare-Object -ReferenceObject $ExpectedTables -DifferenceObject $Actual).Count -ne 0) {
    throw "$Label table allowlist mismatch."
  }
}

function Assert-InventoryDependencies {
  param([Parameter(Mandatory = $true)] $Inventory)

  foreach ($field in @(
    'captured_at', 'current_user', 'session_user', 'current_role_bypasses_rls', 'row_security',
    'server_version_num', 'migration_history', 'tables', 'columns',
    'constraints', 'indexes', 'policies', 'triggers', 'functions', 'external_triggers'
  )) {
    if (-not $Inventory.PSObject.Properties[$field]) { throw "Schema inventory is missing $field." }
  }
  if ([string]::IsNullOrWhiteSpace([string]$Inventory.current_user) -or
      [string]::IsNullOrWhiteSpace([string]$Inventory.session_user) -or
      -not [bool]$Inventory.current_role_bypasses_rls -or
      [string]$Inventory.row_security -ne 'off') {
    throw 'Schema inventory was not captured by an explicit RLS-bypass role.'
  }
  $names = @($Inventory.tables | ForEach-Object { [string]$_.name } | Sort-Object)
  Assert-ExactTableAllowlist -Actual $names -Label 'Inventory'
  Assert-HBAM2RelationShapes `
    -Relations $Inventory.tables `
    -ExpectedNames $ExpectedTables `
    -Label 'Inventory'
  $identities = @($Inventory.functions | ForEach-Object {
    ([string]$_.identity).ToLowerInvariant() -replace '^public\.', ''
  })
  foreach ($identity in $RequiredFunctionIdentities) {
    if ($identity -notin $identities) {
      throw "Schema inventory is missing required function signature $identity."
    }
  }
  if (@($Inventory.external_triggers | Where-Object {
    [string]$_.schema -eq 'auth' -and
    [string]$_.table -eq 'users' -and
    [string]$_.enabled -in @('O', 'A') -and
    [int]$_.type_bits -eq 5 -and
    [bool]$_.row_level -and
    [bool]$_.fires_insert -and
    -not [bool]$_.fires_delete -and
    -not [bool]$_.fires_update -and
    -not [bool]$_.fires_truncate -and
    [string]$_.timing -eq 'AFTER' -and
    [string]$_.function_identity -match '(^|\.)create_profile_on_signup\('
  }).Count -lt 1) {
    throw 'Schema inventory is missing an enabled auth.users signup trigger dependency.'
  }
}

function Get-InventoryContractSha256 {
  param([Parameter(Mandatory = $true)] $Inventory)

  Assert-InventoryDependencies -Inventory $Inventory
  $contract = [ordered]@{
    current_user = $Inventory.current_user
    session_user = $Inventory.session_user
    current_role_bypasses_rls = $Inventory.current_role_bypasses_rls
    row_security = $Inventory.row_security
    server_version_num = $Inventory.server_version_num
    migration_history = $Inventory.migration_history
    tables = $Inventory.tables
    columns = $Inventory.columns
    constraints = $Inventory.constraints
    indexes = $Inventory.indexes
    policies = $Inventory.policies
    triggers = $Inventory.triggers
    functions = $Inventory.functions
    external_triggers = $Inventory.external_triggers
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($contract | ConvertTo-Json -Depth 100 -Compress))
  try { return Get-HBAM2Sha256Hex -Bytes $bytes }
  finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Invoke-PGliteJsonbRoundTrip {
  param(
    [Parameter(Mandatory = $true)] [byte[]] $InventoryBytes,
    [Parameter(Mandatory = $true)] [byte[]] $DataBytes,
    [Parameter(Mandatory = $true)] $RuntimeFence
  )

  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $webRoot = Join-Path $repoRoot 'apps\web'
  $nodeScript = Join-Path $webRoot 'scripts\amora-db-jsonb-roundtrip.mjs'
  if (-not (Test-Path -LiteralPath $nodeScript -PathType Leaf)) {
    throw 'PGlite authenticated JSONB round-trip script is missing.'
  }
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $RuntimeFence.NodePath
  $startInfo.Arguments = "`"$nodeScript`""
  $startInfo.WorkingDirectory = $webRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($name in @(
    'NODE_OPTIONS', 'NODE_PATH', 'NODE_COMPILE_CACHE', 'NODE_V8_COVERAGE',
    'NODE_REDIRECT_WARNINGS', 'NODE_CHANNEL_FD'
  )) {
    [void]$startInfo.EnvironmentVariables.Remove($name)
  }
  $startInfo.EnvironmentVariables['HBAM_PGLITE_ENTRY'] = $RuntimeFence.PGliteEntryPath
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start the PGlite verification process.' }
  try {
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    foreach ($payloadBytes in @($InventoryBytes, $DataBytes)) {
      $remaining = 120000 - [int]$deadline.ElapsedMilliseconds
      if ($remaining -le 0) {
        & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null
        throw 'PGlite authenticated JSONB input exceeded the total 120-second deadline.'
      }
      $line = [Convert]::ToBase64String($payloadBytes)
      $writeTask = $process.StandardInput.WriteLineAsync($line)
      if (-not $writeTask.Wait($remaining)) {
        & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null
        throw 'PGlite authenticated JSONB input exceeded the total 120-second deadline.'
      }
      [void]$writeTask.GetAwaiter().GetResult()
      $line = $null
    }
    $process.StandardInput.Close()
    $remaining = 120000 - [int]$deadline.ElapsedMilliseconds
    if ($remaining -le 0 -or -not $process.WaitForExit($remaining)) {
      & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null
      throw 'PGlite authenticated JSONB round-trip exceeded 120 seconds.'
    }
    $process.WaitForExit()
    $stdout = $stdoutTask.Result
    $null = $stderrTask.Result
    if ($process.ExitCode -ne 0) {
      throw "PGlite authenticated JSONB round-trip failed with exit code $($process.ExitCode)."
    }
    try { $receipt = $stdout.Trim() | ConvertFrom-Json }
    catch { throw 'PGlite authenticated JSONB round-trip returned invalid receipt JSON.' }
    foreach ($field in @(
      'JsonbRoundTripVerified', 'AuthenticatedJsonbStaged', 'SourceCanonicalDigestsVerified',
      'Engine', 'TableCount', 'TotalRows', 'PrimaryConstraintsChecked',
      'ForeignKeysChecked', 'ExternalForeignKeysSkipped',
      'LogicalDataParsedInV8', 'PlaintextWrittenToDisk'
    )) {
      if (-not $receipt.PSObject.Properties[$field]) {
        throw 'PGlite authenticated JSONB round-trip returned an incomplete receipt.'
      }
    }
    if (-not [bool]$receipt.JsonbRoundTripVerified -or
        -not [bool]$receipt.AuthenticatedJsonbStaged -or
        -not [bool]$receipt.SourceCanonicalDigestsVerified -or
        $receipt.Engine -ne 'PGlite' -or
        [bool]$receipt.LogicalDataParsedInV8 -or
        [bool]$receipt.PlaintextWrittenToDisk -or
        [int]$receipt.PrimaryConstraintsChecked -lt 1 -or
        [int]$receipt.ForeignKeysChecked -lt 1) {
      throw 'PGlite authenticated JSONB round-trip returned an invalid receipt.'
    }
    return $receipt
  } finally { $process.Dispose() }
}

if ($Help) { Show-Help; exit 0 }
if ([string]::IsNullOrWhiteSpace($BackupDirectory)) { throw '-BackupDirectory is required.' }
if ([string]::IsNullOrWhiteSpace($ExpectedProjectRef) -or
    $ExpectedProjectRef -notmatch '^[a-z0-9]{20}$') {
  throw '-ExpectedProjectRef must be an explicit 20-character project ref.'
}
try { $canonicalExpectedSet = ([Guid]::ParseExact($ExpectedBackupSetId, 'D')).ToString('D') }
catch { throw '-ExpectedBackupSetId must be a canonical UUID.' }
if ($canonicalExpectedSet -ne $ExpectedBackupSetId) { throw '-ExpectedBackupSetId must use canonical lowercase UUID form.' }
if ($ExpectedManifestSha256 -notmatch '^[A-F0-9]{64}$') {
  throw '-ExpectedManifestSha256 must be an uppercase SHA-256 digest.'
}
if ($env:OS -ne 'Windows_NT') { throw 'This backup format requires Windows DPAPI.' }
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$rootInfo = Resolve-HBAM2BackupRoot -SelfTest ([bool]$SelfTest) -SelfTestBackupRoot $SelfTestBackupRoot
Assert-HBAM2BackupRoot -Root $rootInfo.Root -Anchor $rootInfo.Anchor
$directory = (Resolve-Path -LiteralPath $BackupDirectory).Path
$root = $rootInfo.Root
if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($directory)).TrimEnd('\') -ne
      [IO.Path]::GetFullPath($root).TrimEnd('\') -or
    [IO.Path]::GetFileName($directory) -notmatch '^\d{8}-\d{6}$') {
  throw 'Backup directory failed fixed-root containment validation.'
}
Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $directory -Anchor $rootInfo.Anchor
Assert-HBAM2PrivateDirectoryAcl -Path $directory
$entries = @(Get-ChildItem -LiteralPath $directory -Force)
$files = @($entries | Where-Object { -not $_.PSIsContainer } | ForEach-Object Name | Sort-Object)
if ($entries.Count -ne $ExpectedFiles.Count -or
    @(Compare-Object -ReferenceObject $ExpectedFiles -DifferenceObject $files).Count -ne 0) {
  throw 'Backup directory contains an unexpected artifact set.'
}
foreach ($file in $ExpectedFiles) {
  $path = Join-Path $directory $file
  $item = Get-Item -LiteralPath $path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Backup artifacts must not be reparse points.'
  }
  Assert-HBAM2PrivateFileAcl -Path $path
}

$manifestBytes = Read-HBAM2BoundedFileBytes -Path (Join-Path $directory 'manifest.json') `
  -MaximumBytes $script:HBAM2MaximumManifestBytes
try {
  $actualManifestSha256 = Get-HBAM2Sha256Hex -Bytes $manifestBytes
  if ($actualManifestSha256 -ne $ExpectedManifestSha256) {
    throw 'Manifest SHA-256 does not match the externally supplied anchor.'
  }
  try { $manifest = [Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json }
  catch { throw 'Backup manifest is not valid JSON.' }
} finally { [Array]::Clear($manifestBytes, 0, $manifestBytes.Length) }

foreach ($field in @(
  'status', 'format', 'format_version', 'backup_set_id', 'created_at_utc',
  'preflight_captured_at', 'inventory_before_captured_at', 'source_captured_at',
  'inventory_captured_at', 'inventory_after_captured_at', 'inventory_contract_sha256',
  'source_relation_contract_sha256',
  'source_current_user', 'source_session_user', 'source_role_bypasses_rls', 'source_row_security',
  'consistency', 'source_fence', 'plaintext_written_to_disk', 'source_project_ref',
  'source_project_ref_sha256', 'implementation', 'supabase_cli', 'verifier_runtime',
  'artifacts', 'tables'
)) {
  if (-not $manifest.PSObject.Properties[$field]) { throw "Backup manifest is missing $field." }
}
if (-not $manifest.artifacts.PSObject.Properties['schema_inventory'] -or
    -not $manifest.artifacts.PSObject.Properties['logical_data']) {
  throw 'Backup manifest is missing required artifacts.'
}
if ($manifest.status -ne 'complete' -or
    $manifest.format -ne $script:HBAM2FormatName -or
    [int]$manifest.format_version -ne 2 -or
    $manifest.consistency -ne 'data-single-statement-schema-before-after-fenced' -or
    $manifest.source_fence -ne 'supabase-linked-project-ref-plus-explicit-workdir-plus-pinned-cli' -or
    [string]::IsNullOrWhiteSpace([string]$manifest.source_current_user) -or
    [string]::IsNullOrWhiteSpace([string]$manifest.source_session_user) -or
    -not [bool]$manifest.source_role_bypasses_rls -or
    [string]$manifest.source_row_security -ne 'off' -or
    [bool]$manifest.plaintext_written_to_disk) {
  throw 'Backup manifest is incomplete or uses an unsupported safety contract.'
}
if ([string]$manifest.backup_set_id -ne $ExpectedBackupSetId) {
  throw 'Manifest backup set does not match the externally supplied anchor.'
}
if ([string]$manifest.source_project_ref -ne $ExpectedProjectRef) {
  throw 'Backup source project ref does not match -ExpectedProjectRef.'
}
if ([string]$manifest.inventory_contract_sha256 -notmatch '^[A-F0-9]{64}$') {
  throw 'Manifest inventory contract digest is invalid.'
}
if ([string]$manifest.source_relation_contract_sha256 -notmatch '^[A-F0-9]{64}$') {
  throw 'Manifest relation identity contract digest is invalid.'
}
$refBytes = [Text.Encoding]::UTF8.GetBytes($ExpectedProjectRef)
try {
  if ((Get-HBAM2Sha256Hex -Bytes $refBytes) -ne [string]$manifest.source_project_ref_sha256) {
    throw 'Backup source project ref digest mismatch.'
  }
} finally { [Array]::Clear($refBytes, 0, $refBytes.Length) }

$preflightAt = ConvertTo-ValidatedTimestamp -Value ([string]$manifest.preflight_captured_at) -Label 'preflight_captured_at'
$beforeAt = ConvertTo-ValidatedTimestamp -Value ([string]$manifest.inventory_before_captured_at) -Label 'inventory_before_captured_at'
$sourceAt = ConvertTo-ValidatedTimestamp -Value ([string]$manifest.source_captured_at) -Label 'source_captured_at'
$inventoryAt = ConvertTo-ValidatedTimestamp -Value ([string]$manifest.inventory_captured_at) -Label 'inventory_captured_at'
$afterAt = ConvertTo-ValidatedTimestamp -Value ([string]$manifest.inventory_after_captured_at) -Label 'inventory_after_captured_at'
$createdAt = ConvertTo-ValidatedTimestamp -Value ([string]$manifest.created_at_utc) -Label 'created_at_utc'
$now = [DateTimeOffset]::UtcNow
if ($preflightAt -gt $beforeAt -or $beforeAt -gt $sourceAt -or
    $sourceAt -gt $afterAt -or $inventoryAt -ne $afterAt -or $afterAt -gt $createdAt) {
  throw 'Manifest timestamps violate the required query and publication order.'
}
if ($createdAt -gt $now.AddMinutes(5) -or $sourceAt -gt $now.AddMinutes(5) -or
    $now.Subtract($createdAt).TotalMinutes -gt $MaximumAgeMinutes -or
    $now.Subtract($sourceAt).TotalMinutes -gt $MaximumAgeMinutes) {
  throw 'Backup is stale or has a timestamp too far in the future.'
}

$inventoryBytes = $null
$dataBytes = $null
$implementationFence = $null
$cliFence = $null
$runtimeFence = $null
try {
  $implementationFence = New-HBAM2ImplementationFence `
    -RepoRoot $repoRoot `
    -SelfTest ([bool]$SelfTest)
  $runtimeContract = Get-HBAM2VerifierRuntimeContract -RepoRoot $repoRoot
  Assert-HBAM2VerifierRuntimeContract `
    -Recorded $manifest.verifier_runtime `
    -Expected $runtimeContract
  $runtimeFence = New-HBAM2VerifierRuntimeFence `
    -RepoRoot $repoRoot `
    -RequestedNode $NodeCli `
    -SelfTest ([bool]$SelfTest) `
    -Contract $runtimeContract
  Assert-HBAM2ImplementationProvenance `
    -Recorded $manifest.implementation `
    -CurrentFence $implementationFence `
    -RepoRoot $repoRoot `
    -SelfTest ([bool]$SelfTest)
  if ($SelfTest) {
    Assert-HBAM2SupabaseCliProvenance `
      -Recorded $manifest.supabase_cli `
      -SelfTest $true
  } else {
    $cliFence = New-HBAM2SupabaseCliFence `
      -RepoRoot $repoRoot `
      -RequestedCli 'supabase' `
      -SelfTest $false
    Assert-HBAM2SupabaseCliProvenance `
      -Recorded $manifest.supabase_cli `
      -CurrentFence $cliFence `
      -SelfTest $false
  }
  $inventoryBytes = Unprotect-HBAM2Artifact -Directory $directory `
    -Metadata $manifest.artifacts.schema_inventory -ArtifactName 'schema-inventory.json' `
    -ProjectRef $ExpectedProjectRef -BackupSetId $ExpectedBackupSetId
  $dataBytes = Unprotect-HBAM2Artifact -Directory $directory `
    -Metadata $manifest.artifacts.logical_data -ArtifactName 'logical-data.json' `
    -ProjectRef $ExpectedProjectRef -BackupSetId $ExpectedBackupSetId
  try { $inventory = [Text.Encoding]::UTF8.GetString($inventoryBytes) | ConvertFrom-Json }
  catch { throw 'Authenticated schema inventory payload is not valid JSON.' }
  try { $data = [Text.Encoding]::UTF8.GetString($dataBytes) | ConvertFrom-Json }
  catch { throw 'Authenticated logical data payload is not valid JSON.' }
  Assert-InventoryDependencies -Inventory $inventory
  if ([string]$inventory.captured_at -ne [string]$manifest.inventory_captured_at) {
    throw 'Authenticated inventory captured_at does not match the manifest.'
  }
  if ([string]$inventory.current_user -ne [string]$manifest.source_current_user -or
      [string]$inventory.session_user -ne [string]$manifest.source_session_user -or
      -not [bool]$inventory.current_role_bypasses_rls -or
      [string]$inventory.row_security -ne 'off') {
    throw 'Authenticated inventory execution role does not match the manifest.'
  }
  if ($inventory.PSObject.Properties['source_project_ref']) {
    $inventoryRef = [string]$inventory.source_project_ref
    if (-not [string]::IsNullOrWhiteSpace($inventoryRef) -and $inventoryRef -ne $ExpectedProjectRef) {
      throw 'Authenticated inventory project ref conflicts with the source fence.'
    }
  }
  $contractHash = Get-InventoryContractSha256 -Inventory $inventory
  if ($contractHash -ne [string]$manifest.inventory_contract_sha256) {
    throw 'Authenticated schema inventory contract digest mismatch.'
  }
  $inventoryRelationContract = Get-HBAM2RelationContractSha256 `
    -Relations $inventory.tables `
    -ExpectedNames $ExpectedTables `
    -Label 'Authenticated inventory'
  if ($inventoryRelationContract -ne [string]$manifest.source_relation_contract_sha256) {
    throw 'Authenticated inventory relation identity contract mismatch.'
  }
  if (-not $data.PSObject.Properties['captured_at'] -or
      -not $data.PSObject.Properties['current_user'] -or
      -not $data.PSObject.Properties['session_user'] -or
      -not $data.PSObject.Properties['current_role_bypasses_rls'] -or
      -not $data.PSObject.Properties['row_security'] -or
      -not $data.PSObject.Properties['relations'] -or
      -not $data.PSObject.Properties['tables'] -or
      [string]$data.captured_at -ne [string]$manifest.source_captured_at) {
    throw 'Authenticated logical data timestamp, role, or table metadata is invalid.'
  }
  if ([string]$data.current_user -ne [string]$manifest.source_current_user -or
      [string]$data.session_user -ne [string]$manifest.source_session_user -or
      -not [bool]$data.current_role_bypasses_rls -or
      [string]$data.row_security -ne 'off') {
    throw 'Authenticated logical data execution role does not match the manifest.'
  }
  $dataRelationContract = Get-HBAM2RelationContractSha256 `
    -Relations $data.relations `
    -ExpectedNames $ExpectedTables `
    -Label 'Authenticated logical backup'
  if ($dataRelationContract -ne $inventoryRelationContract) {
    throw 'Authenticated logical data relation identity does not match the inventory.'
  }
  $dataNames = @($data.tables.PSObject.Properties.Name | Sort-Object)
  $manifestNames = @($manifest.tables.PSObject.Properties.Name | Sort-Object)
  Assert-ExactTableAllowlist -Actual $dataNames -Label 'Logical backup'
  Assert-ExactTableAllowlist -Actual $manifestNames -Label 'Manifest'
  $verifiedCounts = [ordered]@{}
  foreach ($property in @($data.tables.PSObject.Properties | Sort-Object Name)) {
    $manifestProperty = $manifest.tables.PSObject.Properties[$property.Name]
    if (-not $manifestProperty -or
        -not $property.Value.PSObject.Properties['canonical_sha256'] -or
        [string]$property.Value.canonical_sha256 -notmatch '^[A-Fa-f0-9]{64}$') {
      throw "Logical backup metadata is incomplete for $($property.Name)."
    }
    $actual = @($property.Value.rows).Count
    $reported = [int64]$property.Value.row_count
    $manifestCount = [int64]$manifestProperty.Value
    if ($actual -ne $reported -or $actual -ne $manifestCount) {
      throw "Row count verification failed for $($property.Name)."
    }
    $verifiedCounts[$property.Name] = $actual
  }

  $roundTrip = Invoke-PGliteJsonbRoundTrip -InventoryBytes $inventoryBytes `
    -DataBytes $dataBytes -RuntimeFence $runtimeFence
  $totalRows = [int64](($verifiedCounts.Values | Measure-Object -Sum).Sum)
  if ([int64]$roundTrip.TotalRows -ne $totalRows -or
      [int]$roundTrip.TableCount -ne $verifiedCounts.Count) {
    throw 'PGlite authenticated JSONB round-trip counts do not match the encrypted backup.'
  }
  Assert-HBAM2ImplementationFence `
    -Fence $implementationFence `
    -RepoRoot $repoRoot `
    -SelfTest ([bool]$SelfTest)
  if ($cliFence) { Assert-HBAM2SupabaseCliFence -Fence $cliFence }
  Assert-HBAM2VerifierRuntimeFence -Fence $runtimeFence
  $recordedCliFiles = $manifest.supabase_cli.files
  $recordedCliBinaryPath = [string]$manifest.supabase_cli.invocation_relative_path
  [pscustomobject]@{
    Verified = $true
    BackupDirectory = $directory
    BackupSetId = $ExpectedBackupSetId
    ManifestSha256 = $actualManifestSha256
    InventoryContractSha256 = $contractHash
    SourceRelationContractSha256 = $inventoryRelationContract
    GitCommit = [string]$manifest.implementation.git_commit
    SupabaseCliVersion = [string]$manifest.supabase_cli.version
    SupabaseCliBinarySha256 = [string](Get-HBAM2ObjectPropertyValue -Value $recordedCliFiles -Name $recordedCliBinaryPath)
    NodeVersion = [string]$runtimeFence.Provenance.node_version
    NodeSha256 = [string]$runtimeFence.Provenance.node_sha256
    PGliteVersion = [string]$runtimeFence.Provenance.pglite_version
    PGliteTreeSha256 = [string]$runtimeFence.Provenance.pglite_tree_sha256
    CreatedAtUtc = [string]$manifest.created_at_utc
    SourceCapturedAt = [string]$manifest.source_captured_at
    InventoryCapturedAt = [string]$manifest.inventory_captured_at
    AgeSeconds = [math]::Round($now.Subtract($createdAt).TotalSeconds, 3)
    TableCount = $verifiedCounts.Count
    TotalRows = $totalRows
    SourceCanonicalDigestsVerified = [bool]$roundTrip.SourceCanonicalDigestsVerified
    PGliteJsonbRoundTripVerified = [bool]$roundTrip.JsonbRoundTripVerified
    PrimaryConstraintsChecked = [int]$roundTrip.PrimaryConstraintsChecked
    ForeignKeysChecked = [int]$roundTrip.ForeignKeysChecked
    ExternalForeignKeysSkipped = [int]$roundTrip.ExternalForeignKeysSkipped
    PlaintextWrittenToDisk = $false
  } | ConvertTo-Json -Compress
} finally {
  Close-HBAM2VerifierRuntimeFence -Fence $runtimeFence
  Close-HBAM2SupabaseCliFence -Fence $cliFence
  Close-HBAM2ImplementationFence -Fence $implementationFence
  if ($inventoryBytes) { [Array]::Clear($inventoryBytes, 0, $inventoryBytes.Length) }
  if ($dataBytes) { [Array]::Clear($dataBytes, 0, $dataBytes.Length) }
}
