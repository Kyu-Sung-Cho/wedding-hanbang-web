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
  'account_deletion_jobs',
  'account_deletion_media_manifest',
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
  'amora_tool_executions',
  'amora_turn_counters',
  'amora_turn_requests',
  'booking_projection_jobs',
  'chat_feedback',
  'chat_messages',
  'chat_summaries',
  'community_upload_sessions',
  'couples',
  'decision_nodes',
  'profiles',
  'vendor_reviews',
  'wedding_journeys'
)
$ExpectedReleaseMigrationBaselineHead = '20260715210000'
$ExpectedReleaseMigrationHead = '20260716117000'
$ExpectedReleaseMigrationVersions = @(
  '20260716090000',
  '20260716091000',
  '20260716092000',
  '20260716093000',
  '20260716094000',
  '20260716095000',
  '20260716096000',
  '20260716097000',
  '20260716098000',
  '20260716099000',
  '20260716100000',
  '20260716102000',
  '20260716103000',
  '20260716104000',
  '20260716105000',
  '20260716106000',
  '20260716107000',
  '20260716108000',
  '20260716109000',
  '20260716110000',
  '20260716111000',
  '20260716112000',
  '20260716113000',
  '20260716114000',
  '20260716115000',
  '20260716116000',
  '20260716117000'
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
  'reserve_amora_turn(uuid,integer,integer,bigint,bigint)',
  'prepare_amora_provider_call_receipt(uuid,uuid,text,text,text,text,integer,text,text,jsonb)',
  'reserve_amora_provider_call(uuid,uuid,text,uuid,integer,integer,bigint,bigint)',
  'finalize_amora_provider_call_receipt(uuid,uuid,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
  'claim_amora_tool_execution(uuid,text,text,text,text)',
  'claim_amora_tool_execution(uuid,text,text,text,text,integer)',
  'claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid)',
  'claim_community_upload_session(uuid,uuid,uuid,timestamp with time zone)',
  'begin_account_deletion_job(uuid,text)',
  'claim_account_deletion_job(uuid,uuid,timestamp with time zone)',
  'replace_account_deletion_media_manifest(uuid,uuid,jsonb)',
  'release_account_deletion_job(uuid,uuid,text)',
  'mark_account_deletion_manual_review(uuid,uuid,text)',
  'resume_account_deletion_after_manual_review(uuid)',
  'checkpoint_account_deletion_media(uuid,uuid,text,text)',
  'prepare_account_deletion_auth_delete(uuid,uuid)',
  'finalize_account_deletion_job(uuid,uuid)',
  'apply_journey_progress_patch(uuid,jsonb,text[])',
  'apply_journey_progress_item_patch(uuid,text,jsonb)',
  'join_couple(text,text)',
  'generate_invite_code()',
  'redact_old_ai_interactions(interval)',
  'create_profile_on_signup()',
  'reset_amora_memory_after_membership_change()',
  'has_current_amora_memory_consent(uuid,text)',
  'enqueue_amora_memory_job(uuid,uuid,text,uuid)',
  'claim_amora_memory_job(integer,uuid)',
  'finish_amora_memory_job(uuid,boolean,text,integer)',
  'upsert_amora_memory_node(uuid,text,text,text,text,text,text,numeric,text,uuid,jsonb)',
  'update_amora_memory_node(uuid,text,uuid,uuid,text,text)',
  'delete_amora_memory_node(uuid,text,uuid,uuid)',
  'insert_amora_memory_summary(uuid,uuid,text,text,integer,uuid,uuid)',
  'commit_amora_memory_job(uuid,integer,jsonb,text,integer,uuid,uuid)',
  'bind_amora_mediation_proposal()',
  'accept_amora_mediation(uuid,uuid,uuid,text,text,uuid,text)',
  'revoke_amora_mediation_acceptance(uuid,uuid,uuid)',
  'reset_amora_mediation_after_membership_change()',
  'insert_amora_care_message(uuid,text,jsonb)',
  'claim_amora_care_scan(date,integer)',
  'advance_amora_care_scan(date,uuid,uuid,uuid,integer,boolean,integer)',
  'enqueue_amora_care_job(uuid,date,text,text,jsonb,text,text)',
  'claim_amora_care_job(integer,uuid)',
  'prepare_amora_care_job(uuid,uuid,boolean)',
  'claim_amora_care_email_delivery(uuid,uuid)',
  'amora_care_delivery_clock()',
  'amora_care_is_delivery_window(timestamp with time zone)',
  'amora_care_next_delivery_window(timestamp with time zone)',
  'get_amora_care_queue_stats(date)',
  'enqueue_amora_care_job_pre_delivery_policy(uuid,date,text,text,jsonb,text,text)',
  'prepare_amora_care_job_pre_delivery_policy(uuid,uuid,boolean)',
  'claim_amora_care_email_delivery_pre_delivery_policy(uuid,uuid)',
  'finish_amora_care_email_delivery(uuid,uuid,boolean,text,text)',
  'finish_amora_care_job(uuid,uuid)',
  'set_amora_care_consent(uuid,boolean)',
  'quarantine_amora_care_queue(text)',
  'prevent_direct_amora_care_consent_change()',
  'defer_amora_memory_job(uuid,integer,integer,text)',
  'enqueue_booking_projection_job()',
  'claim_booking_projection_job(uuid,integer)',
  'finish_booking_projection_job(uuid,bigint,uuid,boolean,text,integer)',
  'get_booking_projection_queue_stats()',
  'retry_booking_projection_job(uuid)',
  'apply_booking_progress_projection(uuid,uuid,text,jsonb,text,numeric,bigint,uuid)',
  'claim_amora_conflict_check(uuid,text,uuid)',
  'checkpoint_amora_conflict_check(uuid,text,uuid,jsonb)',
  'complete_amora_conflict_check(uuid,text,uuid,jsonb)',
  'fail_amora_conflict_check(uuid,text,uuid,text)',
  'patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean)',
  'finalize_amora_conflict_verify_receipt(uuid,uuid,uuid,text,uuid,jsonb,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
  'finalize_amora_chat_response(uuid,uuid,uuid,uuid,text,text,integer,text,jsonb,text,text,boolean,text,bigint,boolean,text,text,integer,integer,integer,jsonb)',
  'reconcile_amora_chat_response(uuid,text,uuid,text,uuid)',
  'get_wedding_settings_snapshot(uuid)',
  'patch_wedding_settings_atomic(uuid,uuid,boolean,text,boolean,text,text,boolean,text,date,boolean,date,text,boolean,text,bigint,boolean,bigint)',
  'set_amora_memory_consent(uuid,text,uuid,boolean)',
  'clear_amora_memory_scope(uuid,text,uuid)'
)
$ForbiddenFunctionIdentities = @(
  'accept_amora_mediation(uuid,uuid,uuid,text,text)'
)
$RequiredCarePolicyMigrationVersion = '20260716095000'
$RequiredCarePolicyColumn = 'amora_care_deliveries.send_day'
$RequiredCarePolicyConstraint = 'profiles_care_consent_state_valid'
$RequiredCarePolicyIndexes = @(
  'amora_care_deliveries_user_send_day_uidx',
  'amora_care_jobs_active_age_idx',
  'amora_care_jobs_scan_status_idx'
)
$RequiredCarePolicyFunctions = @(
  'amora_care_delivery_clock()',
  'amora_care_is_delivery_window(timestamp with time zone)',
  'amora_care_next_delivery_window(timestamp with time zone)',
  'claim_amora_care_email_delivery(uuid,uuid)',
  'claim_amora_care_email_delivery_pre_delivery_policy(uuid,uuid)',
  'enqueue_amora_care_job(uuid,date,text,text,jsonb,text,text)',
  'enqueue_amora_care_job_pre_delivery_policy(uuid,date,text,text,jsonb,text,text)',
  'get_amora_care_queue_stats(date)',
  'prepare_amora_care_job(uuid,uuid,boolean)',
  'prepare_amora_care_job_pre_delivery_policy(uuid,uuid,boolean)'
)
$RequiredMemoryDeferralMigrationVersion = '20260716098000'
$RequiredMemoryDeferralFunction = 'defer_amora_memory_job(uuid,integer,integer,text)'
$RequiredAccountDeletionMigrationVersion = '20260716113000'
$RequiredAccountDeletionTables = @(
  'account_deletion_jobs',
  'account_deletion_media_manifest'
)
$RequiredAccountDeletionFunctions = @(
  'begin_account_deletion_job(uuid,text)',
  'claim_account_deletion_job(uuid,uuid,timestamp with time zone)',
  'replace_account_deletion_media_manifest(uuid,uuid,jsonb)',
  'release_account_deletion_job(uuid,uuid,text)',
  'mark_account_deletion_manual_review(uuid,uuid,text)',
  'resume_account_deletion_after_manual_review(uuid)',
  'checkpoint_account_deletion_media(uuid,uuid,text,text)',
  'prepare_account_deletion_auth_delete(uuid,uuid)',
  'finalize_account_deletion_job(uuid,uuid)'
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

function Assert-CareDeliveryPolicyContract {
  param(
    [Parameter(Mandatory = $true)] $Contract,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  foreach ($field in @(
    'migration_version', 'migration_present', 'column', 'column_present',
    'constraint', 'constraint_present', 'indexes', 'indexes_present',
    'functions', 'functions_present'
  )) {
    if (-not $Contract.PSObject.Properties[$field]) {
      throw "$Label care delivery policy contract is missing $field."
    }
  }
  $actualIndexes = @($Contract.indexes | ForEach-Object { [string]$_ } | Sort-Object)
  $actualFunctions = @($Contract.functions | ForEach-Object { [string]$_ } | Sort-Object)
  foreach ($field in @(
    'migration_present', 'column_present', 'constraint_present',
    'indexes_present', 'functions_present'
  )) {
    if ($Contract.$field -isnot [bool] -or $Contract.$field -ne $true) {
      throw "$Label care delivery policy contract has an invalid $field boolean."
    }
  }
  if ([string]$Contract.migration_version -cne $RequiredCarePolicyMigrationVersion -or
      [string]$Contract.column -cne $RequiredCarePolicyColumn -or
      [string]$Contract.constraint -cne $RequiredCarePolicyConstraint -or
      $actualIndexes.Count -ne $RequiredCarePolicyIndexes.Count -or
      @(Compare-Object -ReferenceObject $RequiredCarePolicyIndexes -DifferenceObject $actualIndexes -CaseSensitive).Count -ne 0 -or
      $actualFunctions.Count -ne $RequiredCarePolicyFunctions.Count -or
      @(Compare-Object -ReferenceObject $RequiredCarePolicyFunctions -DifferenceObject $actualFunctions -CaseSensitive).Count -ne 0) {
    throw "$Label care delivery policy contract failed."
  }
}

function Assert-MemoryBudgetDeferralContract {
  param(
    [Parameter(Mandatory = $true)] $Contract,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  foreach ($field in @(
    'migration_version', 'migration_present', 'function', 'function_present',
    'service_role_execute', 'anon_execute', 'authenticated_execute', 'service_only'
  )) {
    if (-not $Contract.PSObject.Properties[$field]) {
      throw "$Label memory budget deferral contract is missing $field."
    }
  }
  foreach ($field in @('migration_present', 'function_present', 'service_role_execute', 'service_only')) {
    if ($Contract.$field -isnot [bool] -or $Contract.$field -ne $true) {
      throw "$Label memory budget deferral contract has an invalid $field boolean."
    }
  }
  foreach ($field in @('anon_execute', 'authenticated_execute')) {
    if ($Contract.$field -isnot [bool] -or $Contract.$field -ne $false) {
      throw "$Label memory budget deferral contract has an invalid $field boolean."
    }
  }
  if ([string]$Contract.migration_version -cne $RequiredMemoryDeferralMigrationVersion -or
      [string]$Contract.function -cne $RequiredMemoryDeferralFunction) {
    throw "$Label memory budget deferral service-only contract failed."
  }
}

function Assert-ReleaseMigrationContract {
  param(
    [Parameter(Mandatory = $true)] $Contract,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  foreach ($field in @(
    'baseline_head', 'expected_head', 'actual_head',
    'expected_versions', 'actual_versions', 'exact'
  )) {
    if (-not $Contract.PSObject.Properties[$field]) {
      throw "$Label release migration contract is missing $field."
    }
  }

  $expected = @($Contract.expected_versions | ForEach-Object { [string]$_ })
  $actual = @($Contract.actual_versions | ForEach-Object { [string]$_ })
  if ($Contract.exact -isnot [bool] -or $Contract.exact -ne $true -or
      [string]$Contract.baseline_head -cne $ExpectedReleaseMigrationBaselineHead -or
      [string]$Contract.expected_head -cne $ExpectedReleaseMigrationHead -or
      [string]$Contract.actual_head -cne $ExpectedReleaseMigrationHead -or
      $expected.Count -ne $ExpectedReleaseMigrationVersions.Count -or
      $actual.Count -ne $ExpectedReleaseMigrationVersions.Count -or
      ($expected -join "`n") -cne ($ExpectedReleaseMigrationVersions -join "`n") -or
      ($actual -join "`n") -cne ($ExpectedReleaseMigrationVersions -join "`n")) {
    throw "$Label release migration ledger is not the exact reviewed 27-version set."
  }
}

function Assert-PolicyInventoryDetails {
  param(
    [Parameter(Mandatory = $true)] $Inventory,
    [Parameter(Mandatory = $true)] [string[]] $FunctionIdentities
  )

  $migrationVersions = @($Inventory.migration_history | ForEach-Object { [string]$_.version })
  $actualHead = @($migrationVersions | Sort-Object | Select-Object -Last 1)
  $releaseMigrationVersions = @($migrationVersions | Where-Object {
    [string]::CompareOrdinal($_, $ExpectedReleaseMigrationBaselineHead) -gt 0
  } | Sort-Object)
  if ($actualHead.Count -ne 1 -or
      [string]$actualHead[0] -cne $ExpectedReleaseMigrationHead -or
      $releaseMigrationVersions.Count -ne $ExpectedReleaseMigrationVersions.Count -or
      ($releaseMigrationVersions -join "`n") -cne ($ExpectedReleaseMigrationVersions -join "`n")) {
    throw 'Schema inventory migration history is not the exact reviewed 27-version release set.'
  }
  foreach ($version in @(
    $RequiredCarePolicyMigrationVersion,
    $RequiredMemoryDeferralMigrationVersion,
    $RequiredAccountDeletionMigrationVersion
  )) {
    if ($version -notin $migrationVersions) {
      throw "Schema inventory is missing required migration version $version."
    }
  }

  $sendDayColumns = @($Inventory.columns | Where-Object {
    [string]$_.table_name -ceq 'amora_care_deliveries' -and
    [string]$_.column_name -ceq 'send_day'
  })
  if ($sendDayColumns.Count -ne 1 -or
      [string]$sendDayColumns[0].data_type -cne 'date' -or
      [string]$sendDayColumns[0].udt_name -cne 'date') {
    throw 'Schema inventory is missing the exact amora_care_deliveries.send_day date column.'
  }

  $consentConstraints = @($Inventory.constraints | Where-Object {
    [string]$_.table -ceq 'profiles' -and
    [string]$_.name -ceq $RequiredCarePolicyConstraint
  })
  if ($consentConstraints.Count -ne 1 -or
      [string]$consentConstraints[0].type -cne 'c' -or
      $consentConstraints[0].validated -isnot [bool] -or
      $consentConstraints[0].validated -ne $true -or
      [string]$consentConstraints[0].definition -notmatch 'care_notifications_enabled' -or
      [string]$consentConstraints[0].definition -notmatch 'care_notifications_consented_at') {
    throw 'Schema inventory is missing the validated care consent state constraint.'
  }

  foreach ($indexName in $RequiredCarePolicyIndexes) {
    $matches = @($Inventory.indexes | Where-Object { [string]$_.name -ceq $indexName })
    if ($matches.Count -ne 1) {
      throw "Schema inventory is missing required care policy index $indexName."
    }
    $definition = ([string]$matches[0].definition).ToLowerInvariant() -replace '"', '' -replace '\s+', ' '
    $valid = switch ($indexName) {
      'amora_care_deliveries_user_send_day_uidx' {
        [string]$matches[0].table -ceq 'amora_care_deliveries' -and
        $definition -match '^create unique index ' -and
        $definition -match '\(user_id,\s*send_day\)' -and
        $definition -match 'where .*send_day is not null'
      }
      'amora_care_jobs_scan_status_idx' {
        [string]$matches[0].table -ceq 'amora_care_jobs' -and
        $definition -match '\(scan_day,\s*status\)'
      }
      'amora_care_jobs_active_age_idx' {
        [string]$matches[0].table -ceq 'amora_care_jobs' -and
        $definition -match '\(created_at\)' -and
        $definition -match 'where ' -and
        $definition -match 'status' -and
        $definition -match 'pending' -and
        $definition -match 'processing'
      }
    }
    if (-not $valid) { throw "Schema inventory care policy index definition is invalid for $indexName." }
  }

  if ($RequiredMemoryDeferralFunction -notin $FunctionIdentities) {
    throw "Schema inventory is missing required function signature $RequiredMemoryDeferralFunction."
  }
  $memoryFunctions = @($Inventory.functions | Where-Object {
    (([string]$_.identity).ToLowerInvariant() -replace '^public\.', '') -ceq $RequiredMemoryDeferralFunction
  })
  if ($memoryFunctions.Count -ne 1) {
    throw 'Schema inventory memory budget deferral function identity is ambiguous.'
  }
  $memoryFunction = $memoryFunctions[0]
  $memoryConfig = @($memoryFunction.config | ForEach-Object { [string]$_ })
  $memoryAcl = @($memoryFunction.acl | ForEach-Object { [string]$_ })
  if ([string]$memoryFunction.owner -cne 'postgres' -or
      $memoryFunction.security_definer -isnot [bool] -or
      $memoryFunction.security_definer -ne $true -or
      'search_path=pg_catalog, public' -notin $memoryConfig -or
      'lock_timeout=5s' -notin $memoryConfig -or
      'statement_timeout=30s' -notin $memoryConfig -or
      @($memoryAcl | Where-Object { $_ -ceq 'service_role=X/postgres' }).Count -ne 1 -or
      @($memoryAcl | Where-Object { $_ -cmatch '^(=|anon=|authenticated=).*X' }).Count -ne 0) {
    throw 'Schema inventory memory budget deferral function ACL/configuration is not service-only.'
  }

  foreach ($tableName in $RequiredAccountDeletionTables) {
    $table = @($Inventory.tables | Where-Object { [string]$_.name -ceq $tableName })
    if ($table.Count -ne 1 -or
        $table[0].rls -isnot [bool] -or $table[0].rls -ne $true -or
        $table[0].force_rls -isnot [bool] -or $table[0].force_rls -ne $true) {
      throw "Schema inventory account deletion table $tableName is not FORCE RLS."
    }
  }
  foreach ($identity in $RequiredAccountDeletionFunctions) {
    $matches = @($Inventory.functions | Where-Object {
      (([string]$_.identity).ToLowerInvariant() -replace '^public\.', '') -ceq $identity
    })
    if ($matches.Count -ne 1) {
      throw "Schema inventory account deletion function identity is ambiguous: $identity."
    }
    $function = $matches[0]
    $config = @($function.config | ForEach-Object { [string]$_ })
    $acl = @($function.acl | ForEach-Object { [string]$_ })
    if ([string]$function.owner -cne 'postgres' -or
        $function.security_definer -isnot [bool] -or $function.security_definer -ne $true -or
        @($config | Where-Object { $_ -ceq 'search_path=' -or $_ -ceq 'search_path=""' }).Count -ne 1 -or
        @($acl | Where-Object { $_ -ceq 'service_role=X/postgres' }).Count -ne 1 -or
        @($acl | Where-Object { $_ -cmatch '^(=|anon=|authenticated=).*X' }).Count -ne 0) {
      throw "Schema inventory account deletion function is not empty-search-path service-only: $identity."
    }
  }
}

function Assert-InventoryDependencies {
  param([Parameter(Mandatory = $true)] $Inventory)

  foreach ($field in @(
    'captured_at', 'current_user', 'session_user', 'current_role_bypasses_rls', 'row_security',
    'server_version_num', 'live_schema_contract_sha256', 'migration_history', 'tables', 'columns',
    'constraints', 'indexes', 'policies', 'triggers', 'functions', 'external_triggers',
    'care_delivery_policy', 'memory_budget_deferral', 'release_migrations'
  )) {
    if (-not $Inventory.PSObject.Properties[$field]) { throw "Schema inventory is missing $field." }
  }
  if ([string]::IsNullOrWhiteSpace([string]$Inventory.current_user) -or
      [string]::IsNullOrWhiteSpace([string]$Inventory.session_user) -or
      -not [bool]$Inventory.current_role_bypasses_rls -or
      [string]$Inventory.row_security -ne 'off' -or
      [string]$Inventory.live_schema_contract_sha256 -notmatch '^[A-F0-9]{64}$') {
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
  foreach ($identity in $ForbiddenFunctionIdentities) {
    if ($identity -in $identities) {
      throw "Schema inventory contains forbidden legacy function signature $identity."
    }
  }
  Assert-CareDeliveryPolicyContract -Contract $Inventory.care_delivery_policy -Label 'Schema inventory'
  Assert-MemoryBudgetDeferralContract -Contract $Inventory.memory_budget_deferral -Label 'Schema inventory'
  Assert-ReleaseMigrationContract -Contract $Inventory.release_migrations -Label 'Schema inventory'
  Assert-PolicyInventoryDetails -Inventory $Inventory -FunctionIdentities $identities
  $requiredTriggers = @(
    [pscustomobject]@{ Table = 'couples'; Name = 'trg_reset_amora_memory_after_membership_change'; Timing = 'AFTER'; Insert = $false; Update = $true; Function = 'reset_amora_memory_after_membership_change' },
    [pscustomobject]@{ Table = 'couples'; Name = 'trg_reset_amora_mediation_after_membership_change'; Timing = 'AFTER'; Insert = $false; Update = $true; Function = 'reset_amora_mediation_after_membership_change' },
    [pscustomobject]@{ Table = 'chat_messages'; Name = 'trg_bind_amora_mediation_proposal'; Timing = 'BEFORE'; Insert = $true; Update = $true; Function = 'bind_amora_mediation_proposal' }
  )
  foreach ($required in $requiredTriggers) {
    $matches = @($Inventory.triggers | Where-Object {
      [string]$_.table -eq $required.Table -and
      [string]$_.name -eq $required.Name -and
      [string]$_.enabled -in @('O', 'A') -and
      [bool]$_.row_level -and
      [string]$_.timing -eq $required.Timing -and
      [bool]$_.fires_insert -eq $required.Insert -and
      [bool]$_.fires_update -eq $required.Update -and
      -not [bool]$_.fires_delete -and
      -not [bool]$_.fires_truncate -and
      [string]$_.function_identity -match "(^|\.)$([regex]::Escape($required.Function))\("
    })
    if ($matches.Count -ne 1) {
      throw "Schema inventory is missing required safety trigger $($required.Name)."
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
  if (@($Inventory.external_triggers | Where-Object {
    [string]$_.schema -eq 'public' -and
    [string]$_.table -eq 'vendor_bookings' -and
    [string]$_.name -eq 'vendor_bookings_projection_outbox' -and
    [string]$_.enabled -in @('O', 'A') -and
    [int]$_.type_bits -eq 21 -and
    [bool]$_.row_level -and
    [bool]$_.fires_insert -and
    [bool]$_.fires_update -and
    -not [bool]$_.fires_delete -and
    -not [bool]$_.fires_truncate -and
    [string]$_.timing -eq 'AFTER' -and
    [string]$_.function_identity -match '(^|\.)enqueue_booking_projection_job\('
  }).Count -ne 1) {
    throw 'Schema inventory is missing the enabled vendor booking projection outbox trigger.'
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
    live_schema_contract_sha256 = $Inventory.live_schema_contract_sha256
    migration_history = $Inventory.migration_history
    tables = $Inventory.tables
    columns = $Inventory.columns
    constraints = $Inventory.constraints
    indexes = $Inventory.indexes
    policies = $Inventory.policies
    triggers = $Inventory.triggers
    functions = $Inventory.functions
    external_triggers = $Inventory.external_triggers
    care_delivery_policy = $Inventory.care_delivery_policy
    memory_budget_deferral = $Inventory.memory_budget_deferral
    release_migrations = $Inventory.release_migrations
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
  'source_relation_contract_sha256', 'live_schema_contract_sha256',
  'logical_data_contract_sha256',
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
if ([string]$manifest.live_schema_contract_sha256 -notmatch '^[A-F0-9]{64}$') {
  throw 'Manifest live schema contract digest is invalid.'
}
if ([string]$manifest.logical_data_contract_sha256 -notmatch '^[A-F0-9]{64}$') {
  throw 'Manifest logical data contract digest is invalid.'
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
  if ([string]$inventory.live_schema_contract_sha256 -cne
      [string]$manifest.live_schema_contract_sha256) {
    throw 'Authenticated live schema contract digest mismatch.'
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
      -not $data.PSObject.Properties['care_delivery_policy'] -or
      -not $data.PSObject.Properties['memory_budget_deferral'] -or
      -not $data.PSObject.Properties['release_migrations'] -or
      -not $data.PSObject.Properties['tables'] -or
      [string]$data.captured_at -ne [string]$manifest.source_captured_at) {
    throw 'Authenticated logical data timestamp, role, or table metadata is invalid.'
  }
  Assert-CareDeliveryPolicyContract -Contract $data.care_delivery_policy -Label 'Authenticated logical backup'
  Assert-MemoryBudgetDeferralContract -Contract $data.memory_budget_deferral -Label 'Authenticated logical backup'
  Assert-ReleaseMigrationContract -Contract $data.release_migrations -Label 'Authenticated logical backup'
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
  $logicalDataContract = Get-HBAM2LogicalDataContractSha256 `
    -Tables $data.tables `
    -ExpectedNames $ExpectedTables `
    -Label 'Authenticated logical backup'
  if ($logicalDataContract -cne [string]$manifest.logical_data_contract_sha256) {
    throw 'Authenticated logical data contract digest mismatch.'
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
    LiveSchemaContractSha256 = [string]$inventory.live_schema_contract_sha256
    LogicalDataContractSha256 = $logicalDataContract
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
