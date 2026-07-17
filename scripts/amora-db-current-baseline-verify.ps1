param(
  [string] $BackupDirectory,

  [string] $ExpectedProjectRef,

  [string] $ExpectedBackupSetId,

  [string] $ExpectedManifestSha256,

  [ValidateRange(1, 5256000)]
  [int] $MaximumAgeMinutes = 30,

  [string] $NodeCli = 'node.exe',

  [switch] $SelfTest,

  [string] $SelfTestBackupRoot,

  [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'amora-db-current-baseline-common.ps1')

function Show-Help {
  Write-Host ''
  Write-Host 'WeddingHanbang current production baseline verifier'
  Write-Host ''
  Write-Host 'Authenticates and decrypts the three HBAM2 artifacts only in memory, verifies the'
  Write-Host 'externally supplied manifest anchors and source fences, then restores all rows into'
  Write-Host 'a disposable in-memory PGlite target and checks canonical digests and key relations.'
  Write-Host ''
  Write-Host 'Usage:'
  Write-Host '  powershell -File scripts/amora-db-current-baseline-verify.ps1 `'
  Write-Host '    -BackupDirectory <dir> -ExpectedProjectRef <ref> `'
  Write-Host '    -ExpectedBackupSetId <uuid> -ExpectedManifestSha256 <sha256>'
  Write-Host ''
  Write-Host '-Help performs no filesystem or database operation.'
  Write-Host ''
}

if ($Help) { Show-Help; exit 0 }
if ([string]::IsNullOrWhiteSpace($BackupDirectory)) { throw '-BackupDirectory is required.' }
if ([string]::IsNullOrWhiteSpace($ExpectedProjectRef) -or
    $ExpectedProjectRef -notmatch '^[a-z0-9]{20}$') {
  throw '-ExpectedProjectRef must be an explicit 20-character project ref.'
}
try { $canonicalSetId = ([Guid]::ParseExact($ExpectedBackupSetId, 'D')).ToString('D') }
catch { throw '-ExpectedBackupSetId must be a canonical UUID.' }
if ($canonicalSetId -cne $ExpectedBackupSetId) {
  throw '-ExpectedBackupSetId must use canonical lowercase UUID form.'
}
if ($ExpectedManifestSha256 -notmatch '^[A-F0-9]{64}$') {
  throw '-ExpectedManifestSha256 must be an uppercase SHA-256 digest.'
}
if ($env:OS -ne 'Windows_NT') { throw 'HBAM2 baseline verification requires Windows DPAPI.' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$rootInfo = Resolve-HBAM2BackupRoot `
  -SelfTest ([bool]$SelfTest) `
  -SelfTestBackupRoot $SelfTestBackupRoot
Assert-HBAM2BackupRoot -Root $rootInfo.Root -Anchor $rootInfo.Anchor
$directory = (Resolve-Path -LiteralPath $BackupDirectory).Path
$rootFull = [IO.Path]::GetFullPath($rootInfo.Root).TrimEnd('\')
if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($directory)).TrimEnd('\') -cne $rootFull -or
    [IO.Path]::GetFileName($directory) -notmatch '^\d{8}-\d{6}$') {
  throw 'Baseline directory failed fixed-root containment validation.'
}
Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $directory -Anchor $rootInfo.Anchor
Assert-HBAM2PrivateDirectoryAcl -Path $directory
$entries = @(Get-ChildItem -LiteralPath $directory -Force)
$files = @($entries | Where-Object { -not $_.PSIsContainer } | ForEach-Object Name | Sort-Object)
if ($entries.Count -ne $script:HBAM2BaselineExpectedFiles.Count -or
    @(Compare-Object -ReferenceObject $script:HBAM2BaselineExpectedFiles -DifferenceObject $files -CaseSensitive).Count -ne 0) {
  throw 'Baseline directory contains an unexpected artifact set.'
}
foreach ($file in $script:HBAM2BaselineExpectedFiles) {
  $path = Join-Path $directory $file
  $item = Get-Item -LiteralPath $path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Baseline artifacts must not be reparse points.'
  }
  Assert-HBAM2PrivateFileAcl -Path $path
}

$manifestBytes = Read-HBAM2BoundedFileBytes `
  -Path (Join-Path $directory 'manifest.json') `
  -MaximumBytes $script:HBAM2MaximumManifestBytes
try {
  $actualManifestHash = Get-HBAM2Sha256Hex -Bytes $manifestBytes
  if ($actualManifestHash -cne $ExpectedManifestSha256) {
    throw 'Baseline manifest SHA-256 does not match the external anchor.'
  }
  try { $manifest = [Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json }
  catch { throw 'Baseline manifest is not valid JSON.' }
} finally { [Array]::Clear($manifestBytes, 0, $manifestBytes.Length) }

foreach ($field in @(
  'status', 'format', 'format_version', 'baseline_contract_version', 'backup_set_id',
  'backup_type', 'created_at_utc', 'preflight_captured_at', 'schema_before_captured_at',
  'source_captured_at', 'schema_after_captured_at', 'schema_contract_sha256',
  'source_migration_head',
  'source_relation_contract_sha256', 'source_project_ref', 'source_project_ref_sha256',
  'source_database', 'source_current_user', 'source_session_user',
  'source_role_bypasses_rls', 'source_row_security', 'source_transaction_read_only',
  'source_fence', 'consistency', 'plaintext_written_to_disk', 'restore_contract',
  'excluded_ephemeral_tables', 'ephemeral_rebuild_contract',
  'implementation', 'supabase_cli', 'verifier_runtime', 'preflight', 'tables', 'artifacts'
)) {
  if (-not $manifest.PSObject.Properties[$field]) { throw "Baseline manifest is missing $field." }
}
foreach ($artifact in @('schema_inventory', 'logical_data')) {
  if (-not $manifest.artifacts.PSObject.Properties[$artifact]) {
    throw "Baseline manifest is missing $artifact artifact metadata."
  }
}
if ([string]$manifest.status -cne 'complete' -or
    [string]$manifest.format -cne $script:HBAM2FormatName -or
    [int]$manifest.format_version -ne 2 -or
    [int]$manifest.baseline_contract_version -ne 1 -or
    [string]$manifest.backup_type -cne 'pre-amora-current-remote-14-table-baseline' -or
    [string]$manifest.backup_set_id -cne $ExpectedBackupSetId -or
    [string]$manifest.source_project_ref -cne $ExpectedProjectRef -or
    [string]$manifest.source_fence -cne 'supabase-linked-project-ref-plus-explicit-workdir-plus-pinned-cli' -or
    [string]$manifest.consistency -cne 'read-only-data-single-statement-schema-before-after-fenced' -or
    [string]$manifest.restore_contract -cne 'isolated-column-wise-jsonb-pglite-restoration-rehearsal' -or
    [string]$manifest.schema_contract_sha256 -notmatch '^[A-F0-9]{64}$' -or
    [string]$manifest.schema_contract_sha256 -cne $script:HBAM2BaselineExpectedSchemaContractSha256 -or
    [string]$manifest.source_migration_head -cne $script:HBAM2BaselineExpectedMigrationHead -or
    @($manifest.excluded_ephemeral_tables).Count -ne
      $script:HBAM2BaselineExcludedEphemeralTables.Count -or
    @(Compare-Object `
      -ReferenceObject $script:HBAM2BaselineExcludedEphemeralTables `
      -DifferenceObject @($manifest.excluded_ephemeral_tables) `
      -CaseSensitive).Count -ne 0 -or
    [string]$manifest.ephemeral_rebuild_contract -cne
      $script:HBAM2BaselineEphemeralRebuildContract -or
    [string]$manifest.source_relation_contract_sha256 -notmatch '^[A-F0-9]{64}$' -or
    [string]::IsNullOrWhiteSpace([string]$manifest.source_database) -or
    [string]::IsNullOrWhiteSpace([string]$manifest.source_current_user) -or
    [string]::IsNullOrWhiteSpace([string]$manifest.source_session_user) -or
    -not [bool]$manifest.source_role_bypasses_rls -or
    [string]$manifest.source_row_security -cne 'off' -or
    [string]$manifest.source_transaction_read_only -cne 'on' -or
    [bool]$manifest.plaintext_written_to_disk) {
  throw 'Baseline manifest violates its fixed capture contract.'
}
$refBytes = [Text.Encoding]::UTF8.GetBytes($ExpectedProjectRef)
try {
  if ((Get-HBAM2Sha256Hex -Bytes $refBytes) -cne [string]$manifest.source_project_ref_sha256) {
    throw 'Baseline source project ref digest mismatch.'
  }
} finally { [Array]::Clear($refBytes, 0, $refBytes.Length) }

$preflightAt = ConvertTo-HBAM2BaselineTimestamp `
  -Value ([string]$manifest.preflight_captured_at) -Label 'preflight_captured_at'
$beforeAt = ConvertTo-HBAM2BaselineTimestamp `
  -Value ([string]$manifest.schema_before_captured_at) -Label 'schema_before_captured_at'
$dataAt = ConvertTo-HBAM2BaselineTimestamp `
  -Value ([string]$manifest.source_captured_at) -Label 'source_captured_at'
$afterAt = ConvertTo-HBAM2BaselineTimestamp `
  -Value ([string]$manifest.schema_after_captured_at) -Label 'schema_after_captured_at'
$createdAt = ConvertTo-HBAM2BaselineTimestamp `
  -Value ([string]$manifest.created_at_utc) -Label 'created_at_utc'
$now = [DateTimeOffset]::UtcNow
if ($preflightAt -gt $beforeAt -or $beforeAt -gt $dataAt -or
    $dataAt -gt $afterAt -or $afterAt -gt $createdAt -or
    $createdAt -gt $now.AddMinutes(5) -or
    $now.Subtract($createdAt).TotalMinutes -gt $MaximumAgeMinutes) {
  throw 'Baseline manifest is stale, future-dated, or violates capture order.'
}

$schemaBytes = $null
$beforeBytes = $null
$dataBytes = $null
$afterBytes = $null
$implementationFence = $null
$cliFence = $null
$runtimeFence = $null
try {
  $implementationFence = New-HBAM2ImplementationFence `
    -RepoRoot $repoRoot `
    -SelfTest ([bool]$SelfTest)
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
  $runtimeContract = Get-HBAM2VerifierRuntimeContract -RepoRoot $repoRoot
  Assert-HBAM2VerifierRuntimeContract `
    -Recorded $manifest.verifier_runtime `
    -Expected $runtimeContract
  $runtimeFence = New-HBAM2VerifierRuntimeFence `
    -RepoRoot $repoRoot `
    -RequestedNode $NodeCli `
    -SelfTest ([bool]$SelfTest) `
    -Contract $runtimeContract

  $schemaBytes = Unprotect-HBAM2Artifact `
    -Directory $directory `
    -Metadata $manifest.artifacts.schema_inventory `
    -ArtifactName 'schema-inventory.json' `
    -ProjectRef $ExpectedProjectRef `
    -BackupSetId $ExpectedBackupSetId
  $dataBytes = Unprotect-HBAM2Artifact `
    -Directory $directory `
    -Metadata $manifest.artifacts.logical_data `
    -ArtifactName 'logical-data.json' `
    -ProjectRef $ExpectedProjectRef `
    -BackupSetId $ExpectedBackupSetId
  foreach ($payload in @($schemaBytes, $dataBytes)) {
    if ($payload.Length -lt 1 -or $payload.Length -gt $script:HBAM2BaselineMaximumPayloadBytes) {
      throw 'Authenticated baseline payload is outside its fixed size bound.'
    }
  }

  $schemaBundle = ConvertFrom-HBAM2BaselineJson `
    -Json ([Text.Encoding]::UTF8.GetString($schemaBytes)) `
    -Label 'Authenticated schema inventory bundle'
  if (-not $schemaBundle.PSObject.Properties['before'] -or
      -not $schemaBundle.PSObject.Properties['after'] -or
      @($schemaBundle.PSObject.Properties).Count -ne 2) {
    throw 'Authenticated schema inventory bundle has an invalid shape.'
  }
  $beforeJson = $schemaBundle.before | ConvertTo-Json -Depth 100 -Compress
  $afterJson = $schemaBundle.after | ConvertTo-Json -Depth 100 -Compress
  $beforeBytes = [Text.Encoding]::UTF8.GetBytes($beforeJson)
  $afterBytes = [Text.Encoding]::UTF8.GetBytes($afterJson)
  $before = ConvertFrom-HBAM2BaselineJson `
    -Json $beforeJson `
    -Label 'Authenticated schema-before inventory'
  $data = ConvertFrom-HBAM2BaselineJson `
    -Json ([Text.Encoding]::UTF8.GetString($dataBytes)) `
    -Label 'Authenticated logical data'
  $after = ConvertFrom-HBAM2BaselineJson `
    -Json $afterJson `
    -Label 'Authenticated schema-after inventory'
  Assert-HBAM2BaselineInventory `
    -Inventory $before `
    -ExpectedProjectRef $ExpectedProjectRef `
    -Label 'Authenticated schema-before inventory'
  Assert-HBAM2BaselineInventory `
    -Inventory $after `
    -ExpectedProjectRef $ExpectedProjectRef `
    -Label 'Authenticated schema-after inventory'
  $verifiedCounts = Assert-HBAM2BaselineLogicalData `
    -Data $data `
    -ExpectedProjectRef $ExpectedProjectRef

  if ([string]$before.captured_at -cne [string]$manifest.schema_before_captured_at -or
      [string]$data.captured_at -cne [string]$manifest.source_captured_at -or
      [string]$after.captured_at -cne [string]$manifest.schema_after_captured_at -or
      ([string]$before.schema_contract_sha256).ToUpperInvariant() -cne [string]$manifest.schema_contract_sha256 -or
      ([string]$after.schema_contract_sha256).ToUpperInvariant() -cne [string]$manifest.schema_contract_sha256 -or
      (Get-HBAM2BaselineSchemaContractJson -Inventory $before) -cne
        (Get-HBAM2BaselineSchemaContractJson -Inventory $after) -or
      [string]$data.database_name -cne [string]$manifest.source_database -or
      [string]$data.current_user -cne [string]$manifest.source_current_user -or
      [string]$data.session_user -cne [string]$manifest.source_session_user) {
    throw 'Authenticated baseline payloads do not match the manifest or each other.'
  }
  $relationContract = Get-HBAM2RelationContractSha256 `
    -Relations $data.relations `
    -ExpectedNames $script:HBAM2BaselineExpectedTables `
    -Label 'Authenticated logical data'
  if ($relationContract -cne [string]$manifest.source_relation_contract_sha256) {
    throw 'Authenticated baseline relation contract does not match the manifest.'
  }
  $manifestNames = @($manifest.tables.PSObject.Properties.Name)
  Assert-HBAM2BaselineExactNames -Actual $manifestNames -Label 'Baseline manifest'
  foreach ($name in $script:HBAM2BaselineExpectedTables) {
    $manifestCount = [int64]$manifest.tables.PSObject.Properties[$name].Value
    if ($manifestCount -ne [int64]$verifiedCounts[$name]) {
      throw "Baseline manifest row count mismatch for $name."
    }
  }

  $restoreReceipt = Invoke-HBAM2BaselinePGliteRestore `
    -BeforeBytes $beforeBytes `
    -DataBytes $dataBytes `
    -AfterBytes $afterBytes `
    -RuntimeFence $runtimeFence
  $totalRows = [int64](($verifiedCounts.Values | Measure-Object -Sum).Sum)
  if ([int64]$restoreReceipt.TotalRows -ne $totalRows) {
    throw 'Baseline PGlite restored row count does not match the encrypted snapshot.'
  }

  Assert-HBAM2ImplementationFence `
    -Fence $implementationFence `
    -RepoRoot $repoRoot `
    -SelfTest ([bool]$SelfTest)
  if ($cliFence) { Assert-HBAM2SupabaseCliFence -Fence $cliFence }
  Assert-HBAM2VerifierRuntimeFence -Fence $runtimeFence

  [pscustomobject]@{
    Verified = $true
    BackupDirectory = $directory
    BackupSetId = $ExpectedBackupSetId
    ManifestSha256 = $actualManifestHash
    SchemaContractSha256 = [string]$manifest.schema_contract_sha256
    SourceRelationContractSha256 = $relationContract
    GitCommit = [string]$manifest.implementation.git_commit
    CreatedAtUtc = [string]$manifest.created_at_utc
    SourceCapturedAt = [string]$manifest.source_captured_at
    AgeSeconds = [math]::Round($now.Subtract($createdAt).TotalSeconds, 3)
    TableCount = $verifiedCounts.Count
    TotalRows = $totalRows
    ExcludedEphemeralTableCount = $script:HBAM2BaselineExcludedEphemeralTables.Count
    EphemeralRebuildContract = $script:HBAM2BaselineEphemeralRebuildContract
    LogicalRowReplayVerified = [bool]$restoreReceipt.LogicalRowReplayVerified
    RestoredColumnCount = [int]$restoreReceipt.RestoredColumnCount
    UniqueConstraintsReplayed = [int]$restoreReceipt.UniqueConstraintsReplayed
    ForeignKeysReplayed = [int]$restoreReceipt.ForeignKeysReplayed
    ExternalForeignKeysSkipped = [int]$restoreReceipt.ExternalForeignKeysSkipped
    CheckConstraintsDocumented = [int]$restoreReceipt.CheckConstraintsDocumented
    CheckConstraintsReplayed = [int]$restoreReceipt.CheckConstraintsReplayed
    TypedSchemaReplayed = [bool]$restoreReceipt.TypedSchemaReplayed
    PlaintextWrittenToDisk = $false
  } | ConvertTo-Json -Compress
} finally {
  Close-HBAM2VerifierRuntimeFence -Fence $runtimeFence
  Close-HBAM2SupabaseCliFence -Fence $cliFence
  Close-HBAM2ImplementationFence -Fence $implementationFence
  if ($schemaBytes) { [Array]::Clear($schemaBytes, 0, $schemaBytes.Length) }
  if ($beforeBytes) { [Array]::Clear($beforeBytes, 0, $beforeBytes.Length) }
  if ($dataBytes) { [Array]::Clear($dataBytes, 0, $dataBytes.Length) }
  if ($afterBytes) { [Array]::Clear($afterBytes, 0, $afterBytes.Length) }
}
