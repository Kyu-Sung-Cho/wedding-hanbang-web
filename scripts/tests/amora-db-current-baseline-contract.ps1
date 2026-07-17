Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'scripts\amora-db-current-baseline-common.ps1')

function Assert-Contract {
  param(
    [Parameter(Mandatory = $true)] [bool] $Condition,
    [Parameter(Mandatory = $true)] [string] $Message
  )

  if (-not $Condition) { throw $Message }
}

$expectedTables = @(
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
$actualTables = @($script:HBAM2BaselineExpectedTables | Sort-Object)
Assert-Contract `
  -Condition ($actualTables.Count -eq $expectedTables.Count -and
    @(Compare-Object -ReferenceObject $expectedTables -DifferenceObject $actualTables -CaseSensitive).Count -eq 0) `
  -Message 'Current-baseline table allowlist changed.'
Assert-Contract `
  -Condition ($script:HBAM2BaselineExcludedEphemeralTables.Count -eq 2 -and
    $script:HBAM2BaselineExcludedEphemeralTables[0] -ceq
      'production_release_lease_20260717' -and
    $script:HBAM2BaselineExcludedEphemeralTables[1] -ceq 'rate_limit_buckets' -and
    $script:HBAM2BaselineEphemeralRebuildContract -ceq
      'production_release_lease_20260717=temporary-release-control-dropped-by-paired-write-fence-finalizer;rate_limit_buckets=empty-on-restore-recreated-by-public.check_rate_limit(text,integer,integer)') `
  -Message 'Current-baseline ephemeral exclusion/rebuild contract changed.'
Assert-Contract `
  -Condition ($script:HBAM2BaselineExpectedMigrationHead -ceq '20260715210000') `
  -Message 'Current-baseline migration-head fence changed.'
Assert-Contract `
  -Condition ($script:HBAM2BaselineExpectedSchemaContractSha256 -ceq
    'CE2A4D55024571C9491274F796C509384681D8026336573334C4BCA199EC6CE3' -and
    $script:HBAM2BaselineExpectedSchemaContractSha256 -cne
      '414524A4DE0504EC885106FE59BD16FE5C353515DE00B5793E2768193F6B10D3') `
  -Message 'Current-baseline audited schema digest changed.'

$sqlPaths = @(
  (Join-Path $repoRoot 'scripts\sql\amora-db-current-baseline-preflight.sql'),
  (Join-Path $repoRoot 'scripts\sql\amora-db-current-baseline-inventory.sql'),
  (Join-Path $repoRoot 'scripts\sql\amora-db-current-baseline-logical-data.sql')
)
foreach ($sqlPath in $sqlPaths) {
  Assert-HBAM2ReadOnlySqlSafetyGuard -Path $sqlPath
  $sql = [IO.File]::ReadAllText($sqlPath)
  Assert-Contract `
    -Condition ($sql -notmatch '(?i)\b(insert|update|delete|alter|create|drop|truncate|grant|revoke|call|do)\b') `
    -Message "Current-baseline SQL contains a write-capable token: $([IO.Path]::GetFileName($sqlPath))."
  foreach ($table in $expectedTables) {
    Assert-Contract `
      -Condition ($sql.Contains("('$table'::text)")) `
      -Message "Current-baseline SQL omits $table from $([IO.Path]::GetFileName($sqlPath))."
  }
}

$preflightSql = [IO.File]::ReadAllText($sqlPaths[0])
Assert-Contract `
  -Condition ($preflightSql.Contains("payload ->> 'migration_head' = '20260715210000'") -and
    $preflightSql.Contains("'forbidden_post_baseline_relation_count'") -and
    $preflightSql.Contains("'excluded_ephemeral_relation_count'") -and
    $preflightSql.Contains("'ephemeral_rebuild_function_count'") -and
    $preflightSql.Contains("'temporary_release_lease_empty_count'") -and
    $preflightSql.Contains("estimated_total_bytes')::bigint <= 8388608") -and
    $preflightSql.Contains("estimated_total_rows')::bigint <= 100000")) `
  -Message 'Current-baseline preflight lost a remote-state or source-size fence.'

$capturePath = Join-Path $repoRoot 'scripts\amora-db-current-baseline.ps1'
$verifyPath = Join-Path $repoRoot 'scripts\amora-db-current-baseline-verify.ps1'
$commonPath = Join-Path $repoRoot 'scripts\amora-db-current-baseline-common.ps1'
$nodePath = Join-Path $repoRoot 'apps\web\scripts\amora-db-current-baseline-restore.mjs'
foreach ($path in @($capturePath, $verifyPath, $commonPath)) {
  $tokens = $null
  $errors = $null
  [void][Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
  Assert-Contract `
    -Condition ($errors.Count -eq 0) `
    -Message "PowerShell syntax is invalid for $([IO.Path]::GetFileName($path))."
}

$capture = [IO.File]::ReadAllText($capturePath)
$verify = [IO.File]::ReadAllText($verifyPath)
$shared = [IO.File]::ReadAllText((Join-Path $repoRoot 'scripts\amora-db-backup-common.ps1'))
$node = [IO.File]::ReadAllText($nodePath)
Assert-Contract `
  -Condition ($capture.Contains("-ArtifactName 'schema-inventory.json'") -and
    $capture.Contains("-ArtifactName 'logical-data.json'") -and
    $capture.Contains("plaintext_written_to_disk = `$false")) `
  -Message 'Current-baseline capture lost the two-artifact no-plaintext contract.'
Assert-Contract `
  -Condition ($verify.Contains('Invoke-HBAM2BaselinePGliteRestore') -and
    $verify.Contains('-ExpectedManifestSha256') -and
    $verify.Contains('-ExpectedBackupSetId')) `
  -Message 'Current-baseline verifier lost an external anchor or logical row replay.'
Assert-Contract `
  -Condition ($shared.Contains('Production backup requires a clean committed Git worktree.')) `
  -Message 'HBAM2 production capture no longer requires a clean committed worktree.'
Assert-Contract `
  -Condition ($node.Contains('const db = new PGlite()') -and
    -not $node.Contains('writeFile') -and
    -not $node.Contains('mkdtemp') -and
    $node.Contains("'vendor_reviews'") -and
    $node.Contains('TypedSchemaReplayed: false') -and
    $node.Contains('PlaintextWrittenToDisk: false')) `
  -Message 'Current-baseline logical row replay lost its in-memory or honest-limit contract.'

[pscustomobject]@{
  ContractVerified = $true
  SqlReadOnlyGuards = $sqlPaths.Count
  TableCount = $expectedTables.Count
  MigrationHead = $script:HBAM2BaselineExpectedMigrationHead
  SchemaContractSha256 = $script:HBAM2BaselineExpectedSchemaContractSha256
  ProductionCleanCommitRequired = $true
  PlaintextWrittenToDisk = $false
} | ConvertTo-Json -Compress
