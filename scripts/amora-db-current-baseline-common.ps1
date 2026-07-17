Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'amora-db-backup-common.ps1')

$script:HBAM2BaselineMaximumEstimatedSourceBytes = 8388608
$script:HBAM2BaselineMaximumEstimatedRows = 100000
$script:HBAM2BaselineMaximumPayloadBytes = 16777216
$script:HBAM2BaselineExpectedMigrationHead = '20260715210000'
$script:HBAM2BaselineExpectedSchemaContractSha256 = 'CE2A4D55024571C9491274F796C509384681D8026336573334C4BCA199EC6CE3'
$script:HBAM2BaselineExpectedTables = @(
  'ai_interactions_log',
  'amora_actions',
  'amora_chat_request_claims',
  'amora_couple_profiles',
  'amora_tool_executions',
  'amora_turn_counters',
  'chat_feedback',
  'chat_messages',
  'chat_summaries',
  'couples',
  'decision_nodes',
  'profiles',
  'vendor_reviews',
  'wedding_journeys'
)
$script:HBAM2BaselineExcludedEphemeralTables = @(
  'production_release_lease_20260717',
  'rate_limit_buckets'
)
$script:HBAM2BaselineEphemeralRebuildContract =
  'production_release_lease_20260717=temporary-release-control-dropped-by-paired-write-fence-finalizer;rate_limit_buckets=empty-on-restore-recreated-by-public.check_rate_limit(text,integer,integer)'
$script:HBAM2BaselineExpectedFiles = @(
  'logical-data.json.hbam2',
  'logical-data.json.key.dpapi',
  'manifest.json',
  'schema-inventory.json.hbam2',
  'schema-inventory.json.key.dpapi'
)

function Get-HBAM2ImplementationRelativePaths {
  return @(
    'apps/web/scripts/amora-db-current-baseline-restore.mjs',
    'apps/web/package.json',
    'package.json',
    'pnpm-lock.yaml',
    'scripts/amora-db-backup-common.ps1',
    'scripts/amora-db-current-baseline-common.ps1',
    'scripts/amora-db-current-baseline.ps1',
    'scripts/amora-db-current-baseline-verify.ps1',
    'scripts/provenance/amora-verifier-runtime.json',
    'scripts/sql/amora-db-current-baseline-inventory.sql',
    'scripts/sql/amora-db-current-baseline-logical-data.sql',
    'scripts/sql/amora-db-current-baseline-preflight.sql'
  )
}

function ConvertTo-HBAM2BaselineNativeProcessArgument {
  param([Parameter(Mandatory = $true)] [string] $Value)

  if ($Value.Contains('"') -or $Value.Contains("`r") -or $Value.Contains("`n")) {
    throw 'Native process argument contains an unsupported character.'
  }
  return '"' + $Value + '"'
}

function Invoke-HBAM2BaselineLinkedQuery {
  param(
    [Parameter(Mandatory = $true)] [string] $Cli,
    [Parameter(Mandatory = $true)] [string] $SqlFile,
    [Parameter(Mandatory = $true)] [string] $Workdir,
    [Parameter(Mandatory = $true)] [int] $TimeoutSeconds
  )

  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Cli
  $startInfo.Arguments = (@(
    'db', 'query', '--linked', '--workdir', $Workdir,
    '--output', 'json', '--file', $SqlFile
  ) | ForEach-Object { ConvertTo-HBAM2BaselineNativeProcessArgument -Value $_ }) -join ' '
  $startInfo.WorkingDirectory = $Workdir
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start the fenced Supabase query process.' }
  try {
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null
      throw "Supabase read-only query exceeded $TimeoutSeconds seconds."
    }
    $process.WaitForExit()
    $raw = $stdoutTask.Result.Trim()
    $null = $stderrTask.Result
    if ($process.ExitCode -ne 0) {
      throw "Supabase read-only query failed with exit code $($process.ExitCode)."
    }
  } finally { $process.Dispose() }

  if ([string]::IsNullOrWhiteSpace($raw) -or
      [Text.Encoding]::UTF8.GetByteCount($raw) -gt ($script:HBAM2BaselineMaximumPayloadBytes + 1048576)) {
    throw 'Supabase query response is empty or exceeds the baseline size bound.'
  }
  try { $response = $raw | ConvertFrom-Json }
  catch { throw 'Supabase query returned invalid JSON.' }
  $rows = @($response.rows)
  if ($rows.Count -ne 1 -or -not $rows[0].PSObject.Properties['payload']) {
    throw 'Supabase query returned an unexpected response shape.'
  }
  if (-not $rows[0].PSObject.Properties['payload_bytes'] -or
      [int64]$rows[0].payload_bytes -lt 1 -or
      [int64]$rows[0].payload_bytes -gt $script:HBAM2BaselineMaximumPayloadBytes) {
    throw 'Supabase query payload is outside the baseline size bound.'
  }
  $payload = [string]$rows[0].payload
  if ([string]::IsNullOrWhiteSpace($payload)) {
    throw 'Supabase query was rejected by its server-side baseline gate.'
  }
  return $payload
}

function ConvertFrom-HBAM2BaselineJson {
  param(
    [Parameter(Mandatory = $true)] [string] $Json,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  try { return $Json | ConvertFrom-Json }
  catch { throw "$Label is not valid JSON." }
}

function ConvertTo-HBAM2BaselineTimestamp {
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

function Read-HBAM2BaselineLinkedRefFence {
  param([Parameter(Mandatory = $true)] [IO.FileStream] $Stream)

  $Stream.Position = 0
  $reader = [IO.StreamReader]::new($Stream, [Text.Encoding]::UTF8, $true, 1024, $true)
  try { return $reader.ReadToEnd().Trim() }
  finally { $reader.Dispose() }
}

function Assert-HBAM2BaselineExactNames {
  param(
    [Parameter(Mandatory = $true)] [string[]] $Actual,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  $expected = @($script:HBAM2BaselineExpectedTables | Sort-Object)
  $sortedActual = @($Actual | Sort-Object)
  if ($sortedActual.Count -ne $expected.Count -or
      @(Compare-Object -ReferenceObject $expected -DifferenceObject $sortedActual -CaseSensitive).Count -ne 0) {
    throw "$Label table allowlist mismatch."
  }
}

function Assert-HBAM2BaselineExecutionEnvelope {
  param(
    [Parameter(Mandatory = $true)] $Payload,
    [Parameter(Mandatory = $true)] [string] $ExpectedProjectRef,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  foreach ($field in @(
    'captured_at', 'source_project_ref', 'current_user', 'session_user',
    'current_role_bypasses_rls', 'row_security', 'transaction_read_only'
  )) {
    if (-not $Payload.PSObject.Properties[$field]) { throw "$Label is missing $field." }
  }
  [void](ConvertTo-HBAM2BaselineTimestamp -Value ([string]$Payload.captured_at) -Label "$Label captured_at")
  $reportedRef = [string]$Payload.source_project_ref
  if (-not [string]::IsNullOrWhiteSpace($reportedRef) -and $reportedRef -cne $ExpectedProjectRef) {
    throw "$Label reported a project ref that conflicts with the linked source fence."
  }
  if ([string]::IsNullOrWhiteSpace([string]$Payload.current_user) -or
      [string]::IsNullOrWhiteSpace([string]$Payload.session_user) -or
      $Payload.current_role_bypasses_rls -isnot [bool] -or
      -not [bool]$Payload.current_role_bypasses_rls -or
      [string]$Payload.row_security -cne 'off' -or
      [string]$Payload.transaction_read_only -cne 'on') {
    throw "$Label was not captured by one explicit RLS-bypass role in a read-only transaction."
  }
}

function Assert-HBAM2BaselinePreflight {
  param(
    [Parameter(Mandatory = $true)] $Preflight,
    [Parameter(Mandatory = $true)] [string] $ExpectedProjectRef
  )

  Assert-HBAM2BaselineExecutionEnvelope `
    -Payload $Preflight `
    -ExpectedProjectRef $ExpectedProjectRef `
    -Label 'Baseline preflight'
  foreach ($field in @(
    'database_name', 'server_version_num', 'migration_head',
    'forbidden_post_baseline_relation_count',
    'excluded_ephemeral_relation_count', 'ephemeral_rebuild_function_count',
    'temporary_release_lease_empty_count',
    'table_count',
    'estimated_total_bytes', 'estimated_total_rows', 'tables'
  )) {
    if (-not $Preflight.PSObject.Properties[$field]) { throw "Baseline preflight is missing $field." }
  }
  $names = @($Preflight.tables | ForEach-Object { [string]$_.name })
  Assert-HBAM2BaselineExactNames -Actual $names -Label 'Baseline preflight'
  Assert-HBAM2RelationShapes `
    -Relations $Preflight.tables `
    -ExpectedNames $script:HBAM2BaselineExpectedTables `
    -Label 'Baseline preflight'
  if ([string]$Preflight.migration_head -cne $script:HBAM2BaselineExpectedMigrationHead -or
      [int]$Preflight.forbidden_post_baseline_relation_count -ne 0 -or
      [int]$Preflight.table_count -ne $script:HBAM2BaselineExpectedTables.Count -or
      [int]$Preflight.excluded_ephemeral_relation_count -ne
        $script:HBAM2BaselineExcludedEphemeralTables.Count -or
      [int]$Preflight.ephemeral_rebuild_function_count -ne 1 -or
      [int]$Preflight.temporary_release_lease_empty_count -ne 1 -or
      [int64]$Preflight.estimated_total_bytes -lt 0 -or
      [int64]$Preflight.estimated_total_bytes -gt $script:HBAM2BaselineMaximumEstimatedSourceBytes -or
      [int64]$Preflight.estimated_total_rows -lt 0 -or
      [int64]$Preflight.estimated_total_rows -gt $script:HBAM2BaselineMaximumEstimatedRows) {
    throw 'Baseline preflight table count or source-size bound failed.'
  }
}

function Assert-HBAM2BaselineInventory {
  param(
    [Parameter(Mandatory = $true)] $Inventory,
    [Parameter(Mandatory = $true)] [string] $ExpectedProjectRef,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  Assert-HBAM2BaselineExecutionEnvelope `
    -Payload $Inventory `
    -ExpectedProjectRef $ExpectedProjectRef `
    -Label $Label
  foreach ($field in @('schema_contract_sha256', 'schema_contract')) {
    if (-not $Inventory.PSObject.Properties[$field]) { throw "$Label is missing $field." }
  }
  if ([string]$Inventory.schema_contract_sha256 -notmatch '^[A-Fa-f0-9]{64}$') {
    throw "$Label has an invalid schema contract digest."
  }
  if (([string]$Inventory.schema_contract_sha256).ToUpperInvariant() -cne
      $script:HBAM2BaselineExpectedSchemaContractSha256) {
    throw "$Label does not match the audited current-remote schema digest."
  }
  $contract = $Inventory.schema_contract
  foreach ($field in @(
    'database_name', 'server_version_num', 'migration_history', 'tables', 'columns',
    'constraints', 'indexes', 'policies', 'triggers', 'dependent_functions', 'owned_sequences'
  )) {
    if (-not $contract.PSObject.Properties[$field]) { throw "$Label schema contract is missing $field." }
  }
  $migrationVersions = @($contract.migration_history | ForEach-Object { [string]$_.version } | Sort-Object)
  if ($migrationVersions.Count -lt 1 -or
      $migrationVersions[-1] -cne $script:HBAM2BaselineExpectedMigrationHead) {
    throw "$Label does not end at the audited pre-Amora migration head."
  }
  $names = @($contract.tables | ForEach-Object { [string]$_.name })
  Assert-HBAM2BaselineExactNames -Actual $names -Label $Label
  Assert-HBAM2RelationShapes `
    -Relations $contract.tables `
    -ExpectedNames $script:HBAM2BaselineExpectedTables `
    -Label $Label
  $columnsByTable = @{}
  foreach ($table in $script:HBAM2BaselineExpectedTables) { $columnsByTable[$table] = @() }
  foreach ($column in @($contract.columns)) {
    $tableName = [string]$column.table_name
    $columnName = [string]$column.column_name
    if (-not $columnsByTable.ContainsKey($tableName) -or
        [string]::IsNullOrWhiteSpace($columnName) -or
        -not $column.PSObject.Properties['ordinal_position'] -or
        -not $column.PSObject.Properties['formatted_type'] -or
        $columnsByTable[$tableName] -contains $columnName) {
      throw "$Label contains invalid or duplicate column metadata."
    }
    $columnsByTable[$tableName] += $columnName
  }
  foreach ($table in $script:HBAM2BaselineExpectedTables) {
    if (@($columnsByTable[$table]).Count -lt 1) { throw "$Label has no columns for $table." }
  }
}

function Assert-HBAM2BaselineLogicalData {
  param(
    [Parameter(Mandatory = $true)] $Data,
    [Parameter(Mandatory = $true)] [string] $ExpectedProjectRef
  )

  Assert-HBAM2BaselineExecutionEnvelope `
    -Payload $Data `
    -ExpectedProjectRef $ExpectedProjectRef `
    -Label 'Baseline logical data'
  foreach ($field in @('database_name', 'relations', 'tables')) {
    if (-not $Data.PSObject.Properties[$field]) { throw "Baseline logical data is missing $field." }
  }
  Assert-HBAM2RelationShapes `
    -Relations $Data.relations `
    -ExpectedNames $script:HBAM2BaselineExpectedTables `
    -Label 'Baseline logical data'
  $names = @($Data.tables.PSObject.Properties.Name)
  Assert-HBAM2BaselineExactNames -Actual $names -Label 'Baseline logical data'
  $counts = [ordered]@{}
  foreach ($property in @($Data.tables.PSObject.Properties | Sort-Object Name)) {
    foreach ($field in @('row_count', 'rows', 'canonical_sha256')) {
      if (-not $property.Value.PSObject.Properties[$field]) {
        throw "Baseline logical data is missing $field for $($property.Name)."
      }
    }
    $rows = @($property.Value.rows)
    $reported = [int64]$property.Value.row_count
    if ($reported -ne $rows.Count -or
        [string]$property.Value.canonical_sha256 -notmatch '^[A-Fa-f0-9]{64}$') {
      throw "Baseline logical data row metadata is invalid for $($property.Name)."
    }
    $counts[$property.Name] = $reported
  }
  $total = [int64](($counts.Values | Measure-Object -Sum).Sum)
  if ($total -gt $script:HBAM2BaselineMaximumEstimatedRows) {
    throw 'Baseline logical data exceeds the total row bound.'
  }
  return $counts
}

function Get-HBAM2BaselineSchemaContractJson {
  param([Parameter(Mandatory = $true)] $Inventory)

  return $Inventory.schema_contract | ConvertTo-Json -Depth 100 -Compress
}

function Invoke-HBAM2BaselinePGliteRestore {
  param(
    [Parameter(Mandatory = $true)] [byte[]] $BeforeBytes,
    [Parameter(Mandatory = $true)] [byte[]] $DataBytes,
    [Parameter(Mandatory = $true)] [byte[]] $AfterBytes,
    [Parameter(Mandatory = $true)] $RuntimeFence
  )

  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $webRoot = Join-Path $repoRoot 'apps\web'
  $nodeScript = Join-Path $webRoot 'scripts\amora-db-current-baseline-restore.mjs'
  if (-not (Test-Path -LiteralPath $nodeScript -PathType Leaf)) {
    throw 'Baseline PGlite logical row replay script is missing.'
  }
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $RuntimeFence.NodePath
  $startInfo.Arguments = '"' + $nodeScript + '"'
  $startInfo.WorkingDirectory = $webRoot
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
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start the baseline PGlite restore process.' }
  try {
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    foreach ($payloadBytes in @($BeforeBytes, $DataBytes, $AfterBytes)) {
      $remaining = 180000 - [int]$deadline.ElapsedMilliseconds
      if ($remaining -le 0) {
        & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null
        throw 'Baseline PGlite input exceeded the 180-second total deadline.'
      }
      $line = [Convert]::ToBase64String($payloadBytes)
      $writeTask = $process.StandardInput.WriteLineAsync($line)
      if (-not $writeTask.Wait($remaining)) {
        & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null
        throw 'Baseline PGlite input exceeded the 180-second total deadline.'
      }
      [void]$writeTask.GetAwaiter().GetResult()
      $line = $null
    }
    $process.StandardInput.Close()
    $remaining = 180000 - [int]$deadline.ElapsedMilliseconds
    if ($remaining -le 0 -or -not $process.WaitForExit($remaining)) {
      & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null
      throw 'Baseline PGlite logical row replay exceeded 180 seconds.'
    }
    $process.WaitForExit()
    $stdout = $stdoutTask.Result.Trim()
    $stderr = $stderrTask.Result
    if ($process.ExitCode -ne 0) {
      $stageMatch = [Regex]::Match($stderr, '(?m)^HBAM_BASELINE_STAGE=([a-z0-9_-]{1,96})$')
      $stage = if ($stageMatch.Success) { $stageMatch.Groups[1].Value } else { 'unclassified' }
      throw "Baseline PGlite logical row replay failed at safe stage $stage with exit code $($process.ExitCode)."
    }
    try { $receipt = $stdout | ConvertFrom-Json }
    catch { throw 'Baseline PGlite logical row replay returned invalid receipt JSON.' }
    foreach ($field in @(
      'LogicalRowReplayVerified', 'ColumnWiseTablesRestored',
      'SchemaContractBeforeAfterVerified', 'SourceCanonicalDigestsVerified',
      'RestoredCanonicalDigestsVerified', 'Engine', 'TableCount', 'RestoredColumnCount',
      'TotalRows', 'UniqueConstraintsReplayed', 'ForeignKeysReplayed',
      'ExternalForeignKeysSkipped', 'CheckConstraintsDocumented',
      'CheckConstraintsReplayed', 'TypedSchemaReplayed', 'LogicalDataParsedInV8',
      'PlaintextWrittenToDisk'
    )) {
      if (-not $receipt.PSObject.Properties[$field]) {
        throw "Baseline PGlite receipt is missing $field."
      }
    }
    if (-not [bool]$receipt.LogicalRowReplayVerified -or
        -not [bool]$receipt.ColumnWiseTablesRestored -or
        -not [bool]$receipt.SchemaContractBeforeAfterVerified -or
        -not [bool]$receipt.SourceCanonicalDigestsVerified -or
        -not [bool]$receipt.RestoredCanonicalDigestsVerified -or
        [string]$receipt.Engine -cne 'PGlite' -or
        [int]$receipt.TableCount -ne $script:HBAM2BaselineExpectedTables.Count -or
        [int]$receipt.RestoredColumnCount -lt $script:HBAM2BaselineExpectedTables.Count -or
        [bool]$receipt.TypedSchemaReplayed -or
        [bool]$receipt.LogicalDataParsedInV8 -or
        [bool]$receipt.PlaintextWrittenToDisk) {
      throw 'Baseline PGlite logical row replay returned an invalid receipt.'
    }
    return $receipt
  } finally { $process.Dispose() }
}
