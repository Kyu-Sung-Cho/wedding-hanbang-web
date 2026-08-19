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

  [ValidateRange(30, 600)]
  [int] $QueryTimeoutSeconds = 150,

  [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'vendor-disclosure-db-current-baseline-common.ps1')

$MaximumEstimatedSourceBytes = 268435456
$MaximumEstimatedRows = 500000
$ExpectedArtifactFiles = @(
  'logical-data.json.hbam2',
  'logical-data.json.key.dpapi',
  'manifest.json',
  'schema-inventory.json.hbam2',
  'schema-inventory.json.key.dpapi'
)

function Show-Help {
  Write-Host 'Vendor-disclosure successor current-Production logical backup'
  Write-Host ''
  Write-Host 'Captures the exact 60-table / 147-migration Production baseline through four'
  Write-Host 'linked read-only queries, encrypts payload bytes in memory with HBAM2 + DPAPI,'
  Write-Host 'and publishes only ciphertext, protected keys, and a non-secret manifest.'
  Write-Host ''
  Write-Host 'Production requires explicit release, commit, origin, pushed remote branch,'
  Write-Host 'backup contract, and pinned Supabase CLI anchors. -Help performs no I/O.'
}

function ConvertTo-VDNativeArgument {
  param([Parameter(Mandatory = $true)] [string] $Value)
  if ($Value.Contains('"') -or $Value.Contains("`r") -or $Value.Contains("`n")) {
    throw 'Native process argument contains an unsupported character.'
  }
  return '"' + $Value + '"'
}

function New-VDCurrentBaselineLinkedQuery {
  param(
    [Parameter(Mandatory = $true)] [string] $Cli,
    [Parameter(Mandatory = $true)] [string] $SqlFile,
    [Parameter(Mandatory = $true)] [string] $Workdir,
    [Parameter(Mandatory = $true)] [int] $TimeoutSeconds
  )

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $Cli
  $startInfo.Arguments = (@(
    'db', 'query', '--linked', '--workdir', $Workdir,
    '--output', 'json', '--file', $SqlFile
  ) | ForEach-Object { ConvertTo-VDNativeArgument -Value $_ }) -join ' '
  $startInfo.WorkingDirectory = $Workdir
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start the fenced Supabase query.' }
  try {
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null
      throw "Supabase linked read-only query exceeded $TimeoutSeconds seconds."
    }
    $process.WaitForExit()
    $raw = $stdoutTask.Result.Trim()
    $null = $stderrTask.Result
    if ($process.ExitCode -ne 0) {
      throw "Supabase linked read-only query failed with exit code $($process.ExitCode)."
    }
  } finally { $process.Dispose() }

  if ([string]::IsNullOrWhiteSpace($raw) -or
      [Text.Encoding]::UTF8.GetByteCount($raw) -gt ($script:HBAM2MaximumPayloadBytes + 1048576)) {
    throw 'Supabase query response is missing or oversized.'
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

function ConvertFrom-VDRequiredJson {
  param(
    [Parameter(Mandatory = $true)] [string] $Json,
    [Parameter(Mandatory = $true)] [string] $Label
  )
  try { return $Json | ConvertFrom-Json }
  catch { throw "$Label payload is not valid JSON." }
}

function Get-VDTimestamp {
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
  } catch { throw "$Label timestamp is invalid." }
}

function Assert-VDSupabaseCliContract {
  param([Parameter(Mandatory = $true)] $Fence)

  $path = [string]$Fence.Provenance.invocation_relative_path
  $binaryHash = [string](Get-HBAM2ObjectPropertyValue -Value $Fence.Provenance.files -Name $path)
  if ([string]$Fence.Provenance.version -ne $ExpectedSupabaseCliVersion -or
      $binaryHash -ne $ExpectedSupabaseCliBinarySha256) {
    throw 'Installed Supabase CLI differs from the exact release backup contract.'
  }
}

function Remove-VDCurrentBaselineStagingDirectory {
  param(
    [Parameter(Mandatory = $true)] [string] $Path,
    [Parameter(Mandatory = $true)] [string] $Root
  )
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $parent = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  if ([IO.Path]::GetDirectoryName($full).TrimEnd('\') -ne $parent -or
      [IO.Path]::GetFileName($full) -notmatch '^\.partial-\d{8}-\d{6}-[a-f0-9]{32}$') {
    throw 'Refusing cleanup outside the exact current-baseline staging directory.'
  }
  if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
}

if ($Help) { Show-Help; exit 0 }
if ($env:OS -ne 'Windows_NT') { throw 'HBAM2 current-baseline backup requires Windows DPAPI.' }
if ($ExpectedProjectRef -ne $script:VDCurrentBaselineProjectRef) {
  throw 'Backup is pinned to the exact Production project ref.'
}
if ($Release -notmatch '^[a-z][a-z0-9-]{2,80}$' -or
    $BackupContractId -ne "pre-$Release-current-remote-backup" -or
    $BackupContractVersion -ne 2 -or
    $ExpectedSupabaseCliVersion -notmatch '^\d+\.\d+\.\d+$' -or
    $ExpectedSupabaseCliBinarySha256 -notmatch '^[A-F0-9]{64}$') {
  throw 'Release backup contract arguments are invalid.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$linkedRefPath = Join-Path $repoRoot 'supabase\.temp\project-ref'
if (-not (Test-Path -LiteralPath $linkedRefPath -PathType Leaf) -or
    ([IO.File]::ReadAllText($linkedRefPath)).Trim() -ne $script:VDCurrentBaselineProjectRef) {
  throw 'This worktree is not linked to the exact Production project.'
}

Assert-VDCurrentBaselineExactPushedGitState -RepoRoot $repoRoot `
  -ExpectedCommit $ExpectedCommit -ExpectedOrigin $ExpectedGitOrigin -RemoteRef $RemoteRef

$rootInfo = Resolve-HBAM2BackupRoot -SelfTest $false
Initialize-HBAM2BackupRoot -Root $rootInfo.Root -Anchor $rootInfo.Anchor
$root = $rootInfo.Root
$parent = [IO.Path]::GetFullPath($root).TrimEnd('\')
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$finalDirectory = Join-Path $root $timestamp
$stagingDirectory = Join-Path $root ".partial-$timestamp-$([Guid]::NewGuid().ToString('N'))"
if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($finalDirectory)).TrimEnd('\') -ne $parent -or
    [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($stagingDirectory)).TrimEnd('\') -ne $parent -or
    [IO.Path]::GetFileName($finalDirectory) -notmatch '^\d{8}-\d{6}$' -or
    [IO.Path]::GetFileName($stagingDirectory) -notmatch '^\.partial-\d{8}-\d{6}-[a-f0-9]{32}$' -or
    (Test-Path -LiteralPath $finalDirectory)) {
  throw 'Backup destination failed exact containment or uniqueness checks.'
}

$captureLock = $null
$implementationFence = $null
$cliFence = $null
$linkedRefStream = $null
$inventoryBytes = $null
$dataBytes = $null
$published = $false
$queryFiles = @()
try {
  $captureLock = New-HBAM2CaptureLock -Root $root
  [IO.Directory]::CreateDirectory($stagingDirectory) | Out-Null
  Set-HBAM2PrivateDirectoryAcl -Path $stagingDirectory

  $implementationFence = New-VDCurrentBaselineImplementationFence `
    -RepoRoot $repoRoot -ExpectedCommit $ExpectedCommit
  $cliFence = New-HBAM2SupabaseCliFence `
    -RepoRoot $repoRoot -RequestedCli $SupabaseCli -SelfTest $false
  Assert-VDSupabaseCliContract -Fence $cliFence
  $verifierRuntime = Get-HBAM2VerifierRuntimeContract -RepoRoot $repoRoot

  $linkedRefStream = [IO.File]::Open(
    $linkedRefPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read
  )
  $linkedBytes = New-Object byte[] ([int]$linkedRefStream.Length)
  [void]$linkedRefStream.Read($linkedBytes, 0, $linkedBytes.Length)
  try {
    if ([Text.Encoding]::UTF8.GetString($linkedBytes).Trim() -ne $ExpectedProjectRef) {
      throw 'Linked Production project ref changed before capture.'
    }
  } finally { [Array]::Clear($linkedBytes, 0, $linkedBytes.Length) }

  $queryDefinitions = [ordered]@{
    '01-preflight.sql' = New-VDCurrentBaselinePreflightSql
    '02-inventory.sql' = New-VDCurrentBaselineInventorySql
    '03-logical-data.sql' = New-VDCurrentBaselineLogicalSql
  }
  foreach ($entry in $queryDefinitions.GetEnumerator()) {
    $path = Join-Path $stagingDirectory $entry.Key
    [IO.File]::WriteAllText($path, [string]$entry.Value, [Text.UTF8Encoding]::new($false))
    Assert-HBAM2ReadOnlySqlSafetyGuard -Path $path
    Assert-HBAM2PrivateFileAcl -Path $path
    $queryFiles += $path
  }

  $preflightJson = New-VDCurrentBaselineLinkedQuery -Cli $cliFence.InvocationPath `
    -SqlFile $queryFiles[0] -Workdir $repoRoot -TimeoutSeconds $QueryTimeoutSeconds
  $inventoryBeforeJson = New-VDCurrentBaselineLinkedQuery -Cli $cliFence.InvocationPath `
    -SqlFile $queryFiles[1] -Workdir $repoRoot -TimeoutSeconds $QueryTimeoutSeconds
  $dataJson = New-VDCurrentBaselineLinkedQuery -Cli $cliFence.InvocationPath `
    -SqlFile $queryFiles[2] -Workdir $repoRoot -TimeoutSeconds $QueryTimeoutSeconds
  $inventoryAfterJson = New-VDCurrentBaselineLinkedQuery -Cli $cliFence.InvocationPath `
    -SqlFile $queryFiles[1] -Workdir $repoRoot -TimeoutSeconds $QueryTimeoutSeconds

  foreach ($path in $queryFiles) { Remove-Item -LiteralPath $path -Force }
  $queryFiles = @()

  $linkedRefStream.Position = 0
  $linkedBytes = New-Object byte[] ([int]$linkedRefStream.Length)
  [void]$linkedRefStream.Read($linkedBytes, 0, $linkedBytes.Length)
  try {
    if ([Text.Encoding]::UTF8.GetString($linkedBytes).Trim() -ne $ExpectedProjectRef) {
      throw 'Linked Production project ref changed during capture.'
    }
  } finally { [Array]::Clear($linkedBytes, 0, $linkedBytes.Length) }

  $preflight = ConvertFrom-VDRequiredJson -Json $preflightJson -Label 'Preflight'
  $inventoryBefore = ConvertFrom-VDRequiredJson -Json $inventoryBeforeJson -Label 'Inventory-before'
  $data = ConvertFrom-VDRequiredJson -Json $dataJson -Label 'Logical data'
  $inventoryAfter = ConvertFrom-VDRequiredJson -Json $inventoryAfterJson -Label 'Inventory-after'
  foreach ($pair in @(
    @($preflight, 'Preflight'),
    @($inventoryBefore, 'Inventory-before'),
    @($data, 'Logical data'),
    @($inventoryAfter, 'Inventory-after')
  )) {
    Assert-VDCurrentBaselineSourceContract -Value $pair[0] -Label $pair[1]
  }
  if ([int]$preflight.table_count -ne 60 -or
      [int64]$preflight.estimated_total_bytes -lt 0 -or
      [int64]$preflight.estimated_total_bytes -gt $MaximumEstimatedSourceBytes -or
      [int64]$preflight.estimated_total_rows -lt 0 -or
      [int64]$preflight.estimated_total_rows -gt $MaximumEstimatedRows) {
    throw 'Preflight source size, row count, or table count exceeded its safety gate.'
  }
  foreach ($inventory in @($inventoryBefore, $inventoryAfter)) {
    foreach ($field in @(
      'migration_versions', 'columns', 'constraints', 'schema_contract',
      'auth_schema_contract'
    )) {
      if (-not $inventory.PSObject.Properties[$field]) { throw "Inventory is missing $field." }
    }
    if (@($inventory.migration_versions).Count -ne $script:VDCurrentBaselineMigrationCount -or
        [string]@($inventory.migration_versions)[-1] -ne $script:VDCurrentBaselineMigrationHead) {
      throw 'Inventory migration history is not the exact 147-version Production baseline.'
    }
  }

  $preflightRelationSha = (Get-HBAM2RelationContractSha256 -Relations $preflight.relations `
    -ExpectedNames $script:VDCurrentBaselineExpectedTables -Label 'Preflight').ToLowerInvariant()
  $beforeRelationSha = (Get-HBAM2RelationContractSha256 -Relations $inventoryBefore.relations `
    -ExpectedNames $script:VDCurrentBaselineExpectedTables -Label 'Inventory-before').ToLowerInvariant()
  $dataRelationSha = (Get-HBAM2RelationContractSha256 -Relations $data.relations `
    -ExpectedNames $script:VDCurrentBaselineExpectedTables -Label 'Logical data').ToLowerInvariant()
  $afterRelationSha = (Get-HBAM2RelationContractSha256 -Relations $inventoryAfter.relations `
    -ExpectedNames $script:VDCurrentBaselineExpectedTables -Label 'Inventory-after').ToLowerInvariant()
  if (@(@($preflightRelationSha, $beforeRelationSha, $dataRelationSha, $afterRelationSha) |
      Select-Object -Unique).Count -ne 1) {
    throw 'Relation identity or inheritance shape changed during capture.'
  }

  $beforeInventorySha = Get-VDCurrentBaselineInventorySha256 -Inventory $inventoryBefore
  $afterInventorySha = Get-VDCurrentBaselineInventorySha256 -Inventory $inventoryAfter
  $beforeLiveSchemaSha = Get-VDCurrentBaselineCanonicalJsonSha256 -Value $inventoryBefore.schema_contract
  $afterLiveSchemaSha = Get-VDCurrentBaselineCanonicalJsonSha256 -Value $inventoryAfter.schema_contract
  $sourceIdentitySha = Get-VDCurrentBaselineCanonicalJsonSha256 -Value $data.source_database_identity
  if ($beforeInventorySha -ne $afterInventorySha -or
      $beforeLiveSchemaSha -ne $afterLiveSchemaSha -or
      (Get-VDCurrentBaselineCanonicalJsonSha256 -Value $preflight.source_database_identity) -ne $sourceIdentitySha -or
      (Get-VDCurrentBaselineCanonicalJsonSha256 -Value $inventoryBefore.source_database_identity) -ne $sourceIdentitySha -or
      (Get-VDCurrentBaselineCanonicalJsonSha256 -Value $inventoryAfter.source_database_identity) -ne $sourceIdentitySha) {
    throw 'Schema or source database/system identity changed during capture.'
  }

  if (-not $data.PSObject.Properties['tables']) { throw 'Logical data has no tables object.' }
  $dataNames = @($data.tables.PSObject.Properties.Name | Sort-Object)
  Assert-VDCurrentBaselineExactNames -Actual $dataNames -Label 'Logical data'
  $tableCounts = [ordered]@{}
  foreach ($property in @($data.tables.PSObject.Properties | Sort-Object Name)) {
    if (-not $property.Value.PSObject.Properties['row_count'] -or
        -not $property.Value.PSObject.Properties['rows'] -or
        -not $property.Value.PSObject.Properties['canonical_sha256'] -or
        [string]$property.Value.canonical_sha256 -notmatch '^[a-f0-9]{64}$') {
      throw "Logical data metadata is invalid for $($property.Name)."
    }
    $rowCount = [int64]$property.Value.row_count
    if ($rowCount -ne @($property.Value.rows).Count) {
      throw "Logical data row count is inconsistent for $($property.Name)."
    }
    $tableCounts[$property.Name] = $rowCount
  }
  $logicalDataSha = (Get-HBAM2LogicalDataContractSha256 -Tables $data.tables `
    -ExpectedNames $script:VDCurrentBaselineExpectedTables -Label 'Logical data').ToLowerInvariant()
  $authContracts = Get-VDCurrentBaselineAuthContractDigests `
    -Inventory $inventoryAfter -Logical $data -Label 'Logical data'
  $authSchemaSha = [string]$authContracts.AuthSchemaContractSha256
  $authUsersCanonicalSha = [string]$authContracts.AuthUsersCanonicalSha256
  $authUsersContractSha = [string]$authContracts.AuthUsersContractSha256
  $authUsersRowCount = [int64]$authContracts.AuthUsersRowCount

  $preflightAt = Get-VDTimestamp -Value ([string]$preflight.captured_at) -Label 'Preflight'
  $beforeAt = Get-VDTimestamp -Value ([string]$inventoryBefore.captured_at) -Label 'Inventory-before'
  $dataAt = Get-VDTimestamp -Value ([string]$data.captured_at) -Label 'Logical data'
  $afterAt = Get-VDTimestamp -Value ([string]$inventoryAfter.captured_at) -Label 'Inventory-after'
  if ($preflightAt -gt $beforeAt -or $beforeAt -gt $dataAt -or $dataAt -gt $afterAt) {
    throw 'Capture timestamps violate preflight/inventory/data/inventory order.'
  }

  $backupSetId = [Guid]::NewGuid().ToString('D')
  $inventoryBytes = [Text.Encoding]::UTF8.GetBytes($inventoryAfterJson)
  $dataBytes = [Text.Encoding]::UTF8.GetBytes($dataJson)
  $inventoryArtifact = Protect-HBAM2Artifact -Plaintext $inventoryBytes `
    -Directory $stagingDirectory -ArtifactName 'schema-inventory.json' `
    -ProjectRef $ExpectedProjectRef -BackupSetId $backupSetId
  $dataArtifact = Protect-HBAM2Artifact -Plaintext $dataBytes `
    -Directory $stagingDirectory -ArtifactName 'logical-data.json' `
    -ProjectRef $ExpectedProjectRef -BackupSetId $backupSetId

  $verifierRelative = 'scripts/vendor-disclosure-db-current-baseline-verify.ps1'
  $verifierPath = Join-Path $repoRoot $verifierRelative.Replace('/', '\')
  $verifierSha = Get-VDCurrentBaselineCanonicalTextFileSha256 -Path $verifierPath
  $cliBinaryPath = [string]$cliFence.Provenance.invocation_relative_path
  $cliBinarySha = [string](Get-HBAM2ObjectPropertyValue `
    -Value $cliFence.Provenance.files -Name $cliBinaryPath)
  $projectRefSha = Get-VDCurrentBaselineUtf8Sha256Lower -Value $ExpectedProjectRef
  $createdAt = [DateTimeOffset]::UtcNow.ToString('o')
  $manifest = [ordered]@{
    status = 'complete'
    format = $script:HBAM2FormatName
    format_version = 2
    backup_type = 'vendor-disclosure-successor-current-production-logical-snapshot'
    backup_set_id = $backupSetId
    release = $Release
    backup_contract_id = $BackupContractId
    backup_contract_version = $BackupContractVersion
    created_at_utc = $createdAt
    preflight_captured_at = [string]$preflight.captured_at
    inventory_before_captured_at = [string]$inventoryBefore.captured_at
    source_captured_at = [string]$data.captured_at
    inventory_after_captured_at = [string]$inventoryAfter.captured_at
    source_project_ref = $ExpectedProjectRef
    source_project_ref_sha256 = $projectRefSha
    source_database_identity = $data.source_database_identity
    source_database_identity_sha256 = $sourceIdentitySha
    source_current_user = [string]$data.current_user
    source_session_user = [string]$data.session_user
    source_role_bypasses_rls = $true
    source_row_security = 'off'
    source_migration_head = $script:VDCurrentBaselineMigrationHead
    source_migration_count = $script:VDCurrentBaselineMigrationCount
    source_migration_versions_sha256 = $script:VDCurrentBaselineMigrationVersionsSha256
    expected_tables = @($script:VDCurrentBaselineExpectedTables)
    table_count = 60
    table_contract_sha256 = $script:VDCurrentBaselineTableContractSha256
    inventory_contract_sha256 = $afterInventorySha
    source_relation_contract_sha256 = $afterRelationSha
    live_schema_contract_sha256 = $afterLiveSchemaSha
    logical_data_contract_sha256 = $logicalDataSha
    auth_schema_contract_sha256 = $authSchemaSha
    auth_users_canonical_sha256 = $authUsersCanonicalSha
    auth_users_contract_sha256 = $authUsersContractSha
    auth_users_row_count = $authUsersRowCount
    git_commit = $ExpectedCommit
    git_origin = $ExpectedGitOrigin
    git_remote_ref = $RemoteRef
    implementation = $implementationFence.Provenance
    supabase_cli = $cliFence.Provenance
    verifier_runtime = $verifierRuntime
    verifier = [ordered]@{ file = $verifierRelative; sha256 = $verifierSha }
    source_fence = 'exact-linked-production-ref-plus-clean-pushed-commit-plus-pinned-cli'
    consistency = 'logical-data-single-statement-schema-before-after-fenced'
    query_timeout_seconds = $QueryTimeoutSeconds
    plaintext_written_to_disk = $false
    contains_secrets = $false
    key_scope = 'Windows DPAPI CurrentUser on the creating computer'
    preflight = [ordered]@{
      estimated_total_bytes = [int64]$preflight.estimated_total_bytes
      estimated_total_rows = [int64]$preflight.estimated_total_rows
    }
    tables = $tableCounts
    artifacts = [ordered]@{
      schema_inventory = $inventoryArtifact
      logical_data = $dataArtifact
    }
  }

  $manifestPath = Join-Path $stagingDirectory 'manifest.json'
  [IO.File]::WriteAllText(
    $manifestPath,
    ($manifest | ConvertTo-Json -Depth 100),
    [Text.UTF8Encoding]::new($false)
  )
  Set-HBAM2PrivateFileAcl -Path $manifestPath
  if ((Get-Item -LiteralPath $manifestPath).Length -gt $script:HBAM2MaximumManifestBytes) {
    throw 'Current-baseline manifest exceeds its size limit.'
  }

  $entries = @(Get-ChildItem -LiteralPath $stagingDirectory -Force)
  $files = @($entries | Where-Object { -not $_.PSIsContainer } | ForEach-Object Name | Sort-Object)
  if ($entries.Count -ne $ExpectedArtifactFiles.Count -or
      @(Compare-Object -ReferenceObject $ExpectedArtifactFiles -DifferenceObject $files).Count -ne 0) {
    throw 'Staging directory contains an unexpected artifact set.'
  }
  Assert-VDCurrentBaselineImplementationFence -Fence $implementationFence
  Assert-HBAM2SupabaseCliFence -Fence $cliFence
  Assert-VDCurrentBaselineExactPushedGitState -RepoRoot $repoRoot `
    -ExpectedCommit $ExpectedCommit -ExpectedOrigin $ExpectedGitOrigin -RemoteRef $RemoteRef

  Assert-HBAM2PrivateDirectoryAcl -Path $stagingDirectory
  foreach ($file in $ExpectedArtifactFiles) {
    Assert-HBAM2PrivateFileAcl -Path (Join-Path $stagingDirectory $file)
  }
  Move-Item -LiteralPath $stagingDirectory -Destination $finalDirectory
  $published = $true
  Assert-HBAM2PrivateDirectoryAcl -Path $finalDirectory
  foreach ($file in $ExpectedArtifactFiles) {
    Assert-HBAM2PrivateFileAcl -Path (Join-Path $finalDirectory $file)
  }

  $manifestSha = Get-VDCurrentBaselineImplementationFileSha256 `
    -Path (Join-Path $finalDirectory 'manifest.json')
  [pscustomobject]@{
    Status = 'current_production_encrypted_logical_backup_captured'
    BackupDirectory = $finalDirectory
    BackupSetId = $backupSetId
    ManifestSha256 = $manifestSha
    Release = $Release
    ProjectRef = $ExpectedProjectRef
    GitCommit = $ExpectedCommit
    GitOrigin = $ExpectedGitOrigin
    BackupContractId = $BackupContractId
    BackupContractVersion = $BackupContractVersion
    SourceMigrationHead = $script:VDCurrentBaselineMigrationHead
    SourceMigrationCount = $script:VDCurrentBaselineMigrationCount
    TableCount = 60
    TableContractSha256 = $script:VDCurrentBaselineTableContractSha256
    InventorySha256 = $afterInventorySha
    SourceDatabaseIdentitySha256 = $sourceIdentitySha
    LiveSchemaContractSha256 = $afterLiveSchemaSha
    LogicalDataContractSha256 = $logicalDataSha
    AuthSchemaContractSha256 = $authSchemaSha
    AuthUsersCanonicalSha256 = $authUsersCanonicalSha
    AuthUsersContractSha256 = $authUsersContractSha
    AuthUsersRowCount = $authUsersRowCount
    SupabaseCliVersion = [string]$cliFence.Provenance.version
    SupabaseCliBinarySha256 = $cliBinarySha
    VerifierFile = $verifierRelative
    VerifierSha256 = $verifierSha
    SourceCapturedAt = [string]$data.captured_at
    PlaintextWrittenToDisk = $false
    ContainsSecrets = $false
  } | ConvertTo-Json -Compress
} catch {
  foreach ($path in $queryFiles) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
  }
  if (-not $published -and (Test-Path -LiteralPath $stagingDirectory)) {
    Remove-VDCurrentBaselineStagingDirectory -Path $stagingDirectory -Root $root
  }
  throw
} finally {
  if ($inventoryBytes) { [Array]::Clear($inventoryBytes, 0, $inventoryBytes.Length) }
  if ($dataBytes) { [Array]::Clear($dataBytes, 0, $dataBytes.Length) }
  if ($linkedRefStream) { $linkedRefStream.Dispose() }
  Close-HBAM2SupabaseCliFence -Fence $cliFence
  Close-VDCurrentBaselineImplementationFence -Fence $implementationFence
  if ($captureLock) { $captureLock.Dispose() }
}
