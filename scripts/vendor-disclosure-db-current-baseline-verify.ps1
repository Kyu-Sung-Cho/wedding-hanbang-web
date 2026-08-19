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

  [ValidateRange(1, 30)]
  [int] $MaximumAgeMinutes = 30,

  [string] $NodeCli = 'node.exe',

  [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'vendor-disclosure-db-current-baseline-common.ps1')

$ExpectedFiles = @(
  'logical-data.json.hbam2',
  'logical-data.json.key.dpapi',
  'manifest.json',
  'schema-inventory.json.hbam2',
  'schema-inventory.json.key.dpapi'
)

function Show-Help {
  Write-Host 'Vendor-disclosure successor current-Production backup verifier'
  Write-Host ''
  Write-Host 'Authenticates and decrypts the exact 60-table HBAM2 backup only in memory,'
  Write-Host 'recomputes source/schema/data contracts, and performs a PGlite JSONB round-trip.'
  Write-Host 'The exact logical verification receipt is created outside the repository.'
  Write-Host ''
  Write-Host '-Help performs no project, filesystem, Git, database, or runtime operation.'
}

function Get-VDVerifiedTimestamp {
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

function Invoke-VDCurrentBaselinePGliteRoundTrip {
  param(
    [Parameter(Mandatory = $true)] [byte[]] $InventoryBytes,
    [Parameter(Mandatory = $true)] [byte[]] $DataBytes,
    [Parameter(Mandatory = $true)] $RuntimeFence,
    [Parameter(Mandatory = $true)] [string] $RepoRoot
  )

  $scriptPath = Join-Path $RepoRoot 'apps\web\scripts\vendor-disclosure-db-current-baseline-roundtrip.mjs'
  if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    throw 'Current-baseline PGlite verifier script is missing.'
  }
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $RuntimeFence.NodePath
  $startInfo.Arguments = '"' + $scriptPath + '"'
  $startInfo.WorkingDirectory = Join-Path $RepoRoot 'apps\web'
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($name in @(
    'NODE_OPTIONS', 'NODE_PATH', 'NODE_COMPILE_CACHE', 'NODE_V8_COVERAGE',
    'NODE_REDIRECT_WARNINGS', 'NODE_CHANNEL_FD'
  )) { [void]$startInfo.EnvironmentVariables.Remove($name) }
  $startInfo.EnvironmentVariables['HBAM_PGLITE_ENTRY'] = $RuntimeFence.PGliteEntryPath
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start current-baseline PGlite verifier.' }
  try {
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    foreach ($bytes in @($InventoryBytes, $DataBytes)) {
      $remaining = 120000 - [int]$deadline.ElapsedMilliseconds
      if ($remaining -le 0) { throw 'PGlite verifier input exceeded the total deadline.' }
      $line = [Convert]::ToBase64String($bytes)
      $writeTask = $process.StandardInput.WriteLineAsync($line)
      if (-not $writeTask.Wait($remaining)) { throw 'PGlite verifier input exceeded the total deadline.' }
      [void]$writeTask.GetAwaiter().GetResult()
      $line = $null
    }
    $process.StandardInput.Close()
    $remaining = 120000 - [int]$deadline.ElapsedMilliseconds
    if ($remaining -le 0 -or -not $process.WaitForExit($remaining)) {
      & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null
      throw 'PGlite current-baseline verification exceeded 120 seconds.'
    }
    $process.WaitForExit()
    $stdout = $stdoutTask.Result.Trim()
    $null = $stderrTask.Result
    if ($process.ExitCode -ne 0) {
      throw "PGlite current-baseline verification failed with exit code $($process.ExitCode)."
    }
    try { $receipt = $stdout | ConvertFrom-Json }
    catch { throw 'PGlite current-baseline verifier returned invalid JSON.' }
    foreach ($field in @(
      'JsonbRoundTripVerified', 'AuthenticatedJsonbStaged', 'Engine', 'TableCount',
      'TotalRows', 'PrimaryConstraintsChecked', 'ForeignKeysChecked',
      'ExternalForeignKeysSkipped', 'SourceCanonicalDigestsVerified',
      'LogicalDataParsedInV8', 'PlaintextWrittenToDisk'
    )) {
      if (-not $receipt.PSObject.Properties[$field]) {
        throw "PGlite current-baseline receipt is missing $field."
      }
    }
    if (-not [bool]$receipt.JsonbRoundTripVerified -or
        -not [bool]$receipt.AuthenticatedJsonbStaged -or
        -not [bool]$receipt.SourceCanonicalDigestsVerified -or
        [string]$receipt.Engine -ne 'PGlite' -or
        [int]$receipt.TableCount -ne 60 -or
        [bool]$receipt.LogicalDataParsedInV8 -or
        [bool]$receipt.PlaintextWrittenToDisk -or
        [int]$receipt.PrimaryConstraintsChecked -lt 1) {
      throw 'PGlite current-baseline receipt failed its exact safety contract.'
    }
    return $receipt
  } finally {
    if (-not $process.HasExited) {
      & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null
    }
    $process.Dispose()
  }
}

function Assert-VDRecordedImplementation {
  param(
    [Parameter(Mandatory = $true)] $Recorded,
    [Parameter(Mandatory = $true)] $Fence
  )
  foreach ($field in @('git_commit', 'files', 'git_blobs')) {
    if (-not $Recorded.PSObject.Properties[$field]) {
      throw "Recorded implementation provenance is missing $field."
    }
  }
  if ([string]$Recorded.git_commit -ne $ExpectedCommit) {
    throw 'Recorded implementation commit differs from the external anchor.'
  }
  $expected = @($script:VDCurrentBaselineImplementationPaths | Sort-Object)
  $recordedFiles = @(Get-HBAM2ObjectPropertyNames -Value $Recorded.files | Sort-Object)
  $recordedBlobs = @(Get-HBAM2ObjectPropertyNames -Value $Recorded.git_blobs | Sort-Object)
  if ($recordedFiles.Count -ne $expected.Count -or $recordedBlobs.Count -ne $expected.Count -or
      @(Compare-Object -ReferenceObject $expected -DifferenceObject $recordedFiles).Count -ne 0 -or
      @(Compare-Object -ReferenceObject $expected -DifferenceObject $recordedBlobs).Count -ne 0) {
    throw 'Recorded implementation provenance file set is not exact.'
  }
  Assert-VDCurrentBaselineImplementationFence -Fence $Fence -Recorded $Recorded
}

function Write-VDExactReceipt {
  param(
    [Parameter(Mandatory = $true)] [string] $Path,
    [Parameter(Mandatory = $true)] [string] $Json
  )

  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Json + "`n")
  $stream = $null
  try {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally {
    if ($stream) { $stream.Dispose() }
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
  Set-HBAM2PrivateFileAcl -Path $Path
}

if ($Help) { Show-Help; exit 0 }
if ($env:OS -ne 'Windows_NT') { throw 'HBAM2 current-baseline verification requires Windows DPAPI.' }
if ([string]::IsNullOrWhiteSpace($BackupDirectory) -or
    $ExpectedProjectRef -ne $script:VDCurrentBaselineProjectRef -or
    $ExpectedCommit -notmatch '^[a-f0-9]{40}$' -or
    [string]::IsNullOrWhiteSpace($ExpectedGitOrigin) -or
    $Release -notmatch '^[a-z][a-z0-9-]{2,80}$' -or
    $BackupContractId -ne "pre-$Release-current-remote-backup" -or
    $BackupContractVersion -ne 2 -or
    $ExpectedManifestSha256 -notmatch '^[a-f0-9]{64}$' -or
    $ExpectedSupabaseCliVersion -notmatch '^\d+\.\d+\.\d+$' -or
    $ExpectedSupabaseCliBinarySha256 -notmatch '^[A-F0-9]{64}$') {
  throw 'Current-baseline verifier anchors are missing or invalid.'
}
try { $canonicalSetId = ([Guid]::ParseExact($ExpectedBackupSetId, 'D')).ToString('D') }
catch { throw '-ExpectedBackupSetId must be a canonical UUID.' }
if ($canonicalSetId -ne $ExpectedBackupSetId) {
  throw '-ExpectedBackupSetId must use canonical lowercase UUID form.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Assert-VDCurrentBaselineExactPushedGitState -RepoRoot $repoRoot `
  -ExpectedCommit $ExpectedCommit -ExpectedOrigin $ExpectedGitOrigin -RemoteRef $RemoteRef

$rootInfo = Resolve-HBAM2BackupRoot -SelfTest $false
Assert-HBAM2BackupRoot -Root $rootInfo.Root -Anchor $rootInfo.Anchor
$directory = (Resolve-Path -LiteralPath $BackupDirectory).Path
if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($directory)).TrimEnd('\') -ne
      [IO.Path]::GetFullPath($rootInfo.Root).TrimEnd('\') -or
    [IO.Path]::GetFileName($directory) -notmatch '^\d{8}-\d{6}$') {
  throw 'Backup directory is outside the fixed private external root.'
}
Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $directory -Anchor $rootInfo.Anchor
Assert-HBAM2PrivateDirectoryAcl -Path $directory
$entries = @(Get-ChildItem -LiteralPath $directory -Force)
$files = @($entries | Where-Object { -not $_.PSIsContainer } | ForEach-Object Name | Sort-Object)
if ($entries.Count -ne $ExpectedFiles.Count -or
    @(Compare-Object -ReferenceObject $ExpectedFiles -DifferenceObject $files).Count -ne 0) {
  throw 'Backup directory does not contain the exact encrypted artifact set.'
}
foreach ($file in $ExpectedFiles) {
  $path = Join-Path $directory $file
  if (((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Backup artifact is a reparse point.'
  }
  Assert-HBAM2PrivateFileAcl -Path $path
}

if (-not [IO.Path]::IsPathRooted($ReceiptPath)) {
  throw '-ReceiptPath must be an absolute external path.'
}
$fullReceiptPath = [IO.Path]::GetFullPath($ReceiptPath)
$expectedReceiptName = "$ExpectedBackupSetId-successor-logical-verification.json"
if ([IO.Path]::GetDirectoryName($fullReceiptPath).TrimEnd('\') -ne
      [IO.Path]::GetFullPath($rootInfo.Root).TrimEnd('\') -or
    [IO.Path]::GetFileName($fullReceiptPath) -ne $expectedReceiptName -or
    (Test-Path -LiteralPath $fullReceiptPath)) {
  throw 'Receipt path must be a new exact-name file under the fixed private external root.'
}
Assert-HBAM2PrivateDirectoryAcl -Path $rootInfo.Root

$manifestBytes = Read-HBAM2BoundedFileBytes -Path (Join-Path $directory 'manifest.json') `
  -MaximumBytes $script:HBAM2MaximumManifestBytes
try {
  $actualManifestSha = (Get-HBAM2Sha256Hex -Bytes $manifestBytes).ToLowerInvariant()
  if ($actualManifestSha -ne $ExpectedManifestSha256) {
    throw 'Manifest SHA-256 differs from the external anchor.'
  }
  try { $manifest = [Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json }
  catch { throw 'Backup manifest is not valid JSON.' }
} finally { [Array]::Clear($manifestBytes, 0, $manifestBytes.Length) }

foreach ($field in @(
  'status', 'format', 'format_version', 'backup_type', 'backup_set_id', 'release',
  'backup_contract_id', 'backup_contract_version', 'created_at_utc',
  'preflight_captured_at', 'inventory_before_captured_at', 'source_captured_at',
  'inventory_after_captured_at', 'source_project_ref', 'source_project_ref_sha256',
  'source_database_identity', 'source_database_identity_sha256', 'source_current_user',
  'source_session_user', 'source_role_bypasses_rls', 'source_row_security',
  'source_migration_head', 'source_migration_count', 'source_migration_versions_sha256',
  'expected_tables', 'table_count', 'table_contract_sha256',
  'inventory_contract_sha256', 'source_relation_contract_sha256',
  'live_schema_contract_sha256', 'logical_data_contract_sha256',
  'auth_schema_contract_sha256', 'auth_users_canonical_sha256',
  'auth_users_contract_sha256', 'auth_users_row_count', 'git_commit',
  'git_origin', 'git_remote_ref', 'implementation', 'supabase_cli', 'verifier_runtime',
  'verifier', 'source_fence', 'consistency', 'plaintext_written_to_disk',
  'contains_secrets', 'tables', 'artifacts'
)) {
  if (-not $manifest.PSObject.Properties[$field]) { throw "Manifest is missing $field." }
}
if ([string]$manifest.status -ne 'complete' -or
    [string]$manifest.format -ne $script:HBAM2FormatName -or
    [int]$manifest.format_version -ne 2 -or
    [string]$manifest.backup_type -ne 'vendor-disclosure-successor-current-production-logical-snapshot' -or
    [string]$manifest.backup_set_id -ne $ExpectedBackupSetId -or
    [string]$manifest.release -ne $Release -or
    [string]$manifest.backup_contract_id -ne $BackupContractId -or
    [int]$manifest.backup_contract_version -ne $BackupContractVersion -or
    [string]$manifest.source_project_ref -ne $ExpectedProjectRef -or
    [string]$manifest.source_migration_head -ne $script:VDCurrentBaselineMigrationHead -or
    [int]$manifest.source_migration_count -ne $script:VDCurrentBaselineMigrationCount -or
    [string]$manifest.source_migration_versions_sha256 -ne $script:VDCurrentBaselineMigrationVersionsSha256 -or
    [int]$manifest.table_count -ne 60 -or
    [string]$manifest.table_contract_sha256 -ne $script:VDCurrentBaselineTableContractSha256 -or
    [string]$manifest.git_commit -ne $ExpectedCommit -or
    [string]$manifest.git_origin -ne $ExpectedGitOrigin -or
    [string]$manifest.git_remote_ref -ne $RemoteRef -or
    [string]$manifest.source_fence -ne 'exact-linked-production-ref-plus-clean-pushed-commit-plus-pinned-cli' -or
    [string]$manifest.consistency -ne 'logical-data-single-statement-schema-before-after-fenced' -or
    [bool]$manifest.plaintext_written_to_disk -or [bool]$manifest.contains_secrets) {
  throw 'Manifest differs from the exact current Production safety contract.'
}
$manifestTables = @($manifest.expected_tables | ForEach-Object { [string]$_ })
Assert-VDCurrentBaselineExactNames -Actual $manifestTables -Label 'Manifest expected tables'
if (@(Compare-Object -ReferenceObject $script:VDCurrentBaselineExpectedTables `
    -DifferenceObject $manifestTables -SyncWindow 0).Count -ne 0) {
  throw 'Manifest expected table order differs from the exact contract.'
}
foreach ($digest in @(
  [string]$manifest.source_project_ref_sha256,
  [string]$manifest.source_database_identity_sha256,
  [string]$manifest.inventory_contract_sha256,
  [string]$manifest.source_relation_contract_sha256,
  [string]$manifest.live_schema_contract_sha256,
  [string]$manifest.logical_data_contract_sha256,
  [string]$manifest.auth_schema_contract_sha256,
  [string]$manifest.auth_users_canonical_sha256,
  [string]$manifest.auth_users_contract_sha256
)) {
  if ($digest -notmatch '^[a-f0-9]{64}$') { throw 'Manifest contains an invalid contract digest.' }
}
if ((Get-VDCurrentBaselineUtf8Sha256Lower -Value $ExpectedProjectRef) -ne
      [string]$manifest.source_project_ref_sha256 -or
    (Get-VDCurrentBaselineCanonicalJsonSha256 -Value $manifest.source_database_identity) -ne
      [string]$manifest.source_database_identity_sha256 -or
    [int64]$manifest.auth_users_row_count -lt 0 -or
    [int64]$manifest.auth_users_row_count -gt 500000) {
  throw 'Manifest source project/database identity digest is invalid.'
}

$preflightAt = Get-VDVerifiedTimestamp -Value ([string]$manifest.preflight_captured_at) -Label 'preflight_captured_at'
$beforeAt = Get-VDVerifiedTimestamp -Value ([string]$manifest.inventory_before_captured_at) -Label 'inventory_before_captured_at'
$sourceAt = Get-VDVerifiedTimestamp -Value ([string]$manifest.source_captured_at) -Label 'source_captured_at'
$afterAt = Get-VDVerifiedTimestamp -Value ([string]$manifest.inventory_after_captured_at) -Label 'inventory_after_captured_at'
$createdAt = Get-VDVerifiedTimestamp -Value ([string]$manifest.created_at_utc) -Label 'created_at_utc'
$now = [DateTimeOffset]::UtcNow
if ($preflightAt -gt $beforeAt -or $beforeAt -gt $sourceAt -or $sourceAt -gt $afterAt -or
    $afterAt -gt $createdAt -or $createdAt -gt $now.AddMinutes(1) -or
    $now.Subtract($sourceAt).TotalMinutes -gt $MaximumAgeMinutes -or
    $now.Subtract($createdAt).TotalMinutes -gt $MaximumAgeMinutes) {
  throw 'Backup timestamps are stale, future-dated, or out of capture order.'
}

$verifierRelative = 'scripts/vendor-disclosure-db-current-baseline-verify.ps1'
$verifierSha = Get-VDCurrentBaselineCanonicalTextFileSha256 -Path (Join-Path $repoRoot $verifierRelative.Replace('/', '\'))
if ([string]$manifest.verifier.file -ne $verifierRelative -or
    [string]$manifest.verifier.sha256 -ne $verifierSha) {
  throw 'Manifest verifier identity differs from this exact verifier.'
}

$implementationFence = $null
$cliFence = $null
$runtimeFence = $null
$inventoryBytes = $null
$dataBytes = $null
try {
  $implementationFence = New-VDCurrentBaselineImplementationFence `
    -RepoRoot $repoRoot -ExpectedCommit $ExpectedCommit
  Assert-VDRecordedImplementation -Recorded $manifest.implementation -Fence $implementationFence
  $cliFence = New-HBAM2SupabaseCliFence `
    -RepoRoot $repoRoot -RequestedCli 'supabase' -SelfTest $false
  Assert-HBAM2SupabaseCliProvenance `
    -Recorded $manifest.supabase_cli -CurrentFence $cliFence -SelfTest $false
  $cliBinaryPath = [string]$cliFence.Provenance.invocation_relative_path
  $cliBinarySha = [string](Get-HBAM2ObjectPropertyValue -Value $cliFence.Provenance.files -Name $cliBinaryPath)
  if ([string]$cliFence.Provenance.version -ne $ExpectedSupabaseCliVersion -or
      $cliBinarySha -ne $ExpectedSupabaseCliBinarySha256) {
    throw 'Verifier Supabase CLI differs from the external release anchor.'
  }
  $runtimeContract = Get-HBAM2VerifierRuntimeContract -RepoRoot $repoRoot
  Assert-HBAM2VerifierRuntimeContract -Recorded $manifest.verifier_runtime -Expected $runtimeContract
  $runtimeFence = New-HBAM2VerifierRuntimeFence `
    -RepoRoot $repoRoot -RequestedNode $NodeCli -SelfTest $false -Contract $runtimeContract

  if (-not $manifest.artifacts.PSObject.Properties['schema_inventory'] -or
      -not $manifest.artifacts.PSObject.Properties['logical_data']) {
    throw 'Manifest encrypted artifact metadata is incomplete.'
  }
  $inventoryBytes = Unprotect-HBAM2Artifact -Directory $directory `
    -Metadata $manifest.artifacts.schema_inventory -ArtifactName 'schema-inventory.json' `
    -ProjectRef $ExpectedProjectRef -BackupSetId $ExpectedBackupSetId
  $dataBytes = Unprotect-HBAM2Artifact -Directory $directory `
    -Metadata $manifest.artifacts.logical_data -ArtifactName 'logical-data.json' `
    -ProjectRef $ExpectedProjectRef -BackupSetId $ExpectedBackupSetId
  try { $inventory = [Text.Encoding]::UTF8.GetString($inventoryBytes) | ConvertFrom-Json }
  catch { throw 'Authenticated inventory is not valid JSON.' }
  try { $data = [Text.Encoding]::UTF8.GetString($dataBytes) | ConvertFrom-Json }
  catch { throw 'Authenticated logical data is not valid JSON.' }

  Assert-VDCurrentBaselineSourceContract -Value $inventory -Label 'Authenticated inventory'
  Assert-VDCurrentBaselineSourceContract -Value $data -Label 'Authenticated logical data'
  foreach ($field in @(
    'migration_versions', 'columns', 'constraints', 'schema_contract',
    'auth_schema_contract'
  )) {
    if (-not $inventory.PSObject.Properties[$field]) { throw "Authenticated inventory is missing $field." }
  }
  if (@($inventory.migration_versions).Count -ne $script:VDCurrentBaselineMigrationCount -or
      [string]@($inventory.migration_versions)[-1] -ne $script:VDCurrentBaselineMigrationHead) {
    throw 'Authenticated inventory does not contain the exact 147-version history.'
  }

  $inventorySha = Get-VDCurrentBaselineInventorySha256 -Inventory $inventory
  $liveSchemaSha = Get-VDCurrentBaselineCanonicalJsonSha256 -Value $inventory.schema_contract
  $sourceIdentitySha = Get-VDCurrentBaselineCanonicalJsonSha256 -Value $inventory.source_database_identity
  $inventoryRelationSha = (Get-HBAM2RelationContractSha256 -Relations $inventory.relations `
    -ExpectedNames $script:VDCurrentBaselineExpectedTables -Label 'Authenticated inventory').ToLowerInvariant()
  $dataRelationSha = (Get-HBAM2RelationContractSha256 -Relations $data.relations `
    -ExpectedNames $script:VDCurrentBaselineExpectedTables -Label 'Authenticated logical data').ToLowerInvariant()
  if ($inventorySha -ne [string]$manifest.inventory_contract_sha256 -or
      $liveSchemaSha -ne [string]$manifest.live_schema_contract_sha256 -or
      $sourceIdentitySha -ne [string]$manifest.source_database_identity_sha256 -or
      $sourceIdentitySha -ne (Get-VDCurrentBaselineCanonicalJsonSha256 -Value $data.source_database_identity) -or
      $inventoryRelationSha -ne [string]$manifest.source_relation_contract_sha256 -or
      $dataRelationSha -ne $inventoryRelationSha -or
      [string]$inventory.current_user -ne [string]$manifest.source_current_user -or
      [string]$inventory.session_user -ne [string]$manifest.source_session_user -or
      [string]$data.current_user -ne [string]$manifest.source_current_user -or
      [string]$data.session_user -ne [string]$manifest.source_session_user) {
    throw 'Authenticated source identity or schema contract digest is invalid.'
  }

  if (-not $data.PSObject.Properties['tables']) { throw 'Authenticated logical data has no tables object.' }
  $dataNames = @($data.tables.PSObject.Properties.Name | Sort-Object)
  $manifestCountNames = @($manifest.tables.PSObject.Properties.Name | Sort-Object)
  Assert-VDCurrentBaselineExactNames -Actual $dataNames -Label 'Authenticated logical data'
  Assert-VDCurrentBaselineExactNames -Actual $manifestCountNames -Label 'Manifest table counts'
  $verifiedCounts = [ordered]@{}
  foreach ($property in @($data.tables.PSObject.Properties | Sort-Object Name)) {
    $manifestCount = $manifest.tables.PSObject.Properties[$property.Name]
    if (-not $manifestCount -or
        -not $property.Value.PSObject.Properties['row_count'] -or
        -not $property.Value.PSObject.Properties['rows'] -or
        -not $property.Value.PSObject.Properties['canonical_sha256'] -or
        [string]$property.Value.canonical_sha256 -notmatch '^[a-f0-9]{64}$') {
      throw "Authenticated logical metadata is invalid for $($property.Name)."
    }
    $actual = @($property.Value.rows).Count
    if ($actual -ne [int64]$property.Value.row_count -or $actual -ne [int64]$manifestCount.Value) {
      throw "Authenticated logical row count is invalid for $($property.Name)."
    }
    $verifiedCounts[$property.Name] = $actual
  }
  $logicalDataSha = (Get-HBAM2LogicalDataContractSha256 -Tables $data.tables `
    -ExpectedNames $script:VDCurrentBaselineExpectedTables -Label 'Authenticated logical data').ToLowerInvariant()
  if ($logicalDataSha -ne [string]$manifest.logical_data_contract_sha256 -or
      [string]$data.captured_at -ne [string]$manifest.source_captured_at) {
    throw 'Authenticated logical data contract or timestamp is invalid.'
  }
  $authContracts = Get-VDCurrentBaselineAuthContractDigests `
    -Inventory $inventory -Logical $data -Label 'Authenticated logical data'
  $authSchemaSha = [string]$authContracts.AuthSchemaContractSha256
  $authUsersCanonicalSha = [string]$authContracts.AuthUsersCanonicalSha256
  $authUsersContractSha = [string]$authContracts.AuthUsersContractSha256
  if ($authSchemaSha -ne [string]$manifest.auth_schema_contract_sha256 -or
      $authUsersCanonicalSha -ne [string]$manifest.auth_users_canonical_sha256 -or
      $authUsersContractSha -ne [string]$manifest.auth_users_contract_sha256 -or
      [int64]$authContracts.AuthUsersRowCount -ne [int64]$manifest.auth_users_row_count) {
    throw 'Authenticated auth.users contract differs from the manifest.'
  }

  $roundTrip = Invoke-VDCurrentBaselinePGliteRoundTrip `
    -InventoryBytes $inventoryBytes -DataBytes $dataBytes `
    -RuntimeFence $runtimeFence -RepoRoot $repoRoot
  $totalRows = [int64](($verifiedCounts.Values | Measure-Object -Sum).Sum)
  if ([int64]$roundTrip.TotalRows -ne $totalRows -or [int]$roundTrip.TableCount -ne 60) {
    throw 'PGlite row/table counts differ from the authenticated backup.'
  }

  Assert-VDCurrentBaselineImplementationFence -Fence $implementationFence -Recorded $manifest.implementation
  Assert-HBAM2SupabaseCliFence -Fence $cliFence
  Assert-HBAM2VerifierRuntimeFence -Fence $runtimeFence
  Assert-VDCurrentBaselineExactPushedGitState -RepoRoot $repoRoot `
    -ExpectedCommit $ExpectedCommit -ExpectedOrigin $ExpectedGitOrigin -RemoteRef $RemoteRef

  $verifiedAt = [DateTimeOffset]::UtcNow.ToString('o')
  $logicalArtifact = $manifest.artifacts.logical_data
  $inventoryArtifact = $manifest.artifacts.schema_inventory
  $receipt = [ordered]@{
    ReceiptVersion = 1
    Kind = 'vendor-disclosure-successor-current-baseline-backup-verification-v1'
    Verified = $true
    Release = $Release
    ProjectRef = $ExpectedProjectRef
    GitCommit = $ExpectedCommit
    GitOrigin = $ExpectedGitOrigin
    BackupContractId = $BackupContractId
    BackupContractVersion = $BackupContractVersion
    BackupSetId = $ExpectedBackupSetId
    ManifestSha256 = $actualManifestSha
    SourceCapturedAt = [string]$manifest.source_captured_at
    VerifiedAtUtc = $verifiedAt
    SourceMigrationHead = $script:VDCurrentBaselineMigrationHead
    SourceMigrationCount = $script:VDCurrentBaselineMigrationCount
    TableCount = 60
    ExpectedTables = @($script:VDCurrentBaselineExpectedTables)
    TableContractSha256 = $script:VDCurrentBaselineTableContractSha256
    InventorySha256 = $inventorySha
    LiveSchemaContractSha256 = $liveSchemaSha
    LogicalDataContractSha256 = $logicalDataSha
    AuthSchemaContractSha256 = $authSchemaSha
    AuthUsersCanonicalSha256 = $authUsersCanonicalSha
    AuthUsersContractSha256 = $authUsersContractSha
    EncryptedArtifacts = [ordered]@{
      LogicalDataCiphertextSha256 = ([string]$logicalArtifact.encrypted_sha256).ToLowerInvariant()
      LogicalDataProtectedKeySha256 = ([string]$logicalArtifact.key_sha256).ToLowerInvariant()
      SchemaInventoryCiphertextSha256 = ([string]$inventoryArtifact.encrypted_sha256).ToLowerInvariant()
      SchemaInventoryProtectedKeySha256 = ([string]$inventoryArtifact.key_sha256).ToLowerInvariant()
    }
    SupabaseCli = [ordered]@{
      Version = [string]$cliFence.Provenance.version
      BinarySha256 = $cliBinarySha
    }
    Verifier = [ordered]@{ File = $verifierRelative; Sha256 = $verifierSha }
    EncryptedArtifactsVerified = $true
    SourceCanonicalDigestsVerified = $true
    PGliteJsonbRoundTripVerified = $true
    PlaintextWrittenToDisk = $false
    ContainsSecrets = $false
  }
  Assert-VDCurrentBaselineLogicalReceipt -Receipt $receipt
  $receiptJson = $receipt | ConvertTo-Json -Depth 20 -Compress
  Write-VDExactReceipt -Path $fullReceiptPath -Json $receiptJson
  Write-Output $receiptJson
} finally {
  Close-HBAM2VerifierRuntimeFence -Fence $runtimeFence
  Close-HBAM2SupabaseCliFence -Fence $cliFence
  Close-VDCurrentBaselineImplementationFence -Fence $implementationFence
  if ($inventoryBytes) { [Array]::Clear($inventoryBytes, 0, $inventoryBytes.Length) }
  if ($dataBytes) { [Array]::Clear($dataBytes, 0, $dataBytes.Length) }
}
