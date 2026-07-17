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
. (Join-Path $PSScriptRoot 'amora-db-backup-common.ps1')

$MaximumEstimatedSourceBytes = 16777216
$MaximumEstimatedRows = 250000
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
  Write-Host 'Amora production logical backup'
  Write-Host ''
  Write-Host 'Creates an encrypted data snapshot with schema inventories captured before and'
  Write-Host 'after the data statement. The script creates no plaintext payload file. The root is'
  Write-Host 'fixed under LOCALAPPDATA and protected with an exact private Windows ACL.'
  Write-Host ''
  Write-Host 'Usage:'
  Write-Host '  corepack pnpm amora:db:backup -ExpectedProjectRef <project-ref>'
  Write-Host ''
  Write-Host '-Help performs no project, filesystem, or database operation.'
  Write-Host ''
}

function ConvertTo-NativeProcessArgument {
  param([Parameter(Mandatory = $true)] [string] $Value)

  if ($Value.Contains('"') -or $Value.Contains("`r") -or $Value.Contains("`n")) {
    throw 'Native process argument contains an unsupported character.'
  }
  return '"' + $Value + '"'
}

function Invoke-LinkedQuery {
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
  ) | ForEach-Object { ConvertTo-NativeProcessArgument -Value $_ }) -join ' '
  $startInfo.WorkingDirectory = $Workdir
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
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
  } finally {
    $process.Dispose()
  }

  if ([string]::IsNullOrWhiteSpace($raw)) { throw 'Supabase query returned no JSON.' }
  if ([Text.Encoding]::UTF8.GetByteCount($raw) -gt ($script:HBAM2MaximumPayloadBytes + 1048576)) {
    throw 'Supabase query response exceeded the configured size limit.'
  }
  try { $response = $raw | ConvertFrom-Json }
  catch { throw 'Supabase query returned invalid JSON.' }
  $rows = @($response.rows)
  if ($rows.Count -ne 1 -or -not $rows[0].PSObject.Properties['payload']) {
    throw 'Supabase query returned an unexpected response shape.'
  }
  if ($rows[0].PSObject.Properties['payload_bytes'] -and
      [int64]$rows[0].payload_bytes -gt $script:HBAM2MaximumPayloadBytes) {
    throw 'Supabase query payload exceeded the configured size limit.'
  }
  $payload = [string]$rows[0].payload
  if ([string]::IsNullOrWhiteSpace($payload)) {
    throw 'Supabase query was rejected by its server-side safety bound.'
  }
  return $payload
}

function ConvertFrom-RequiredJson {
  param(
    [Parameter(Mandatory = $true)] [string] $Json,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  try { return $Json | ConvertFrom-Json }
  catch { throw "$Label payload is not valid JSON." }
}

function Read-LinkedRefFence {
  param([Parameter(Mandatory = $true)] [IO.FileStream] $Stream)

  $Stream.Position = 0
  $reader = [IO.StreamReader]::new(
    $Stream,
    [Text.Encoding]::UTF8,
    $true,
    1024,
    $true
  )
  try { return $reader.ReadToEnd().Trim() }
  finally { $reader.Dispose() }
}

function Get-TableNamesFromInventory {
  param([Parameter(Mandatory = $true)] $Inventory)
  return @($Inventory.tables | ForEach-Object { [string]$_.name } | Sort-Object)
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
    if (-not $Inventory.PSObject.Properties[$field]) {
      throw "Schema inventory is missing $field."
    }
  }
  if ([string]::IsNullOrWhiteSpace([string]$Inventory.current_user) -or
      [string]::IsNullOrWhiteSpace([string]$Inventory.session_user) -or
      -not [bool]$Inventory.current_role_bypasses_rls -or
      [string]$Inventory.row_security -ne 'off' -or
      [string]$Inventory.live_schema_contract_sha256 -notmatch '^[A-F0-9]{64}$') {
    throw 'Schema inventory was not captured by an explicit RLS-bypass role.'
  }
  Assert-ExactTableAllowlist -Actual (Get-TableNamesFromInventory -Inventory $Inventory) -Label 'Inventory'
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
  $signupTriggers = @($Inventory.external_triggers | Where-Object {
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
  })
  if ($signupTriggers.Count -lt 1) {
    throw 'Schema inventory is missing an enabled auth.users signup trigger dependency.'
  }
  $projectionTriggers = @($Inventory.external_triggers | Where-Object {
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
  })
  if ($projectionTriggers.Count -ne 1) {
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

function Assert-Preflight {
  param(
    [Parameter(Mandatory = $true)] $Preflight,
    [Parameter(Mandatory = $true)] [string] $ProjectRef
  )

  foreach ($field in @(
    'captured_at', 'source_project_ref', 'current_user', 'session_user',
    'current_role_bypasses_rls', 'row_security', 'server_version_num', 'table_count',
    'estimated_total_bytes', 'estimated_total_rows', 'tables',
    'care_delivery_policy', 'memory_budget_deferral', 'release_migrations'
  )) {
    if (-not $Preflight.PSObject.Properties[$field]) { throw "Preflight is missing $field." }
  }
  [void](ConvertTo-ValidatedTimestamp -Value ([string]$Preflight.captured_at) -Label 'Preflight captured_at')
  Assert-CareDeliveryPolicyContract -Contract $Preflight.care_delivery_policy -Label 'Preflight'
  Assert-MemoryBudgetDeferralContract -Contract $Preflight.memory_budget_deferral -Label 'Preflight'
  Assert-ReleaseMigrationContract -Contract $Preflight.release_migrations -Label 'Preflight'
  $preflightNames = @($Preflight.tables | ForEach-Object { [string]$_.name } | Sort-Object)
  Assert-ExactTableAllowlist -Actual $preflightNames -Label 'Preflight'
  Assert-HBAM2RelationShapes `
    -Relations $Preflight.tables `
    -ExpectedNames $ExpectedTables `
    -Label 'Preflight'
  if ([int]$Preflight.table_count -ne $ExpectedTables.Count -or
      [int64]$Preflight.estimated_total_bytes -gt $MaximumEstimatedSourceBytes -or
      [int64]$Preflight.estimated_total_rows -gt $MaximumEstimatedRows -or
      [int64]$Preflight.estimated_total_bytes -lt 0 -or
      [int64]$Preflight.estimated_total_rows -lt 0) {
    throw 'Preflight source-size or table-count safety gate failed.'
  }
  $reportedRef = [string]$Preflight.source_project_ref
  if (-not [string]::IsNullOrWhiteSpace($reportedRef) -and $reportedRef -ne $ProjectRef) {
    throw 'Preflight reported a project ref that conflicts with the linked source fence.'
  }
  if ([string]::IsNullOrWhiteSpace([string]$Preflight.current_user) -or
      [string]::IsNullOrWhiteSpace([string]$Preflight.session_user) -or
      -not [bool]$Preflight.current_role_bypasses_rls -or
      [string]$Preflight.row_security -ne 'off') {
    throw 'Preflight was not executed by an explicit RLS-bypass role.'
  }
}

if ($Help) { Show-Help; exit 0 }
if ([string]::IsNullOrWhiteSpace($ExpectedProjectRef) -or
    $ExpectedProjectRef -notmatch '^[a-z0-9]{20}$') {
  throw '-ExpectedProjectRef must be an explicit 20-character project ref.'
}
if ($env:OS -ne 'Windows_NT') { throw 'This backup format requires Windows DPAPI.' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$linkedRefPath = Join-Path $repoRoot 'supabase\.temp\project-ref'
if (-not (Test-Path -LiteralPath $linkedRefPath -PathType Leaf)) {
  throw 'Supabase is not linked in this worktree.'
}
$linkedRef = ([IO.File]::ReadAllText($linkedRefPath)).Trim()
if ($linkedRef -ne $ExpectedProjectRef) {
  throw 'Linked project ref does not match -ExpectedProjectRef.'
}
$preflightSql = Join-Path $PSScriptRoot 'sql\amora-db-preflight.sql'
$inventorySql = Join-Path $PSScriptRoot 'sql\amora-db-inventory.sql'
$dataSql = Join-Path $PSScriptRoot 'sql\amora-db-logical-backup.sql'
foreach ($sqlFile in @($preflightSql, $inventorySql, $dataSql)) {
  if (-not (Test-Path -LiteralPath $sqlFile -PathType Leaf)) { throw 'Required Amora backup SQL is missing.' }
  Assert-HBAM2ReadOnlySqlSafetyGuard -Path $sqlFile
}

$rootInfo = Resolve-HBAM2BackupRoot -SelfTest ([bool]$SelfTest) -SelfTestBackupRoot $SelfTestBackupRoot
Initialize-HBAM2BackupRoot -Root $rootInfo.Root -Anchor $rootInfo.Anchor
$resolvedRoot = $rootInfo.Root
$parent = [IO.Path]::GetFullPath($resolvedRoot).TrimEnd('\')
$finalDirectory = $null
$stagingDirectory = $null
$backupSetId = [Guid]::NewGuid().ToString('D')
$inventoryBytes = $null
$dataBytes = $null
$published = $false
$linkedRefFenceStream = $null
$implementationFence = $null
$cliFence = $null
$captureLock = $null
$verifierRuntimeContract = $null

try {
  $captureLock = New-HBAM2CaptureLock -Root $resolvedRoot
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $finalDirectory = Join-Path $resolvedRoot $timestamp
  $stagingDirectory = Join-Path $resolvedRoot ".partial-$timestamp-$([Guid]::NewGuid().ToString('N'))"
  if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($finalDirectory)).TrimEnd('\') -ne $parent -or
      [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($stagingDirectory)).TrimEnd('\') -ne $parent -or
      [IO.Path]::GetFileName($finalDirectory) -notmatch '^\d{8}-\d{6}$' -or
      [IO.Path]::GetFileName($stagingDirectory) -notmatch '^\.partial-\d{8}-\d{6}-[a-f0-9]{32}$' -or
      (Test-Path -LiteralPath $finalDirectory)) {
    throw 'Backup destination path failed containment or uniqueness validation.'
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
  $linkedRefFenceStream = [IO.File]::Open(
    $linkedRefPath,
    [IO.FileMode]::Open,
    [IO.FileAccess]::Read,
    [IO.FileShare]::Read
  )
  if ((Read-LinkedRefFence -Stream $linkedRefFenceStream) -ne $ExpectedProjectRef) {
    throw 'Linked project ref changed before the source fence was acquired.'
  }
  $preflightJson = Invoke-LinkedQuery -Cli $cliFence.InvocationPath -SqlFile $preflightSql -Workdir $repoRoot -TimeoutSeconds $QueryTimeoutSeconds
  $preflight = ConvertFrom-RequiredJson -Json $preflightJson -Label 'Preflight'
  Assert-Preflight -Preflight $preflight -ProjectRef $linkedRef

  $inventoryBeforeJson = Invoke-LinkedQuery -Cli $cliFence.InvocationPath -SqlFile $inventorySql -Workdir $repoRoot -TimeoutSeconds $QueryTimeoutSeconds
  $dataJson = Invoke-LinkedQuery -Cli $cliFence.InvocationPath -SqlFile $dataSql -Workdir $repoRoot -TimeoutSeconds $QueryTimeoutSeconds
  $inventoryAfterJson = Invoke-LinkedQuery -Cli $cliFence.InvocationPath -SqlFile $inventorySql -Workdir $repoRoot -TimeoutSeconds $QueryTimeoutSeconds
  if ((Read-LinkedRefFence -Stream $linkedRefFenceStream) -ne $ExpectedProjectRef) {
    throw 'Linked project ref changed while the source fence was held.'
  }
  Assert-HBAM2ImplementationFence `
    -Fence $implementationFence `
    -RepoRoot $repoRoot `
    -SelfTest ([bool]$SelfTest)
  Assert-HBAM2SupabaseCliFence -Fence $cliFence
  $inventoryBefore = ConvertFrom-RequiredJson -Json $inventoryBeforeJson -Label 'Schema-before inventory'
  $inventoryAfter = ConvertFrom-RequiredJson -Json $inventoryAfterJson -Label 'Schema-after inventory'
  $data = ConvertFrom-RequiredJson -Json $dataJson -Label 'Logical backup'
  if (-not $data.PSObject.Properties['relations'] -or
      -not $data.PSObject.Properties['care_delivery_policy'] -or
      -not $data.PSObject.Properties['memory_budget_deferral'] -or
      -not $data.PSObject.Properties['release_migrations']) {
    throw 'Logical backup is missing relation or policy contract metadata.'
  }
  Assert-CareDeliveryPolicyContract -Contract $data.care_delivery_policy -Label 'Logical backup'
  Assert-MemoryBudgetDeferralContract -Contract $data.memory_budget_deferral -Label 'Logical backup'
  Assert-ReleaseMigrationContract -Contract $data.release_migrations -Label 'Logical backup'
  $preflightRelationContract = Get-HBAM2RelationContractSha256 `
    -Relations $preflight.tables -ExpectedNames $ExpectedTables -Label 'Preflight'
  $beforeRelationContract = Get-HBAM2RelationContractSha256 `
    -Relations $inventoryBefore.tables -ExpectedNames $ExpectedTables -Label 'Schema-before inventory'
  $dataRelationContract = Get-HBAM2RelationContractSha256 `
    -Relations $data.relations -ExpectedNames $ExpectedTables -Label 'Logical backup'
  $afterRelationContract = Get-HBAM2RelationContractSha256 `
    -Relations $inventoryAfter.tables -ExpectedNames $ExpectedTables -Label 'Schema-after inventory'
  if ($preflightRelationContract -ne $beforeRelationContract -or
      $beforeRelationContract -ne $dataRelationContract -or
      $dataRelationContract -ne $afterRelationContract) {
    throw 'Target relation identity or inheritance shape changed during capture.'
  }
  $beforeContract = Get-InventoryContractSha256 -Inventory $inventoryBefore
  $afterContract = Get-InventoryContractSha256 -Inventory $inventoryAfter
  if ($beforeContract -ne $afterContract) {
    throw 'Schema inventory changed while the logical data snapshot was captured.'
  }
  if ([string]$inventoryBefore.live_schema_contract_sha256 -cne
      [string]$inventoryAfter.live_schema_contract_sha256) {
    throw 'Live schema contract changed while the logical data snapshot was captured.'
  }
  if (-not $data.PSObject.Properties['captured_at'] -or
      -not $data.PSObject.Properties['current_user'] -or
      -not $data.PSObject.Properties['session_user'] -or
      -not $data.PSObject.Properties['current_role_bypasses_rls'] -or
      -not $data.PSObject.Properties['row_security'] -or
      -not $data.PSObject.Properties['tables']) {
    throw 'Logical backup is missing captured_at, execution role, or tables.'
  }
  if (-not [bool]$data.current_role_bypasses_rls -or
      [string]$data.row_security -ne 'off' -or
      [string]$data.current_user -ne [string]$preflight.current_user -or
      [string]$data.session_user -ne [string]$preflight.session_user -or
      [string]$inventoryBefore.current_user -ne [string]$preflight.current_user -or
      [string]$inventoryBefore.session_user -ne [string]$preflight.session_user -or
      [string]$inventoryAfter.current_user -ne [string]$preflight.current_user -or
      [string]$inventoryAfter.session_user -ne [string]$preflight.session_user) {
    throw 'Backup queries did not use one stable explicit RLS-bypass execution role.'
  }
  $preflightAt = ConvertTo-ValidatedTimestamp -Value ([string]$preflight.captured_at) -Label 'Preflight captured_at'
  $beforeAt = ConvertTo-ValidatedTimestamp -Value ([string]$inventoryBefore.captured_at) -Label 'Schema-before captured_at'
  $sourceAt = ConvertTo-ValidatedTimestamp -Value ([string]$data.captured_at) -Label 'Data captured_at'
  $afterAt = ConvertTo-ValidatedTimestamp -Value ([string]$inventoryAfter.captured_at) -Label 'Schema-after captured_at'
  if ($preflightAt -gt $beforeAt -or $beforeAt -gt $sourceAt -or $sourceAt -gt $afterAt) {
    throw 'Backup query timestamps are not in the required preflight/schema/data/schema order.'
  }

  $dataTableNames = @($data.tables.PSObject.Properties.Name | Sort-Object)
  Assert-ExactTableAllowlist -Actual $dataTableNames -Label 'Logical backup'
  $tableCounts = [ordered]@{}
  foreach ($property in @($data.tables.PSObject.Properties | Sort-Object Name)) {
    if (-not $property.Value.PSObject.Properties['row_count'] -or
        -not $property.Value.PSObject.Properties['rows'] -or
        -not $property.Value.PSObject.Properties['canonical_sha256'] -or
        [string]$property.Value.canonical_sha256 -notmatch '^[A-Fa-f0-9]{64}$') {
      throw "Logical backup metadata is incomplete for $($property.Name)."
    }
    $reported = [int64]$property.Value.row_count
    $actual = @($property.Value.rows).Count
    if ($reported -ne $actual) { throw "Row count mismatch for $($property.Name)." }
    $tableCounts[$property.Name] = $reported
  }
  $logicalDataContract = Get-HBAM2LogicalDataContractSha256 `
    -Tables $data.tables `
    -ExpectedNames $ExpectedTables `
    -Label 'Logical backup'

  $inventoryBytes = [Text.Encoding]::UTF8.GetBytes($inventoryAfterJson)
  $dataBytes = [Text.Encoding]::UTF8.GetBytes($dataJson)
  $inventoryArtifact = Protect-HBAM2Artifact -Plaintext $inventoryBytes -Directory $stagingDirectory `
    -ArtifactName 'schema-inventory.json' -ProjectRef $linkedRef -BackupSetId $backupSetId
  $dataArtifact = Protect-HBAM2Artifact -Plaintext $dataBytes -Directory $stagingDirectory `
    -ArtifactName 'logical-data.json' -ProjectRef $linkedRef -BackupSetId $backupSetId
  $refBytes = [Text.Encoding]::UTF8.GetBytes($linkedRef)
  try {
    $manifest = [ordered]@{
      format = $script:HBAM2FormatName
      format_version = 2
      backup_set_id = $backupSetId
      status = 'complete'
      backup_type = 'amora-related-encrypted-logical-snapshot'
      created_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
      preflight_captured_at = [string]$preflight.captured_at
      inventory_before_captured_at = [string]$inventoryBefore.captured_at
      source_captured_at = [string]$data.captured_at
      inventory_captured_at = [string]$inventoryAfter.captured_at
      inventory_after_captured_at = [string]$inventoryAfter.captured_at
      inventory_contract_sha256 = $afterContract
      source_relation_contract_sha256 = $afterRelationContract
      live_schema_contract_sha256 = [string]$inventoryAfter.live_schema_contract_sha256
      logical_data_contract_sha256 = $logicalDataContract
      source_current_user = [string]$data.current_user
      source_session_user = [string]$data.session_user
      source_role_bypasses_rls = $true
      source_row_security = 'off'
      implementation = $implementationFence.Provenance
      supabase_cli = $cliFence.Provenance
      verifier_runtime = $verifierRuntimeContract
      source_project_ref = $linkedRef
      source_project_ref_sha256 = Get-HBAM2Sha256Hex -Bytes $refBytes
      source_fence = 'supabase-linked-project-ref-plus-explicit-workdir-plus-pinned-cli'
      consistency = 'data-single-statement-schema-before-after-fenced'
      query_timeout_seconds = $QueryTimeoutSeconds
      plaintext_written_to_disk = $false
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
  } finally { [Array]::Clear($refBytes, 0, $refBytes.Length) }

  $manifestPath = Join-Path $stagingDirectory 'manifest.json'
  [IO.File]::WriteAllText(
    $manifestPath,
    ($manifest | ConvertTo-Json -Depth 20),
    [Text.UTF8Encoding]::new($false)
  )
  if ((Get-Item -LiteralPath $manifestPath).Length -gt $script:HBAM2MaximumManifestBytes) {
    throw 'Backup manifest exceeds its size limit.'
  }
  $expectedFiles = @(
    'logical-data.json.hbam2', 'logical-data.json.key.dpapi', 'manifest.json',
    'schema-inventory.json.hbam2', 'schema-inventory.json.key.dpapi'
  )
  $entries = @(Get-ChildItem -LiteralPath $stagingDirectory -Force)
  $files = @($entries | Where-Object { -not $_.PSIsContainer } | ForEach-Object Name | Sort-Object)
  if ($entries.Count -ne $expectedFiles.Count -or
      @(Compare-Object -ReferenceObject $expectedFiles -DifferenceObject $files).Count -ne 0) {
    throw 'Backup staging directory contains an unexpected artifact set.'
  }
  Assert-HBAM2PrivateDirectoryAcl -Path $stagingDirectory
  foreach ($file in $expectedFiles) { Assert-HBAM2PrivateFileAcl -Path (Join-Path $stagingDirectory $file) }
  Move-Item -LiteralPath $stagingDirectory -Destination $finalDirectory
  $published = $true
  Assert-HBAM2PrivateDirectoryAcl -Path $finalDirectory
  foreach ($file in $expectedFiles) { Assert-HBAM2PrivateFileAcl -Path (Join-Path $finalDirectory $file) }
  $manifestBytes = Read-HBAM2BoundedFileBytes -Path (Join-Path $finalDirectory 'manifest.json') `
    -MaximumBytes $script:HBAM2MaximumManifestBytes
  try { $manifestHash = Get-HBAM2Sha256Hex -Bytes $manifestBytes }
  finally { [Array]::Clear($manifestBytes, 0, $manifestBytes.Length) }
  [pscustomobject]@{
    BackupDirectory = $finalDirectory
    BackupSetId = $backupSetId
    ManifestSha256 = $manifestHash
    InventoryContractSha256 = $afterContract
    SourceRelationContractSha256 = $afterRelationContract
    LiveSchemaContractSha256 = [string]$inventoryAfter.live_schema_contract_sha256
    LogicalDataContractSha256 = $logicalDataContract
    GitCommit = [string]$implementationFence.Provenance.git_commit
    SupabaseCliVersion = [string]$cliFence.Provenance.version
    SupabaseCliBinarySha256 = [string]$cliFence.Provenance.files[$cliFence.Provenance.invocation_relative_path]
    PreflightCapturedAt = [string]$preflight.captured_at
    InventoryBeforeCapturedAt = [string]$inventoryBefore.captured_at
    SourceCapturedAt = [string]$data.captured_at
    InventoryAfterCapturedAt = [string]$inventoryAfter.captured_at
    TableCount = $tableCounts.Count
    TotalRows = [int64](($tableCounts.Values | Measure-Object -Sum).Sum)
    PlaintextWrittenToDisk = $false
  } | ConvertTo-Json -Compress
} catch {
  $cleanupCandidates = @()
  if (-not [string]::IsNullOrWhiteSpace($stagingDirectory)) {
    $cleanupCandidates += $stagingDirectory
  }
  if ($published -and -not [string]::IsNullOrWhiteSpace($finalDirectory)) {
    $cleanupCandidates += $finalDirectory
  }
  foreach ($candidate in $cleanupCandidates) {
    $full = [IO.Path]::GetFullPath($candidate)
    if ((Test-Path -LiteralPath $full) -and
        [IO.Path]::GetDirectoryName($full).TrimEnd('\') -eq $parent -and
        ([IO.Path]::GetFileName($full) -match '^\d{8}-\d{6}$' -or
         [IO.Path]::GetFileName($full) -match '^\.partial-\d{8}-\d{6}-[a-f0-9]{32}$')) {
      Remove-Item -LiteralPath $full -Recurse -Force
    }
  }
  throw
} finally {
  Close-HBAM2SupabaseCliFence -Fence $cliFence
  Close-HBAM2ImplementationFence -Fence $implementationFence
  if ($linkedRefFenceStream) { $linkedRefFenceStream.Dispose() }
  if ($inventoryBytes) { [Array]::Clear($inventoryBytes, 0, $inventoryBytes.Length) }
  if ($dataBytes) { [Array]::Clear($dataBytes, 0, $dataBytes.Length) }
  if ($captureLock) { $captureLock.Dispose() }
}
