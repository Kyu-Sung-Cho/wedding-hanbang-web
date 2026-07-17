param(
  [string] $ExpectedProjectRef,

  [string] $SupabaseCli = 'supabase',

  [ValidateRange(30, 600)]
  [int] $QueryTimeoutSeconds = 150,

  [switch] $SelfTest,

  [string] $SelfTestBackupRoot,

  [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'amora-db-current-baseline-common.ps1')

function Show-Help {
  Write-Host ''
  Write-Host 'WeddingHanbang current production baseline backup'
  Write-Host ''
  Write-Host 'Captures only the fixed 14-table pre-Amora remote baseline through four linked,'
  Write-Host 'server-side read-only queries. Schema-before, logical data, and schema-after are'
  Write-Host 'encrypted immediately with HBAM2; no plaintext payload file is created.'
  Write-Host ''
  Write-Host 'Usage:'
  Write-Host '  powershell -File scripts/amora-db-current-baseline.ps1 -ExpectedProjectRef <20-char-ref>'
  Write-Host ''
  Write-Host 'Production capture requires the baseline implementation to be committed and the'
  Write-Host 'entire Git worktree to be clean. -Help performs no database or filesystem action.'
  Write-Host ''
}

if ($Help) { Show-Help; exit 0 }
if ([string]::IsNullOrWhiteSpace($ExpectedProjectRef) -or
    $ExpectedProjectRef -notmatch '^[a-z0-9]{20}$') {
  throw '-ExpectedProjectRef must be an explicit 20-character project ref.'
}
if ($env:OS -ne 'Windows_NT') { throw 'HBAM2 baseline capture requires Windows DPAPI.' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$linkedRefPath = Join-Path $repoRoot 'supabase\.temp\project-ref'
if (-not (Test-Path -LiteralPath $linkedRefPath -PathType Leaf)) {
  throw 'Supabase is not linked in this worktree.'
}
$linkedRef = ([IO.File]::ReadAllText($linkedRefPath)).Trim()
if ($linkedRef -cne $ExpectedProjectRef) {
  throw 'Linked project ref does not match -ExpectedProjectRef.'
}

$preflightSql = Join-Path $PSScriptRoot 'sql\amora-db-current-baseline-preflight.sql'
$inventorySql = Join-Path $PSScriptRoot 'sql\amora-db-current-baseline-inventory.sql'
$dataSql = Join-Path $PSScriptRoot 'sql\amora-db-current-baseline-logical-data.sql'
foreach ($sqlFile in @($preflightSql, $inventorySql, $dataSql)) {
  if (-not (Test-Path -LiteralPath $sqlFile -PathType Leaf)) {
    throw 'A required current-baseline SQL file is missing.'
  }
  Assert-HBAM2ReadOnlySqlSafetyGuard -Path $sqlFile
}

$rootInfo = Resolve-HBAM2BackupRoot `
  -SelfTest ([bool]$SelfTest) `
  -SelfTestBackupRoot $SelfTestBackupRoot
Initialize-HBAM2BackupRoot -Root $rootInfo.Root -Anchor $rootInfo.Anchor
$root = $rootInfo.Root
$rootFull = [IO.Path]::GetFullPath($root).TrimEnd('\')
$backupSetId = [Guid]::NewGuid().ToString('D')
$finalDirectory = $null
$stagingDirectory = $null
$published = $false
$captureLock = $null
$implementationFence = $null
$cliFence = $null
$linkedRefFence = $null
$schemaBytes = $null
$dataBytes = $null

try {
  $captureLock = New-HBAM2CaptureLock -Root $root
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $finalDirectory = Join-Path $root $timestamp
  $stagingDirectory = Join-Path $root ".partial-$timestamp-$([Guid]::NewGuid().ToString('N'))"
  foreach ($candidate in @($finalDirectory, $stagingDirectory)) {
    if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($candidate)).TrimEnd('\') -cne $rootFull) {
      throw 'Baseline backup destination escaped its fixed private root.'
    }
  }
  if ([IO.Path]::GetFileName($finalDirectory) -notmatch '^\d{8}-\d{6}$' -or
      [IO.Path]::GetFileName($stagingDirectory) -notmatch '^\.partial-\d{8}-\d{6}-[a-f0-9]{32}$' -or
      (Test-Path -LiteralPath $finalDirectory)) {
    throw 'Baseline backup destination failed uniqueness validation.'
  }
  [IO.Directory]::CreateDirectory($stagingDirectory) | Out-Null
  Set-HBAM2PrivateDirectoryAcl -Path $stagingDirectory

  $implementationFence = New-HBAM2ImplementationFence `
    -RepoRoot $repoRoot `
    -SelfTest ([bool]$SelfTest)
  $cliFence = New-HBAM2SupabaseCliFence `
    -RepoRoot $repoRoot `
    -RequestedCli $SupabaseCli `
    -SelfTest ([bool]$SelfTest)
  $verifierRuntimeContract = Get-HBAM2VerifierRuntimeContract -RepoRoot $repoRoot

  foreach ($sqlFile in @($preflightSql, $inventorySql, $dataSql)) {
    Assert-HBAM2ReadOnlySqlSafetyGuard -Path $sqlFile
  }
  $linkedRefFence = [IO.File]::Open(
    $linkedRefPath,
    [IO.FileMode]::Open,
    [IO.FileAccess]::Read,
    [IO.FileShare]::Read
  )
  if ((Read-HBAM2BaselineLinkedRefFence -Stream $linkedRefFence) -cne $ExpectedProjectRef) {
    throw 'Linked project ref changed before the source fence was acquired.'
  }

  $preflightJson = Invoke-HBAM2BaselineLinkedQuery `
    -Cli $cliFence.InvocationPath `
    -SqlFile $preflightSql `
    -Workdir $repoRoot `
    -TimeoutSeconds $QueryTimeoutSeconds
  $beforeJson = Invoke-HBAM2BaselineLinkedQuery `
    -Cli $cliFence.InvocationPath `
    -SqlFile $inventorySql `
    -Workdir $repoRoot `
    -TimeoutSeconds $QueryTimeoutSeconds
  $dataJson = Invoke-HBAM2BaselineLinkedQuery `
    -Cli $cliFence.InvocationPath `
    -SqlFile $dataSql `
    -Workdir $repoRoot `
    -TimeoutSeconds $QueryTimeoutSeconds
  $afterJson = Invoke-HBAM2BaselineLinkedQuery `
    -Cli $cliFence.InvocationPath `
    -SqlFile $inventorySql `
    -Workdir $repoRoot `
    -TimeoutSeconds $QueryTimeoutSeconds

  if ((Read-HBAM2BaselineLinkedRefFence -Stream $linkedRefFence) -cne $ExpectedProjectRef) {
    throw 'Linked project ref changed while the source fence was held.'
  }
  Assert-HBAM2ImplementationFence `
    -Fence $implementationFence `
    -RepoRoot $repoRoot `
    -SelfTest ([bool]$SelfTest)
  Assert-HBAM2SupabaseCliFence -Fence $cliFence

  $preflight = ConvertFrom-HBAM2BaselineJson -Json $preflightJson -Label 'Baseline preflight'
  $before = ConvertFrom-HBAM2BaselineJson -Json $beforeJson -Label 'Schema-before inventory'
  $data = ConvertFrom-HBAM2BaselineJson -Json $dataJson -Label 'Baseline logical data'
  $after = ConvertFrom-HBAM2BaselineJson -Json $afterJson -Label 'Schema-after inventory'
  Assert-HBAM2BaselinePreflight -Preflight $preflight -ExpectedProjectRef $ExpectedProjectRef
  Assert-HBAM2BaselineInventory `
    -Inventory $before `
    -ExpectedProjectRef $ExpectedProjectRef `
    -Label 'Schema-before inventory'
  Assert-HBAM2BaselineInventory `
    -Inventory $after `
    -ExpectedProjectRef $ExpectedProjectRef `
    -Label 'Schema-after inventory'
  $tableCounts = Assert-HBAM2BaselineLogicalData `
    -Data $data `
    -ExpectedProjectRef $ExpectedProjectRef

  $preflightRelations = Get-HBAM2RelationContractSha256 `
    -Relations $preflight.tables `
    -ExpectedNames $script:HBAM2BaselineExpectedTables `
    -Label 'Baseline preflight'
  $beforeRelations = Get-HBAM2RelationContractSha256 `
    -Relations $before.schema_contract.tables `
    -ExpectedNames $script:HBAM2BaselineExpectedTables `
    -Label 'Schema-before inventory'
  $dataRelations = Get-HBAM2RelationContractSha256 `
    -Relations $data.relations `
    -ExpectedNames $script:HBAM2BaselineExpectedTables `
    -Label 'Baseline logical data'
  $afterRelations = Get-HBAM2RelationContractSha256 `
    -Relations $after.schema_contract.tables `
    -ExpectedNames $script:HBAM2BaselineExpectedTables `
    -Label 'Schema-after inventory'
  if ($preflightRelations -cne $beforeRelations -or
      $beforeRelations -cne $dataRelations -or
      $dataRelations -cne $afterRelations) {
    throw 'Baseline target relation identity changed during capture.'
  }

  $beforeContract = Get-HBAM2BaselineSchemaContractJson -Inventory $before
  $afterContract = Get-HBAM2BaselineSchemaContractJson -Inventory $after
  if ([string]$before.schema_contract_sha256 -cne [string]$after.schema_contract_sha256 -or
      $beforeContract -cne $afterContract) {
    throw 'Baseline schema changed while logical data was captured.'
  }
  if ([string]$preflight.database_name -cne [string]$before.schema_contract.database_name -or
      [string]$data.database_name -cne [string]$before.schema_contract.database_name -or
      [string]$before.current_user -cne [string]$preflight.current_user -or
      [string]$data.current_user -cne [string]$preflight.current_user -or
      [string]$after.current_user -cne [string]$preflight.current_user -or
      [string]$before.session_user -cne [string]$preflight.session_user -or
      [string]$data.session_user -cne [string]$preflight.session_user -or
      [string]$after.session_user -cne [string]$preflight.session_user) {
    throw 'Baseline queries did not use one stable database and RLS-bypass role.'
  }

  $preflightAt = ConvertTo-HBAM2BaselineTimestamp `
    -Value ([string]$preflight.captured_at) -Label 'Preflight captured_at'
  $beforeAt = ConvertTo-HBAM2BaselineTimestamp `
    -Value ([string]$before.captured_at) -Label 'Schema-before captured_at'
  $dataAt = ConvertTo-HBAM2BaselineTimestamp `
    -Value ([string]$data.captured_at) -Label 'Logical-data captured_at'
  $afterAt = ConvertTo-HBAM2BaselineTimestamp `
    -Value ([string]$after.captured_at) -Label 'Schema-after captured_at'
  if ($preflightAt -gt $beforeAt -or $beforeAt -gt $dataAt -or $dataAt -gt $afterAt) {
    throw 'Baseline timestamps violate preflight/schema-before/data/schema-after order.'
  }

  $schemaBundleJson = '{"before":' + $beforeJson + ',"after":' + $afterJson + '}'
  $schemaBytes = [Text.Encoding]::UTF8.GetBytes($schemaBundleJson)
  $dataBytes = [Text.Encoding]::UTF8.GetBytes($dataJson)
  foreach ($payload in @($schemaBytes, $dataBytes)) {
    if ($payload.Length -lt 1 -or $payload.Length -gt $script:HBAM2BaselineMaximumPayloadBytes) {
      throw 'A baseline plaintext payload is outside the in-memory encryption bound.'
    }
  }
  $schemaArtifact = Protect-HBAM2Artifact `
    -Plaintext $schemaBytes `
    -Directory $stagingDirectory `
    -ArtifactName 'schema-inventory.json' `
    -ProjectRef $ExpectedProjectRef `
    -BackupSetId $backupSetId
  $dataArtifact = Protect-HBAM2Artifact `
    -Plaintext $dataBytes `
    -Directory $stagingDirectory `
    -ArtifactName 'logical-data.json' `
    -ProjectRef $ExpectedProjectRef `
    -BackupSetId $backupSetId
  $refBytes = [Text.Encoding]::UTF8.GetBytes($ExpectedProjectRef)
  try {
    $manifest = [ordered]@{
      status = 'complete'
      format = $script:HBAM2FormatName
      format_version = 2
      baseline_contract_version = 1
      backup_set_id = $backupSetId
      backup_type = 'pre-amora-current-remote-14-table-baseline'
      excluded_ephemeral_tables = @($script:HBAM2BaselineExcludedEphemeralTables)
      ephemeral_rebuild_contract = $script:HBAM2BaselineEphemeralRebuildContract
      created_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
      preflight_captured_at = [string]$preflight.captured_at
      schema_before_captured_at = [string]$before.captured_at
      source_captured_at = [string]$data.captured_at
      schema_after_captured_at = [string]$after.captured_at
      schema_contract_sha256 = ([string]$before.schema_contract_sha256).ToUpperInvariant()
      source_migration_head = $script:HBAM2BaselineExpectedMigrationHead
      source_relation_contract_sha256 = $afterRelations
      source_project_ref = $ExpectedProjectRef
      source_project_ref_sha256 = Get-HBAM2Sha256Hex -Bytes $refBytes
      source_database = [string]$data.database_name
      source_current_user = [string]$data.current_user
      source_session_user = [string]$data.session_user
      source_role_bypasses_rls = $true
      source_row_security = 'off'
      source_transaction_read_only = 'on'
      source_fence = 'supabase-linked-project-ref-plus-explicit-workdir-plus-pinned-cli'
      consistency = 'read-only-data-single-statement-schema-before-after-fenced'
      query_timeout_seconds = $QueryTimeoutSeconds
      plaintext_written_to_disk = $false
      key_scope = 'Windows DPAPI CurrentUser on the creating computer'
      restore_contract = 'isolated-column-wise-jsonb-pglite-restoration-rehearsal'
      implementation = $implementationFence.Provenance
      supabase_cli = $cliFence.Provenance
      verifier_runtime = $verifierRuntimeContract
      preflight = [ordered]@{
        estimated_total_bytes = [int64]$preflight.estimated_total_bytes
        estimated_total_rows = [int64]$preflight.estimated_total_rows
      }
      tables = $tableCounts
      artifacts = [ordered]@{
        schema_inventory = $schemaArtifact
        logical_data = $dataArtifact
      }
    }
  } finally { [Array]::Clear($refBytes, 0, $refBytes.Length) }

  $manifestPath = Join-Path $stagingDirectory 'manifest.json'
  [IO.File]::WriteAllText(
    $manifestPath,
    ($manifest | ConvertTo-Json -Depth 30),
    [Text.UTF8Encoding]::new($false)
  )
  if ((Get-Item -LiteralPath $manifestPath).Length -gt $script:HBAM2MaximumManifestBytes) {
    throw 'Baseline manifest exceeds its size limit.'
  }
  $entries = @(Get-ChildItem -LiteralPath $stagingDirectory -Force)
  $files = @($entries | Where-Object { -not $_.PSIsContainer } | ForEach-Object Name | Sort-Object)
  if ($entries.Count -ne $script:HBAM2BaselineExpectedFiles.Count -or
      @(Compare-Object -ReferenceObject $script:HBAM2BaselineExpectedFiles -DifferenceObject $files -CaseSensitive).Count -ne 0) {
    throw 'Baseline staging directory contains an unexpected artifact set.'
  }
  Assert-HBAM2PrivateDirectoryAcl -Path $stagingDirectory
  foreach ($file in $script:HBAM2BaselineExpectedFiles) {
    Assert-HBAM2PrivateFileAcl -Path (Join-Path $stagingDirectory $file)
  }
  Move-Item -LiteralPath $stagingDirectory -Destination $finalDirectory
  $published = $true
  Assert-HBAM2PrivateDirectoryAcl -Path $finalDirectory
  foreach ($file in $script:HBAM2BaselineExpectedFiles) {
    Assert-HBAM2PrivateFileAcl -Path (Join-Path $finalDirectory $file)
  }
  $manifestBytes = Read-HBAM2BoundedFileBytes `
    -Path (Join-Path $finalDirectory 'manifest.json') `
    -MaximumBytes $script:HBAM2MaximumManifestBytes
  try { $manifestHash = Get-HBAM2Sha256Hex -Bytes $manifestBytes }
  finally { [Array]::Clear($manifestBytes, 0, $manifestBytes.Length) }

  [pscustomobject]@{
    BackupDirectory = $finalDirectory
    BackupSetId = $backupSetId
    ManifestSha256 = $manifestHash
      SchemaContractSha256 = ([string]$before.schema_contract_sha256).ToUpperInvariant()
      SourceMigrationHead = $script:HBAM2BaselineExpectedMigrationHead
      ExcludedEphemeralTableCount = $script:HBAM2BaselineExcludedEphemeralTables.Count
      EphemeralRebuildContract = $script:HBAM2BaselineEphemeralRebuildContract
    SourceRelationContractSha256 = $afterRelations
    GitCommit = [string]$implementationFence.Provenance.git_commit
    SupabaseCliVersion = [string]$cliFence.Provenance.version
    PreflightCapturedAt = [string]$preflight.captured_at
    SchemaBeforeCapturedAt = [string]$before.captured_at
    SourceCapturedAt = [string]$data.captured_at
    SchemaAfterCapturedAt = [string]$after.captured_at
    TableCount = $tableCounts.Count
    TotalRows = [int64](($tableCounts.Values | Measure-Object -Sum).Sum)
    PlaintextWrittenToDisk = $false
  } | ConvertTo-Json -Compress
} catch {
  foreach ($candidate in @($stagingDirectory, $(if ($published) { $finalDirectory } else { $null }))) {
    if ([string]::IsNullOrWhiteSpace([string]$candidate)) { continue }
    $full = [IO.Path]::GetFullPath([string]$candidate)
    $name = [IO.Path]::GetFileName($full)
    if ((Test-Path -LiteralPath $full) -and
        [IO.Path]::GetDirectoryName($full).TrimEnd('\') -ceq $rootFull -and
        ($name -match '^\d{8}-\d{6}$' -or
         $name -match '^\.partial-\d{8}-\d{6}-[a-f0-9]{32}$')) {
      Remove-Item -LiteralPath $full -Recurse -Force
    }
  }
  throw
} finally {
  Close-HBAM2SupabaseCliFence -Fence $cliFence
  Close-HBAM2ImplementationFence -Fence $implementationFence
  if ($linkedRefFence) { $linkedRefFence.Dispose() }
  if ($schemaBytes) { [Array]::Clear($schemaBytes, 0, $schemaBytes.Length) }
  if ($dataBytes) { [Array]::Clear($dataBytes, 0, $dataBytes.Length) }
  if ($captureLock) { $captureLock.Dispose() }
}
