param(
  [switch]$Help,
  [switch]$SkipBuild,
  [switch]$SkipLint,
  [switch]$SkipAudit,
  [string]$ExpectedProjectRef,
  [switch]$Production,
  [string]$BackupRef,
  [switch]$MaintenanceModeActive,
  [switch]$TrafficDrained,
  [string]$MaintenanceAuthorizedUntilUtc
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$script:expectedDependencyFunctionCount = 54
$script:expectedDependencyCronCount = 5
$script:expectedClientDeniedTriggerFunctionCount = 12
$script:expectedClientDeniedTriggerBindingCount = 13
$script:accountDeletionWorkerLeaseSeconds = 600
$script:accountDeletionMaxInvocationSeconds = 120
$script:accountDeletionWorkerDrainSeconds = [Math]::Max(
  $script:accountDeletionWorkerLeaseSeconds,
  $script:accountDeletionMaxInvocationSeconds
)

function Show-Help {
  Write-Host ""
  Write-Host "Supabase safe ship"
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  pnpm run supabase:ship:safe -ExpectedProjectRef REF"
  Write-Host ""
  Write-Host "Protected production refs automatically force all production gates."
  Write-Host "Production additionally requires:"
  Write-Host "  -BackupRef BACKUP_ID -MaintenanceModeActive -TrafficDrained"
  Write-Host "  -MaintenanceAuthorizedUntilUtc ISO_8601_UTC"
  Write-Host ""
  Write-Host "This command never resets a database, uses --include-all, or repairs history."
  Write-Host "Use supabase:baseline:core separately for version 20260202000000."
  Write-Host ""
}

function Convert-SecureStringToPlainText {
  param([Parameter(Mandatory = $true)] [Security.SecureString]$Secure)

  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)] [string]$Name,
    [Parameter(Mandatory = $true)] [scriptblock]$Script
  )

  Write-Host ""
  Write-Host "==> $Name"
  $global:LASTEXITCODE = 0
  $result = & $Script
  if ($global:LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $global:LASTEXITCODE."
  }
  return $result
}

function Assert-LinkedProject {
  $currentRef = (Get-Content -Raw -LiteralPath $script:linkedRefPath).Trim()
  if ($currentRef -ne $script:expectedRef) {
    throw "Linked Supabase project changed during the release operation."
  }
}

function Get-ReleaseArtifactFingerprint {
  $paths = @(
    Get-ChildItem -LiteralPath "supabase/migrations" -Filter "*.sql" |
      Sort-Object FullName |
      ForEach-Object { $_.FullName }
  ) + @(
    (Resolve-Path "scripts/release-targets.json").Path,
    (Resolve-Path "scripts/run-reviewed-powershell.mjs").Path,
    (Resolve-Path "scripts/invoke-reviewed-powershell.ps1").Path,
    (Resolve-Path "scripts/supabase-ship-safe.ps1").Path,
    (Resolve-Path "scripts/supabase-write-fence.ps1").Path,
    (Resolve-Path "scripts/supabase-recovery-safe.mjs").Path,
    (Resolve-Path "scripts/retire-invitation-bucket.mjs").Path,
    (Resolve-Path "scripts/supabase-anon-probe.mjs").Path,
    (Resolve-Path "scripts/supabase-auth-config-preflight.mjs").Path
  ) + @(
    Get-ChildItem -LiteralPath "scripts/sql" -Filter "supabase-*.sql" |
      Sort-Object FullName |
      ForEach-Object { $_.FullName }
  )
  return (($paths | ForEach-Object {
    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $_
    "$($hash.Path)|$($hash.Hash)"
  }) -join "`n")
}

function Assert-ReleaseArtifactsUnchanged {
  param(
    [Parameter(Mandatory = $true)] [string]$ExpectedHead,
    [Parameter(Mandatory = $true)] [string]$ExpectedFingerprint
  )

  $dirtyNow = @(git status --porcelain=v1 --untracked-files=all)
  $headNow = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $dirtyNow.Count -gt 0 -or
    $headNow -ne $ExpectedHead -or
    (Get-ReleaseArtifactFingerprint) -ne $ExpectedFingerprint) {
    throw "Git HEAD or reviewed release artifacts changed during the release operation."
  }
}

function ConvertFrom-SupabaseQueryRows {
  param([Parameter(Mandatory = $true)] $Raw)

  $document = ($Raw -join "`n") | ConvertFrom-Json
  if ($document -is [Array]) {
    return @($document)
  }
  if ($document.PSObject.Properties.Name -contains "rows") {
    return @($document.rows)
  }
  throw "Supabase query JSON did not contain a supported row collection."
}

function Read-JsonQueryRow {
  param(
    [Parameter(Mandatory = $true)] [string]$Name,
    [Parameter(Mandatory = $true)] [string]$File
  )

  Assert-LinkedProject
  $raw = Invoke-Step $Name {
    corepack pnpm exec supabase db query --linked --file $File --output json
  }
  $rows = @(ConvertFrom-SupabaseQueryRows $raw)
  if ($rows.Count -ne 1) {
    throw "$Name returned an unexpected result shape."
  }
  return $rows[0]
}

function Read-JsonSqlRow {
  param(
    [Parameter(Mandatory = $true)] [string]$Name,
    [Parameter(Mandatory = $true)] [string]$Sql
  )

  # PowerShell can pass embedded newlines to native commands as separate
  # arguments on Windows. Normalize trusted, checked-in SQL to one argument.
  $singleLineSql = ($Sql -replace '\r?\n', ' ').Trim()
  if ([string]::IsNullOrWhiteSpace($singleLineSql)) {
    throw "$Name received an empty SQL query."
  }
  Assert-LinkedProject
  $raw = Invoke-Step $Name {
    corepack pnpm exec supabase db query --linked --output json $singleLineSql
  }
  $rows = @(ConvertFrom-SupabaseQueryRows $raw)
  if ($rows.Count -ne 1) {
    throw "$Name returned an unexpected result shape."
  }
  return $rows[0]
}

function Complete-DependencyCronInventory {
  param([Parameter(Mandatory = $true)]$Preflight)

  $catalogRow = Read-JsonSqlRow "Detect pg_cron catalog" `
    "SELECT to_regclass('cron.job') IS NOT NULL AS present;"
  if ($catalogRow.present -eq $true) {
    $cronRow = Read-JsonQueryRow "Exact pg_cron dependency inventory" `
      "scripts/sql/supabase-dependency-cron-preflight.sql"
    if ($null -eq $cronRow.dependency_cron_status) {
      throw "pg_cron dependency inventory returned no job contracts."
    }
    $Preflight.dynamic_sources.dependency_cron_status = `
      $cronRow.dependency_cron_status
  }

  return $Preflight
}

function Assert-PreflightDynamicSourceTopology {
  param(
    [Parameter(Mandatory = $true)]$Preflight,
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$PendingVersions
  )

  if ($null -eq $Preflight.dynamic_sources) {
    throw "Production preflight omitted its dynamic source inventory."
  }
  if ($Preflight.dynamic_sources.amora_lifecycle_existing_compatible -ne $true) {
    throw "Existing Amora lifecycle columns/functions are incompatible with migration 20260710050000."
  }
  $dependencyFunctions = $Preflight.dynamic_sources.dependency_function_status
  if ($null -eq $dependencyFunctions) {
    throw "Production preflight omitted its dependency function contracts."
  }
  $dependencyStatuses = @($dependencyFunctions.PSObject.Properties)
  if ($dependencyStatuses.Count -ne $script:expectedDependencyFunctionCount) {
    throw "Production preflight returned an incomplete dependency function catalog."
  }
  foreach ($functionProperty in $dependencyStatuses) {
    $status = $functionProperty.Value
    $creatorPending = [string]$status.creator_version -in $PendingVersions
    $forwardVersion = [string]$status.forward_version
    $forwardPending = -not [string]::IsNullOrWhiteSpace($forwardVersion) -and
      $forwardVersion -in $PendingVersions
    if ($forwardPending) {
      # CREATE OR REPLACE can repair source/search-path/ACL, but cannot change
      # result/argument contracts and preserves a drifted owner. Existing
      # functions must therefore be replaceable before a repair is attempted.
      if ($status.existing_replaceable -ne $true) {
        throw "Dependency function $($functionProperty.Name) cannot be safely replaced by its pending migration."
      }
    } elseif ($creatorPending) {
      # A creator migration is safe when the function is absent. If an object
      # already occupies that signature, require the complete reviewed contract
      # instead of allowing the creator to overwrite unexplained drift.
      if ($status.present -eq $true -and $status.exact -ne $true) {
        throw "Dependency function $($functionProperty.Name) already exists but does not match its pending creator contract."
      }
    } elseif ($status.exact -ne $true) {
      throw "Applied dependency function $($functionProperty.Name) has drifted from its exact contract."
    }
  }
  $clientDeniedTriggers =
    $Preflight.dynamic_sources.client_denied_trigger_function_status
  if ($null -eq $clientDeniedTriggers) {
    throw "Production preflight omitted its trigger function ACL contracts."
  }
  $clientDeniedTriggerStatuses = @($clientDeniedTriggers.PSObject.Properties)
  if ($clientDeniedTriggerStatuses.Count -ne
      $script:expectedClientDeniedTriggerFunctionCount) {
    throw "Production preflight returned an incomplete trigger function ACL catalog."
  }
  foreach ($functionProperty in $clientDeniedTriggerStatuses) {
    $status = $functionProperty.Value
    $creatorPending = [string]$status.creator_version -in $PendingVersions
    $forwardPending = [string]$status.forward_version -in $PendingVersions
    if ($forwardPending) {
      if ($status.present -ne $true -and -not $creatorPending) {
        throw "Trigger function $($functionProperty.Name) is absent even though its creator migration is applied."
      }
      if ($status.present -eq $true -and $status.existing_compatible -ne $true) {
        throw "Trigger function $($functionProperty.Name) cannot be safely locked by its pending migration."
      }
    } elseif ($status.exact -ne $true) {
      throw "Applied trigger function $($functionProperty.Name) has an unsafe direct-call ACL or definition."
    }
  }
  $clientDeniedTriggerBindings =
    $Preflight.dynamic_sources.client_denied_trigger_binding_status
  if ($null -eq $clientDeniedTriggerBindings) {
    throw "Production preflight omitted its trigger binding contracts."
  }
  $clientDeniedTriggerBindingStatuses =
    @($clientDeniedTriggerBindings.PSObject.Properties)
  if ($clientDeniedTriggerBindingStatuses.Count -ne
      $script:expectedClientDeniedTriggerBindingCount) {
    throw "Production preflight returned an incomplete trigger binding catalog."
  }
  foreach ($bindingProperty in $clientDeniedTriggerBindingStatuses) {
    $status = $bindingProperty.Value
    $creatorPending = [string]$status.creator_version -in $PendingVersions
    $forwardPending = [string]$status.forward_version -in $PendingVersions
    if ($forwardPending) {
      if (-not $creatorPending -and $status.existing_replaceable -ne $true) {
        throw "Trigger binding $($bindingProperty.Name) cannot be repaired because its table or function contract is absent."
      }
    } elseif ($status.exact -ne $true) {
      throw "Applied trigger binding $($bindingProperty.Name) is missing, disabled, or points to the wrong function."
    }
  }
  $amoraResetReadBoundaryPending =
    "20260712102000" -in $PendingVersions
  if ($amoraResetReadBoundaryPending) {
    if ($Preflight.dynamic_sources.amora_reset_read_helper_present -eq $true -and
      $Preflight.dynamic_sources.amora_reset_read_helper_existing_replaceable -ne $true) {
      throw "Amora reset read helper cannot be safely replaced by pending migration 20260712102000."
    }
    if ($Preflight.dynamic_sources.amora_reset_read_policy_replacement_safe -ne $true) {
      throw "Amora reset read policies have unmanaged client reads or incompatible table ACL/RLS prerequisites."
    }
  } elseif (
    $Preflight.dynamic_sources.amora_reset_read_helper_exact -ne $true -or
    $Preflight.dynamic_sources.amora_reset_read_policies_exact -ne $true
  ) {
    throw "Applied Amora reset read helper or policies drifted from the exact privacy-revocation contract."
  }
  $privacyMinimumPending = "20260713100000" -in $PendingVersions
  foreach ($field in @(
      "privacy_minimum_contract_exact",
      "privacy_minimum_invalid_cohort_rows"
    )) {
    if ($Preflight.dynamic_sources.PSObject.Properties.Name -notcontains $field) {
      throw "Production preflight omitted the privacy-minimum release contract."
    }
  }
  $privacyInvalidCohortRows =
    [long]$Preflight.dynamic_sources.privacy_minimum_invalid_cohort_rows
  if ($privacyInvalidCohortRows -ne 0) {
    throw "Existing cohort quotes violate the bounded privacy contract and require explicit review before migration. rows=$privacyInvalidCohortRows"
  }
  if (-not $privacyMinimumPending -and
    $Preflight.dynamic_sources.privacy_minimum_contract_exact -ne $true) {
    throw "Applied cohort/profile/vendor/survey privacy minimum drifted from its exact remote contract."
  }
  $dependencyCrons = $Preflight.dynamic_sources.dependency_cron_status
  if ($null -eq $dependencyCrons) {
    throw "Production preflight omitted its dependency cron contracts."
  }
  $cronStatuses = @($dependencyCrons.PSObject.Properties)
  if ($cronStatuses.Count -ne $script:expectedDependencyCronCount) {
    throw "Production preflight returned an incomplete dependency cron catalog."
  }
  foreach ($cronProperty in $cronStatuses) {
    $status = $cronProperty.Value
    if ([string]$status.creator_version -in $PendingVersions) {
      if ($status.existing_replaceable -ne $true) {
        throw "Dependency cron $($cronProperty.Name) cannot be safely replaced by its pending migration."
      }
    } elseif ($status.exact -ne $true) {
      throw "Applied dependency cron $($cronProperty.Name) has drifted from its exact contract."
    }
  }
  $vendorLicenseObjectCount =
    [long]$Preflight.dynamic_sources.vendor_license_object_count
  $vendorUuidImageObjectCount =
    [long]$Preflight.dynamic_sources.vendor_uuid_image_object_count
  if ($vendorLicenseObjectCount -ne 0 -or $vendorUuidImageObjectCount -ne 0) {
    throw "Unproven vendor uploads require export and an approved provenance/retention decision before release. vendor-licenses=$vendorLicenseObjectCount UUID-scoped vendor-images=$vendorUuidImageObjectCount"
  }
  $vendorStoragePolicyCount =
    [long]$Preflight.dynamic_sources.vendor_storage_policy_name_count
  $vendorStorageAllPolicyCount =
    [long]$Preflight.dynamic_sources.vendor_storage_all_insert_policy_name_count
  $vendorStorageExpansionPending = "20260711140000" -in $PendingVersions
  $vendorStorageDisablePending = "20260711146000" -in $PendingVersions
  if ($vendorStorageDisablePending -and $vendorStorageExpansionPending) {
    if ($vendorStoragePolicyCount -ne 0) {
      throw "Migration 20260711140000 requires its vendor Storage policy names to be absent."
    }
  } elseif ($vendorStorageDisablePending -and
    ($vendorStoragePolicyCount -ne 2 -or
    $Preflight.dynamic_sources.vendor_storage_policies_contract_exact -ne $true)) {
    throw "Applied vendor Storage policies do not match migration 20260711140000."
  } elseif (-not $vendorStorageDisablePending -and
    ($vendorStorageAllPolicyCount -ne 0 -or
    $Preflight.dynamic_sources.vendor_storage_uploads_disabled_contract_exact -ne $true)) {
    throw "Vendor upload INSERT policies remain after migration 20260711146000."
  }

  $requirements = [ordered]@{
    wedding_code_responses = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.wedding_code_responses_present
      Exact = $Preflight.dynamic_sources.wedding_code_base_contract_exact
      Creator = "20260705160000"
    }
    wedding_code_couple_token = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.wedding_couple_token_present
      Exact = $Preflight.dynamic_sources.wedding_couple_token_contract_exact
      Creator = "20260706100000"
    }
    wedding_code_submission_id = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.wedding_submission_id_present
      Exact = $Preflight.dynamic_sources.wedding_submission_id_contract_exact
      Creator = "20260710110000"
    }
    wedding_code_scoring_version = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.wedding_scoring_version_present
      Exact = $Preflight.dynamic_sources.wedding_scoring_version_contract_exact
      Creator = "20260710110000"
    }
    amora_request_claims = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.amora_request_claims_present
      Exact = $Preflight.dynamic_sources.amora_request_claims_base_contract_exact
      Creator = "20260710050000"
    }
    amora_lifecycle = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.amora_lifecycle_contract_present
      Exact = $Preflight.dynamic_sources.amora_lifecycle_contract_exact
      Creator = "20260710050000"
    }
    amora_claim_lease = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.amora_claim_lease_present
      Exact = $Preflight.dynamic_sources.amora_claim_lease_contract_exact
      Creator = "20260711139000"
    }
    care_notifications = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.care_notifications_column_present
      Exact = $Preflight.dynamic_sources.care_notifications_contract_exact
      Creator = "20260705120000"
    }
    profile_phone = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.profile_phone_column_present
      Exact = $Preflight.dynamic_sources.profile_phone_contract_exact
      Creator = "20260705140000"
    }
    phone_care_consent = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.phone_care_consent_column_present
      Exact = $Preflight.dynamic_sources.phone_care_consent_contract_exact
      Creator = "20260705140000"
    }
    profile_push_token = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.profile_push_token_present
      Exact = $Preflight.dynamic_sources.profile_push_token_contract_exact
      Creator = "20260710050000"
    }
    rate_limit_subject = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.rate_limit_subject_column_present
      Exact = $Preflight.dynamic_sources.rate_limit_subject_contract_exact
      Creator = "20260711147000"
    }
    account_deletion_jobs = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.account_deletion_jobs_present
      Exact = $Preflight.dynamic_sources.account_deletion_jobs_base_contract_exact
      Creator = "20260710070000"
    }
    account_deletion_email_attestation = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.account_deletion_email_attestation_present
      Exact = $Preflight.dynamic_sources.account_deletion_email_attestation_contract_exact
      Creator = "20260712101000"
    }
    account_deletion_auth_ready = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.account_deletion_auth_ready_present
      Exact = $Preflight.dynamic_sources.account_deletion_auth_ready_contract_exact
      Creator = "20260712105000"
    }
    preregistration_expiry = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.preregistration_expiry_present
      Exact = $Preflight.dynamic_sources.preregistration_expiry_contract_exact
      Creator = "20260711135000"
    }
    research_cohort_applications = [pscustomobject]@{
      Present = $Preflight.dynamic_sources.research_cohort_applications_present
      Exact = $Preflight.dynamic_sources.research_cohort_applications_contract_exact
      Creator = "20260712100000"
    }
  }

  foreach ($requirement in $requirements.GetEnumerator()) {
    if ($requirement.Value.Present -eq $true) {
      if ($requirement.Value.Exact -ne $true) {
        throw "Required dynamic source $($requirement.Key) has an incompatible schema contract."
      }
      continue
    }
    if ($requirement.Value.Creator -notin $PendingVersions) {
      throw "Required dynamic source $($requirement.Key) is absent after its creator migration."
    }
  }
}

function Complete-ProductionPreflightDynamicInventory {
  param(
    [Parameter(Mandatory = $true)]$Preflight,
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$PendingVersions
  )

  $Preflight = Complete-DependencyCronInventory $Preflight
  Assert-PreflightDynamicSourceTopology $Preflight $PendingVersions

  $weddingInventory = [pscustomobject]@{
    wedding_pair_groups_over_two = [long]0
    wedding_submission_groups = [long]0
    wedding_tokens_to_null = [long]0
    wedding_scoring_version_backfills = [long]0
  }
  if ($Preflight.dynamic_sources.wedding_code_responses_present -eq $true) {
    # Optional columns are read through to_jsonb so this query also works when
    # the table exists but a later expand migration has not added them yet.
    $weddingSql = @'
WITH wedding_rows AS (
  SELECT to_jsonb(response) AS row_data
  FROM public.wedding_code_responses AS response
)
SELECT
  (SELECT count(*)::bigint FROM (
    SELECT row_data->>'couple_token' AS token
    FROM wedding_rows
    WHERE row_data->>'couple_token' IS NOT NULL
    GROUP BY row_data->>'couple_token'
    HAVING count(*) > 2
  ) groups_over_two) AS wedding_pair_groups_over_two,
  (SELECT count(*)::bigint FROM (
    SELECT row_data->>'submission_id' AS submission_id
    FROM wedding_rows
    WHERE row_data->>'submission_id' IS NOT NULL
    GROUP BY row_data->>'submission_id'
    HAVING count(*) > 1
  ) duplicate_submissions) AS wedding_submission_groups,
  (SELECT count(*)::bigint FROM wedding_rows
    WHERE row_data->>'couple_token' IS NOT NULL) AS wedding_tokens_to_null,
  (SELECT count(*)::bigint FROM wedding_rows
    WHERE row_data->>'scoring_version' IS NULL
      AND row_data->>'form_version' IN (
        'v0.5-candidate.1', 'v0.5-candidate.2', 'v0.5-candidate.3',
        'v0.5-candidate.4', 'v0.5-candidate.5', 'v0.5-candidate.6',
        'v0.5-candidate.7', 'v0.5-candidate.8', 'v0.5-candidate.9'
      )) AS wedding_scoring_version_backfills;
'@
    $weddingInventory = Read-JsonSqlRow `
      "Dynamic WeddingCode rewrite inventory" $weddingSql
  }

  $leaseBackfills = [long]0
  if ($Preflight.dynamic_sources.amora_request_claims_present -eq $true) {
    $leaseSql = @'
SELECT count(*)::bigint AS amora_claim_lease_backfills
FROM public.amora_request_claims AS claim
WHERE to_jsonb(claim)->>'lease_expires_at' IS NULL;
'@
    $leaseRow = Read-JsonSqlRow "Dynamic Amora claim lease inventory" $leaseSql
    $leaseBackfills = [long]$leaseRow.amora_claim_lease_backfills
  }

  $Preflight.unique_blockers.wedding_pair_groups_over_two =
    [long]$weddingInventory.wedding_pair_groups_over_two
  $Preflight.unique_blockers.wedding_submission_groups =
    [long]$weddingInventory.wedding_submission_groups
  $Preflight.data_rewrites.wedding_tokens_to_null =
    [long]$weddingInventory.wedding_tokens_to_null
  $Preflight.data_rewrites.wedding_scoring_version_backfills =
    [long]$weddingInventory.wedding_scoring_version_backfills
  $Preflight.data_rewrites.amora_claim_lease_backfills = $leaseBackfills

  return $Preflight
}

function Get-LedgerTopology {
  param(
    [Parameter(Mandatory = $true)] [string[]]$LocalVersions,
    [Parameter(Mandatory = $true)] [object[]]$AppliedVersions
  )

  $remote = @($AppliedVersions | ForEach-Object { [string]$_ } | Sort-Object -Unique)
  $unknownRemote = @($remote | Where-Object { $_ -notin $LocalVersions })
  if ($unknownRemote.Count -gt 0) {
    throw "Remote migration history contains versions absent from this checkout."
  }

  $firstMissing = -1
  for ($index = 0; $index -lt $LocalVersions.Count; $index += 1) {
    if ($LocalVersions[$index] -notin $remote) {
      $firstMissing = $index
      break
    }
  }

  if ($firstMissing -lt 0) {
    return @()
  }

  $expectedSuffix = @($LocalVersions[$firstMissing..($LocalVersions.Count - 1)])
  $appliedInsideSuffix = @($expectedSuffix | Where-Object { $_ -in $remote })
  if ($appliedInsideSuffix.Count -gt 0) {
    throw "Remote migration history is not a contiguous local prefix."
  }
  return $expectedSuffix
}

function Assert-DryRunMatches {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [object[]]$Output,
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$ExpectedVersions
  )

  $text = $Output -join "`n"
  if (-not [string]::IsNullOrWhiteSpace($text)) {
    Write-Host $text
  }
  $listed = @([regex]::Matches($text, '\b(20\d{12})_[^\s]+\.sql\b') |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique)
  $difference = @(Compare-Object -ReferenceObject $ExpectedVersions `
    -DifferenceObject $listed)
  if ($difference.Count -gt 0) {
    throw "Dry-run migrations do not exactly match the reviewed pending suffix."
  }
}

function Assert-ProductionPreflight {
  param(
    [Parameter(Mandatory = $true)]$Preflight,
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$PendingVersions,
    [switch]$RequireDrained
  )

  Assert-PreflightDynamicSourceTopology $Preflight $PendingVersions

  $requiredDynamicCounts = [ordered]@{
    wedding_pair_groups_over_two = $Preflight.unique_blockers.wedding_pair_groups_over_two
    wedding_submission_groups = $Preflight.unique_blockers.wedding_submission_groups
    wedding_tokens_to_null = $Preflight.data_rewrites.wedding_tokens_to_null
    wedding_scoring_version_backfills = $Preflight.data_rewrites.wedding_scoring_version_backfills
    amora_claim_lease_backfills = $Preflight.data_rewrites.amora_claim_lease_backfills
  }
  $missingDynamicCounts = @($requiredDynamicCounts.GetEnumerator() |
    Where-Object { $null -eq $_.Value })
  if ($missingDynamicCounts.Count -gt 0) {
    throw "Production preflight dynamic inventory was not completed."
  }
  foreach ($requiredAccountDeletionCount in @(
      "processing_jobs",
      "owned_storage_owners_over_20000",
      "unattributed_chat_image_objects",
      "orphaned_chat_image_objects"
    )) {
    if ($null -eq $Preflight.account_deletion_gate.$requiredAccountDeletionCount) {
      throw "Production preflight omitted account-deletion evidence: $requiredAccountDeletionCount."
    }
  }

  $hardBlockers = [ordered]@{
    amora_legacy_gate = -not [bool]$Preflight.amora_legacy_gate.gate_will_pass
    invitation_photo_objects = [long]$Preflight.invitation_retirement.photo_objects
    guestbook_owners_over_498 = [long]$Preflight.account_deletion_gate.guestbook_owners_over_498
    profiles_over_500_scopes = [long]$Preflight.account_deletion_gate.profiles_over_500_scopes
    storage_scopes_over_20000 = [long]$Preflight.account_deletion_gate.storage_scopes_over_20000
    owned_storage_owners_over_20000 = [long]$Preflight.account_deletion_gate.owned_storage_owners_over_20000
    unattributed_chat_image_objects = [long]$Preflight.account_deletion_gate.unattributed_chat_image_objects
    orphaned_chat_image_objects = [long]$Preflight.account_deletion_gate.orphaned_chat_image_objects
    processing_account_deletion_jobs = [long]$Preflight.account_deletion_gate.processing_jobs
    legacy_storage_objects = [long]$Preflight.account_deletion_gate.legacy_storage_objects
    active_deletion_jobs_missing_auth_subject = [long]$Preflight.account_deletion_gate.active_jobs_missing_auth_subject
    invalid_phones = [long]$Preflight.data_rewrites.invalid_phones
    tool_idempotency_groups = [long]$Preflight.unique_blockers.tool_idempotency_groups
    active_booking_groups = [long]$Preflight.unique_blockers.active_booking_groups
    wedding_pair_groups_over_two = [long]$Preflight.unique_blockers.wedding_pair_groups_over_two
    wedding_submission_groups = [long]$Preflight.unique_blockers.wedding_submission_groups
    storage_policy_name_conflicts = [long]$Preflight.community_guard.policy_name_conflicts
  }
  if ($RequireDrained) {
    $hardBlockers.active_transactions = [long]$Preflight.community_guard.active_transactions
  }

  $blocked = @($hardBlockers.GetEnumerator() | Where-Object {
    if ($_.Value -is [bool]) { $_.Value } else { [long]$_.Value -ne 0 }
  })
  if ($blocked.Count -gt 0) {
    throw "Production preflight is blocked. $($hardBlockers | ConvertTo-Json -Compress)"
  }

  return [ordered]@{
    account_deletion_rows_scrubbed = [long]$Preflight.account_deletion_gate.legacy_rows_scrubbed
    account_deletion_email_snapshots_backfilled = [long]$Preflight.account_deletion_gate.email_snapshot_backfills
    account_deletion_owned_storage_oversized_owners = [long]$Preflight.account_deletion_gate.owned_storage_owners_over_20000
    account_deletion_unattributed_chat_images = [long]$Preflight.account_deletion_gate.unattributed_chat_image_objects
    account_deletion_orphaned_chat_images = [long]$Preflight.account_deletion_gate.orphaned_chat_image_objects
    account_deletion_processing_jobs = [long]$Preflight.account_deletion_gate.processing_jobs
    vendor_demotions = [long]$Preflight.data_rewrites.vendor_demotions
    ai_redactions = [long]$Preflight.data_rewrites.ai_redactions
    ai_deletes = [long]$Preflight.data_rewrites.ai_deletes
    feedback_pii_redactions = [long]$Preflight.data_rewrites.feedback_pii_redactions
    feedback_deletes = [long]$Preflight.data_rewrites.feedback_deletes
    wedding_tokens_to_null = [long]$Preflight.data_rewrites.wedding_tokens_to_null
    wedding_scoring_version_backfills = [long]$Preflight.data_rewrites.wedding_scoring_version_backfills
    amora_claim_lease_backfills = [long]$Preflight.data_rewrites.amora_claim_lease_backfills
    push_tokens_to_null = [long]$Preflight.data_rewrites.push_tokens_to_null
    quote_rows_forced_private = [long]$Preflight.data_rewrites.quote_rows_forced_private
    quote_leads_deleted = [long]$Preflight.data_rewrites.quote_leads_deleted
    quote_leads_scrubbed = [long]$Preflight.data_rewrites.quote_leads_scrubbed
    community_nickname_pseudonymizations = [long]$Preflight.data_rewrites.community_nickname_pseudonymizations
    prereg_expiry_backfill = [long]$Preflight.data_rewrites.prereg_expiry_backfill
    care_consent_resets = [long]$Preflight.data_rewrites.care_consent_resets
    community_reports_deleted = [long]$Preflight.community_guard.reports_deleted
    community_posts_marked_under_review = [long]$Preflight.community_guard.posts_marked_under_review
    prereg_rows_updated = [long]$Preflight.retention_rewrite.prereg_rows
    prereg_created_at_backfilled = [long]$Preflight.retention_rewrite.prereg_created_at_backfilled
    prereg_expires_backfilled = [long]$Preflight.retention_rewrite.prereg_expires_backfilled
    prereg_expiry_shortened = [long]$Preflight.retention_rewrite.prereg_expiry_shortened
    prereg_deleted_first_cron = [long]$Preflight.retention_rewrite.prereg_deleted_first_cron
    survey_rows_updated = [long]$Preflight.retention_rewrite.survey_rows
    survey_expires_backfilled = [long]$Preflight.retention_rewrite.survey_expires_backfilled
    survey_expiry_shortened = [long]$Preflight.retention_rewrite.survey_expiry_shortened
    survey_pii_rows_scrubbed = [long]$Preflight.retention_rewrite.survey_pii_rows_scrubbed
    survey_deleted_first_cron = [long]$Preflight.retention_rewrite.survey_deleted_first_cron
    rate_limit_deleted_first_cron = [long]$Preflight.retention_rewrite.rate_limit_deleted_first_cron
  }
}

function Assert-InvitationRetirementInventory {
  param(
    [Parameter(Mandatory = $true)]$Preflight,
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$PendingVersions
  )

  $tableFlags = [ordered]@{
    invitation_visits = [bool]$Preflight.invitation_retirement.visits_present
    invitation_guestbook = [bool]$Preflight.invitation_retirement.guestbook_present
    invitation_rsvp = [bool]$Preflight.invitation_retirement.rsvp_present
    invitation_accounts = [bool]$Preflight.invitation_retirement.accounts_present
    invitation_photos = [bool]$Preflight.invitation_retirement.photos_table_present
    invitations = [bool]$Preflight.invitation_retirement.invitations_present
    ai_scripts = [bool]$Preflight.invitation_retirement.ai_scripts_present
  }
  $dropPending = "20260704131000" -in $PendingVersions
  if ([bool]$Preflight.invitation_retirement.templates_present -and
    -not $dropPending) {
    throw "invitation_templates exists after its retirement migration."
  }
  if ([bool]$Preflight.invitation_retirement.templates_present -and
    $dropPending) {
    $templateSql = @"
SELECT count(*)::bigint AS seed_count,
       count(*) FILTER (WHERE thumbnail_url IS NOT NULL)::bigint AS thumbnail_count,
       md5(string_agg(concat_ws(
         E'\x1f', id, name, category, is_premium::text,
         color_palette::text, font_pair::text, layout_config::text,
         opening_animation
       ), E'\n' ORDER BY id)) AS seed_fingerprint
FROM public.invitation_templates;
"@
    $templateRow = Read-JsonSqlRow `
      "Verify canonical invitation template seed" $templateSql
    if ([long]$templateRow.seed_count -ne 30 -or
      [long]$templateRow.thumbnail_count -ne 0 -or
      [string]$templateRow.seed_fingerprint -ne
        "299c29b7db8596dfb373cd2684751e47") {
      throw "invitation_templates contains non-canonical data that requires export."
    }
  }
  foreach ($entry in $tableFlags.GetEnumerator()) {
    if (-not $entry.Value) { continue }
    if (-not $dropPending) {
      throw "Invitation table $($entry.Key) exists after its retirement migration."
    }

    # Names come only from the fixed allow-list above, never from user input.
    $sql = "SELECT count(*)::bigint AS row_count FROM public.$($entry.Key);"
    Assert-LinkedProject
    $raw = Invoke-Step "Count retirement rows in $($entry.Key)" {
      corepack pnpm exec supabase db query --linked --output json $sql
    }
    $rows = @(ConvertFrom-SupabaseQueryRows $raw)
    if ($rows.Count -ne 1 -or [long]$rows[0].row_count -ne 0) {
      throw "Invitation table $($entry.Key) requires export/cleanup before retirement."
    }
  }
}

function Get-RetiredInvitationInventoryJobCount {
  param([Parameter(Mandatory = $true)]$Preflight)

  if ($Preflight.account_deletion_gate.jobs_table_present -ne $true) {
    return [long]0
  }
  $row = Read-JsonQueryRow "Count retired invitation scopes in deletion jobs" `
    "scripts/sql/supabase-retired-invitation-job-preflight.sql"
  return [long]$row.retired_invitation_inventory_jobs
}

function Assert-PostDeployContract {
  param(
    [Parameter(Mandatory = $true)]$Contract,
    [Parameter(Mandatory = $true)] [string]$ExpectedLatest
  )

  if (($Contract.latest_migration -ne $ExpectedLatest) -or
    ($Contract.all_functions_present -ne $true) -or
    ($Contract.all_client_denied_trigger_functions_exact -ne $true) -or
    ($Contract.all_client_denied_trigger_bindings_exact -ne $true) -or
    ($Contract.amora_reset_read_helper_exact -ne $true) -or
    ($Contract.all_amora_reset_read_policies_exact -ne $true) -or
    ($Contract.all_maintenance_crons_exact -ne $true) -or
    ($Contract.vendor_upload_insert_policies_absent -ne $true) -or
    ($Contract.unproven_vendor_upload_objects_absent -ne $true) -or
    ($Contract.all_columns_present -ne $true) -or
    ($Contract.rate_limit_subject_contract_exact -ne $true) -or
    ($Contract.research_cohort_application_identity_exact -ne $true) -or
    ($Contract.privacy_minimum_contract_exact -ne $true) -or
    ($Contract.blocked_invite_constraint_valid -ne $true) -or
    ($Contract.public_schema_create_locked -ne $true) -or
    ($Contract.internal_service_acl_exact -ne $true) -or
    ($Contract.account_deletion_jobs_catalog_exact -ne $true) -or
    ($Contract.account_deletion_triggers_present -ne $true) -or
    ($Contract.all_sensitive_rls_present -ne $true) -or
    ($Contract.tables.amora_request_claims -ne $true) -or
    ($Contract.tables.amora_provider_leases -ne $true) -or
    ($Contract.tables.amora_usage_reservations -ne $true) -or
    ($Contract.tables.invitations_retired -ne $true) -or
    ([long]$Contract.legacy_invitation_photo_objects -ne 0) -or
    ($Contract.legacy_invitation_bucket_present -ne $false) -or
    ([long]$Contract.unattributed_chat_image_objects -ne 0) -or
    ([long]$Contract.orphaned_chat_image_objects -ne 0) -or
    ([long]$Contract.retired_invitation_inventory_jobs -ne 0)) {
    throw "Post-deploy contract failed. $($Contract | ConvertTo-Json -Depth 8 -Compress)"
  }
}

function Assert-MaintenanceHealth {
  param(
    [Parameter(Mandatory = $true)] [string]$BaseUrl,
    [Parameter(Mandatory = $true)] [string]$ExpectedRef,
    [Parameter(Mandatory = $true)] [string]$ExpectedDeployment
  )

  $uri = "$($BaseUrl.TrimEnd('/'))/api/health/maintenance?release_check=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  try {
    $status = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 10 `
      -Headers @{ "Cache-Control" = "no-cache" }
  } catch {
    throw "Live maintenance health endpoint is unreachable."
  }
  if ($status.maintenance -ne $true -or $status.supabaseProjectRef -ne $ExpectedRef) {
    throw "Live app is not in maintenance mode for the expected Supabase project."
  }
  if ($status.rateLimitKeySecretConfigured -ne $true) {
    throw "Live deployment is missing a dedicated high-entropy RATE_LIMIT_KEY_SECRET that passes the strict configuration boundary."
  }
  if ($status.turnstileCredentialsConfigured -ne $true -or
    $status.turnstileCanonicalHostnameConfigured -ne $true -or
    $status.turnstileConfigured -ne $true) {
    throw "Live deployment is missing the complete Turnstile site/secret pair or the exact hanbang.ai configuration binding. This configuration signal does not replace real hostname/action challenge evidence."
  }
  if ($status.researchCohortApplicationsEnabled -ne $false -or
    $status.accountDeletionCronEnabled -ne $false) {
    throw "Live deployment must keep research intake and account-deletion cron disabled during migration."
  }
  if ($status.coupleCourtEnabled -ne $false -or
    $status.coupleCourtAiEnabled -ne $false -or
    $status.coupleCourtPublicEnabled -ne $false -or
    $status.coupleCourtMockEnabled -ne $false) {
    throw "Live deployment must keep every Couple Court capability and provider mock disabled during migration."
  }
  $startedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse(
      [string]$status.maintenanceStartedAt,
      [ref]$startedAt
    )) {
    throw "Live maintenance status is missing its authoritative start time."
  }
  if ($startedAt -gt [DateTimeOffset]::UtcNow -or
    $startedAt -lt [DateTimeOffset]::UtcNow.AddMinutes(-30)) {
    throw "Live maintenance mode must have started within the last 30 minutes."
  }
  if ($ExpectedDeployment -notmatch '^[0-9a-f]{40}$' -or
    [string]$status.deployment -cne $ExpectedDeployment) {
    throw "Live maintenance deployment does not match the reviewed Git HEAD."
  }
  return [pscustomobject]@{
    StartedAt = $startedAt
    Deployment = [string]$status.deployment
  }
}

function Assert-AccountDeletionWorkerDrainWindow {
  param(
    [Parameter(Mandatory = $true)] [DateTimeOffset]$MaintenanceStartedAt
  )

  $elapsedSeconds = [DateTimeOffset]::UtcNow.Subtract(
    $MaintenanceStartedAt
  ).TotalSeconds
  if ($elapsedSeconds -lt $script:accountDeletionWorkerDrainSeconds) {
    $remainingSeconds = [Math]::Ceiling(
      $script:accountDeletionWorkerDrainSeconds - $elapsedSeconds
    )
    throw "Account-deletion cron is disabled, but the previous worker lease/invocation drain window has not elapsed. Retry after at least $remainingSeconds seconds."
  }
}

function Assert-NoProcessingAccountDeletionJobs {
  $row = Read-JsonSqlRow "Immediate account-deletion worker drain recheck" @"
SELECT count(*)::bigint AS processing_jobs
FROM public.account_deletion_jobs
WHERE status = 'processing';
"@
  if ($null -eq $row.processing_jobs -or [long]$row.processing_jobs -ne 0) {
    throw "Account-deletion workers are not fully drained. processing_jobs=$($row.processing_jobs)"
  }
}

function Assert-Backup {
  param(
    [Parameter(Mandatory = $true)] [string]$ProjectRef,
    [Parameter(Mandatory = $true)] [string]$RequestedBackupRef,
    [Parameter(Mandatory = $true)] [DateTimeOffset]$NotBefore
  )

  if ($RequestedBackupRef -notmatch '^\d{6,20}$') {
    throw "-BackupRef must be a numeric Supabase backup id."
  }
  $raw = Invoke-Step "Verify production backup" {
    corepack pnpm exec supabase backups list --project-ref $ProjectRef `
      --output-format json
  }
  $document = ($raw -join "`n") | ConvertFrom-Json
  $completedBackups = @($document.backups | Where-Object {
    $_.status -eq "COMPLETED" -and $_.is_physical_backup -eq $true
  } | Sort-Object { [DateTimeOffset]::Parse([string]$_.inserted_at) } -Descending)
  $backup = @($completedBackups | Where-Object {
    [string]$_.id -eq $RequestedBackupRef
  }) | Select-Object -First 1
  if (-not $backup -or $backup.status -ne "COMPLETED" -or
    $backup.is_physical_backup -ne $true) {
    throw "Requested backup is not a completed physical backup for this project."
  }
  $insertedAt = [DateTimeOffset]::Parse([string]$backup.inserted_at)
  if ($completedBackups.Count -eq 0 -or
    [string]$completedBackups[0].id -ne $RequestedBackupRef) {
    throw "Production requires the newest completed physical backup."
  }
  if ($insertedAt -gt [DateTimeOffset]::UtcNow -or
    $insertedAt -lt [DateTimeOffset]::UtcNow.AddMinutes(-30)) {
    throw "Production backup must have completed within the last 30 minutes."
  }
  if ($insertedAt -lt $NotBefore) {
    throw "Production backup predates the live maintenance/drain window."
  }
  Write-Host "Verified backup $RequestedBackupRef from $($insertedAt.ToString('u'))."
}

if ($Help) {
  Show-Help
  exit 0
}
if ([string]::IsNullOrWhiteSpace($ExpectedProjectRef)) {
  throw "-ExpectedProjectRef is required."
}

throw "Remote migration execution is disabled before any credential prompt until a provider-side lease, exact-target connection, filter-free worktree attestation, and reviewed PowerShell module boundary are verified."

$injectedEntrypointRoot = $ExecutionContext.SessionState.PSVariable.GetValue(
  "ReviewedEntrypointRoot"
)
$entrypointRoot = if ([string]::IsNullOrWhiteSpace($injectedEntrypointRoot)) {
  $PSScriptRoot
} else {
  [string]$injectedEntrypointRoot
}
$repoRoot = Resolve-Path (Join-Path $entrypointRoot "..")
Set-Location $repoRoot

$targets = Get-Content -Raw -LiteralPath "scripts/release-targets.json" |
  ConvertFrom-Json
$protectedProductionRefs = @($targets.productionSupabaseProjectRefs |
  ForEach-Object { [string]$_ })
$isProductionTarget = $ExpectedProjectRef -in $protectedProductionRefs
if ($Production -and -not $isProductionTarget) {
  throw "-Production is permitted only for a checked-in protected production ref."
}
if ($isProductionTarget -and ($SkipBuild -or $SkipLint -or $SkipAudit)) {
  throw "Protected production refs forbid -SkipBuild, -SkipLint, and -SkipAudit."
}
if ($isProductionTarget -and
  $targets.productionSupabaseAuthConfigContract -ne
    "direct-signup-disabled-general-password-v1") {
  throw "Production push is disabled because the reviewed hosted Auth config contract identity changed."
}
if ($isProductionTarget -and
  ($targets.productionSupabasePublicEmailBoundary.status -ne "verified-v1" -or
    $targets.productionSupabasePublicEmailBoundary.contract -ne
      "hosted-public-email-boundary-v1" -or
    [string]::IsNullOrWhiteSpace(
      [string]$targets.productionSupabasePublicEmailBoundary.approvedMode
    ))) {
  throw "Production push is disabled until public GoTrue recovery, resend, magic-link, and OTP email paths cannot bypass the reviewed CAPTCHA, limiter, neutral-response, and delivery boundary."
}
if ($isProductionTarget -and
  ($targets.productionSupabaseRedirectTokenPolicy.status -ne "verified-v1" -or
    $targets.productionSupabaseRedirectTokenPolicy.contract -ne
      "hosted-auth-redirect-token-v1")) {
  throw "Production push is disabled until the hosted site URL, exact redirect allow-list, JWT/refresh policy, email OTP policy, and Auth rate limits are read-only attested."
}
if ($isProductionTarget -and
  ($targets.productionOAuthProviderContract.status -ne "verified-v1" -or
    $targets.productionOAuthProviderContract.contract -ne
      "verified-visible-oauth-providers-v1")) {
  throw "Production push is disabled until every visible OAuth provider and redirect round-trip is independently attested."
}
if ($isProductionTarget -and
  ($targets.productionTurnstileBoundary.status -ne "verified-v1" -or
    $targets.productionTurnstileBoundary.contract -ne
      "siteverify-hostname-action-v1" -or
    $targets.productionTurnstileBoundary.canonicalHostname -cne "hanbang.ai" -or
    ((@($targets.productionTurnstileBoundary.requiredActions |
          ForEach-Object { [string]$_ })) -join ",") -cne
      "signup,forgot_password,preregister,survey")) {
  throw "Production push is disabled until Turnstile credentials, the hanbang.ai widget hostname, and all four hostname/action-bound Siteverify flows are independently attested."
}
if ($isProductionTarget -and
  ($targets.productionAdminPasswordLifecycle.status -ne "verified-v1" -or
    $targets.productionAdminPasswordLifecycle.contract -ne
      "role-aware-admin-password-v1" -or
    [int]$targets.productionAdminPasswordLifecycle.minimumLength -ne 12)) {
  throw "Production push is disabled until admin creation, recovery, and authenticated password updates enforce the role-aware 12-character policy at a non-bypassable boundary."
}
if ($isProductionTarget -and
  $targets.productionDatabaseWriteFence -ne "verified-v1") {
  throw "Production push is disabled until the DB/Storage direct-write fence is implemented and verified."
}
if ($isProductionTarget -and
  $targets.productionDatabaseWriteFenceContract -ne
    "database-readonly-realtime-cron-v1") {
  throw "Production push is disabled because the reviewed write-fence contract identity changed."
}
if ($isProductionTarget -and
  $targets.backupPolicy.status -ne "verified-v1") {
  throw "Production push is disabled until encrypted DB/Storage recovery and an isolated restore drill are verified."
}
if ($isProductionTarget) {
  throw "Production push remains disabled until ship is bound to a live fence snapshot, an automated black-box evidence producer, and an integrated reviewed exact-target direct DB runner."
}
$approvedNonProductionRefs = @($targets.approvedNonProductionSupabaseProjectRefs |
  ForEach-Object { [string]$_ })
if ($ExpectedProjectRef -notin $approvedNonProductionRefs) {
  throw "Remote migration requires a checked-in approved non-production project ref."
}

$linkedRefPath = Join-Path $repoRoot "supabase/.temp/project-ref"
if (-not (Test-Path -LiteralPath $linkedRefPath)) {
  throw "No linked Supabase project was found."
}
$linkedRef = (Get-Content -Raw -LiteralPath $linkedRefPath).Trim()
if ($linkedRef -ne $ExpectedProjectRef) {
  throw "Linked project ref does not match -ExpectedProjectRef."
}

$dirty = @(git status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect Git status."
}
if ($dirty.Count -gt 0) {
  throw "Git worktree must be clean before a remote migration."
}

# Local work happens before any production maintenance window starts.
Invoke-Step "TypeScript check" { corepack pnpm typecheck } | Out-Null
Invoke-Step "Unit tests" { corepack pnpm test } | Out-Null
if (-not $SkipLint) {
  Invoke-Step "Lint" { corepack pnpm lint } | Out-Null
}
if (-not $SkipBuild) {
  Invoke-Step "Production build" { corepack pnpm build } | Out-Null
}
if (-not $SkipAudit) {
  Invoke-Step "Production dependency audit" { corepack pnpm audit --prod } | Out-Null
}

$reviewedHead = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $reviewedHead -notmatch '^[0-9a-f]{40}$') {
  throw "Unable to capture the reviewed Git HEAD."
}
$reviewedDeployment = $reviewedHead
$reviewedFingerprint = Get-ReleaseArtifactFingerprint

$script:linkedRefPath = $linkedRefPath
$script:expectedRef = $ExpectedProjectRef
$linkLock = [System.IO.File]::Open(
  $linkedRefPath,
  [System.IO.FileMode]::Open,
  [System.IO.FileAccess]::Read,
  [System.IO.FileShare]::Read
)
$plainPassword = $null
$plainServiceRoleKey = $null
$plainAnonKey = $null
$previousPassword = $env:SUPABASE_DB_PASSWORD
$previousServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
$previousAnonKey = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY
$previousSupabaseUrl = $env:NEXT_PUBLIC_SUPABASE_URL

try {
  Assert-LinkedProject
  if ($isProductionTarget) {
    Invoke-Step "Exact hosted Auth config preflight" {
      node ./scripts/supabase-auth-config-preflight.mjs `
        --expected-project-ref $ExpectedProjectRef
    } | Out-Null
  }
  $localVersions = @(Get-ChildItem -LiteralPath "supabase/migrations" -Filter "*.sql" |
    ForEach-Object { $_.BaseName.Split('_')[0] } |
    Sort-Object -Unique)
  $expectedLatest = $localVersions[-1]

  $baselineRow = Read-JsonQueryRow "Core baseline and migration ledger gate" `
    "scripts/sql/supabase-core-baseline-preflight.sql"
  if ($baselineRow.baseline_preflight.history_present -ne $true) {
    throw "Migration 20260202000000 is missing. Run exact baseline reconciliation first."
  }
  $pendingVersions = @(Get-LedgerTopology $localVersions `
    @($baselineRow.baseline_preflight.applied_versions))

  $preflightRow = Read-JsonQueryRow "Initial production data inventory" `
    "scripts/sql/supabase-production-preflight.sql"
  $preflight = Complete-ProductionPreflightDynamicInventory `
    $preflightRow.preflight $pendingVersions
  $rewrites = Assert-ProductionPreflight $preflight $pendingVersions
  Assert-InvitationRetirementInventory $preflight $pendingVersions
  $rewrites["retired_invitation_inventory_jobs"] = `
    Get-RetiredInvitationInventoryJobCount $preflight
  $rewriteTotal = [long](($rewrites.Values | Measure-Object -Sum).Sum)
  Write-Host ""
  Write-Host "Planned data rewrites/deletions:"
  Write-Host ($rewrites | ConvertTo-Json -Compress)
  if ($rewriteTotal -gt 0) {
    $rewriteConfirmation = Read-Host "Type ACK_REWRITES to approve this exact inventory"
    if ($rewriteConfirmation -ne "ACK_REWRITES") {
      throw "Cancelled before data rewrites."
    }
  }

  $securePassword = Read-Host "Paste Supabase database password (hidden)" -AsSecureString
  $plainPassword = Convert-SecureStringToPlainText $securePassword
  if ([string]::IsNullOrWhiteSpace($plainPassword)) {
    throw "Supabase database password is required."
  }
  $env:SUPABASE_DB_PASSWORD = $plainPassword

  $env:NEXT_PUBLIC_SUPABASE_URL = "https://$ExpectedProjectRef.supabase.co"
  if ([string]::IsNullOrWhiteSpace($env:SUPABASE_SERVICE_ROLE_KEY)) {
    $secureServiceRoleKey = Read-Host `
      "Paste Supabase service-role key for the Storage API check (hidden)" `
      -AsSecureString
    $plainServiceRoleKey = Convert-SecureStringToPlainText $secureServiceRoleKey
    if ([string]::IsNullOrWhiteSpace($plainServiceRoleKey)) {
      throw "Supabase service-role key is required before any migration push."
    }
    $env:SUPABASE_SERVICE_ROLE_KEY = $plainServiceRoleKey
  }
  Invoke-Step "Storage service-role preflight" {
    node ./scripts/retire-invitation-bucket.mjs `
      --expected-project-ref $ExpectedProjectRef --verify-access-only
  } | Out-Null
  if ([string]::IsNullOrWhiteSpace($env:NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    $secureAnonKey = Read-Host "Paste Supabase anon key (hidden)" -AsSecureString
    $plainAnonKey = Convert-SecureStringToPlainText $secureAnonKey
    if ([string]::IsNullOrWhiteSpace($plainAnonKey)) {
      throw "Supabase anon key is required before any migration push."
    }
    $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $plainAnonKey
  }
  Invoke-Step "Anonymous key preflight" {
    node ./scripts/supabase-anon-probe.mjs `
      --expected-project-ref $ExpectedProjectRef --verify-key-only
  } | Out-Null

  Assert-LinkedProject
  Invoke-Step "List local/remote migrations" {
    corepack pnpm exec supabase migration list --linked
  } | Out-Null
  $initialDryRun = @(Invoke-Step "Dry-run pending migrations" {
    corepack pnpm exec supabase db push --linked --dry-run
  })
  Assert-DryRunMatches $initialDryRun $pendingVersions

  $authorizationExpiry = [DateTimeOffset]::MinValue
  if ($isProductionTarget) {
    if (-not $MaintenanceModeActive -or -not $TrafficDrained) {
      throw "Production requires active maintenance mode and drained traffic."
    }
    if (-not [DateTimeOffset]::TryParse(
        $MaintenanceAuthorizedUntilUtc,
        [ref]$authorizationExpiry
      )) {
      throw "Production requires a valid maintenance authorization expiry."
    }
    $now = [DateTimeOffset]::UtcNow
    if ($authorizationExpiry -le $now -or $authorizationExpiry -gt $now.AddMinutes(30)) {
      throw "Maintenance authorization must expire in the next 30 minutes."
    }
    $maintenanceIdentity = Assert-MaintenanceHealth `
      ([string]$targets.productionWebBaseUrl) $ExpectedProjectRef `
      $reviewedDeployment
    Assert-AccountDeletionWorkerDrainWindow $maintenanceIdentity.StartedAt
    Assert-NoProcessingAccountDeletionJobs
    Assert-Backup $ExpectedProjectRef $BackupRef $maintenanceIdentity.StartedAt
    $drainConfirmation = Read-Host "Type DRAINED_AND_MAINTENANCE_ACTIVE"
    if ($drainConfirmation -ne "DRAINED_AND_MAINTENANCE_ACTIVE") {
      throw "Production maintenance confirmation failed."
    }
  }

  $confirmation = Read-Host "Type APPLY to begin the final fail-closed checks and push"
  if ($confirmation -ne "APPLY") {
    throw "Cancelled before remote database changes."
  }

  # Nothing interactive occurs from this point until the push starts.
  Assert-LinkedProject
  Assert-ReleaseArtifactsUnchanged $reviewedHead $reviewedFingerprint
  if ($isProductionTarget) {
    if ([DateTimeOffset]::UtcNow -ge $authorizationExpiry) {
      throw "Maintenance authorization expired before apply."
    }
    $verifiedMaintenanceIdentity = Assert-MaintenanceHealth `
      ([string]$targets.productionWebBaseUrl) $ExpectedProjectRef `
      $reviewedDeployment
    if ($verifiedMaintenanceIdentity.StartedAt -ne $maintenanceIdentity.StartedAt -or
      $verifiedMaintenanceIdentity.Deployment -ne $maintenanceIdentity.Deployment) {
      throw "Maintenance deployment changed after backup approval."
    }
    Assert-AccountDeletionWorkerDrainWindow $verifiedMaintenanceIdentity.StartedAt
    Assert-NoProcessingAccountDeletionJobs
    Assert-Backup $ExpectedProjectRef $BackupRef $maintenanceIdentity.StartedAt
  }

  $finalPreflightRow = Read-JsonQueryRow "Final drained production preflight" `
    "scripts/sql/supabase-production-preflight.sql"
  $finalPreflight = Complete-ProductionPreflightDynamicInventory `
    $finalPreflightRow.preflight $pendingVersions
  $finalRewrites = Assert-ProductionPreflight $finalPreflight $pendingVersions `
    -RequireDrained:$isProductionTarget
  Assert-InvitationRetirementInventory $finalPreflight $pendingVersions
  $finalRewrites["retired_invitation_inventory_jobs"] = `
    Get-RetiredInvitationInventoryJobCount $finalPreflight
  if (($finalRewrites | ConvertTo-Json -Compress) -ne
      ($rewrites | ConvertTo-Json -Compress)) {
    throw "Rewrite inventory changed after approval."
  }

  $finalLedgerRow = Read-JsonQueryRow "Final migration ledger gate" `
    "scripts/sql/supabase-core-baseline-preflight.sql"
  $finalPending = @(Get-LedgerTopology $localVersions `
    @($finalLedgerRow.baseline_preflight.applied_versions))
  if (@(Compare-Object $pendingVersions $finalPending).Count -gt 0) {
    throw "Pending migration suffix changed after review."
  }
  $finalDryRun = @(Invoke-Step "Final dry-run" {
    Assert-LinkedProject
    corepack pnpm exec supabase db push --linked --dry-run
  })
  Assert-DryRunMatches $finalDryRun $pendingVersions

  # Re-query every expiring or externally mutable production authorization
  # after the final dry-run. No reviewed result from earlier in the workflow is
  # trusted across this last TOCTOU boundary.
  $pushLedgerRow = Read-JsonQueryRow "Immediate pre-push migration topology" `
    "scripts/sql/supabase-core-baseline-preflight.sql"
  $pushPending = @(Get-LedgerTopology $localVersions `
    @($pushLedgerRow.baseline_preflight.applied_versions))
  if (@(Compare-Object $pendingVersions $pushPending).Count -gt 0) {
    throw "Pending migration suffix changed immediately before push."
  }
  if ($isProductionTarget) {
    if ([DateTimeOffset]::UtcNow -ge $authorizationExpiry) {
      throw "Maintenance authorization expired immediately before push."
    }
    Invoke-Step "Immediate service-role project identity recheck" {
      node ./scripts/retire-invitation-bucket.mjs `
        --expected-project-ref $ExpectedProjectRef --verify-access-only
    } | Out-Null
    Invoke-Step "Immediate anonymous project identity recheck" {
      node ./scripts/supabase-anon-probe.mjs `
        --expected-project-ref $ExpectedProjectRef --verify-key-only
    } | Out-Null
    Invoke-Step "Immediate hosted Auth config recheck" {
      node ./scripts/supabase-auth-config-preflight.mjs `
        --expected-project-ref $ExpectedProjectRef
    } | Out-Null
    Assert-Backup $ExpectedProjectRef $BackupRef $maintenanceIdentity.StartedAt
    $pushMaintenanceIdentity = Assert-MaintenanceHealth `
      ([string]$targets.productionWebBaseUrl) $ExpectedProjectRef `
      $reviewedDeployment
    if ($pushMaintenanceIdentity.StartedAt -ne $maintenanceIdentity.StartedAt -or
      $pushMaintenanceIdentity.Deployment -ne $maintenanceIdentity.Deployment) {
      throw "Maintenance identity changed immediately before push."
    }
    Assert-AccountDeletionWorkerDrainWindow $pushMaintenanceIdentity.StartedAt
    Assert-NoProcessingAccountDeletionJobs
    if ([DateTimeOffset]::UtcNow -ge $authorizationExpiry) {
      throw "Maintenance authorization expired during immediate pre-push verification."
    }
  }

  # This is the last remote read before db push. The CLI cannot atomically bind
  # a topology query and push into one server transaction, so keep only local
  # comparisons and the reviewed HEAD/artifact check in the unavoidable gap.
  $lastMomentLedgerRow = Read-JsonQueryRow `
    "Last-moment pre-push migration topology" `
    "scripts/sql/supabase-core-baseline-preflight.sql"
  $lastMomentPending = @(Get-LedgerTopology $localVersions `
    @($lastMomentLedgerRow.baseline_preflight.applied_versions))
  if (@(Compare-Object $pendingVersions $lastMomentPending).Count -gt 0) {
    throw "Pending migration suffix changed at the last-moment pre-push gate."
  }
  Assert-LinkedProject
  Assert-ReleaseArtifactsUnchanged $reviewedHead $reviewedFingerprint
  Invoke-Step "Push pending migrations" {
    corepack pnpm exec supabase db push --linked
  } | Out-Null

  Invoke-Step "Retire invitation bucket through Storage API" {
    node ./scripts/retire-invitation-bucket.mjs `
      --expected-project-ref $ExpectedProjectRef
  } | Out-Null

  $postDryRun = @(Invoke-Step "Post-push dry-run" {
    corepack pnpm exec supabase db push --linked --dry-run
  })
  Assert-DryRunMatches $postDryRun @()

  $contractRow = Read-JsonQueryRow "Post-deploy database contract" `
    "scripts/sql/supabase-post-deploy-contract.sql"
  Assert-PostDeployContract $contractRow.contract $expectedLatest

  $postLedgerRow = Read-JsonQueryRow "Post-deploy migration ledger" `
    "scripts/sql/supabase-core-baseline-preflight.sql"
  $postPending = @(Get-LedgerTopology $localVersions `
    @($postLedgerRow.baseline_preflight.applied_versions))
  if ($postPending.Count -ne 0) {
    throw "Migration ledger still has a pending local suffix."
  }

  Invoke-Step "Anonymous HTTP authorization probe" {
    node ./scripts/supabase-anon-probe.mjs `
      --expected-project-ref $ExpectedProjectRef
  } | Out-Null

  Write-Host ""
  Write-Host "Database apply and database security checks passed."
  if ($isProductionTarget) {
    Write-Host "KEEP MAINTENANCE MODE ACTIVE until application deploy and smoke tests pass."
    Write-Host "Backup used: $BackupRef"
  }
} finally {
  if ($null -eq $previousPassword) {
    Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
  } else {
    $env:SUPABASE_DB_PASSWORD = $previousPassword
  }
  if ($null -eq $previousServiceRoleKey) {
    Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  } else {
    $env:SUPABASE_SERVICE_ROLE_KEY = $previousServiceRoleKey
  }
  if ($null -eq $previousAnonKey) {
    Remove-Item Env:NEXT_PUBLIC_SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
  } else {
    $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $previousAnonKey
  }
  if ($null -eq $previousSupabaseUrl) {
    Remove-Item Env:NEXT_PUBLIC_SUPABASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:NEXT_PUBLIC_SUPABASE_URL = $previousSupabaseUrl
  }
  $plainPassword = $null
  $plainServiceRoleKey = $null
  $plainAnonKey = $null
  $linkLock.Dispose()
}
