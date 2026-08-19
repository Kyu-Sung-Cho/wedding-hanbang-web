param(
  [string] $ExpectedProjectRef = 'slrtobkksjmxgzatjyqb',
  [string] $ExpectedCommit,
  [string] $ExpectedGitOrigin,
  [string] $RemoteRef,
  [string] $Release,
  [string] $BackupContractId,
  [int] $BackupContractVersion = 2,
  [string] $ExpectedSupabaseCliVersion,
  [string] $ExpectedSupabaseCliBinarySha256,
  [string] $SupabaseCli = 'supabase',
  [ValidateRange(30, 600)] [int] $QueryTimeoutSeconds = 150,
  [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'vendor-disclosure-db-backup-common.ps1')

$MaximumEstimatedSourceBytes = 536870912
$MaximumEstimatedRows = 1000000
$ExpectedArtifactFiles = @(
  'logical-data.json.hbam2',
  'logical-data.json.key.dpapi',
  'manifest.json',
  'schema-inventory.json.hbam2',
  'schema-inventory.json.key.dpapi'
)

function Show-Help {
  Write-Host 'Vendor-disclosure successor post-expand Production backup'
  Write-Host ''
  Write-Host 'Captures the exact 139-table / 228-migration Production state with read-only'
  Write-Host 'linked queries. Public, Auth users, and Storage metadata/object inventory are'
  Write-Host 'encrypted in memory as HBAM2 artifacts protected by Windows DPAPI CurrentUser.'
  Write-Host 'No logical plaintext is written to disk. -Help performs no I/O.'
}

function ConvertTo-VDPostExpandNativeArgument {
  param([Parameter(Mandatory = $true)] [string] $Value)
  if ($Value.Contains('"') -or $Value.Contains("`r") -or $Value.Contains("`n")) {
    throw 'Native process argument contains an unsupported character.'
  }
  return '"' + $Value + '"'
}

function Stop-VDPostExpandProcessTree {
  param([Parameter(Mandatory = $true)] [Diagnostics.Process] $Process)
  if (-not $Process.HasExited) {
    & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $Process.Id /T /F *> $null
  }
}

function Invoke-VDPostExpandLinkedQuery {
  param(
    [Parameter(Mandatory = $true)] [string] $Cli,
    [Parameter(Mandatory = $true)] [string] $SqlFile,
    [Parameter(Mandatory = $true)] [string] $Workdir,
    [Parameter(Mandatory = $true)] [int] $TimeoutSeconds
  )
  $maximumBytes = [int64]$script:HBAM2MaximumPayloadBytes + 1048576
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Cli
  $startInfo.Arguments = (@('db', 'query', '--linked', '--workdir', $Workdir,
    '--output', 'json', '--file', $SqlFile) | ForEach-Object {
      ConvertTo-VDPostExpandNativeArgument -Value $_
    }) -join ' '
  $startInfo.WorkingDirectory = $Workdir
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $startInfo
  $memory = [IO.MemoryStream]::new(); $buffer = New-Object byte[] 65536
  $rawBytes = $null; $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  if (-not $process.Start()) { throw 'Could not start the fenced Supabase query.' }
  try {
    $stderrTask = $process.StandardError.ReadToEndAsync()
    while ($true) {
      $remaining = ($TimeoutSeconds * 1000) - [int]$stopwatch.ElapsedMilliseconds
      if ($remaining -le 0) { Stop-VDPostExpandProcessTree -Process $process; throw 'Supabase query timed out.' }
      $readTask = $process.StandardOutput.BaseStream.ReadAsync($buffer, 0, $buffer.Length)
      if (-not $readTask.Wait($remaining)) {
        Stop-VDPostExpandProcessTree -Process $process
        throw "Supabase linked read-only query exceeded $TimeoutSeconds seconds."
      }
      $read = $readTask.Result
      if ($read -eq 0) { break }
      if ($memory.Length + $read -gt $maximumBytes) {
        Stop-VDPostExpandProcessTree -Process $process
        throw 'Supabase query response exceeded its streamed byte bound.'
      }
      $memory.Write($buffer, 0, $read)
    }
    $remaining = ($TimeoutSeconds * 1000) - [int]$stopwatch.ElapsedMilliseconds
    if ($remaining -le 0 -or -not $process.WaitForExit($remaining)) {
      Stop-VDPostExpandProcessTree -Process $process
      throw "Supabase linked read-only query exceeded $TimeoutSeconds seconds."
    }
    $process.WaitForExit(); $null = $stderrTask.Result
    if ($process.ExitCode -ne 0) {
      throw "Supabase linked read-only query failed with exit code $($process.ExitCode)."
    }
    $rawBytes = $memory.ToArray()
    if ($rawBytes.Length -lt 2) { throw 'Supabase query response is missing.' }
    $raw = [Text.UTF8Encoding]::new($false, $true).GetString($rawBytes).Trim()
  } finally {
    $stopwatch.Stop(); $memory.Dispose(); $process.Dispose()
    [Array]::Clear($buffer, 0, $buffer.Length)
    if ($rawBytes) { [Array]::Clear($rawBytes, 0, $rawBytes.Length) }
  }
  try { $response = $raw | ConvertFrom-Json }
  catch { throw 'Supabase query returned invalid JSON.' }
  $rows = @($response.rows)
  if ($rows.Count -ne 1 -or -not $rows[0].PSObject.Properties['payload'] -or
      [string]::IsNullOrWhiteSpace([string]$rows[0].payload) -or
      ($rows[0].PSObject.Properties['payload_bytes'] -and
        [int64]$rows[0].payload_bytes -gt $script:HBAM2MaximumPayloadBytes)) {
    throw 'Supabase query failed its server-side contract or payload-size gate.'
  }
  return [string]$rows[0].payload
}

function ConvertFrom-VDPostExpandRequiredJson {
  param([Parameter(Mandatory = $true)] [string] $Json, [Parameter(Mandatory = $true)] [string] $Label)
  try { return $Json | ConvertFrom-Json }
  catch { throw "$Label payload is not valid JSON." }
}

function Get-VDPostExpandTimestamp {
  param([Parameter(Mandatory = $true)] [string] $Value, [Parameter(Mandatory = $true)] [string] $Label)
  try { return [DateTimeOffset]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind) }
  catch { throw "$Label timestamp is invalid." }
}

function Assert-VDPostExpandCliContract {
  param([Parameter(Mandatory = $true)] $Fence)
  $path = [string]$Fence.Provenance.invocation_relative_path
  $hash = [string](Get-HBAM2ObjectPropertyValue -Value $Fence.Provenance.files -Name $path)
  if ([string]$Fence.Provenance.version -ne $ExpectedSupabaseCliVersion -or
      $hash -ne $ExpectedSupabaseCliBinarySha256) {
    throw 'Installed Supabase CLI differs from the exact post-expand release contract.'
  }
}

function Remove-VDPostExpandStagingDirectory {
  param([Parameter(Mandatory = $true)] [string] $Path, [Parameter(Mandatory = $true)] [string] $Root)
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\'); $parent = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  if ([IO.Path]::GetDirectoryName($full).TrimEnd('\') -ne $parent -or
      [IO.Path]::GetFileName($full) -notmatch '^\.partial-post-expand-\d{8}-\d{6}-[a-f0-9]{32}$') {
    throw 'Refusing cleanup outside the exact post-expand staging directory.'
  }
  if (Test-Path -LiteralPath $full) {
    $item = Get-Item -LiteralPath $full -Force
    if (-not $item.PSIsContainer -or
        (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
      throw 'Refusing cleanup of a non-directory or reparse-point staging path.'
    }
    Remove-Item -LiteralPath $full -Recurse -Force
    Sync-VDPostExpandParentDirectory -Path $full
  }
}

function Remove-VDPostExpandFinalDirectory {
  param([Parameter(Mandatory = $true)] [string] $Path, [Parameter(Mandatory = $true)] [string] $Root)
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\'); $parent = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  if ([IO.Path]::GetDirectoryName($full).TrimEnd('\') -ne $parent -or
      [IO.Path]::GetFileName($full) -notmatch '^post-expand-\d{8}-\d{6}-[a-f0-9]{32}$') {
    throw 'Refusing cleanup outside the exact post-expand final directory.'
  }
  if (Test-Path -LiteralPath $full) {
    $item = Get-Item -LiteralPath $full -Force
    if (-not $item.PSIsContainer -or
        (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
      throw 'Refusing cleanup of a non-directory or reparse-point final path.'
    }
    Remove-Item -LiteralPath $full -Recurse -Force
    Sync-VDPostExpandParentDirectory -Path $full
  }
}

function Test-VDPostExpandLogicalPart {
  param([Parameter(Mandatory = $true)] $Value, [Parameter(Mandatory = $true)] [string] $Label)
  foreach ($field in @('row_count', 'rows', 'canonical_sha256')) {
    if (-not $Value.PSObject.Properties[$field]) { throw "$Label is missing $field." }
  }
  if ([int64]$Value.row_count -ne @($Value.rows).Count -or
      [string]$Value.canonical_sha256 -notmatch '^[a-f0-9]{64}$') {
    throw "$Label row count or canonical digest is invalid."
  }
}

if ($Help) { Show-Help; exit 0 }
if ($env:OS -ne 'Windows_NT') { throw 'HBAM2 post-expand backup requires Windows DPAPI.' }
if ($ExpectedProjectRef -ne $script:VDPostExpandProjectRef) { throw 'Backup is pinned to the exact Production project ref.' }
if ($Release -notmatch '^[a-z][a-z0-9-]{2,80}$' -or
    $BackupContractId -ne "post-$Release-backup" -or $BackupContractVersion -ne 2 -or
    $ExpectedCommit -notmatch '^[a-f0-9]{40}$' -or
    $ExpectedSupabaseCliVersion -notmatch '^\d+\.\d+\.\d+$' -or
    $ExpectedSupabaseCliBinarySha256 -notmatch '^[A-F0-9]{64}$') {
  throw 'Post-expand backup contract arguments are invalid.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$linkedRefPath = Join-Path $repoRoot 'supabase\.temp\project-ref'
if (-not (Test-Path -LiteralPath $linkedRefPath -PathType Leaf) -or
    ([IO.File]::ReadAllText($linkedRefPath)).Trim() -ne $script:VDPostExpandProjectRef) {
  throw 'This worktree is not linked to the exact Production project.'
}
Assert-VDPostExpandExactPushedGitState -RepoRoot $repoRoot -ExpectedCommit $ExpectedCommit `
  -ExpectedOrigin $ExpectedGitOrigin -RemoteRef $RemoteRef

$rootInfo = Resolve-HBAM2BackupRoot -SelfTest $false
Initialize-HBAM2BackupRoot -Root $rootInfo.Root -Anchor $rootInfo.Anchor
$root = $rootInfo.Root; $parent = [IO.Path]::GetFullPath($root).TrimEnd('\')
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'; $unique = [Guid]::NewGuid().ToString('N')
$finalDirectory = Join-Path $root "post-expand-$timestamp-$unique"
$stagingDirectory = Join-Path $root ".partial-post-expand-$timestamp-$unique"
foreach ($path in @($finalDirectory, $stagingDirectory)) {
  if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($path)).TrimEnd('\') -ne $parent) {
    throw 'Backup destination escaped the external backup root.'
  }
}
if (Test-Path -LiteralPath $finalDirectory) { throw 'Post-expand backup destination already exists.' }

$captureLock = $null; $implementationFence = $null; $cliFence = $null; $linkedRefStream = $null
$inventoryBytes = $null; $dataBytes = $null; $published = $false; $movedToFinal = $false
$queryFiles = @()
try {
  $captureLock = New-HBAM2CaptureLock -Root $root
  [IO.Directory]::CreateDirectory($stagingDirectory) | Out-Null
  Set-HBAM2PrivateDirectoryAcl -Path $stagingDirectory
  $implementationFence = New-VDPostExpandImplementationFence -RepoRoot $repoRoot -ExpectedCommit $ExpectedCommit
  $cliFence = New-HBAM2SupabaseCliFence -RepoRoot $repoRoot -RequestedCli $SupabaseCli -SelfTest $false
  Assert-VDPostExpandCliContract -Fence $cliFence
  $verifierRuntime = Get-HBAM2VerifierRuntimeContract -RepoRoot $repoRoot
  $linkedRefStream = [IO.File]::Open($linkedRefPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)

  $queryDefinitions = [ordered]@{
    '01-preflight.sql' = New-VDPostExpandPreflightSql
    '02-inventory.sql' = New-VDPostExpandInventorySql
    '03-logical-data.sql' = New-VDPostExpandLogicalSql
  }
  foreach ($entry in $queryDefinitions.GetEnumerator()) {
    $path = Join-Path $stagingDirectory $entry.Key
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes([string]$entry.Value)
    try { Write-VDPostExpandDurableExclusiveBytes -Path $path -Bytes $bytes }
    finally { [Array]::Clear($bytes, 0, $bytes.Length) }
    Assert-HBAM2ReadOnlySqlSafetyGuard -Path $path; Set-HBAM2PrivateFileAcl -Path $path
    $queryFiles += $path
  }

  $preflightJson = Invoke-VDPostExpandLinkedQuery -Cli $cliFence.InvocationPath -SqlFile $queryFiles[0] -Workdir $repoRoot -TimeoutSeconds $QueryTimeoutSeconds
  $inventoryBeforeJson = Invoke-VDPostExpandLinkedQuery -Cli $cliFence.InvocationPath -SqlFile $queryFiles[1] -Workdir $repoRoot -TimeoutSeconds $QueryTimeoutSeconds
  $dataJson = Invoke-VDPostExpandLinkedQuery -Cli $cliFence.InvocationPath -SqlFile $queryFiles[2] -Workdir $repoRoot -TimeoutSeconds $QueryTimeoutSeconds
  $inventoryAfterJson = Invoke-VDPostExpandLinkedQuery -Cli $cliFence.InvocationPath -SqlFile $queryFiles[1] -Workdir $repoRoot -TimeoutSeconds $QueryTimeoutSeconds
  foreach ($path in $queryFiles) { Remove-Item -LiteralPath $path -Force }; $queryFiles = @()

  $linkedRefStream.Position = 0
  $linkedBytes = New-Object byte[] ([int]$linkedRefStream.Length)
  try {
    if ($linkedRefStream.Read($linkedBytes, 0, $linkedBytes.Length) -ne $linkedBytes.Length -or
        [Text.Encoding]::UTF8.GetString($linkedBytes).Trim() -ne $ExpectedProjectRef) {
      throw 'Linked Production project ref changed during capture.'
    }
  } finally { [Array]::Clear($linkedBytes, 0, $linkedBytes.Length) }

  $preflight = ConvertFrom-VDPostExpandRequiredJson -Json $preflightJson -Label 'Preflight'
  $inventoryBefore = ConvertFrom-VDPostExpandRequiredJson -Json $inventoryBeforeJson -Label 'Inventory-before'
  $data = ConvertFrom-VDPostExpandRequiredJson -Json $dataJson -Label 'Logical data'
  $inventoryAfter = ConvertFrom-VDPostExpandRequiredJson -Json $inventoryAfterJson -Label 'Inventory-after'
  foreach ($pair in @(@($preflight, 'Preflight'), @($inventoryBefore, 'Inventory-before'),
      @($data, 'Logical data'), @($inventoryAfter, 'Inventory-after'))) {
    Assert-VDPostExpandSourceContract -Value $pair[0] -Label $pair[1]
  }
  if ([int]$preflight.table_count -ne 139 -or [int64]$preflight.estimated_total_bytes -lt 0 -or
      [int64]$preflight.estimated_total_bytes -gt $MaximumEstimatedSourceBytes -or
      [int64]$preflight.estimated_total_rows -lt 0 -or [int64]$preflight.estimated_total_rows -gt $MaximumEstimatedRows) {
    throw 'Preflight source size, row count, or table count exceeded its safety gate.'
  }
  foreach ($inventory in @($inventoryBefore, $inventoryAfter)) {
    foreach ($field in @('migration_versions', 'release_migration_versions', 'applied_suffix_versions',
      'columns', 'constraints', 'schema_contract', 'auth_schema_contract', 'storage_schema_contract')) {
      if (-not $inventory.PSObject.Properties[$field]) { throw "Inventory is missing $field." }
    }
    if (@($inventory.migration_versions).Count -ne 228 -or [string]@($inventory.migration_versions)[-1] -ne $script:VDPostExpandMigrationHead -or
        @($inventory.release_migration_versions).Count -ne 113 -or @($inventory.applied_suffix_versions).Count -ne 81 -or
        @($inventory.auth_schema_contract).Count -lt 1 -or @($inventory.storage_schema_contract).Count -lt 1) {
      throw 'Inventory migration/Auth/Storage contract is incomplete.'
    }
  }

  $relationDigests = @($preflight, $inventoryBefore, $data, $inventoryAfter) | ForEach-Object {
    (Get-HBAM2RelationContractSha256 -Relations $_.relations -ExpectedNames $script:VDPostExpandExpectedTables -Label 'Capture').ToLowerInvariant()
  }
  if (@($relationDigests | Select-Object -Unique).Count -ne 1) { throw 'Relation identity changed during capture.' }
  $identityDigests = @($preflight, $inventoryBefore, $data, $inventoryAfter) | ForEach-Object {
    Get-VDPostExpandCanonicalJsonSha256 -Value $_.source_database_identity
  }
  if (@($identityDigests | Select-Object -Unique).Count -ne 1) { throw 'Database/system identity changed during capture.' }
  $beforeSchema = Get-VDPostExpandCanonicalJsonSha256 -Value ([ordered]@{
    public = $inventoryBefore.schema_contract; auth = $inventoryBefore.auth_schema_contract; storage = $inventoryBefore.storage_schema_contract
  })
  $afterSchema = Get-VDPostExpandCanonicalJsonSha256 -Value ([ordered]@{
    public = $inventoryAfter.schema_contract; auth = $inventoryAfter.auth_schema_contract; storage = $inventoryAfter.storage_schema_contract
  })
  if ($beforeSchema -ne $afterSchema) { throw 'Public/Auth/Storage schema changed during capture.' }

  if (-not $data.PSObject.Properties['tables']) { throw 'Logical data has no public tables.' }
  Assert-VDPostExpandExactNames -Actual @($data.tables.PSObject.Properties.Name) -Label 'Logical data'
  $tableCounts = [ordered]@{}
  foreach ($property in @($data.tables.PSObject.Properties | Sort-Object Name)) {
    Test-VDPostExpandLogicalPart -Value $property.Value -Label "Logical table $($property.Name)"
    $tableCounts[$property.Name] = [int64]$property.Value.row_count
  }
  foreach ($name in @('auth_users', 'storage_buckets', 'storage_objects')) {
    if (-not $data.PSObject.Properties[$name]) { throw "Logical data is missing $name." }
    Test-VDPostExpandLogicalPart -Value $data.$name -Label $name
  }
  $digests = Get-VDPostExpandDataContractDigests -Inventory $inventoryAfter -Logical $data

  $times = @($preflight, $inventoryBefore, $data, $inventoryAfter) | ForEach-Object {
    Get-VDPostExpandTimestamp -Value ([string]$_.captured_at) -Label 'Capture'
  }
  for ($index = 1; $index -lt $times.Count; $index++) {
    if ($times[$index - 1] -gt $times[$index]) { throw 'Capture timestamps are out of order.' }
  }

  $backupSetId = [Guid]::NewGuid().ToString('D')
  $inventoryBytes = [Text.UTF8Encoding]::new($false).GetBytes($inventoryAfterJson)
  $dataBytes = [Text.UTF8Encoding]::new($false).GetBytes($dataJson)
  $inventoryArtifact = Protect-VDPostExpandArtifact -Plaintext $inventoryBytes -Directory $stagingDirectory `
    -ArtifactName 'schema-inventory.json' -ProjectRef $ExpectedProjectRef -BackupSetId $backupSetId
  $dataArtifact = Protect-VDPostExpandArtifact -Plaintext $dataBytes -Directory $stagingDirectory `
    -ArtifactName 'logical-data.json' -ProjectRef $ExpectedProjectRef -BackupSetId $backupSetId

  $verifierRelative = 'scripts/vendor-disclosure-db-verify-backup.ps1'
  $verifierPath = Join-Path $repoRoot $verifierRelative.Replace('/', '\')
  $verifierSha = Get-VDCurrentBaselineCanonicalTextFileSha256 -Path $verifierPath
  $cliPath = [string]$cliFence.Provenance.invocation_relative_path
  $cliSha = ([string](Get-HBAM2ObjectPropertyValue -Value $cliFence.Provenance.files -Name $cliPath)).ToLowerInvariant()
  $manifest = [ordered]@{
    status = 'complete'; format = $script:HBAM2FormatName; format_version = 2
    backup_type = 'vendor-disclosure-successor-post-expand-logical-snapshot-v2'
    backup_set_id = $backupSetId; release = $Release; backup_contract_id = $BackupContractId
    backup_contract_version = $BackupContractVersion; created_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
    source_captured_at = [string]$data.captured_at; source_project_ref = $ExpectedProjectRef
    source_database_identity = $data.source_database_identity; source_database_identity_sha256 = $identityDigests[0]
    source_migration_head = $script:VDPostExpandMigrationHead; source_migration_count = 228
    source_migration_versions_sha256 = $script:VDPostExpandMigrationVersionsSha256
    release_migration_count = 113; release_migration_versions_sha256 = $script:VDPostExpandReleaseMigrationVersionsSha256
    applied_suffix_count = 81; applied_suffix_versions_sha256 = $script:VDPostExpandAppliedSuffixVersionsSha256
    expected_tables = @($script:VDPostExpandExpectedTables); table_count = 139
    table_contract_sha256 = $script:VDPostExpandTableContractSha256
    source_relation_contract_sha256 = $relationDigests[0]
    live_schema_contract_sha256 = $digests.LiveSchemaContractSha256
    logical_data_contract_sha256 = $digests.LogicalDataContractSha256
    auth_schema_contract_sha256 = $digests.AuthSchemaContractSha256
    auth_users_contract_sha256 = $digests.AuthUsersContractSha256
    storage_metadata_contract_sha256 = $digests.StorageMetadataContractSha256
    storage_object_inventory_sha256 = $digests.StorageObjectInventorySha256
    git_commit = $ExpectedCommit; git_origin = $ExpectedGitOrigin; git_remote_ref = $RemoteRef
    implementation = $implementationFence.Provenance; supabase_cli = $cliFence.Provenance
    verifier_runtime = $verifierRuntime; verifier = [ordered]@{ file = $verifierRelative; sha256 = $verifierSha }
    source_fence = 'exact-linked-production-ref-plus-clean-pushed-commit-plus-pinned-cli'
    consistency = 'read-only-logical-data-single-statement-plus-schema-before-after'
    plaintext_written_to_disk = $false; contains_secrets = $false
    key_scope = 'Windows DPAPI CurrentUser on the creating computer'
    tables = $tableCounts; auth_users_count = [int64]$data.auth_users.row_count
    storage_buckets_count = [int64]$data.storage_buckets.row_count
    storage_objects_count = [int64]$data.storage_objects.row_count
    artifacts = [ordered]@{ schema_inventory = $inventoryArtifact; logical_data = $dataArtifact }
  }
  $manifestBytes = [Text.UTF8Encoding]::new($false).GetBytes(($manifest | ConvertTo-Json -Depth 100))
  try {
    if ($manifestBytes.Length -gt $script:HBAM2MaximumManifestBytes) { throw 'Post-expand manifest exceeds its size limit.' }
    Write-VDPostExpandDurableExclusiveBytes -Path (Join-Path $stagingDirectory 'manifest.json') -Bytes $manifestBytes
  } finally { [Array]::Clear($manifestBytes, 0, $manifestBytes.Length) }
  Set-HBAM2PrivateFileAcl -Path (Join-Path $stagingDirectory 'manifest.json')

  $files = @(Get-ChildItem -LiteralPath $stagingDirectory -File | ForEach-Object Name | Sort-Object)
  if (@(Compare-Object $ExpectedArtifactFiles $files).Count -ne 0) { throw 'Staging directory contains an unexpected artifact set.' }
  Assert-VDPostExpandImplementationFence -Fence $implementationFence
  Assert-HBAM2SupabaseCliFence -Fence $cliFence
  Assert-VDPostExpandExactPushedGitState -RepoRoot $repoRoot -ExpectedCommit $ExpectedCommit `
    -ExpectedOrigin $ExpectedGitOrigin -RemoteRef $RemoteRef
  Move-Item -LiteralPath $stagingDirectory -Destination $finalDirectory
  $movedToFinal = $true
  Sync-VDPostExpandParentDirectory -Path $finalDirectory
  $manifestSha = (Get-VDCurrentBaselineImplementationFileSha256 -Path (Join-Path $finalDirectory 'manifest.json')).ToLowerInvariant()
  $resultJson = [ordered]@{
    Status = 'post_expand_encrypted_logical_backup_captured'; BackupDirectory = $finalDirectory
    BackupSetId = $backupSetId; ManifestSha256 = $manifestSha; Release = $Release
    ProjectRef = $ExpectedProjectRef; GitCommit = $ExpectedCommit; BackupContractId = $BackupContractId
    BackupContractVersion = 2; SourceMigrationHead = $script:VDPostExpandMigrationHead
    SourceMigrationCount = 228; ReleaseMigrationCount = 113; AppliedSuffixCount = 81
    TableCount = 139; TableContractSha256 = $script:VDPostExpandTableContractSha256
    SourceDatabaseSystemIdentifier = [string]$data.source_database_identity.system_identifier
    SourceDatabaseOid = [string]$data.source_database_identity.database_oid
    LiveSchemaContractSha256 = $digests.LiveSchemaContractSha256
    LogicalDataContractSha256 = $digests.LogicalDataContractSha256
    AuthSchemaContractSha256 = $digests.AuthSchemaContractSha256
    AuthUsersContractSha256 = $digests.AuthUsersContractSha256
    StorageMetadataContractSha256 = $digests.StorageMetadataContractSha256
    StorageObjectInventorySha256 = $digests.StorageObjectInventorySha256
    SupabaseCliVersion = [string]$cliFence.Provenance.version; SupabaseCliBinarySha256 = $cliSha
    SourceCapturedAt = [string]$data.captured_at; PlaintextWrittenToDisk = $false; ContainsSecrets = $false
  } | ConvertTo-Json -Compress
  $published = $true
  Write-Output $resultJson
} catch {
  foreach ($path in $queryFiles) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
  if (-not $published -and (Test-Path -LiteralPath $stagingDirectory)) {
    Remove-VDPostExpandStagingDirectory -Path $stagingDirectory -Root $root
  }
  if (-not $published -and $movedToFinal -and (Test-Path -LiteralPath $finalDirectory)) {
    Remove-VDPostExpandFinalDirectory -Path $finalDirectory -Root $root
  }
  throw
} finally {
  if ($inventoryBytes) { [Array]::Clear($inventoryBytes, 0, $inventoryBytes.Length) }
  if ($dataBytes) { [Array]::Clear($dataBytes, 0, $dataBytes.Length) }
  if ($linkedRefStream) { $linkedRefStream.Dispose() }
  Close-HBAM2SupabaseCliFence -Fence $cliFence
  Close-VDPostExpandImplementationFence -Fence $implementationFence
  if ($captureLock) { $captureLock.Dispose() }
}
