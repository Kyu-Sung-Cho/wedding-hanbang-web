Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'amora-db-backup-common.ps1')

$script:VDCurrentBaselineProjectRef = 'slrtobkksjmxgzatjyqb'
$script:VDCurrentBaselineMigrationHead = '20260727090000'
$script:VDCurrentBaselineMigrationCount = 147
$script:VDCurrentBaselineMigrationVersionsSha256 = '0ee207d75d2bd30e1a68d1f6d2f710f220cdd3dd8e1f681f9d2fa332852a0c23'
$script:VDCurrentBaselineTableContractSha256 = 'd6494b9dfbebdea7f82535f81825e2698d5e0296a34ca935da382f91f5dae35f'
$script:VDCurrentBaselineExpectedTables = @(
  'account_deletion_jobs',
  'account_deletion_media_manifest',
  'agencies',
  'agency_dedupe_candidates',
  'ai_interactions_log',
  'amora_actions',
  'amora_care_deliveries',
  'amora_care_jobs',
  'amora_care_scan_states',
  'amora_chat_request_claims',
  'amora_conflict_check_claims',
  'amora_couple_profiles',
  'amora_mediation_acceptances',
  'amora_memory_consents',
  'amora_memory_jobs',
  'amora_memory_settings',
  'amora_saved_notes',
  'amora_tool_executions',
  'amora_turn_counters',
  'amora_turn_requests',
  'booking_projection_jobs',
  'chat_feedback',
  'chat_messages',
  'chat_summaries',
  'combos',
  'community_upload_sessions',
  'couples',
  'decision_nodes',
  'disclosure_semantic_staging',
  'events',
  'official_agency_packages',
  'official_price_options',
  'official_prices',
  'official_review_events',
  'price_alerts',
  'price_snapshots',
  'price_upload_confirmation_events',
  'price_upload_confirmations',
  'profiles',
  'tags',
  'vendor_alias_proposals',
  'vendor_dedupe_candidates',
  'vendor_demand_daily',
  'vendor_disclosure_bulk_approval_audits',
  'vendor_disclosure_ingest_batches',
  'vendor_disclosure_ingest_dedupe_links',
  'vendor_disclosure_ingest_identity_links',
  'vendor_disclosure_ingest_owned_identities',
  'vendor_disclosure_ingest_owned_ledger_rows',
  'vendor_disclosure_ingest_owned_rows',
  'vendor_disclosure_ingest_record_bindings',
  'vendor_disclosure_ingest_runs',
  'vendor_disclosure_ingest_storage_links',
  'vendor_disclosure_ingest_unit_provider_lineage',
  'vendor_disclosure_paid_extraction_attestations',
  'vendor_enrichment_private',
  'vendor_reviews',
  'vendor_tags',
  'wedding_journeys',
  'wishlists'
)
$script:VDCurrentBaselineImplementationPaths = @(
  'apps/web/package.json',
  'apps/web/scripts/vendor-disclosure-db-current-baseline-roundtrip.mjs',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/amora-db-backup-common.ps1',
  'scripts/provenance/amora-verifier-runtime.json',
  'scripts/vendor-disclosure-db-current-baseline-common.ps1',
  'scripts/vendor-disclosure-db-current-baseline.ps1',
  'scripts/vendor-disclosure-db-current-baseline-verify.ps1'
)
$script:VDCurrentBaselineLogicalReceiptKeys = @(
  'AuthSchemaContractSha256',
  'AuthUsersCanonicalSha256',
  'AuthUsersContractSha256',
  'BackupContractId',
  'BackupContractVersion',
  'BackupSetId',
  'ContainsSecrets',
  'EncryptedArtifacts',
  'EncryptedArtifactsVerified',
  'ExpectedTables',
  'GitCommit',
  'GitOrigin',
  'InventorySha256',
  'Kind',
  'LiveSchemaContractSha256',
  'LogicalDataContractSha256',
  'ManifestSha256',
  'PGliteJsonbRoundTripVerified',
  'PlaintextWrittenToDisk',
  'ProjectRef',
  'ReceiptVersion',
  'Release',
  'SourceCanonicalDigestsVerified',
  'SourceCapturedAt',
  'SourceMigrationCount',
  'SourceMigrationHead',
  'SupabaseCli',
  'TableContractSha256',
  'TableCount',
  'Verified',
  'VerifiedAtUtc',
  'Verifier'
)
$script:VDCurrentBaselineManifestKeys = @(
  'artifacts',
  'auth_schema_contract_sha256',
  'auth_users_canonical_sha256',
  'auth_users_contract_sha256',
  'auth_users_row_count',
  'backup_contract_id',
  'backup_contract_version',
  'backup_set_id',
  'backup_type',
  'consistency',
  'contains_secrets',
  'created_at_utc',
  'expected_tables',
  'format',
  'format_version',
  'git_commit',
  'git_origin',
  'git_remote_ref',
  'implementation',
  'inventory_after_captured_at',
  'inventory_before_captured_at',
  'inventory_contract_sha256',
  'key_scope',
  'live_schema_contract_sha256',
  'logical_data_contract_sha256',
  'plaintext_written_to_disk',
  'preflight',
  'preflight_captured_at',
  'query_timeout_seconds',
  'release',
  'source_captured_at',
  'source_current_user',
  'source_database_identity',
  'source_database_identity_sha256',
  'source_fence',
  'source_migration_count',
  'source_migration_head',
  'source_migration_versions_sha256',
  'source_project_ref',
  'source_project_ref_sha256',
  'source_relation_contract_sha256',
  'source_role_bypasses_rls',
  'source_row_security',
  'source_session_user',
  'status',
  'supabase_cli',
  'table_contract_sha256',
  'table_count',
  'tables',
  'verifier',
  'verifier_runtime'
)

function Assert-VDCurrentBaselineExactObjectKeys {
  param(
    # AllowNull keeps a JSON null in a nested-object slot inside this function,
    # where it fails as a schema error, instead of failing at parameter binding.
    [Parameter(Mandatory = $true)] [AllowNull()] $Value,
    [Parameter(Mandatory = $true)] [string[]] $ExpectedKeys
  )

  if ($null -eq $Value -or $Value -is [Array] -or
      ($Value -isnot [Collections.IDictionary] -and
        $Value -isnot [Management.Automation.PSCustomObject])) {
    throw 'Manifest schema is not exact.'
  }
  $actual = @(Get-HBAM2ObjectPropertyNames -Value $Value | Sort-Object -CaseSensitive)
  $expected = @($ExpectedKeys | Sort-Object -CaseSensitive)
  if ($actual.Count -ne $expected.Count -or
      @(Compare-Object -ReferenceObject $expected -DifferenceObject $actual -CaseSensitive).Count -ne 0) {
    throw 'Manifest schema is not exact.'
  }
}

function Assert-VDCurrentBaselineExactManifestShape {
  param([Parameter(Mandatory = $true)] $Manifest)

  Assert-VDCurrentBaselineExactObjectKeys `
    -Value $Manifest -ExpectedKeys $script:VDCurrentBaselineManifestKeys
  Assert-VDCurrentBaselineExactObjectKeys `
    -Value $Manifest.source_database_identity `
    -ExpectedKeys @('database_name', 'database_oid', 'server_version_num', 'system_identifier')
  Assert-VDCurrentBaselineExactObjectKeys `
    -Value $Manifest.implementation -ExpectedKeys @('files', 'git_blobs', 'git_commit')
  Assert-VDCurrentBaselineExactObjectKeys `
    -Value $Manifest.implementation.files `
    -ExpectedKeys $script:VDCurrentBaselineImplementationPaths
  Assert-VDCurrentBaselineExactObjectKeys `
    -Value $Manifest.implementation.git_blobs `
    -ExpectedKeys $script:VDCurrentBaselineImplementationPaths

  Assert-VDCurrentBaselineExactObjectKeys `
    -Value $Manifest.supabase_cli `
    -ExpectedKeys @('files', 'invocation_relative_path', 'mode', 'platform', 'version')
  $cliVersion = [string]$Manifest.supabase_cli.version
  $cliPlatform = [string]$Manifest.supabase_cli.platform
  if ($cliVersion -notmatch '^\d+\.\d+\.\d+$' -or
      $cliPlatform -notmatch '^windows-(?:x64|arm64)$') {
    throw 'Manifest schema is not exact.'
  }
  $cliPackage = "@supabase/cli-$cliPlatform"
  $cliPackageRoot = "node_modules/.pnpm/@supabase+cli-$cliPlatform@$cliVersion/node_modules/$cliPackage"
  $expectedCliFiles = @(
    'node_modules/.bin/supabase.CMD',
    "node_modules/.pnpm/supabase@$cliVersion/node_modules/supabase/package.json",
    "node_modules/.pnpm/supabase@$cliVersion/node_modules/supabase/dist/supabase.js",
    "$cliPackageRoot/package.json",
    "$cliPackageRoot/bin/supabase.exe"
  )
  Assert-VDCurrentBaselineExactObjectKeys `
    -Value $Manifest.supabase_cli.files -ExpectedKeys $expectedCliFiles
  if ([string]$Manifest.supabase_cli.invocation_relative_path -ne $expectedCliFiles[-1]) {
    throw 'Manifest schema is not exact.'
  }

  Assert-VDCurrentBaselineExactObjectKeys `
    -Value $Manifest.verifier_runtime -ExpectedKeys @('format_version', 'node', 'pglite')
  Assert-VDCurrentBaselineExactObjectKeys `
    -Value $Manifest.verifier_runtime.node `
    -ExpectedKeys @('absolute_path', 'bytes', 'sha256', 'version')
  Assert-VDCurrentBaselineExactObjectKeys `
    -Value $Manifest.verifier_runtime.pglite `
    -ExpectedKeys @(
      'entry_relative_path', 'file_count', 'package_relative_path',
      'total_bytes', 'tree_sha256', 'version'
    )
  Assert-VDCurrentBaselineExactObjectKeys `
    -Value $Manifest.verifier -ExpectedKeys @('file', 'sha256')
  Assert-VDCurrentBaselineExactObjectKeys `
    -Value $Manifest.preflight -ExpectedKeys @('estimated_total_bytes', 'estimated_total_rows')
  Assert-VDCurrentBaselineExactObjectKeys `
    -Value $Manifest.tables -ExpectedKeys $script:VDCurrentBaselineExpectedTables
  Assert-VDCurrentBaselineExactObjectKeys `
    -Value $Manifest.artifacts -ExpectedKeys @('logical_data', 'schema_inventory')
  $artifactKeys = @(
    'artifact', 'backup_set_id', 'encrypted_bytes', 'encrypted_sha256',
    'key', 'key_sha256', 'plaintext_bytes', 'plaintext_sha256'
  )
  foreach ($artifact in @($Manifest.artifacts.logical_data, $Manifest.artifacts.schema_inventory)) {
    Assert-VDCurrentBaselineExactObjectKeys -Value $artifact -ExpectedKeys $artifactKeys
  }
}

function Test-VDCurrentBaselineJsonInteger {
  param($Value)

  return $Value -is [int] -or $Value -is [long]
}

function Assert-VDCurrentBaselineManifestSafetyValues {
  param([Parameter(Mandatory = $true)] $Manifest)

  if ([string]$Manifest.key_scope -cne 'Windows DPAPI CurrentUser on the creating computer' -or
      -not (Test-VDCurrentBaselineJsonInteger -Value $Manifest.query_timeout_seconds) -or
      [int64]$Manifest.query_timeout_seconds -lt 30 -or
      [int64]$Manifest.query_timeout_seconds -gt 600 -or
      -not (Test-VDCurrentBaselineJsonInteger -Value $Manifest.preflight.estimated_total_bytes) -or
      [int64]$Manifest.preflight.estimated_total_bytes -lt 0 -or
      [int64]$Manifest.preflight.estimated_total_bytes -gt 268435456 -or
      -not (Test-VDCurrentBaselineJsonInteger -Value $Manifest.preflight.estimated_total_rows) -or
      [int64]$Manifest.preflight.estimated_total_rows -lt 0 -or
      [int64]$Manifest.preflight.estimated_total_rows -gt 500000) {
    throw 'Manifest safety values are invalid.'
  }
}

function Test-VDCurrentBaselineSecretKeyName {
  param([Parameter(Mandatory = $true)] [string] $Name)

  if ([string]::Equals($Name, 'contains_secrets', [StringComparison]::Ordinal)) {
    return $false
  }
  return $Name -match '(?i)(?:password|secret|token|api[_-]?key|authorization|credential|private[_-]?key|service[_-]?role|database[_-]?(?:url|password)|connection[_-]?(?:string|uri))'
}

function Assert-VDCurrentBaselineManifestJsonHasNoSecretMaterial {
  param([Parameter(Mandatory = $true)] [string] $Json)

  $secretValuePattern = '(?i)(?:postgres(?:ql)?://|\bBearer\s+[A-Za-z0-9._~+/-]{16,}|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|SUPABASE_SERVICE_ROLE_KEY)'
  foreach ($match in [Regex]::Matches($Json, '"(?<key>(?:\\.|[^"\\])*)"\s*:')) {
    if (Test-VDCurrentBaselineSecretKeyName -Name ([string]$match.Groups['key'].Value)) {
      throw 'Manifest contains secret-like material.'
    }
  }
  if ($Json -match $secretValuePattern) { throw 'Manifest contains secret-like material.' }
}

function Test-VDCurrentBaselineSecretMaterial {
  param(
    $Value,
    [int] $Depth = 0
  )

  if ($Depth -gt 100) { return $true }
  if ($null -eq $Value) { return $false }
  $secretValuePattern = '(?i)(?:postgres(?:ql)?://|\bBearer\s+[A-Za-z0-9._~+/-]{16,}|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|SUPABASE_SERVICE_ROLE_KEY)'
  if ($Value -is [string]) { return $Value -match $secretValuePattern }
  if ($Value -is [Collections.IDictionary]) {
    foreach ($key in @($Value.Keys)) {
      if ((Test-VDCurrentBaselineSecretKeyName -Name ([string]$key)) -or
          (Test-VDCurrentBaselineSecretMaterial -Value $Value[$key] -Depth ($Depth + 1))) {
        return $true
      }
    }
    return $false
  }
  if ($Value -is [Array] -or $Value -is [Collections.IList]) {
    foreach ($item in $Value) {
      if (Test-VDCurrentBaselineSecretMaterial -Value $item -Depth ($Depth + 1)) {
        return $true
      }
    }
    return $false
  }
  if ($Value -is [Management.Automation.PSCustomObject]) {
    foreach ($property in @($Value.PSObject.Properties)) {
      if ((Test-VDCurrentBaselineSecretKeyName -Name ([string]$property.Name)) -or
          (Test-VDCurrentBaselineSecretMaterial -Value $property.Value -Depth ($Depth + 1))) {
        return $true
      }
    }
  }
  return $false
}

function Assert-VDCurrentBaselineManifestHasNoSecretMaterial {
  param([Parameter(Mandatory = $true)] $Value)

  if (Test-VDCurrentBaselineSecretMaterial -Value $Value) {
    throw 'Manifest contains secret-like material.'
  }
}

function Get-VDCurrentBaselineUtf8Sha256Lower {
  param([Parameter(Mandatory = $true)] [string] $Value)

  $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
  try { return (Get-HBAM2Sha256Hex -Bytes $bytes).ToLowerInvariant() }
  finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Get-VDCurrentBaselineTextListSha256 {
  param([Parameter(Mandatory = $true)] [string[]] $Values)

  return Get-VDCurrentBaselineUtf8Sha256Lower -Value (($Values -join "`n") + "`n")
}

function ConvertTo-VDCurrentBaselineCanonicalValue {
  param($Value)

  if ($null -eq $Value) { return $null }
  if ($Value -is [Collections.IDictionary]) {
    $result = [ordered]@{}
    foreach ($key in @($Value.Keys | ForEach-Object { [string]$_ } | Sort-Object)) {
      $result[$key] = ConvertTo-VDCurrentBaselineCanonicalValue -Value $Value[$key]
    }
    return $result
  }
  if ($Value -is [Management.Automation.PSCustomObject]) {
    $result = [ordered]@{}
    foreach ($property in @($Value.PSObject.Properties | Sort-Object Name)) {
      $result[$property.Name] = ConvertTo-VDCurrentBaselineCanonicalValue -Value $property.Value
    }
    return $result
  }
  if ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) {
    return ,@($Value | ForEach-Object { ConvertTo-VDCurrentBaselineCanonicalValue -Value $_ })
  }
  return $Value
}

function Get-VDCurrentBaselineCanonicalJsonSha256 {
  param([Parameter(Mandatory = $true)] $Value)

  $canonical = ConvertTo-VDCurrentBaselineCanonicalValue -Value $Value
  $json = $canonical | ConvertTo-Json -Depth 100 -Compress
  return Get-VDCurrentBaselineUtf8Sha256Lower -Value ($json + "`n")
}

function Assert-VDCurrentBaselineConstants {
  if ($script:VDCurrentBaselineExpectedTables.Count -ne 60 -or
      @($script:VDCurrentBaselineExpectedTables | Sort-Object -Unique).Count -ne 60 -or
      @(Compare-Object -ReferenceObject $script:VDCurrentBaselineExpectedTables `
          -DifferenceObject @($script:VDCurrentBaselineExpectedTables | Sort-Object)).Count -ne 0 -or
      (Get-VDCurrentBaselineTextListSha256 -Values $script:VDCurrentBaselineExpectedTables) -ne
        $script:VDCurrentBaselineTableContractSha256) {
    throw 'Current Production table contract constants are inconsistent.'
  }
}

function Assert-VDCurrentBaselineExactNames {
  param(
    [Parameter(Mandatory = $true)] [string[]] $Actual,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  $names = @($Actual | Sort-Object)
  if ($names.Count -ne $script:VDCurrentBaselineExpectedTables.Count -or
      @(Compare-Object -ReferenceObject $script:VDCurrentBaselineExpectedTables `
          -DifferenceObject $names).Count -ne 0) {
    throw "$Label does not contain the exact 60-table Production allowlist."
  }
}

function Assert-VDCurrentBaselineLogicalReceipt {
  param([Parameter(Mandatory = $true)] $Receipt)

  $actual = @($Receipt.Keys | ForEach-Object { [string]$_ } | Sort-Object)
  $expected = @($script:VDCurrentBaselineLogicalReceiptKeys | Sort-Object)
  if ($actual.Count -ne $expected.Count -or
      @(Compare-Object -ReferenceObject $expected -DifferenceObject $actual).Count -ne 0 -or
      [int]$Receipt.ReceiptVersion -ne 1 -or
      [string]$Receipt.Kind -ne 'vendor-disclosure-successor-current-baseline-backup-verification-v1' -or
      -not [bool]$Receipt.Verified -or
      -not [bool]$Receipt.EncryptedArtifactsVerified -or
      -not [bool]$Receipt.SourceCanonicalDigestsVerified -or
      -not [bool]$Receipt.PGliteJsonbRoundTripVerified -or
      [bool]$Receipt.PlaintextWrittenToDisk -or
      [bool]$Receipt.ContainsSecrets) {
    throw 'Logical verification receipt does not satisfy its exact public schema.'
  }
  foreach ($value in @($Receipt.EncryptedArtifacts.Values)) {
    if ([string]$value -notmatch '^[a-f0-9]{64}$') {
      throw 'Logical verification receipt contains an invalid artifact digest.'
    }
  }
  foreach ($field in @(
    'AuthSchemaContractSha256',
    'AuthUsersCanonicalSha256',
    'AuthUsersContractSha256'
  )) {
    if ([string]$Receipt[$field] -notmatch '^[a-f0-9]{64}$') {
      throw "Logical verification receipt contains an invalid $field digest."
    }
  }
  $json = $Receipt | ConvertTo-Json -Depth 20 -Compress
  if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 65536 -or
      $json -match '(?i)"(access[_-]?token|authorization|password|service[_-]?role[_-]?key|api[_-]?key)"\s*:') {
    throw 'Logical verification receipt is oversized or contains a secret-bearing field.'
  }
}

function Get-VDCurrentBaselineTargetValuesSql {
  return ($script:VDCurrentBaselineExpectedTables | ForEach-Object { "    ('$_')" }) -join ",`n"
}

function Get-VDCurrentBaselineSqlPrefix {
  return @"
begin transaction read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local row_security = off;
"@
}

function Get-VDCurrentBaselineIdentitySql {
  return @"
source_identity as materialized (
  select jsonb_build_object(
    'system_identifier', control.system_identifier::text,
    'database_name', current_database(),
    'database_oid', database.oid::text,
    'server_version_num', current_setting('server_version_num')
  ) as identity
  from pg_control_system() as control
  join pg_database as database on database.datname = current_database()
),
migration_contract as materialized (
  select
    count(*)::integer as migration_count,
    max(version::text) as migration_head,
    encode(sha256(convert_to(coalesce(string_agg(version::text || E'\\n', '' order by version::text), ''), 'UTF8')), 'hex') as versions_sha256,
    coalesce(jsonb_agg(version::text order by version::text), '[]'::jsonb) as versions
  from supabase_migrations.schema_migrations
),
target_relations as materialized (
  select target.name, relation.oid, relation.relkind, relation.relrowsecurity,
         relation.relforcerowsecurity, relation.relowner, relation.relacl,
         relation.reltuples
  from target
  left join pg_namespace as namespace on namespace.nspname = 'public'
  left join pg_class as relation
    on relation.relnamespace = namespace.oid and relation.relname = target.name
),
relations as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', target.name,
    'relation_oid', target.oid::text,
    'relkind', target.relkind::text,
    'has_inheritance_children', exists(select 1 from pg_inherits where inhparent = target.oid),
    'is_inheritance_child', exists(select 1 from pg_inherits where inhrelid = target.oid)
  ) order by target.name), '[]'::jsonb) as value
  from target_relations as target
)
"@
}

function New-VDCurrentBaselinePreflightSql {
  $values = Get-VDCurrentBaselineTargetValuesSql
  $identity = Get-VDCurrentBaselineIdentitySql
  return (Get-VDCurrentBaselineSqlPrefix) + @"

with target(name) as (values
$values
),
$identity,
payload as materialized (
  select jsonb_build_object(
    'captured_at', statement_timestamp(),
    'current_user', current_user,
    'session_user', session_user,
    'current_role_bypasses_rls', exists (
      select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)
    ),
    'row_security', current_setting('row_security'),
    'source_database_identity', (select identity from source_identity),
    'migration_head', (select migration_head from migration_contract),
    'migration_count', (select migration_count from migration_contract),
    'migration_versions_sha256', (select versions_sha256 from migration_contract),
    'table_count', (select count(*) from target_relations where oid is not null),
    'estimated_total_bytes', (select coalesce(sum(pg_total_relation_size(oid)), 0) from target_relations),
    'estimated_total_rows', (select coalesce(sum(greatest(reltuples, 0))::bigint, 0) from target_relations),
    'relations', (select value from relations)
  ) as value
)
select case when
  (value->>'current_role_bypasses_rls')::boolean
  and value->>'row_security' = 'off'
  and value->>'migration_head' = '$script:VDCurrentBaselineMigrationHead'
  and (value->>'migration_count')::integer = $script:VDCurrentBaselineMigrationCount
  and value->>'migration_versions_sha256' = '$script:VDCurrentBaselineMigrationVersionsSha256'
  and (value->>'table_count')::integer = 60
  and not exists (select 1 from target_relations where oid is null or relkind <> 'r')
  then value::text else null end as payload,
  pg_column_size(value)::bigint as payload_bytes
from payload;

commit;
"@
}

function New-VDCurrentBaselineInventorySql {
  $values = Get-VDCurrentBaselineTargetValuesSql
  $identity = Get-VDCurrentBaselineIdentitySql
  return (Get-VDCurrentBaselineSqlPrefix) + @"

with target(name) as (values
$values
),
$identity,
columns_contract as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name', relation.relname,
    'ordinal_position', attribute.attnum,
    'column_name', attribute.attname,
    'data_type', format_type(attribute.atttypid, attribute.atttypmod),
    'not_null', attribute.attnotnull,
    'identity', attribute.attidentity::text,
    'generated', attribute.attgenerated::text,
    'default_expression', pg_get_expr(defaults.adbin, defaults.adrelid),
    'collation', case when attribute.attcollation = 0 then null else attribute.attcollation::regcollation::text end
  ) order by relation.relname, attribute.attnum), '[]'::jsonb) as value
  from target_relations as target_relation
  join pg_class as relation on relation.oid = target_relation.oid
  join pg_attribute as attribute on attribute.attrelid = relation.oid
    and attribute.attnum > 0 and not attribute.attisdropped
  left join pg_attrdef as defaults
    on defaults.adrelid = relation.oid and defaults.adnum = attribute.attnum
),
constraints_contract as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', 'public.' || relation.relname,
    'name', constraint_record.conname,
    'type', constraint_record.contype::text,
    'definition', pg_get_constraintdef(constraint_record.oid, true),
    'columns', coalesce((select jsonb_agg(attribute.attname order by keys.ordinality)
      from unnest(constraint_record.conkey) with ordinality as keys(attnum, ordinality)
      join pg_attribute as attribute on attribute.attrelid = relation.oid and attribute.attnum = keys.attnum), '[]'::jsonb),
    'referenced_table', case when constraint_record.confrelid = 0 then null else constraint_record.confrelid::regclass::text end,
    'referenced_columns', coalesce((select jsonb_agg(attribute.attname order by keys.ordinality)
      from unnest(constraint_record.confkey) with ordinality as keys(attnum, ordinality)
      join pg_attribute as attribute on attribute.attrelid = constraint_record.confrelid and attribute.attnum = keys.attnum), '[]'::jsonb)
  ) order by relation.relname, constraint_record.conname), '[]'::jsonb) as value
  from target_relations as target_relation
  join pg_class as relation on relation.oid = target_relation.oid
  join pg_constraint as constraint_record on constraint_record.conrelid = relation.oid
),
indexes_contract as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name', relation.relname,
    'index_name', index_relation.relname,
    'definition', pg_get_indexdef(index_relation.oid),
    'valid', index_record.indisvalid,
    'ready', index_record.indisready
  ) order by relation.relname, index_relation.relname), '[]'::jsonb) as value
  from target_relations as target_relation
  join pg_class as relation on relation.oid = target_relation.oid
  join pg_index as index_record on index_record.indrelid = relation.oid
  join pg_class as index_relation on index_relation.oid = index_record.indexrelid
),
policies_contract as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name', relation.relname,
    'name', policy.polname,
    'command', policy.polcmd::text,
    'permissive', policy.polpermissive,
    'roles', to_jsonb(policy.polroles),
    'using_expression', pg_get_expr(policy.polqual, policy.polrelid),
    'check_expression', pg_get_expr(policy.polwithcheck, policy.polrelid)
  ) order by relation.relname, policy.polname), '[]'::jsonb) as value
  from target_relations as target_relation
  join pg_class as relation on relation.oid = target_relation.oid
  join pg_policy as policy on policy.polrelid = relation.oid
),
triggers_contract as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table_name', relation.relname,
    'name', trigger_record.tgname,
    'enabled', trigger_record.tgenabled::text,
    'definition', pg_get_triggerdef(trigger_record.oid, true),
    'function_identity', trigger_record.tgfoid::regprocedure::text
  ) order by relation.relname, trigger_record.tgname), '[]'::jsonb) as value
  from target_relations as target_relation
  join pg_class as relation on relation.oid = target_relation.oid
  join pg_trigger as trigger_record on trigger_record.tgrelid = relation.oid and not trigger_record.tgisinternal
),
tables_contract as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', relation.name,
    'relation_oid', relation.oid::text,
    'relkind', relation.relkind::text,
    'rls', relation.relrowsecurity,
    'force_rls', relation.relforcerowsecurity,
    'owner_oid', relation.relowner::text,
    'acl', to_jsonb(relation.relacl)
  ) order by relation.name), '[]'::jsonb) as value
  from target_relations as relation
),
auth_schema_rows as materialized (
  select namespace.nspname as schema_name, relation.relname as table_name,
         attribute.attnum as ordinal_position, attribute.attname as column_name,
         format_type(attribute.atttypid, attribute.atttypmod) as data_type,
         attribute.attnotnull as not_null, attribute.attidentity::text as identity,
         attribute.attgenerated::text as generated,
         pg_get_expr(defaults.adbin, defaults.adrelid) as default_expression,
         case when collation.oid is null then null
           else collation_namespace.nspname || '.' || collation.collname end as collation
  from pg_namespace as namespace
  join pg_class as relation
    on relation.relnamespace = namespace.oid and relation.relkind = 'r'
  join pg_attribute as attribute
    on attribute.attrelid = relation.oid
    and attribute.attnum > 0 and not attribute.attisdropped
  left join pg_attrdef as defaults
    on defaults.adrelid = relation.oid and defaults.adnum = attribute.attnum
  left join pg_collation as collation
    on collation.oid = attribute.attcollation and attribute.attcollation <> 0
  left join pg_namespace as collation_namespace
    on collation_namespace.oid = collation.collnamespace
  where namespace.nspname = 'auth' and relation.relname = 'users'
),
auth_schema_contract as materialized (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', schema_name || '.' || table_name,
    'ordinal_position', ordinal_position,
    'column_name', column_name,
    'data_type', data_type,
    'not_null', not_null,
    'identity', identity,
    'generated', generated,
    'default_expression', default_expression,
    'collation', collation
  ) order by table_name, ordinal_position), '[]'::jsonb) as value
  from auth_schema_rows
),
schema_contract as materialized (
  select jsonb_build_object(
    'tables', (select value from tables_contract),
    'columns', (select value from columns_contract),
    'constraints', (select value from constraints_contract),
    'indexes', (select value from indexes_contract),
    'policies', (select value from policies_contract),
    'triggers', (select value from triggers_contract)
  ) as value
),
payload as materialized (
  select jsonb_build_object(
    'captured_at', statement_timestamp(),
    'current_user', current_user,
    'session_user', session_user,
    'current_role_bypasses_rls', exists (
      select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)
    ),
    'row_security', current_setting('row_security'),
    'source_database_identity', (select identity from source_identity),
    'migration_head', (select migration_head from migration_contract),
    'migration_count', (select migration_count from migration_contract),
    'migration_versions_sha256', (select versions_sha256 from migration_contract),
    'migration_versions', (select versions from migration_contract),
    'relations', (select value from relations),
    'columns', (select value from columns_contract),
    'constraints', (select value from constraints_contract),
    'schema_contract', (select value from schema_contract),
    'auth_schema_contract', (select value from auth_schema_contract)
  ) as value
)
select case when
  (value->>'current_role_bypasses_rls')::boolean
  and value->>'row_security' = 'off'
  and value->>'migration_head' = '$script:VDCurrentBaselineMigrationHead'
  and (value->>'migration_count')::integer = $script:VDCurrentBaselineMigrationCount
  and value->>'migration_versions_sha256' = '$script:VDCurrentBaselineMigrationVersionsSha256'
  and not exists (select 1 from target_relations where oid is null or relkind <> 'r')
  then value::text else null end as payload,
  pg_column_size(value)::bigint as payload_bytes
from payload;

commit;
"@
}

function New-VDCurrentBaselineLogicalSql {
  $values = Get-VDCurrentBaselineTargetValuesSql
  $identity = Get-VDCurrentBaselineIdentitySql
  $rowCtes = [Collections.Generic.List[string]]::new()
  $tableSelects = [Collections.Generic.List[string]]::new()
  for ($index = 0; $index -lt $script:VDCurrentBaselineExpectedTables.Count; $index++) {
    $table = $script:VDCurrentBaselineExpectedTables[$index]
    $rowCtes.Add("table_$index as materialized (select to_jsonb(row_value) as row_data from only public.$table as row_value)")
    $tableSelects.Add(@"
  select '$table'::text as name, (select jsonb_build_object(
      'row_count', count(*),
      'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
      'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
        octet_length(row_data::text)::text || ':' || row_data::text || E'\\n',
        '' order by row_data::text
      ), ''), 'UTF8')), 'hex')
    ) from table_$index) as value
"@.TrimEnd())
  }
  $rows = $rowCtes -join ",`n"
  $tables = $tableSelects -join "`n  union all`n"
  return (Get-VDCurrentBaselineSqlPrefix) + @"

with target(name) as (values
$values
),
$identity,
$rows,
auth_users_rows as materialized (
  select to_jsonb(row_value) as row_data from only auth.users as row_value
),
table_payloads as materialized (
$tables
),
auth_users_payload as materialized (
  select jsonb_build_object(
    'row_count', count(*),
    'rows', coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb),
    'canonical_sha256', encode(sha256(convert_to(coalesce(string_agg(
      octet_length(row_data::text)::text || ':' || row_data::text || E'\\n',
      '' order by row_data::text
    ), ''), 'UTF8')), 'hex')
  ) as value
  from auth_users_rows
),
payload as materialized (
  select jsonb_build_object(
    'captured_at', statement_timestamp(),
    'current_user', current_user,
    'session_user', session_user,
    'current_role_bypasses_rls', exists (
      select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)
    ),
    'row_security', current_setting('row_security'),
    'source_database_identity', (select identity from source_identity),
    'migration_head', (select migration_head from migration_contract),
    'migration_count', (select migration_count from migration_contract),
    'migration_versions_sha256', (select versions_sha256 from migration_contract),
    'relations', (select value from relations),
    'tables', (select jsonb_object_agg(name, value order by name) from table_payloads),
    'auth_users', (select value from auth_users_payload)
  ) as value
)
select case when
  (value->>'current_role_bypasses_rls')::boolean
  and value->>'row_security' = 'off'
  and value->>'migration_head' = '$script:VDCurrentBaselineMigrationHead'
  and (value->>'migration_count')::integer = $script:VDCurrentBaselineMigrationCount
  and value->>'migration_versions_sha256' = '$script:VDCurrentBaselineMigrationVersionsSha256'
  and not exists (select 1 from target_relations where oid is null or relkind <> 'r')
  and pg_column_size(value) <= 33554432
  then value::text else null end as payload,
  pg_column_size(value)::bigint as payload_bytes
from payload;

commit;
"@
}

function Assert-VDCurrentBaselineSourceContract {
  param(
    [Parameter(Mandatory = $true)] $Value,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  foreach ($field in @(
    'captured_at', 'current_user', 'session_user', 'current_role_bypasses_rls',
    'row_security', 'source_database_identity', 'migration_head', 'migration_count',
    'migration_versions_sha256', 'relations'
  )) {
    if (-not $Value.PSObject.Properties[$field]) { throw "$Label is missing $field." }
  }
  if ([string]::IsNullOrWhiteSpace([string]$Value.current_user) -or
      [string]::IsNullOrWhiteSpace([string]$Value.session_user) -or
      -not [bool]$Value.current_role_bypasses_rls -or
      [string]$Value.row_security -ne 'off' -or
      [string]$Value.migration_head -ne $script:VDCurrentBaselineMigrationHead -or
      [int]$Value.migration_count -ne $script:VDCurrentBaselineMigrationCount -or
      [string]$Value.migration_versions_sha256 -ne $script:VDCurrentBaselineMigrationVersionsSha256) {
    throw "$Label source role or migration contract is invalid."
  }
  try { [void][DateTimeOffset]::Parse([string]$Value.captured_at) }
  catch { throw "$Label captured_at is invalid." }
  Assert-HBAM2RelationShapes -Relations $Value.relations `
    -ExpectedNames $script:VDCurrentBaselineExpectedTables -Label $Label
  foreach ($field in @('system_identifier', 'database_name', 'database_oid', 'server_version_num')) {
    if (-not $Value.source_database_identity.PSObject.Properties[$field] -or
        [string]::IsNullOrWhiteSpace([string]$Value.source_database_identity.$field)) {
      throw "$Label source database identity is incomplete."
    }
  }
  if ([string]$Value.source_database_identity.system_identifier -notmatch '^[1-9][0-9]{8,24}$' -or
      [string]$Value.source_database_identity.database_oid -notmatch '^[1-9][0-9]{0,9}$' -or
      [string]$Value.source_database_identity.server_version_num -notmatch '^[1-9][0-9]{4,7}$') {
    throw "$Label source database identity is invalid."
  }
}

function Get-VDCurrentBaselineInventorySha256 {
  param([Parameter(Mandatory = $true)] $Inventory)

  return Get-VDCurrentBaselineCanonicalJsonSha256 -Value ([ordered]@{
    current_user = [string]$Inventory.current_user
    session_user = [string]$Inventory.session_user
    current_role_bypasses_rls = [bool]$Inventory.current_role_bypasses_rls
    row_security = [string]$Inventory.row_security
    source_database_identity = $Inventory.source_database_identity
    migration_head = [string]$Inventory.migration_head
    migration_count = [int]$Inventory.migration_count
    migration_versions_sha256 = [string]$Inventory.migration_versions_sha256
    migration_versions = $Inventory.migration_versions
    relations = $Inventory.relations
    schema_contract = $Inventory.schema_contract
    auth_schema_contract = $Inventory.auth_schema_contract
  })
}

function Get-VDCurrentBaselineAuthContractDigests {
  param(
    [Parameter(Mandatory = $true)] $Inventory,
    [Parameter(Mandatory = $true)] $Logical,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  if (-not $Inventory.PSObject.Properties['auth_schema_contract'] -or
      -not $Logical.PSObject.Properties['auth_users']) {
    throw "$Label is missing the auth.users schema or logical payload."
  }
  $schema = @($Inventory.auth_schema_contract)
  if ($schema.Count -lt 1 -or $schema.Count -gt 256) {
    throw "$Label auth.users schema has an invalid column count."
  }
  $expectedSchemaFields = @(
    'collation', 'column_name', 'data_type', 'default_expression', 'generated',
    'identity', 'not_null', 'ordinal_position', 'table'
  )
  $columnNames = [Collections.Generic.List[string]]::new()
  for ($index = 0; $index -lt $schema.Count; $index++) {
    $column = $schema[$index]
    $actualFields = @($column.PSObject.Properties.Name | Sort-Object)
    if ($actualFields.Count -ne $expectedSchemaFields.Count -or
        @(Compare-Object -ReferenceObject $expectedSchemaFields -DifferenceObject $actualFields).Count -ne 0 -or
        [string]$column.table -ne 'auth.users' -or
        [int]$column.ordinal_position -ne ($index + 1) -or
        [string]$column.column_name -notmatch '^[a-z_][a-z0-9_]{0,62}$' -or
        [string]::IsNullOrWhiteSpace([string]$column.data_type) -or
        ([string]$column.data_type).Length -gt 256 -or
        $column.not_null -isnot [bool] -or
        [string]$column.identity -notmatch '^(|a|d)$' -or
        [string]$column.generated -ne '' -or
        ($null -ne $column.default_expression -and
          ($column.default_expression -isnot [string] -or
            ([string]$column.default_expression).Length -gt 4096)) -or
        ($null -ne $column.collation -and
          ($column.collation -isnot [string] -or ([string]$column.collation).Length -gt 256)) -or
        $columnNames.Contains([string]$column.column_name)) {
      throw "$Label auth.users schema contract is invalid."
    }
    $columnNames.Add([string]$column.column_name)
  }

  $authUsers = $Logical.auth_users
  $actualAuthFields = @($authUsers.PSObject.Properties.Name | Sort-Object)
  $expectedAuthFields = @('canonical_sha256', 'row_count', 'rows')
  if ($actualAuthFields.Count -ne $expectedAuthFields.Count -or
      @(Compare-Object -ReferenceObject $expectedAuthFields -DifferenceObject $actualAuthFields).Count -ne 0 -or
      [string]$authUsers.canonical_sha256 -notmatch '^[a-f0-9]{64}$') {
    throw "$Label auth.users logical contract is invalid."
  }
  try { $rowCount = [int64]$authUsers.row_count }
  catch { throw "$Label auth.users row count is invalid." }
  $rows = @($authUsers.rows)
  if ($rowCount -lt 0 -or $rowCount -gt 500000 -or $rowCount -ne $rows.Count) {
    throw "$Label auth.users row count is inconsistent."
  }
  $expectedRowFields = @($columnNames | Sort-Object)
  foreach ($row in $rows) {
    if ($null -eq $row -or $row -isnot [Management.Automation.PSCustomObject]) {
      throw "$Label auth.users contains a non-object row."
    }
    $actualRowFields = @($row.PSObject.Properties.Name | Sort-Object)
    if ($actualRowFields.Count -ne $expectedRowFields.Count -or
        @(Compare-Object -ReferenceObject $expectedRowFields -DifferenceObject $actualRowFields).Count -ne 0) {
      throw "$Label auth.users row shape differs from the captured schema."
    }
  }
  $canonicalSha = ([string]$authUsers.canonical_sha256).ToLowerInvariant()
  return [ordered]@{
    AuthSchemaContractSha256 = Get-VDCurrentBaselineCanonicalJsonSha256 -Value $schema
    AuthUsersCanonicalSha256 = $canonicalSha
    AuthUsersContractSha256 = Get-VDCurrentBaselineCanonicalJsonSha256 -Value ([ordered]@{
      row_count = $rowCount
      canonical_sha256 = $canonicalSha
    })
    AuthUsersRowCount = $rowCount
  }
}

function Get-VDCurrentBaselineImplementationFileSha256 {
  param([Parameter(Mandatory = $true)] [string] $Path)

  $bytes = Read-HBAM2BoundedFileBytes -Path $Path -MaximumBytes 2097152
  try { return (Get-HBAM2Sha256Hex -Bytes $bytes).ToLowerInvariant() }
  finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Get-VDCurrentBaselineCanonicalTextFileSha256 {
  param([Parameter(Mandatory = $true)] [string] $Path)

  $text = [IO.File]::ReadAllText($Path).Replace("`r`n", "`n").Replace("`r", "`n")
  return Get-VDCurrentBaselineUtf8Sha256Lower -Value $text
}

function New-VDCurrentBaselineImplementationFence {
  param(
    [Parameter(Mandatory = $true)] [string] $RepoRoot,
    [Parameter(Mandatory = $true)] [string] $ExpectedCommit
  )

  $streams = [Collections.Generic.List[IO.FileStream]]::new()
  $files = [ordered]@{}
  $gitBlobs = [ordered]@{}
  try {
    foreach ($relative in $script:VDCurrentBaselineImplementationPaths) {
      $path = [IO.Path]::GetFullPath((Join-Path $RepoRoot $relative.Replace('/', '\')))
      $prefix = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\') + '\'
      if (-not $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
          -not (Test-Path -LiteralPath $path -PathType Leaf) -or
          ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Current-baseline implementation provenance path escaped, linked, or is missing.'
      }
      $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      $streams.Add($stream)
      $files[$relative] = (Get-HBAM2StreamSha256Hex -Stream $stream).ToLowerInvariant()
      $gitBlobs[$relative] = (Get-HBAM2GitBlobSha256Hex `
        -RepoRoot $RepoRoot -Commit $ExpectedCommit -RelativePath $relative).ToLowerInvariant()
      if ($files[$relative] -ne $gitBlobs[$relative]) {
        throw 'Current-baseline implementation differs from the exact release commit.'
      }
    }
    return [pscustomobject]@{
      Streams = $streams
      Provenance = [ordered]@{
        git_commit = $ExpectedCommit
        files = $files
        git_blobs = $gitBlobs
      }
    }
  } catch {
    foreach ($stream in $streams) { $stream.Dispose() }
    throw
  }
}

function Assert-VDCurrentBaselineImplementationFence {
  param(
    [Parameter(Mandatory = $true)] $Fence,
    $Recorded
  )

  if ($Fence.Streams.Count -ne $script:VDCurrentBaselineImplementationPaths.Count) {
    throw 'Current-baseline implementation fence is incomplete.'
  }
  for ($index = 0; $index -lt $script:VDCurrentBaselineImplementationPaths.Count; $index++) {
    $relative = $script:VDCurrentBaselineImplementationPaths[$index]
    $hash = (Get-HBAM2StreamSha256Hex -Stream $Fence.Streams[$index]).ToLowerInvariant()
    if ($hash -ne [string]$Fence.Provenance.files[$relative] -or
        ($Recorded -and ($hash -ne [string](Get-HBAM2ObjectPropertyValue -Value $Recorded.files -Name $relative) -or
          $hash -ne [string](Get-HBAM2ObjectPropertyValue -Value $Recorded.git_blobs -Name $relative)))) {
      throw 'Current-baseline implementation changed or differs from recorded provenance.'
    }
  }
}

function Close-VDCurrentBaselineImplementationFence {
  param($Fence)
  if ($Fence -and $Fence.Streams) { foreach ($stream in $Fence.Streams) { $stream.Dispose() } }
}

function Assert-VDCurrentBaselineExactPushedGitState {
  param(
    [Parameter(Mandatory = $true)] [string] $RepoRoot,
    [Parameter(Mandatory = $true)] [string] $ExpectedCommit,
    [Parameter(Mandatory = $true)] [string] $ExpectedOrigin,
    [Parameter(Mandatory = $true)] [string] $RemoteRef
  )

  if ($ExpectedCommit -notmatch '^[a-f0-9]{40}$' -or
      [string]::IsNullOrWhiteSpace($ExpectedOrigin) -or
      $RemoteRef -notmatch '^origin/[A-Za-z0-9][A-Za-z0-9._/-]{0,198}$' -or
      $RemoteRef.Contains('..') -or $RemoteRef.Contains('//')) {
    throw 'Exact pushed Git fence arguments are invalid.'
  }
  $git = (Get-Command git.exe -ErrorAction Stop).Source
  $status = @(& $git -C $RepoRoot status --porcelain=v1 --untracked-files=all 2>$null)
  if ($LASTEXITCODE -ne 0 -or @($status | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count -ne 0) {
    throw 'Production backup requires a completely clean worktree.'
  }
  $head = @(& $git -C $RepoRoot rev-parse HEAD 2>$null)
  if ($LASTEXITCODE -ne 0 -or $head.Count -ne 1 -or [string]$head[0] -ne $ExpectedCommit) {
    throw 'Production backup HEAD differs from the expected release commit.'
  }
  $origin = @(& $git -C $RepoRoot remote get-url origin 2>$null)
  if ($LASTEXITCODE -ne 0 -or $origin.Count -ne 1 -or [string]$origin[0] -ne $ExpectedOrigin) {
    throw 'Production backup Git origin differs from the release contract.'
  }
  $branch = $RemoteRef.Substring('origin/'.Length)
  $remote = @(& $git -C $RepoRoot ls-remote --exit-code origin "refs/heads/$branch" 2>$null)
  if ($LASTEXITCODE -ne 0 -or $remote.Count -ne 1 -or
      [string]$remote[0] -ne "$ExpectedCommit`trefs/heads/$branch") {
    throw 'Production backup commit is not the exact pushed remote branch head.'
  }
}

Assert-VDCurrentBaselineConstants
