param(
  [string] $BackupDirectory,
  [string] $ExpectedProjectRef = 'slrtobkksjmxgzatjyqb',
  [string] $ExpectedBackupSetId,
  [string] $ExpectedManifestSha256,
  [string] $ExpectedCommit,
  [string] $ExpectedGitOrigin,
  [string] $RemoteRef,
  [string] $Release,
  [string] $BackupContractId,
  [int] $BackupContractVersion = 2,
  [string] $ExpectedSupabaseCliVersion,
  [string] $ExpectedSupabaseCliBinarySha256,
  [string] $ReceiptPath,
  [ValidateRange(1, 60)] [int] $MaximumAgeMinutes = 30,
  [string] $NodeCli = 'node.exe',
  [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'vendor-disclosure-db-backup-common.ps1')

$ExpectedFiles = @(
  'logical-data.json.hbam2',
  'logical-data.json.key.dpapi',
  'manifest.json',
  'schema-inventory.json.hbam2',
  'schema-inventory.json.key.dpapi'
)

function Show-Help {
  Write-Host 'Vendor-disclosure successor post-expand backup verifier'
  Write-Host ''
  Write-Host 'Authenticates and decrypts the exact encrypted 139-table backup only in memory,'
  Write-Host 'recomputes Public/Auth/Storage contracts, and runs a PGlite JSONB round trip.'
  Write-Host 'Writes an exact post-expand backup verification receipt outside the repository.'
  Write-Host '-Help performs no I/O.'
}

function Get-VDPostExpandVerifiedTimestamp {
  param([Parameter(Mandatory = $true)] [string] $Value, [Parameter(Mandatory = $true)] [string] $Label)
  try { return [DateTimeOffset]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind) }
  catch { throw "$Label is not a valid timestamp." }
}

function ConvertTo-VDPostExpandCanonicalInstant {
  param([Parameter(Mandatory = $true)] [DateTimeOffset] $Value)
  return $Value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
}

function Invoke-VDPostExpandPGliteRoundTrip {
  param(
    [Parameter(Mandatory = $true)] [byte[]] $InventoryBytes,
    [Parameter(Mandatory = $true)] [byte[]] $DataBytes,
    [Parameter(Mandatory = $true)] $RuntimeFence,
    [Parameter(Mandatory = $true)] [string] $RepoRoot
  )
  $scriptPath = Join-Path $RepoRoot 'apps\web\scripts\vendor-disclosure-db-backup-roundtrip.mjs'
  if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw 'Post-expand PGlite verifier script is missing.' }
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $RuntimeFence.NodePath; $startInfo.Arguments = '"' + $scriptPath + '"'
  $startInfo.WorkingDirectory = Join-Path $RepoRoot 'apps\web'; $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true; $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true; $startInfo.RedirectStandardError = $true
  foreach ($name in @('NODE_OPTIONS', 'NODE_PATH', 'NODE_COMPILE_CACHE', 'NODE_V8_COVERAGE',
    'NODE_REDIRECT_WARNINGS', 'NODE_CHANNEL_FD')) { [void]$startInfo.EnvironmentVariables.Remove($name) }
  $startInfo.EnvironmentVariables['HBAM_PGLITE_ENTRY'] = $RuntimeFence.PGliteEntryPath
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start post-expand PGlite verifier.' }
  try {
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync(); $stderrTask = $process.StandardError.ReadToEndAsync()
    foreach ($bytes in @($InventoryBytes, $DataBytes)) {
      $remaining = 120000 - [int]$deadline.ElapsedMilliseconds
      if ($remaining -le 0) { throw 'PGlite input exceeded the total deadline.' }
      $line = [Convert]::ToBase64String($bytes); $writeTask = $process.StandardInput.WriteLineAsync($line)
      if (-not $writeTask.Wait($remaining)) { throw 'PGlite input exceeded the total deadline.' }
      [void]$writeTask.GetAwaiter().GetResult(); $line = $null
    }
    $process.StandardInput.Close(); $remaining = 120000 - [int]$deadline.ElapsedMilliseconds
    if ($remaining -le 0 -or -not $process.WaitForExit($remaining)) {
      & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null
      throw 'PGlite post-expand verification exceeded 120 seconds.'
    }
    $process.WaitForExit(); $stdout = $stdoutTask.Result.Trim(); $null = $stderrTask.Result
    if ($process.ExitCode -ne 0) { throw "PGlite verification failed with exit code $($process.ExitCode)." }
    try { $receipt = $stdout | ConvertFrom-Json } catch { throw 'PGlite verifier returned invalid JSON.' }
    foreach ($field in @('JsonbRoundTripVerified', 'AuthenticatedJsonbStaged', 'Engine', 'TableCount',
      'TotalRows', 'SourceCanonicalDigestsVerified', 'AuthDataDigestsVerified',
      'StorageDataDigestsVerified', 'LogicalDataParsedInV8', 'PlaintextWrittenToDisk')) {
      if (-not $receipt.PSObject.Properties[$field]) { throw "PGlite receipt is missing $field." }
    }
    if (-not [bool]$receipt.JsonbRoundTripVerified -or -not [bool]$receipt.AuthenticatedJsonbStaged -or
        -not [bool]$receipt.SourceCanonicalDigestsVerified -or -not [bool]$receipt.AuthDataDigestsVerified -or
        -not [bool]$receipt.StorageDataDigestsVerified -or [string]$receipt.Engine -ne 'PGlite' -or
        [int]$receipt.TableCount -ne 139 -or [bool]$receipt.LogicalDataParsedInV8 -or
        [bool]$receipt.PlaintextWrittenToDisk) {
      throw 'PGlite receipt failed its exact post-expand safety contract.'
    }
    return $receipt
  } finally {
    if (-not $process.HasExited) { & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null }
    $process.Dispose()
  }
}

function Assert-VDPostExpandRecordedImplementation {
  param([Parameter(Mandatory = $true)] $Recorded, [Parameter(Mandatory = $true)] $Fence)
  foreach ($field in @('git_commit', 'files', 'git_blobs')) {
    if (-not $Recorded.PSObject.Properties[$field]) { throw "Recorded implementation is missing $field." }
  }
  $expected = @($script:VDPostExpandImplementationPaths | Sort-Object)
  $files = @(Get-HBAM2ObjectPropertyNames -Value $Recorded.files | Sort-Object)
  $blobs = @(Get-HBAM2ObjectPropertyNames -Value $Recorded.git_blobs | Sort-Object)
  if ([string]$Recorded.git_commit -ne $ExpectedCommit -or @(Compare-Object $expected $files).Count -ne 0 -or
      @(Compare-Object $expected $blobs).Count -ne 0) { throw 'Recorded implementation provenance is not exact.' }
  Assert-VDPostExpandImplementationFence -Fence $Fence -Recorded $Recorded
}

function Assert-VDPostExpandLogicalPart {
  param([Parameter(Mandatory = $true)] $Value, [Parameter(Mandatory = $true)] [string] $Label)
  foreach ($field in @('row_count', 'rows', 'canonical_sha256')) {
    if (-not $Value.PSObject.Properties[$field]) { throw "$Label is missing $field." }
  }
  if ([int64]$Value.row_count -ne @($Value.rows).Count -or
      [string]$Value.canonical_sha256 -notmatch '^[a-f0-9]{64}$') { throw "$Label metadata is invalid." }
}

if ($Help) { Show-Help; exit 0 }
if ($env:OS -ne 'Windows_NT') { throw 'HBAM2 post-expand verification requires Windows DPAPI.' }
if ([string]::IsNullOrWhiteSpace($BackupDirectory) -or $ExpectedProjectRef -ne $script:VDPostExpandProjectRef -or
    $ExpectedCommit -notmatch '^[a-f0-9]{40}$' -or [string]::IsNullOrWhiteSpace($ExpectedGitOrigin) -or
    $Release -notmatch '^[a-z][a-z0-9-]{2,80}$' -or $BackupContractId -ne "post-$Release-backup" -or
    $BackupContractVersion -ne 2 -or $ExpectedManifestSha256 -notmatch '^[a-f0-9]{64}$' -or
    $ExpectedSupabaseCliVersion -notmatch '^\d+\.\d+\.\d+$' -or
    $ExpectedSupabaseCliBinarySha256 -notmatch '^[A-F0-9]{64}$') {
  throw 'Post-expand verifier anchors are missing or invalid.'
}
try { $canonicalSetId = ([Guid]::ParseExact($ExpectedBackupSetId, 'D')).ToString('D') }
catch { throw '-ExpectedBackupSetId must be a canonical UUID.' }
if ($canonicalSetId -ne $ExpectedBackupSetId) { throw '-ExpectedBackupSetId must be a lowercase canonical UUID.' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Assert-VDPostExpandExactPushedGitState -RepoRoot $repoRoot -ExpectedCommit $ExpectedCommit `
  -ExpectedOrigin $ExpectedGitOrigin -RemoteRef $RemoteRef
$rootInfo = Resolve-HBAM2BackupRoot -SelfTest $false
Assert-HBAM2BackupRoot -Root $rootInfo.Root -Anchor $rootInfo.Anchor
$directory = (Resolve-Path -LiteralPath $BackupDirectory).Path
if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($directory)).TrimEnd('\') -ne
      [IO.Path]::GetFullPath($rootInfo.Root).TrimEnd('\') -or
    [IO.Path]::GetFileName($directory) -notmatch '^post-expand-\d{8}-\d{6}-[a-f0-9]{32}$') {
  throw 'Backup directory is outside the fixed private external root.'
}
Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $directory -Anchor $rootInfo.Anchor
Assert-HBAM2PrivateDirectoryAcl -Path $directory
$entries = @(Get-ChildItem -LiteralPath $directory -Force)
$files = @($entries | Where-Object { -not $_.PSIsContainer } | ForEach-Object Name | Sort-Object)
if ($entries.Count -ne $ExpectedFiles.Count -or @(Compare-Object $ExpectedFiles $files).Count -ne 0) {
  throw 'Backup directory does not contain the exact encrypted artifact set.'
}
foreach ($file in $ExpectedFiles) {
  $path = Join-Path $directory $file
  if (((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Backup artifact is a reparse point.'
  }
  Assert-HBAM2PrivateFileAcl -Path $path
}

if (-not [IO.Path]::IsPathRooted($ReceiptPath)) { throw '-ReceiptPath must be an absolute external path.' }
$fullReceiptPath = [IO.Path]::GetFullPath($ReceiptPath)
$expectedReceiptName = "$ExpectedBackupSetId-successor-post-expand-backup-verification-v2.json"
if ([IO.Path]::GetDirectoryName($fullReceiptPath).TrimEnd('\') -ne [IO.Path]::GetFullPath($rootInfo.Root).TrimEnd('\') -or
    [IO.Path]::GetFileName($fullReceiptPath) -ne $expectedReceiptName -or (Test-Path -LiteralPath $fullReceiptPath)) {
  throw 'Receipt must be a new exact-name file under the fixed external backup root.'
}

$manifestBytes = Read-HBAM2BoundedFileBytes -Path (Join-Path $directory 'manifest.json') `
  -MaximumBytes $script:HBAM2MaximumManifestBytes
try {
  $actualManifestSha = (Get-HBAM2Sha256Hex -Bytes $manifestBytes).ToLowerInvariant()
  if ($actualManifestSha -ne $ExpectedManifestSha256) { throw 'Manifest SHA-256 differs from the external anchor.' }
  try { $manifest = [Text.UTF8Encoding]::new($false, $true).GetString($manifestBytes) | ConvertFrom-Json }
  catch { throw 'Backup manifest is not valid UTF-8 JSON.' }
} finally { [Array]::Clear($manifestBytes, 0, $manifestBytes.Length) }

foreach ($field in @('status', 'format', 'format_version', 'backup_type', 'backup_set_id', 'release',
  'backup_contract_id', 'backup_contract_version', 'created_at_utc', 'source_captured_at',
  'source_project_ref', 'source_database_identity', 'source_database_identity_sha256',
  'source_migration_head', 'source_migration_count', 'source_migration_versions_sha256',
  'release_migration_count', 'release_migration_versions_sha256', 'applied_suffix_count',
  'applied_suffix_versions_sha256', 'expected_tables', 'table_count', 'table_contract_sha256',
  'source_relation_contract_sha256', 'live_schema_contract_sha256', 'logical_data_contract_sha256',
  'auth_schema_contract_sha256', 'auth_users_contract_sha256', 'storage_metadata_contract_sha256',
  'storage_object_inventory_sha256', 'git_commit', 'git_origin', 'git_remote_ref', 'implementation',
  'supabase_cli', 'verifier_runtime', 'verifier', 'source_fence', 'consistency',
  'plaintext_written_to_disk', 'contains_secrets', 'tables', 'auth_users_count',
  'storage_buckets_count', 'storage_objects_count', 'artifacts')) {
  if (-not $manifest.PSObject.Properties[$field]) { throw "Manifest is missing $field." }
}
if ([string]$manifest.status -ne 'complete' -or [string]$manifest.format -ne $script:HBAM2FormatName -or
    [int]$manifest.format_version -ne 2 -or
    [string]$manifest.backup_type -ne 'vendor-disclosure-successor-post-expand-logical-snapshot-v2' -or
    [string]$manifest.backup_set_id -ne $ExpectedBackupSetId -or [string]$manifest.release -ne $Release -or
    [string]$manifest.backup_contract_id -ne $BackupContractId -or [int]$manifest.backup_contract_version -ne 2 -or
    [string]$manifest.source_project_ref -ne $ExpectedProjectRef -or
    [string]$manifest.source_migration_head -ne $script:VDPostExpandMigrationHead -or
    [int]$manifest.source_migration_count -ne 232 -or
    [string]$manifest.source_migration_versions_sha256 -ne $script:VDPostExpandMigrationVersionsSha256 -or
    [int]$manifest.release_migration_count -ne 117 -or
    [string]$manifest.release_migration_versions_sha256 -ne $script:VDPostExpandReleaseMigrationVersionsSha256 -or
    [int]$manifest.applied_suffix_count -ne 85 -or
    [string]$manifest.applied_suffix_versions_sha256 -ne $script:VDPostExpandAppliedSuffixVersionsSha256 -or
    [int]$manifest.table_count -ne 139 -or [string]$manifest.table_contract_sha256 -ne $script:VDPostExpandTableContractSha256 -or
    [string]$manifest.git_commit -ne $ExpectedCommit -or [string]$manifest.git_origin -ne $ExpectedGitOrigin -or
    [string]$manifest.git_remote_ref -ne $RemoteRef -or
    [string]$manifest.source_fence -ne 'exact-linked-production-ref-plus-clean-pushed-commit-plus-pinned-cli' -or
    [string]$manifest.consistency -ne 'read-only-logical-data-single-statement-plus-schema-before-after' -or
    [bool]$manifest.plaintext_written_to_disk -or [bool]$manifest.contains_secrets) {
  throw 'Manifest differs from the exact post-expand safety contract.'
}
$manifestTables = @($manifest.expected_tables | ForEach-Object { [string]$_ })
Assert-VDPostExpandExactNames -Actual $manifestTables -Label 'Manifest expected tables'
if (@(Compare-Object $script:VDPostExpandExpectedTables $manifestTables -SyncWindow 0).Count -ne 0) {
  throw 'Manifest table order differs from the exact contract.'
}
foreach ($value in @($manifest.source_database_identity_sha256, $manifest.source_relation_contract_sha256,
  $manifest.live_schema_contract_sha256, $manifest.logical_data_contract_sha256,
  $manifest.auth_schema_contract_sha256, $manifest.auth_users_contract_sha256,
  $manifest.storage_metadata_contract_sha256, $manifest.storage_object_inventory_sha256)) {
  if ([string]$value -notmatch '^[a-f0-9]{64}$') { throw 'Manifest contains an invalid digest.' }
}
if ((Get-VDPostExpandCanonicalJsonSha256 -Value $manifest.source_database_identity) -ne
    [string]$manifest.source_database_identity_sha256) { throw 'Manifest database identity digest is invalid.' }
$sourceAt = Get-VDPostExpandVerifiedTimestamp -Value ([string]$manifest.source_captured_at) -Label 'source_captured_at'
$createdAt = Get-VDPostExpandVerifiedTimestamp -Value ([string]$manifest.created_at_utc) -Label 'created_at_utc'
$now = [DateTimeOffset]::UtcNow
if ($sourceAt -gt $createdAt -or $createdAt -gt $now.AddMinutes(1) -or
    $now.Subtract($sourceAt).TotalMinutes -gt $MaximumAgeMinutes -or
    $now.Subtract($createdAt).TotalMinutes -gt $MaximumAgeMinutes) { throw 'Backup is stale, future-dated, or out of order.' }

$verifierRelative = 'scripts/vendor-disclosure-db-verify-backup.ps1'
$verifierSha = Get-VDCurrentBaselineCanonicalTextFileSha256 -Path (Join-Path $repoRoot $verifierRelative.Replace('/', '\'))
if ([string]$manifest.verifier.file -ne $verifierRelative -or [string]$manifest.verifier.sha256 -ne $verifierSha) {
  throw 'Manifest verifier identity differs from this exact verifier.'
}

$implementationFence = $null; $cliFence = $null; $runtimeFence = $null
$inventoryBytes = $null; $dataBytes = $null
try {
  $implementationFence = New-VDPostExpandImplementationFence -RepoRoot $repoRoot -ExpectedCommit $ExpectedCommit
  Assert-VDPostExpandRecordedImplementation -Recorded $manifest.implementation -Fence $implementationFence
  $cliFence = New-HBAM2SupabaseCliFence -RepoRoot $repoRoot -RequestedCli 'supabase' -SelfTest $false
  Assert-HBAM2SupabaseCliProvenance -Recorded $manifest.supabase_cli -CurrentFence $cliFence -SelfTest $false
  $cliPath = [string]$cliFence.Provenance.invocation_relative_path
  $cliSha = [string](Get-HBAM2ObjectPropertyValue -Value $cliFence.Provenance.files -Name $cliPath)
  if ([string]$cliFence.Provenance.version -ne $ExpectedSupabaseCliVersion -or $cliSha -ne $ExpectedSupabaseCliBinarySha256) {
    throw 'Verifier Supabase CLI differs from the external release anchor.'
  }
  $runtimeContract = Get-HBAM2VerifierRuntimeContract -RepoRoot $repoRoot
  Assert-HBAM2VerifierRuntimeContract -Recorded $manifest.verifier_runtime -Expected $runtimeContract
  $runtimeFence = New-HBAM2VerifierRuntimeFence -RepoRoot $repoRoot -RequestedNode $NodeCli -SelfTest $false -Contract $runtimeContract

  $inventoryBytes = Unprotect-HBAM2Artifact -Directory $directory -Metadata $manifest.artifacts.schema_inventory `
    -ArtifactName 'schema-inventory.json' -ProjectRef $ExpectedProjectRef -BackupSetId $ExpectedBackupSetId
  $dataBytes = Unprotect-HBAM2Artifact -Directory $directory -Metadata $manifest.artifacts.logical_data `
    -ArtifactName 'logical-data.json' -ProjectRef $ExpectedProjectRef -BackupSetId $ExpectedBackupSetId
  try { $inventory = [Text.UTF8Encoding]::new($false, $true).GetString($inventoryBytes) | ConvertFrom-Json }
  catch { throw 'Authenticated inventory is not valid JSON.' }
  try { $data = [Text.UTF8Encoding]::new($false, $true).GetString($dataBytes) | ConvertFrom-Json }
  catch { throw 'Authenticated logical data is not valid JSON.' }
  Assert-VDPostExpandSourceContract -Value $inventory -Label 'Authenticated inventory'
  Assert-VDPostExpandSourceContract -Value $data -Label 'Authenticated logical data'
  foreach ($field in @('migration_versions', 'release_migration_versions', 'applied_suffix_versions',
    'columns', 'constraints', 'schema_contract', 'auth_schema_contract', 'storage_schema_contract')) {
    if (-not $inventory.PSObject.Properties[$field]) { throw "Authenticated inventory is missing $field." }
  }
  if (@($inventory.migration_versions).Count -ne 232 -or @($inventory.release_migration_versions).Count -ne 117 -or
      @($inventory.applied_suffix_versions).Count -ne 85) { throw 'Authenticated migration arrays are not exact.' }

  $identitySha = Get-VDPostExpandCanonicalJsonSha256 -Value $inventory.source_database_identity
  $inventoryRelationSha = (Get-HBAM2RelationContractSha256 -Relations $inventory.relations `
    -ExpectedNames $script:VDPostExpandExpectedTables -Label 'Authenticated inventory').ToLowerInvariant()
  $dataRelationSha = (Get-HBAM2RelationContractSha256 -Relations $data.relations `
    -ExpectedNames $script:VDPostExpandExpectedTables -Label 'Authenticated logical data').ToLowerInvariant()
  if ($identitySha -ne [string]$manifest.source_database_identity_sha256 -or
      $identitySha -ne (Get-VDPostExpandCanonicalJsonSha256 -Value $data.source_database_identity) -or
      $inventoryRelationSha -ne [string]$manifest.source_relation_contract_sha256 -or
      $dataRelationSha -ne $inventoryRelationSha -or [string]$data.captured_at -ne [string]$manifest.source_captured_at) {
    throw 'Authenticated source identity/relation contract is invalid.'
  }
  Assert-VDPostExpandExactNames -Actual @($data.tables.PSObject.Properties.Name) -Label 'Authenticated logical data'
  Assert-VDPostExpandExactNames -Actual @($manifest.tables.PSObject.Properties.Name) -Label 'Manifest table counts'
  $publicTotal = [int64]0
  foreach ($property in @($data.tables.PSObject.Properties | Sort-Object Name)) {
    Assert-VDPostExpandLogicalPart -Value $property.Value -Label $property.Name
    $manifestCount = $manifest.tables.PSObject.Properties[$property.Name]
    if (-not $manifestCount -or [int64]$manifestCount.Value -ne [int64]$property.Value.row_count) {
      throw "Authenticated logical count differs for $($property.Name)."
    }
    $publicTotal += [int64]$property.Value.row_count
  }
  foreach ($name in @('auth_users', 'storage_buckets', 'storage_objects')) {
    if (-not $data.PSObject.Properties[$name]) { throw "Authenticated logical data is missing $name." }
    Assert-VDPostExpandLogicalPart -Value $data.$name -Label $name
  }
  if ([int64]$data.auth_users.row_count -ne [int64]$manifest.auth_users_count -or
      [int64]$data.storage_buckets.row_count -ne [int64]$manifest.storage_buckets_count -or
      [int64]$data.storage_objects.row_count -ne [int64]$manifest.storage_objects_count) {
    throw 'Authenticated Auth/Storage counts differ from the manifest.'
  }
  $digests = Get-VDPostExpandDataContractDigests -Inventory $inventory -Logical $data
  $digestPairs = [ordered]@{
    LiveSchemaContractSha256 = 'live_schema_contract_sha256'
    LogicalDataContractSha256 = 'logical_data_contract_sha256'
    AuthSchemaContractSha256 = 'auth_schema_contract_sha256'
    AuthUsersContractSha256 = 'auth_users_contract_sha256'
    StorageMetadataContractSha256 = 'storage_metadata_contract_sha256'
    StorageObjectInventorySha256 = 'storage_object_inventory_sha256'
  }
  foreach ($entry in $digestPairs.GetEnumerator()) {
    if ([string]$digests[$entry.Key] -ne [string]$manifest.($entry.Value)) { throw "Authenticated digest differs: $($entry.Key)." }
  }

  $roundTrip = Invoke-VDPostExpandPGliteRoundTrip -InventoryBytes $inventoryBytes -DataBytes $dataBytes `
    -RuntimeFence $runtimeFence -RepoRoot $repoRoot
  $expectedTotal = $publicTotal + [int64]$data.auth_users.row_count +
    [int64]$data.storage_buckets.row_count + [int64]$data.storage_objects.row_count
  if ([int64]$roundTrip.TotalRows -ne $expectedTotal) { throw 'PGlite row total differs from the authenticated backup.' }

  Assert-VDPostExpandImplementationFence -Fence $implementationFence -Recorded $manifest.implementation
  Assert-HBAM2SupabaseCliFence -Fence $cliFence; Assert-HBAM2VerifierRuntimeFence -Fence $runtimeFence
  Assert-VDPostExpandExactPushedGitState -RepoRoot $repoRoot -ExpectedCommit $ExpectedCommit `
    -ExpectedOrigin $ExpectedGitOrigin -RemoteRef $RemoteRef

  $receipt = [ordered]@{
    receiptVersion = 2
    kind = 'successor-post-expand-backup-verification-v2'
    release = $Release
    projectRef = $ExpectedProjectRef
    releaseCommit = $ExpectedCommit
    backupContractId = $BackupContractId
    backupContractVersion = 2
    backupSetId = $ExpectedBackupSetId
    backupManifestSha256 = $actualManifestSha
    sourceDatabaseOid = [string]$data.source_database_identity.database_oid
    sourceDatabaseSystemIdentifier = [string]$data.source_database_identity.system_identifier
    expectedMigrationHead = $script:VDPostExpandMigrationHead
    migrationVersionsSha256 = $script:VDPostExpandReleaseMigrationVersionsSha256
    expectedTableCount = 139
    expectedTables = @($script:VDPostExpandExpectedTables)
    expectedTableContractSha256 = $script:VDPostExpandTableContractSha256
    liveSchemaContractSha256 = [string]$digests.LiveSchemaContractSha256
    logicalDataContractSha256 = [string]$digests.LogicalDataContractSha256
    authSchemaContractSha256 = [string]$digests.AuthSchemaContractSha256
    authUsersContractSha256 = [string]$digests.AuthUsersContractSha256
    storageMetadataContractSha256 = [string]$digests.StorageMetadataContractSha256
    storageObjectInventorySha256 = [string]$digests.StorageObjectInventorySha256
    capturedAt = ConvertTo-VDPostExpandCanonicalInstant -Value $sourceAt
    verifiedAt = ConvertTo-VDPostExpandCanonicalInstant -Value ([DateTimeOffset]::UtcNow)
    checks = [ordered]@{
      authDataDigestsVerified = $true
      encryptedArtifactsVerified = $true
      exactTableContractVerified = $true
      liveSchemaDigestVerified = $true
      logicalDataDigestsVerified = $true
      plaintextWrittenToDisk = $false
      storageDataDigestsVerified = $true
    }
    containsSecrets = $false
  }
  Assert-VDPostExpandVerificationReceipt -Receipt $receipt
  $receiptJson = $receipt | ConvertTo-Json -Depth 20 -Compress
  Write-VDPostExpandDurableReceipt -Path $fullReceiptPath -Json $receiptJson
  Write-Output $receiptJson
} finally {
  Close-HBAM2VerifierRuntimeFence -Fence $runtimeFence
  Close-HBAM2SupabaseCliFence -Fence $cliFence
  Close-VDPostExpandImplementationFence -Fence $implementationFence
  if ($inventoryBytes) { [Array]::Clear($inventoryBytes, 0, $inventoryBytes.Length) }
  if ($dataBytes) { [Array]::Clear($dataBytes, 0, $dataBytes.Length) }
}
