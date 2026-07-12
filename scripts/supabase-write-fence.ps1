param(
  [ValidateSet("Plan", "Capture", "Activate", "Verify", "Deactivate", "Recover")]
  [string]$Action = "Plan",
  [Parameter(Mandatory = $true)]
  [string]$ExpectedProjectRef,
  [string]$ReleaseIpv4Cidr,
  [string]$ReleaseIpv6Cidr,
  [string]$SnapshotPath,
  [string]$PostMigrationEvidencePath,
  [ValidateRange(5, 120)]
  [int]$DrainTimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ($MyInvocation.InvocationName -eq ".") {
  throw "The operational write-fence entrypoint cannot be dot-sourced."
}
$script:Contract = "database-readonly-realtime-cron-v1"
$script:SnapshotSchemaVersion = 2
$script:ExpectedReleaseDatabaseRoleClass = "supabase_project_postgres"
$script:PostMigrationEvidenceContract = "post-migration-release-evidence-v1"
$script:MaximumJournalArtifactCount = 64
$script:MaximumJournalArtifactBytes = 1MB
$script:SnapshotMaximumAge = [TimeSpan]::FromMinutes(5)
$script:ProviderRemoteRequestLimitPerMinute = 120
$script:RecoveryRequestReserve = 48
$script:NormalRemoteRequestLimit = 72
$script:PollIntervalMilliseconds = 3000
$script:NonPollingRequestAllowance = 24
$script:RemoteRequestTimestamps = [Collections.Generic.Queue[DateTimeOffset]]::new()
$script:UsingRecoveryRequestReserve = $false
$script:ManagementAccessToken = $null
$script:RunningOnWindows = [Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
  [Runtime.InteropServices.OSPlatform]::Windows
)
$script:OfflineTestFenceStateRoot = $null

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

if ($ExpectedProjectRef -notmatch '^[a-z0-9]{20}$') {
  throw "-ExpectedProjectRef must be a 20-character Supabase project ref."
}
if ($Action -ne "Plan") {
  throw "All remote write-fence execution is disabled before any companion file, credential, journal, Git, or remote boundary. Only Plan is operational until a provider-side lease/CAS, exact-target connection, cross-version recovery receipt, and disposable rehearsal are independently verified."
}

$injectedReleaseTargetsJson = $ExecutionContext.SessionState.PSVariable.GetValue(
  "ReviewedReleaseTargetsJson"
)
$injectedFenceStatusSql = $ExecutionContext.SessionState.PSVariable.GetValue(
  "ReviewedFenceStatusSql"
)
$releaseTargetsJson = if ([string]::IsNullOrWhiteSpace($injectedReleaseTargetsJson)) {
  Get-Content -Raw -LiteralPath "scripts/release-targets.json"
} else {
  [string]$injectedReleaseTargetsJson
}
$script:StatusSql = if ([string]::IsNullOrWhiteSpace($injectedFenceStatusSql)) {
  Get-Content -Raw -LiteralPath "scripts/sql/supabase-write-fence-status.sql"
} else {
  [string]$injectedFenceStatusSql
}
try {
  $targets = $releaseTargetsJson | ConvertFrom-Json
} catch {
  throw "The reviewed release-target policy is invalid."
}
$isProductionTarget = $ExpectedProjectRef -in @(
  $targets.productionSupabaseProjectRefs | ForEach-Object { [string]$_ }
)

# Keep the production fuse above every credential prompt and remote boundary.
$script:ManagementApiBase = "https://api.supabase.com"
$script:EnforcedNetworkStatuses = @("applied")
$script:PendingNetworkStatuses = @("stored")
$script:ProtectedRoles = @(
  "authenticator"
  "supabase_auth_admin"
  "supabase_storage_admin"
  "dashboard_user"
)
$script:RequiredPostMigrationChecks = @(
  "migrationHistoryExact"
  "databaseContractPassed"
  "dataApiWriteDenied"
  "authWriteDenied"
  "storageWriteDenied"
  "releaseConnectionWritable"
)
$script:LinkedRefPath = Join-Path $repoRoot "supabase/.temp/project-ref"

function Convert-SecureStringToPlainText {
  param([Parameter(Mandatory = $true)] [Security.SecureString]$Secure)

  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Read-FenceSecret {
  param([Parameter(Mandatory = $true)] [string]$Prompt)

  $secure = Read-Host $Prompt -AsSecureString
  $plain = Convert-SecureStringToPlainText $secure
  if ([string]::IsNullOrWhiteSpace($plain)) {
    throw "A required hidden credential was not provided."
  }
  return $plain
}

function Get-OptionalProperty {
  param(
    [Parameter(Mandatory = $true)] $Object,
    [Parameter(Mandatory = $true)] [string]$Name,
    $Default = $null
  )

  if ($null -ne $Object -and
    $Object.PSObject.Properties.Name -contains $Name) {
    return $Object.$Name
  }
  return $Default
}

function Get-RequiredManagementProperty {
  param(
    [Parameter(Mandatory = $true)] $Object,
    [Parameter(Mandatory = $true)] [string]$Name
  )

  if ($null -eq $Object) {
    throw "Management restore schema is missing a required provider field."
  }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) {
    throw "Management restore schema is missing a required provider field."
  }
  Write-Output -NoEnumerate $property.Value
}

function Get-RequiredManagementBoolean {
  param(
    [Parameter(Mandatory = $true)] $Object,
    [Parameter(Mandatory = $true)] [string]$Name
  )

  $value = Get-RequiredManagementProperty $Object $Name
  if ($value -isnot [bool]) {
    throw "Management restore schema requires an actual boolean provider field."
  }
  return $value
}

function Get-RequiredManagementString {
  param(
    [Parameter(Mandatory = $true)] $Object,
    [Parameter(Mandatory = $true)] [string]$Name
  )

  $value = Get-RequiredManagementProperty $Object $Name
  if ($value -isnot [string] -or [string]::IsNullOrWhiteSpace($value)) {
    throw "Management restore schema requires a non-empty string provider field."
  }
  return $value
}

function Get-RequiredManagementArray {
  param(
    [Parameter(Mandatory = $true)] $Object,
    [Parameter(Mandatory = $true)] [string]$Name
  )

  $value = Get-RequiredManagementProperty $Object $Name
  if ($value -isnot [Array]) {
    throw "Management restore schema requires an actual array provider field."
  }
  # Prevent PowerShell's pipeline from collapsing empty or single-item arrays.
  Write-Output -NoEnumerate $value
}

function Assert-ProviderNetworkCidr {
  param(
    [Parameter(Mandatory = $true)] $Cidr,
    [Parameter(Mandatory = $true)]
    [ValidateSet("IPv4", "IPv6")]
    [string]$Family
  )

  if ($Cidr -isnot [string] -or $Cidr.Trim() -ne $Cidr -or
    $Cidr.Contains('%')) {
    throw "Management restore schema contains an invalid provider CIDR."
  }
  $parts = $Cidr.Split('/')
  $address = $null
  $prefix = 0
  if ($parts.Count -ne 2 -or
    -not [Net.IPAddress]::TryParse($parts[0], [ref]$address) -or
    -not [int]::TryParse(
      $parts[1],
      [Globalization.NumberStyles]::None,
      [Globalization.CultureInfo]::InvariantCulture,
      [ref]$prefix
    )) {
    throw "Management restore schema contains an invalid provider CIDR."
  }
  $expectedFamily = if ($Family -eq "IPv4") {
    [Net.Sockets.AddressFamily]::InterNetwork
  } else {
    [Net.Sockets.AddressFamily]::InterNetworkV6
  }
  $maximumPrefix = if ($Family -eq "IPv4") { 32 } else { 128 }
  if ($address.AddressFamily -ne $expectedFamily -or
    $prefix -lt 0 -or $prefix -gt $maximumPrefix) {
    throw "Management restore schema contains a provider CIDR in the wrong address family."
  }

  # Provider allowlists are restored verbatim. Require a network-base address
  # so a provider normalization cannot silently change the captured baseline.
  $bytes = $address.GetAddressBytes()
  for ($index = 0; $index -lt $bytes.Length; $index += 1) {
    $remaining = $prefix - ($index * 8)
    if ($remaining -ge 8) {
      continue
    }
    $mask = if ($remaining -le 0) {
      0
    } else {
      (0xff -shl (8 - $remaining)) -band 0xff
    }
    if (($bytes[$index] -band (-bnot $mask -band 0xff)) -ne 0) {
      throw "Management restore schema contains a non-canonical provider CIDR."
    }
  }
}

function Assert-ProviderNetworkCidrArray {
  param(
    [Parameter(Mandatory = $true)] [AllowEmptyCollection()] [Array]$Cidrs,
    [Parameter(Mandatory = $true)]
    [ValidateSet("IPv4", "IPv6")]
    [string]$Family
  )

  foreach ($cidr in $Cidrs) {
    Assert-ProviderNetworkCidr $cidr $Family
  }
}

function Assert-ExactManagementPropertySet {
  param(
    [Parameter(Mandatory = $true)] $Object,
    [Parameter(Mandatory = $true)] [string[]]$Allowed
  )

  $actual = @($Object.PSObject.Properties | ForEach-Object { [string]$_.Name })
  if (@(Compare-Object $actual $Allowed).Count -ne 0) {
    throw "Management restore schema contains an unexpected normalized field."
  }
}

function Assert-ManagementRestoreBaselineSchema {
  param([Parameter(Mandatory = $true)] $Management)

  try {
    $network = Get-RequiredManagementProperty $Management "network"
    $realtime = Get-RequiredManagementProperty $Management "realtime"
    $auth = Get-RequiredManagementProperty $Management "auth"
    foreach ($section in @($network, $realtime, $auth)) {
      if ($null -eq $section -or $section -is [string] -or
        $section -is [Array] -or $section.GetType().IsValueType) {
        throw "Management restore schema requires nested provider objects."
      }
    }

    Assert-ExactManagementPropertySet $Management @("network", "realtime", "auth")
    Assert-ExactManagementPropertySet $network @("ipv4", "ipv6", "status", "entitlement")
    Assert-ExactManagementPropertySet $realtime @("suspend")
    Assert-ExactManagementPropertySet $auth @("disableSignup")

    $ipv4 = Get-RequiredManagementArray $network "ipv4"
    $ipv6 = Get-RequiredManagementArray $network "ipv6"
    Assert-ProviderNetworkCidrArray -Cidrs $ipv4 -Family "IPv4"
    Assert-ProviderNetworkCidrArray -Cidrs $ipv6 -Family "IPv6"
    Get-RequiredManagementString $network "status" | Out-Null
    Get-RequiredManagementString $network "entitlement" | Out-Null
    Get-RequiredManagementBoolean $realtime "suspend" | Out-Null
    Get-RequiredManagementBoolean $auth "disableSignup" | Out-Null
  } catch {
    throw "Write-fence snapshot exact-restore management baseline has an invalid schema."
  }
}

function Assert-LinkedProject {
  if (-not (Test-Path -LiteralPath $script:LinkedRefPath)) {
    throw "No linked Supabase project was found."
  }
  $linkedRef = (Get-Content -Raw -LiteralPath $script:LinkedRefPath).Trim()
  if ($linkedRef -ne $ExpectedProjectRef) {
    throw "Linked Supabase project does not match -ExpectedProjectRef."
  }
}

function Enter-LinkedProjectReadLock {
  Assert-LinkedProject
  try {
    $handle = [IO.File]::Open(
      $script:LinkedRefPath,
      [IO.FileMode]::Open,
      [IO.FileAccess]::Read,
      [IO.FileShare]::Read
    )
  } catch [IO.IOException] {
    throw "Linked Supabase project identity is being changed by another process."
  }
  try {
    Assert-LinkedProject
    return $handle
  } catch {
    $handle.Dispose()
    throw
  }
}

function Get-CleanReviewedGitIdentity {
  $dirty = @(git status --porcelain=v1 --untracked-files=all)
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect Git worktree state."
  }
  if ($dirty.Count -ne 0) {
    throw "Git worktree must be clean before a write-fence lifecycle action."
  }

  $head = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$') {
    throw "Unable to capture the reviewed Git HEAD."
  }
  $tree = (git rev-parse 'HEAD^{tree}').Trim()
  if ($LASTEXITCODE -ne 0 -or $tree -notmatch '^[0-9a-f]{40}$') {
    throw "Unable to capture the reviewed Git tree."
  }

  return [pscustomobject]@{
    head = $head
    tree = $tree
  }
}

function Assert-ReleaseCidr {
  param(
    [Parameter(Mandatory = $true)] [string]$Cidr,
    [Parameter(Mandatory = $true)] [ValidateSet("IPv4", "IPv6")] [string]$Family
  )

  $parts = $Cidr.Split('/')
  if ($parts.Count -ne 2) {
    throw "$Family release CIDR must contain one address and an exact host prefix."
  }
  $address = $null
  if (-not [Net.IPAddress]::TryParse($parts[0], [ref]$address)) {
    throw "$Family release CIDR has an invalid address."
  }
  $expectedFamily = if ($Family -eq "IPv4") {
    [Net.Sockets.AddressFamily]::InterNetwork
  } else {
    [Net.Sockets.AddressFamily]::InterNetworkV6
  }
  $expectedPrefix = if ($Family -eq "IPv4") { "32" } else { "128" }
  if ($address.AddressFamily -ne $expectedFamily -or $parts[1] -ne $expectedPrefix) {
    throw "$Family release CIDR must be a single-host /$expectedPrefix CIDR."
  }
}

function Get-FenceStateRoot {
  if (-not [string]::IsNullOrWhiteSpace($script:OfflineTestFenceStateRoot)) {
    if ($Action -ne "Plan" -or $isProductionTarget) {
      throw "The offline journal root override is restricted to non-production Plan tests."
    }
    return [IO.Path]::GetFullPath($script:OfflineTestFenceStateRoot)
  }
  if (-not $script:RunningOnWindows) {
    throw "Write-fence lifecycle state is supported only on the approved Windows release workstation."
  }
  $stateRoot = [Environment]::GetFolderPath(
    [Environment+SpecialFolder]::LocalApplicationData
  )
  if ([string]::IsNullOrWhiteSpace($stateRoot)) {
    throw "The canonical Windows LocalApplicationData directory is required for the write-fence journal."
  }
  return [IO.Path]::GetFullPath($stateRoot)
}

function Get-SnapshotRoot {
  $stateRoot = Get-FenceStateRoot
  return [IO.Path]::GetFullPath(
    (Join-Path $stateRoot "WeddingHanbang/release-fence/$ExpectedProjectRef")
  )
}

function Test-PathInsideJournalRoot {
  param(
    [Parameter(Mandatory = $true)] [string]$Candidate,
    [Parameter(Mandatory = $true)] [string]$Root
  )

  $trimmedRoot = $Root.TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
  $rootWithSeparator = $trimmedRoot + [IO.Path]::DirectorySeparatorChar
  $comparison = if ($script:RunningOnWindows) {
    [StringComparison]::OrdinalIgnoreCase
  } else {
    [StringComparison]::Ordinal
  }
  return $Candidate.StartsWith($rootWithSeparator, $comparison)
}

function Assert-NoReparsePointInJournalPath {
  param(
    [Parameter(Mandatory = $true)] [string]$Candidate,
    [Parameter(Mandatory = $true)] [string]$Boundary
  )

  $fullCandidate = [IO.Path]::GetFullPath($Candidate)
  $trimmedBoundary = ([IO.Path]::GetFullPath($Boundary)).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
  $comparison = if ($script:RunningOnWindows) {
    [StringComparison]::OrdinalIgnoreCase
  } else {
    [StringComparison]::Ordinal
  }
  $boundaryWithSeparator = $trimmedBoundary + [IO.Path]::DirectorySeparatorChar
  if (-not $fullCandidate.Equals($trimmedBoundary, $comparison) -and
    -not $fullCandidate.StartsWith($boundaryWithSeparator, $comparison)) {
    throw "Write-fence journal paths must stay inside the platform-local state boundary."
  }

  # The state root itself is the trusted OS/user boundary. Reject every
  # existing descendant component that redirects traversal elsewhere. This
  # covers Windows junctions and filesystem symbolic links before journal I/O.
  $relative = $fullCandidate.Substring($trimmedBoundary.Length).TrimStart(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
  $current = $trimmedBoundary
  foreach ($component in @($relative -split '[\\/]+' | Where-Object { $_ -ne "" })) {
    $current = Join-Path $current $component
    try {
      $attributes = [IO.File]::GetAttributes($current)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Write-fence journal paths cannot traverse a reparse point or symbolic link."
      }
    } catch [IO.FileNotFoundException] {
      # A missing component cannot redirect traversal yet. Later checks run
      # after directory creation and immediately before the publish/read.
    } catch [IO.DirectoryNotFoundException] {
      # Same fail-safe handling for a missing ancestor.
    }
  }
}

function Assert-FenceJournalPathSafe {
  param([Parameter(Mandatory = $true)] [string]$Path)

  $root = Get-SnapshotRoot
  $candidate = [IO.Path]::GetFullPath($Path)
  if (-not (Test-PathInsideJournalRoot $candidate $root)) {
    throw "SnapshotPath must stay inside the local release-fence journal directory."
  }
  Assert-NoReparsePointInJournalPath -Candidate $root -Boundary (Get-FenceStateRoot)
  Assert-NoReparsePointInJournalPath -Candidate $candidate -Boundary (Get-FenceStateRoot)
  $parent = [IO.Path]::GetDirectoryName($candidate)
  $comparison = if ($script:RunningOnWindows) {
    [StringComparison]::OrdinalIgnoreCase
  } else {
    [StringComparison]::Ordinal
  }
  if (-not $parent.Equals($root, $comparison)) {
    throw "Write-fence journal artifacts must be direct children of the project journal."
  }
}

function Get-FenceJournalUnixModeContract {
  param([switch]$Directory)

  $modeType = [IO.File].Assembly.GetType("System.IO.UnixFileMode", $false)
  if ($null -eq $modeType) {
    throw "This platform cannot enforce private write-fence journal permissions."
  }
  $modeName = if ($Directory) {
    "UserRead, UserWrite, UserExecute"
  } else {
    "UserRead, UserWrite"
  }
  return [Enum]::Parse($modeType, $modeName)
}

function Set-FenceJournalPathPrivate {
  param(
    [Parameter(Mandatory = $true)] [string]$Path,
    [switch]$Directory
  )

  $fullPath = [IO.Path]::GetFullPath($Path)
  if ($script:RunningOnWindows) {
    try {
      $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
      $sid = $identity.User
      if ($null -eq $sid) {
        throw "missing current-user SID"
      }
      $rights = [Security.AccessControl.FileSystemRights]::FullControl
      $inheritance = if ($Directory) {
        [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
          [Security.AccessControl.InheritanceFlags]::ObjectInherit
      } else {
        [Security.AccessControl.InheritanceFlags]::None
      }
      $propagation = [Security.AccessControl.PropagationFlags]::None
      $accessType = [Security.AccessControl.AccessControlType]::Allow
      $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        $sid,
        $rights,
        $inheritance,
        $propagation,
        $accessType
      )
      if ($Directory) {
        $security = [Security.AccessControl.DirectorySecurity]::new()
        $security.SetOwner($sid)
        $security.SetAccessRuleProtection($true, $false)
        $security.AddAccessRule($rule) | Out-Null
        [IO.Directory]::SetAccessControl($fullPath, $security)
      } else {
        $security = [Security.AccessControl.FileSecurity]::new()
        $security.SetOwner($sid)
        $security.SetAccessRuleProtection($true, $false)
        $security.AddAccessRule($rule) | Out-Null
        [IO.File]::SetAccessControl($fullPath, $security)
      }
    } catch {
      throw "Windows could not enforce the current-user-only write-fence journal ACL."
    }
  } else {
    try {
      $mode = Get-FenceJournalUnixModeContract -Directory:$Directory
      $method = @([IO.File].GetMethods() | Where-Object {
        $_.Name -eq "SetUnixFileMode" -and $_.GetParameters().Count -eq 2 -and
        $_.GetParameters()[0].ParameterType -eq [string]
      })
      if ($method.Count -ne 1) {
        throw "missing SetUnixFileMode"
      }
      $arguments = [object[]]::new(2)
      $arguments[0] = $fullPath
      $arguments[1] = $mode
      $method[0].Invoke($null, $arguments) | Out-Null
    } catch {
      throw "Unix could not enforce private write-fence journal permissions."
    }
  }
  Assert-FenceJournalPathPrivate -Path $fullPath -Directory:$Directory
}

function Assert-FenceJournalPathPrivate {
  param(
    [Parameter(Mandatory = $true)] [string]$Path,
    [switch]$Directory
  )

  $fullPath = [IO.Path]::GetFullPath($Path)
  if ($script:RunningOnWindows) {
    try {
      $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
      $acl = if ($Directory) {
        [IO.Directory]::GetAccessControl($fullPath)
      } else {
        [IO.File]::GetAccessControl($fullPath)
      }
      $owner = $acl.GetOwner(
        [Security.Principal.SecurityIdentifier]
      )
      $rules = @($acl.GetAccessRules(
        $true,
        $true,
        [Security.Principal.SecurityIdentifier]
      ))
      $currentUserFullControl = @($rules | Where-Object {
        $_.IdentityReference.Value -eq $sid.Value -and
        $_.AccessControlType -eq
          [Security.AccessControl.AccessControlType]::Allow -and
        ($_.FileSystemRights -band
          [Security.AccessControl.FileSystemRights]::FullControl) -eq
          [Security.AccessControl.FileSystemRights]::FullControl
      }).Count -ge 1
      $foreignOrDenied = @($rules | Where-Object {
        $_.IdentityReference.Value -ne $sid.Value -or
        $_.AccessControlType -ne
          [Security.AccessControl.AccessControlType]::Allow
      }).Count -ne 0
      if (-not $acl.AreAccessRulesProtected -or
        $owner.Value -ne $sid.Value -or
        -not $currentUserFullControl -or $foreignOrDenied) {
        throw "ACL is not current-user-only"
      }
      return
    } catch {
      throw "Windows write-fence journal ACL is not current-user-only."
    }
  }

  try {
    $expected = Get-FenceJournalUnixModeContract -Directory:$Directory
    $method = @([IO.File].GetMethods() | Where-Object {
      $_.Name -eq "GetUnixFileMode" -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType -eq [string]
    })
    if ($method.Count -ne 1) {
      throw "missing GetUnixFileMode"
    }
    $arguments = [object[]]::new(1)
    $arguments[0] = $fullPath
    $actual = $method[0].Invoke($null, $arguments)
    if ([long]$actual -ne [long]$expected) {
      throw "mode is not exact"
    }
  } catch {
    throw "Unix write-fence journal permissions are not private."
  }
}

function Assert-FenceSnapshotPathCanonical {
  param([Parameter(Mandatory = $true)] [string]$Path)

  Assert-FenceJournalPathSafe $Path
  $leaf = [IO.Path]::GetFileName([IO.Path]::GetFullPath($Path))
  if ($leaf -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$') {
    throw "Write-fence snapshots require a canonical lowercase UUID.json file name."
  }
}

function Sync-FenceDirectoryMetadata {
  param([Parameter(Mandatory = $true)] [string]$Path)

  $interop = Get-FenceJournalInteropType
  try {
    $method = if ($script:RunningOnWindows) {
      "FlushDirectoryWriteThrough"
    } else {
      "FlushDirectory"
    }
    $arguments = [object[]]::new(1)
    $arguments[0] = [string][IO.Path]::GetFullPath($Path)
    $interop.GetMethod($method).Invoke($null, $arguments) |
      Out-Null
  } catch {
    throw "Write-fence directory durability synchronization failed."
  }
}

function Publish-FenceDirectoryEntryDurably {
  param(
    [Parameter(Mandatory = $true)] [string]$Parent,
    [Parameter(Mandatory = $true)] [string]$Path
  )

  Assert-NoReparsePointInJournalPath -Candidate $Parent -Boundary (Get-FenceStateRoot)
  Assert-NoReparsePointInJournalPath -Candidate $Path -Boundary (Get-FenceStateRoot)
  if ([IO.Directory]::Exists($Path)) {
    return
  }
  if ([IO.File]::Exists($Path)) {
    throw "Write-fence journal hierarchy contains a non-directory component."
  }

  if ($script:RunningOnWindows) {
    # Create an empty sibling and publish the directory entry itself with
    # MOVEFILE_WRITE_THROUGH. MoveFileEx supports directories on the same
    # volume, so the parent link is durable before the next level is created.
    $temporary = Join-Path $Parent ".fence-dir-$([Guid]::NewGuid().ToString('N')).tmp"
    $temporaryCreated = $false
    try {
      [IO.Directory]::CreateDirectory($temporary) | Out-Null
      $temporaryCreated = $true
      Assert-NoReparsePointInJournalPath `
        -Candidate $temporary -Boundary (Get-FenceStateRoot)
      $interop = Get-FenceJournalInteropType
      $arguments = [object[]]::new(2)
      $arguments[0] = [string]$temporary
      $arguments[1] = [string]$Path
      $interop.GetMethod("MoveDirectoryWriteThrough").Invoke(
        $null,
        $arguments
      ) | Out-Null
      $temporaryCreated = $false
    } catch {
      if ($temporaryCreated -and [IO.Directory]::Exists($temporary)) {
        [IO.Directory]::Delete($temporary)
      }
      # A simultaneous first initializer may have won the no-replace rename.
      # Accept only an ordinary directory; all other outcomes fail closed.
      Assert-NoReparsePointInJournalPath -Candidate $Path -Boundary (Get-FenceStateRoot)
      if (-not [IO.Directory]::Exists($Path)) {
        throw "Write-fence journal directory write-through publication failed."
      }
    }
  } else {
    try {
      [IO.Directory]::CreateDirectory($Path) | Out-Null
    } catch {
      throw "Write-fence journal directory creation failed."
    }
    # Persist the new child entry in its existing parent immediately. The
    # hierarchy is also synced bottom-up after every level has been verified.
    Sync-FenceDirectoryMetadata $Parent
  }

  Assert-NoReparsePointInJournalPath -Candidate $Path -Boundary (Get-FenceStateRoot)
  if (-not [IO.Directory]::Exists($Path)) {
    throw "Write-fence journal directory could not be proven after creation."
  }
}

function Ensure-FenceJournalHierarchyDurable {
  $stateRoot = Get-FenceStateRoot
  if (-not [IO.Directory]::Exists($stateRoot)) {
    throw "The platform-local state boundary must exist before write-fence initialization."
  }
  $stateAttributes = [IO.File]::GetAttributes($stateRoot)
  if (($stateAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "The platform-local state boundary cannot be a reparse point or symbolic link."
  }

  $durabilityOrder = [Collections.Generic.List[string]]::new()
  $durabilityOrder.Add($stateRoot)
  $parent = $stateRoot
  foreach ($component in @("WeddingHanbang", "release-fence", $ExpectedProjectRef)) {
    $path = Join-Path $parent $component
    Publish-FenceDirectoryEntryDurably -Parent $parent -Path $path
    Assert-NoReparsePointInJournalPath -Candidate $path -Boundary $stateRoot
    if (-not [IO.Directory]::Exists($path)) {
      throw "Write-fence journal hierarchy is incomplete after durable publication."
    }
    Set-FenceJournalPathPrivate -Path $path -Directory
    $durabilityOrder.Add($path)
    $parent = $path
  }

  # Flush deepest-to-root so each directory's contents are stable before the
  # parent entry that makes that directory reachable is declared durable.
  $durabilityOrder = $durabilityOrder.ToArray()
  [array]::Reverse($durabilityOrder)
  foreach ($directory in $durabilityOrder) {
    Sync-FenceDirectoryMetadata $directory
  }
  return $parent
}

function Enter-ProjectFenceLifecycleLock {
  $root = Ensure-FenceJournalHierarchyDurable
  if ($root -ne (Get-SnapshotRoot)) {
    throw "Write-fence journal hierarchy resolved to an unexpected project path."
  }
  Assert-NoReparsePointInJournalPath -Candidate $root -Boundary (Get-FenceStateRoot)
  $lockPath = Join-Path $root ".lifecycle.lock"
  Assert-FenceJournalPathSafe $lockPath
  $handle = $null
  try {
    $handle = [IO.File]::Open(
      $lockPath,
      [IO.FileMode]::OpenOrCreate,
      [IO.FileAccess]::ReadWrite,
      [IO.FileShare]::None
    )
    Set-FenceJournalPathPrivate -Path $lockPath
    return $handle
  } catch [IO.IOException] {
    if ($null -ne $handle) {
      $handle.Dispose()
    }
    throw "Another write-fence lifecycle action is already active for this project."
  } catch {
    if ($null -ne $handle) {
      $handle.Dispose()
    }
    throw
  }
}

function Resolve-FenceSnapshotPath {
  param([switch]$ForCapture)

  $root = Get-SnapshotRoot
  if ([string]::IsNullOrWhiteSpace($SnapshotPath)) {
    if (-not $ForCapture) {
      throw "-SnapshotPath is required for this action."
    }
    $id = [Guid]::NewGuid().ToString("D")
    $candidate = Join-Path $root "$id.json"
    Assert-FenceSnapshotPathCanonical $candidate
    return $candidate
  }

  $candidate = [IO.Path]::GetFullPath($SnapshotPath)
  Assert-FenceSnapshotPathCanonical $candidate
  if ($ForCapture -and (Test-Path -LiteralPath $candidate)) {
    throw "Capture refuses to overwrite an existing write-fence journal."
  }
  return $candidate
}

function Resolve-PostMigrationEvidencePath {
  if ([string]::IsNullOrWhiteSpace($PostMigrationEvidencePath)) {
    throw "-PostMigrationEvidencePath is required for this action."
  }

  $root = Get-SnapshotRoot
  $candidate = [IO.Path]::GetFullPath($PostMigrationEvidencePath)
  if (-not (Test-PathInsideJournalRoot $candidate $root) -or
    [IO.Path]::GetExtension($candidate) -ne ".json") {
    throw "Post-migration evidence must be a JSON file inside the local journal directory."
  }
  Assert-FenceJournalPathSafe $candidate
  if (-not [string]::IsNullOrWhiteSpace($SnapshotPath) -and
    $candidate -eq [IO.Path]::GetFullPath($SnapshotPath)) {
    throw "Post-migration evidence must be separate from the fence snapshot."
  }
  return $candidate
}

function Read-FenceJournalPayloadBounded {
  param([Parameter(Mandatory = $true)] [string]$Path)

  Assert-FenceJournalPathSafe $Path
  Set-FenceJournalPathPrivate -Path $Path
  $stream = $null
  $sha256 = $null
  try {
    $stream = [IO.File]::Open(
      $Path,
      [IO.FileMode]::Open,
      [IO.FileAccess]::Read,
      [IO.FileShare]::Read
    )
    $length = $stream.Length
    if ($length -le 0 -or $length -gt $script:MaximumJournalArtifactBytes) {
      throw "Write-fence journal inventory artifact exceeds its bounded size."
    }
    $bytes = [byte[]]::new([int]$length)
    $offset = 0
    while ($offset -lt $bytes.Length) {
      $read = $stream.Read($bytes, $offset, $bytes.Length - $offset)
      if ($read -le 0) {
        throw "Write-fence journal inventory artifact changed during its bounded read."
      }
      $offset += $read
    }
    if ($stream.Length -ne $length) {
      throw "Write-fence journal inventory artifact changed during its bounded read."
    }
    $sha256 = [Security.Cryptography.SHA256]::Create()
    $digest = [BitConverter]::ToString(
      $sha256.ComputeHash($bytes)
    ).Replace("-", "").ToLowerInvariant()
    $json = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
    return [pscustomobject]@{
      json = $json
      digestSha256 = $digest
      byteLength = [long]$bytes.Length
    }
  } catch [Text.DecoderFallbackException] {
    throw "Write-fence journal inventory artifact is not strict UTF-8."
  } catch {
    if ($_.Exception.Message -match '^Write-fence journal inventory artifact ') {
      throw $_.Exception.Message
    }
    throw "Write-fence journal inventory artifact could not be read through a bounded handle."
  } finally {
    if ($null -ne $sha256) {
      $sha256.Dispose()
    }
    if ($null -ne $stream) {
      $stream.Dispose()
    }
  }
}

function Read-PostMigrationEvidence {
  param(
    [Parameter(Mandatory = $true)] [string]$Path,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  Assert-FenceJournalPathSafe $Path
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Post-migration evidence does not exist."
  }
  $payload = Read-FenceJournalPayloadBounded $Path
  try {
    $evidence = $payload.json | ConvertFrom-Json
  } catch {
    throw "Post-migration evidence is malformed JSON."
  }
  Assert-PostMigrationEvidenceInventorySchema $evidence
  if ($evidence.schemaVersion -ne 1 -or
    $evidence.contract -ne $script:PostMigrationEvidenceContract -or
    $evidence.projectRef -ne $ExpectedProjectRef -or
    $evidence.fenceId -ne $Snapshot.fenceId -or
    $evidence.reviewedHead -ne $Snapshot.reviewedHead) {
    throw "Post-migration evidence identity does not match the active fence."
  }

  foreach ($check in $script:RequiredPostMigrationChecks) {
    if ((Get-OptionalProperty $evidence.checks $check $false) -ne $true) {
      throw "Post-migration evidence is missing a required passing check."
    }
  }

  try {
    $verifiedAt = [DateTimeOffset]::Parse(
      [string]$evidence.verifiedAtUtc,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind
    )
    $migrationStep = @($Snapshot.steps | Where-Object {
      $_.name -eq "migration" -and $_.status -eq "started"
    })
    if ($migrationStep.Count -ne 1) {
      throw "Missing migration-start journal boundary."
    }
    $startedAt = [DateTimeOffset]::Parse(
      [string]$migrationStep[0].recordedAtUtc,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind
    )
  } catch {
    throw "Post-migration evidence has an invalid verification timestamp."
  }

  $now = [DateTimeOffset]::UtcNow
  if ($verifiedAt -lt $startedAt -or $verifiedAt -lt $now.AddMinutes(-30) -or
    $verifiedAt -gt $now.AddMinutes(5)) {
    throw "Post-migration evidence timestamp is outside the allowed release window."
  }

  return [pscustomobject]@{
    contract = $script:PostMigrationEvidenceContract
    digestSha256 = $payload.digestSha256
    verifiedAtUtc = $verifiedAt.ToUniversalTime().ToString("o")
    allRequiredChecksPassed = $true
  }
}

function Assert-PostMigrationEvidenceRebound {
  param(
    [Parameter(Mandatory = $true)] [string]$Path,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $actual = Read-PostMigrationEvidence $Path $Snapshot
  $expected = $Snapshot.postMigrationEvidence
  Assert-PostMigrationEvidenceSummary `
    $Snapshot `
    (Get-FenceStepByName $Snapshot "migration") `
    (Get-FenceStepByName $Snapshot "migration_verification")
  foreach ($field in @(
      "contract", "digestSha256", "verifiedAtUtc", "allRequiredChecksPassed"
    )) {
    if ($actual.$field -cne $expected.$field) {
      throw "Post-migration evidence no longer matches the journaled $field summary field."
    }
  }
}

function Assert-RestoreEvidenceBoundary {
  param([Parameter(Mandatory = $true)] $Snapshot)

  if ($Snapshot.migrationVerified -eq $true) {
    $reboundEvidencePath = Resolve-PostMigrationEvidencePath
    Assert-PostMigrationEvidenceRebound $reboundEvidencePath $Snapshot
    return
  }
  if (-not [string]::IsNullOrWhiteSpace($PostMigrationEvidencePath)) {
    throw "Post-migration evidence is forbidden unless the journal has a verified migration."
  }
}

function Assert-PostMigrationEvidenceInventorySchema {
  param([Parameter(Mandatory = $true)] $Evidence)

  try {
    Assert-NoSecretFields $Evidence
    if ($null -eq $Evidence -or $Evidence -is [string] -or
      $Evidence -is [Array] -or $Evidence.GetType().IsValueType) {
      throw "invalid"
    }
    $allowed = @(
      "schemaVersion", "contract", "projectRef", "fenceId", "reviewedHead",
      "verifiedAtUtc", "checks"
    )
    $actual = @($Evidence.PSObject.Properties.Name | ForEach-Object { [string]$_ })
    $schemaVersion = Get-OptionalProperty $Evidence "schemaVersion" $null
    $contract = Get-OptionalProperty $Evidence "contract" $null
    $projectRef = Get-OptionalProperty $Evidence "projectRef" $null
    $fenceIdText = Get-OptionalProperty $Evidence "fenceId" $null
    $reviewedHead = Get-OptionalProperty $Evidence "reviewedHead" $null
    $verifiedAtText = Get-OptionalProperty $Evidence "verifiedAtUtc" $null
    if (@(Compare-Object $actual $allowed -CaseSensitive).Count -ne 0 -or
      ($schemaVersion -isnot [int] -and $schemaVersion -isnot [long]) -or
      [long]$schemaVersion -ne 1 -or
      $contract -isnot [string] -or
      $contract -cne $script:PostMigrationEvidenceContract -or
      $projectRef -isnot [string] -or $projectRef -cne $ExpectedProjectRef -or
      $fenceIdText -isnot [string] -or $reviewedHead -isnot [string] -or
      $reviewedHead -cnotmatch '^[0-9a-f]{40}$' -or
      $verifiedAtText -isnot [string]) {
      throw "invalid"
    }
    $fenceId = [Guid]::Empty
    $verifiedAt = [DateTimeOffset]::MinValue
    if (-not [Guid]::TryParse(
        $fenceIdText,
        [ref]$fenceId
      ) -or
      $fenceIdText -cne $fenceId.ToString("D") -or
      -not [DateTimeOffset]::TryParse(
        $verifiedAtText,
        [ref]$verifiedAt
      )) {
      throw "invalid"
    }
    $checks = Get-OptionalProperty $Evidence "checks" $null
    if ($null -eq $checks -or $checks -is [string] -or $checks -is [Array] -or
      $checks.GetType().IsValueType) {
      throw "invalid"
    }
    $actualChecks = @($checks.PSObject.Properties.Name | ForEach-Object { [string]$_ })
    if (@(Compare-Object `
        $actualChecks $script:RequiredPostMigrationChecks -CaseSensitive).Count -ne 0) {
      throw "invalid"
    }
    foreach ($check in $script:RequiredPostMigrationChecks) {
      if ((Get-OptionalProperty $checks $check $null) -isnot [bool] -or
        (Get-OptionalProperty $checks $check $false) -ne $true) {
        throw "invalid"
      }
    }
  } catch {
    throw "Write-fence journal inventory contains invalid allowlisted post-migration evidence."
  }
}

function New-FenceTemporaryPath {
  param([Parameter(Mandatory = $true)] [string]$Path)

  return "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
}

function Get-FenceJournalInteropType {
  $type = "WeddingHanbangFenceJournalInterop" -as [type]
  if ($null -ne $type) {
    return $type
  }

  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class WeddingHanbangFenceJournalInterop
{
    private const uint MOVEFILE_REPLACE_EXISTING = 0x1;
    private const uint MOVEFILE_WRITE_THROUGH = 0x8;
    private const int O_RDONLY = 0;
    private const int O_DIRECTORY_LINUX = 0x10000;
    private const int O_DIRECTORY_DARWIN = 0x100000;
    private const uint GENERIC_WRITE = 0x40000000;
    private const uint FILE_SHARE_ALL = 0x7;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_FLAG_WRITE_THROUGH = 0x80000000;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool MoveFileEx(string source, string destination, uint flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string path,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FlushFileBuffers(SafeFileHandle handle);

    [DllImport("libc", SetLastError = true)]
    private static extern int open(string path, int flags);

    [DllImport("libc", SetLastError = true)]
    private static extern int fsync(int fd);

    [DllImport("libc", SetLastError = true)]
    private static extern int close(int fd);

    public static void MoveFileWriteThrough(string source, string destination, bool replace)
    {
        uint flags = MOVEFILE_WRITE_THROUGH;
        if (replace) flags |= MOVEFILE_REPLACE_EXISTING;
        if (!MoveFileEx(source, destination, flags))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    public static void MoveDirectoryWriteThrough(string source, string destination)
    {
        if (!MoveFileEx(source, destination, MOVEFILE_WRITE_THROUGH))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    public static void FlushDirectoryWriteThrough(string path)
    {
        uint flags = FILE_FLAG_BACKUP_SEMANTICS |
            FILE_FLAG_OPEN_REPARSE_POINT |
            FILE_FLAG_WRITE_THROUGH;
        using (SafeFileHandle handle = CreateFile(
            path,
            GENERIC_WRITE,
            FILE_SHARE_ALL,
            IntPtr.Zero,
            OPEN_EXISTING,
            flags,
            IntPtr.Zero
        ))
        {
            if (handle.IsInvalid)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!FlushFileBuffers(handle))
                throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }

    public static void FlushDirectory(string path)
    {
        int directoryFlag;
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            directoryFlag = O_DIRECTORY_LINUX;
        else if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
            directoryFlag = O_DIRECTORY_DARWIN;
        else
            throw new PlatformNotSupportedException("Directory fsync is unsupported on this platform.");

        int fd = open(path, O_RDONLY | directoryFlag);
        if (fd < 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            if (fsync(fd) != 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            close(fd);
        }
    }
}
'@
  return "WeddingHanbangFenceJournalInterop" -as [type]
}

function Publish-FenceSnapshotFile {
  param(
    [Parameter(Mandatory = $true)] [string]$Temporary,
    [Parameter(Mandatory = $true)] [string]$Path,
    [switch]$CreateNew
  )

  Assert-FenceJournalPathSafe $Temporary
  Assert-FenceJournalPathSafe $Path
  $interop = Get-FenceJournalInteropType
  try {
    if ($script:RunningOnWindows) {
      $arguments = [object[]]::new(3)
      $arguments[0] = [string]$Temporary
      $arguments[1] = [string]$Path
      $arguments[2] = [bool](-not $CreateNew.IsPresent)
      $interop.GetMethod("MoveFileWriteThrough").Invoke(
        $null,
        $arguments
      ) | Out-Null
      return
    }

    if ($CreateNew) {
      [IO.File]::Move($Temporary, $Path)
    } else {
      if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Write-fence journal disappeared before atomic replacement."
      }
      $backup = "$Path.$([Guid]::NewGuid().ToString('N')).bak"
      [IO.File]::Replace($Temporary, $Path, $backup, $true)
      Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    }
    $directory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path))
    $arguments = [object[]]::new(1)
    $arguments[0] = [string]$directory
    $interop.GetMethod("FlushDirectory").Invoke($null, $arguments) | Out-Null
  } catch {
    throw "Write-fence journal atomic publish or metadata flush failed."
  }
}

function Write-FenceSnapshot {
  param(
    [Parameter(Mandatory = $true)] [string]$Path,
    [Parameter(Mandatory = $true)] $Snapshot,
    [switch]$CreateNew
  )

  if ([int](Get-OptionalProperty $Snapshot "schemaVersion" -1) -ne
      $script:SnapshotSchemaVersion -or
    [string](Get-OptionalProperty $Snapshot "contract" "") -ne $script:Contract -or
    [string](Get-OptionalProperty $Snapshot "projectRef" "") -ne $ExpectedProjectRef) {
    throw "Write-fence journal identity is invalid before durable persistence."
  }
  Assert-FenceSnapshotSafety $Snapshot
  $expectedProduction = $ExpectedProjectRef -in @(
    $targets.productionSupabaseProjectRefs | ForEach-Object { [string]$_ }
  )
  if ($Snapshot.production -ne $expectedProduction -or
    $Snapshot.production -ne $isProductionTarget) {
    throw "Write-fence journal production identity is invalid before durable persistence."
  }

  Assert-FenceSnapshotPathCanonical $Path
  $journalRoot = Ensure-FenceJournalHierarchyDurable
  $directory = Split-Path -Parent $Path
  if (-not [IO.Directory]::Exists($directory)) {
    throw "Write-fence snapshot parent must be initialized inside the durable journal hierarchy."
  }
  if (-not (Test-PathInsideJournalRoot `
      ([IO.Path]::GetFullPath($directory + [IO.Path]::DirectorySeparatorChar + "entry")) `
      $journalRoot)) {
    throw "Write-fence snapshot parent escaped the durable journal hierarchy."
  }
  Assert-FenceJournalPathSafe $Path
  $temporary = New-FenceTemporaryPath $Path
  if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($temporary)) -ne
    [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path))) {
    throw "Write-fence temporary files must stay beside the journal."
  }
  Assert-FenceJournalPathSafe $temporary
  $json = $Snapshot | ConvertTo-Json -Depth 30
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
  $temporaryCreated = $false
  try {
    $stream = [IO.FileStream]::new(
      $temporary,
      [IO.FileMode]::CreateNew,
      [IO.FileAccess]::Write,
      [IO.FileShare]::None,
      4096,
      [IO.FileOptions]::WriteThrough
    )
    $temporaryCreated = $true
    try {
      $stream.Write($bytes, 0, $bytes.Length)
      # Flush file contents before the same-directory atomic publish. The
      # publish helper separately requests write-through metadata persistence
      # on Windows and fsyncs the containing directory on Linux/macOS.
      $stream.Flush($true)
    } finally {
      $stream.Dispose()
    }
    Set-FenceJournalPathPrivate -Path $temporary

    try {
      Publish-FenceSnapshotFile -Temporary $temporary -Path $Path -CreateNew:$CreateNew
      $temporaryCreated = $false
      Assert-FenceJournalPathPrivate -Path $Path
    } catch {
      # A same-directory rename/replace can become visible before the parent
      # directory fsync reports failure. Surface that state explicitly so a
      # caller that already restored live controls never re-fences them while
      # the durable journal may already say released.
      $publishedPayloadVisible = $false
      try {
        if ([IO.File]::Exists($Path)) {
          $visiblePayload = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
          $publishedPayloadVisible = $visiblePayload -ceq $json
        }
      } catch {
        $publishedPayloadVisible = $false
      }
      if ($publishedPayloadVisible) {
        $uncertain = [InvalidOperationException]::new(
          "Write-fence journal payload is visible but metadata durability was not confirmed.",
          $_.Exception
        )
        $uncertain.Data["WriteFencePublishedPayloadVisible"] = $true
        throw $uncertain
      }
      throw
    }
  } finally {
    if ($temporaryCreated -and (Test-Path -LiteralPath $temporary)) {
      Remove-Item -LiteralPath $temporary -Force
    }
  }
}

function Assert-NoSecretFields {
  param(
    $Object,
    [int]$Depth = 0
  )

  if ($null -eq $Object -or $Object -is [string] -or
    $Object.GetType().IsValueType) {
    return
  }
  if ($Depth -gt 30) {
    throw "Write-fence snapshot nesting exceeds the sanitized schema."
  }
  if ($Object -is [Collections.IEnumerable] -and
    $Object -isnot [Management.Automation.PSCustomObject]) {
    foreach ($item in $Object) {
      Assert-NoSecretFields $item ($Depth + 1)
    }
    return
  }

  foreach ($property in $Object.PSObject.Properties) {
    if ($property.Name -match '(?i)(token|password|secret|authorization|api.?key|service.?key)') {
      throw "Write-fence snapshot contains a forbidden secret-bearing field."
    }
    Assert-NoSecretFields $property.Value ($Depth + 1)
  }
}

function Get-FenceStepByName {
  param(
    [Parameter(Mandatory = $true)] $Snapshot,
    [Parameter(Mandatory = $true)] [string]$Name
  )

  $matches = @($Snapshot.steps | Where-Object { [string]$_.name -ceq $Name })
  if ($matches.Count -ne 1) {
    throw "Write-fence snapshot lifecycle requires one exact $Name step."
  }
  return $matches[0]
}

function Get-FenceStepTimestamp {
  param(
    [Parameter(Mandatory = $true)] $Step,
    [Parameter(Mandatory = $true)] [string]$Name
  )

  $timestamp = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse(
      [string]$Step.recordedAtUtc,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind,
      [ref]$timestamp
    ) -or $timestamp.Offset -ne [TimeSpan]::Zero) {
    throw "Write-fence snapshot $Name step requires an exact UTC timestamp."
  }
  return $timestamp
}

function Assert-PostMigrationEvidenceSummary {
  param(
    [Parameter(Mandatory = $true)] $Snapshot,
    [Parameter(Mandatory = $true)] $MigrationStep,
    [Parameter(Mandatory = $true)] $VerificationStep
  )

  $summary = $Snapshot.postMigrationEvidence
  if ($null -eq $summary -or $summary -is [string] -or
    $summary -is [Array] -or $summary.GetType().IsValueType) {
    throw "Write-fence snapshot post-migration evidence summary is invalid."
  }
  $expectedFields = @(
    "contract", "digestSha256", "verifiedAtUtc", "allRequiredChecksPassed"
  )
  $actualFields = @(
    $summary.PSObject.Properties.Name | ForEach-Object { [string]$_ }
  )
  if (@(Compare-Object `
      $actualFields $expectedFields -CaseSensitive).Count -ne 0 -or
    $summary.contract -isnot [string] -or
    $summary.contract -cne $script:PostMigrationEvidenceContract -or
    $summary.digestSha256 -isnot [string] -or
    $summary.digestSha256 -cnotmatch '^[0-9a-f]{64}$' -or
    $summary.verifiedAtUtc -isnot [string] -or
    $summary.allRequiredChecksPassed -isnot [bool] -or
    $summary.allRequiredChecksPassed -ne $true) {
    throw "Write-fence snapshot post-migration evidence summary is invalid."
  }

  $verifiedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse(
      [string]$summary.verifiedAtUtc,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind,
      [ref]$verifiedAt
    ) -or $verifiedAt.Offset -ne [TimeSpan]::Zero) {
    throw "Write-fence snapshot post-migration evidence timestamp is invalid."
  }
  $migrationStartedAt = Get-FenceStepTimestamp $MigrationStep "migration"
  $verificationRecordedAt = Get-FenceStepTimestamp `
    $VerificationStep "migration verification"
  if ($verifiedAt -lt $migrationStartedAt -or
    $verificationRecordedAt -lt $migrationStartedAt -or
    $verifiedAt -gt $verificationRecordedAt.AddMinutes(5)) {
    throw "Write-fence snapshot post-migration evidence chronology is invalid."
  }
}

function Assert-FenceLifecycleGraph {
  param([Parameter(Mandatory = $true)] $Snapshot)

  $state = [string]$Snapshot.state
  $migrationSteps = @(
    $Snapshot.steps | Where-Object { [string]$_.name -ceq "migration" }
  )
  $verificationSteps = @(
    $Snapshot.steps | Where-Object {
      [string]$_.name -ceq "migration_verification"
    }
  )
  $activeControlSteps = @(
    "network", "realtime", "auth", "roles", "cron", "verify"
  )

  if ($Snapshot.migrationStarted -eq $false) {
    if ($Snapshot.migrationVerified -ne $false -or
      $null -ne $Snapshot.postMigrationEvidence -or
      $migrationSteps.Count -ne 0 -or $verificationSteps.Count -ne 0 -or
      $state -in @("migration_in_progress", "migration_verified")) {
      throw "Write-fence snapshot migration lifecycle graph is invalid."
    }
  } elseif ($Snapshot.migrationVerified -eq $false) {
    if ($state -notin @("migration_in_progress", "manual_recovery_required") -or
      $null -ne $Snapshot.postMigrationEvidence -or
      $migrationSteps.Count -ne 1 -or
      [string]$migrationSteps[0].status -cne "started" -or
      $verificationSteps.Count -ne 0) {
      throw "Write-fence snapshot migration lifecycle graph is invalid."
    }
    Get-FenceStepTimestamp $migrationSteps[0] "migration" | Out-Null
  } else {
    if ($state -notin @(
        "migration_verified", "restoring", "released", "manual_recovery_required"
      ) -or
      $migrationSteps.Count -ne 1 -or
      [string]$migrationSteps[0].status -cne "started" -or
      $verificationSteps.Count -ne 1 -or
      [string]$verificationSteps[0].status -cne "applied") {
      throw "Write-fence snapshot migration lifecycle graph is invalid."
    }
    Assert-PostMigrationEvidenceSummary `
      $Snapshot $migrationSteps[0] $verificationSteps[0]
  }

  $exactAppliedStepSets = @{
    captured = @()
    active = $activeControlSteps
    migration_in_progress = @($activeControlSteps + "migration")
    migration_verified = @(
      $activeControlSteps + "migration" + "migration_verification"
    )
  }
  if ($exactAppliedStepSets.ContainsKey($state)) {
    $expectedNames = @($exactAppliedStepSets[$state])
    $actualNames = @($Snapshot.steps | ForEach-Object { [string]$_.name })
    if (@(Compare-Object `
        $actualNames $expectedNames -CaseSensitive).Count -ne 0) {
      throw "Write-fence snapshot state has an invalid exact step graph."
    }
    foreach ($name in $activeControlSteps) {
      if ($name -in $expectedNames) {
        $step = Get-FenceStepByName $Snapshot $name
        if ([string]$step.status -cne "applied") {
          throw "Write-fence snapshot active control step is not applied."
        }
      }
    }
  }
}

function Assert-FenceSnapshotSafety {
  param([Parameter(Mandatory = $true)] $Snapshot)

  Assert-NoSecretFields $Snapshot
  $allowedTopLevel = @(
    "schemaVersion", "contract", "fenceId", "projectRef", "state", "production",
    "capturedAtUtc", "reviewedHead", "reviewedTree", "roleFenceAppliedAtUtc",
    "backendFence", "releaseCidrs", "previous", "steps",
    "migrationStarted", "migrationVerified", "postMigrationEvidence"
  )
  $unexpected = @($Snapshot.PSObject.Properties.Name | Where-Object {
    $_ -notin $allowedTopLevel
  })
  if ($unexpected.Count -ne 0) {
    throw "Write-fence snapshot contains fields outside the sanitized schema."
  }

  $fenceGuid = [Guid]::Empty
  if (-not [Guid]::TryParse([string]$Snapshot.fenceId, [ref]$fenceGuid) -or
    [string]$Snapshot.reviewedHead -notmatch '^[0-9a-f]{40}$' -or
    [string]$Snapshot.reviewedTree -notmatch '^[0-9a-f]{40}$' -or
    $Snapshot.production -isnot [bool] -or
    $Snapshot.migrationStarted -isnot [bool] -or
    $Snapshot.migrationVerified -isnot [bool]) {
    throw "Write-fence snapshot has invalid immutable identity or lifecycle fields."
  }

  $allowedStates = @(
    "captured", "activating", "active", "activation_failed", "restoring", "released",
    "migration_in_progress", "migration_verified", "manual_recovery_required"
  )
  if ([string]$Snapshot.state -notin $allowedStates) {
    throw "Write-fence snapshot has an unknown lifecycle state."
  }
  if ($Snapshot.migrationVerified -eq $true -and
    $Snapshot.migrationStarted -ne $true) {
    throw "Write-fence snapshot has an impossible migration lifecycle."
  }

  $capturedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse(
      [string]$Snapshot.capturedAtUtc,
      [ref]$capturedAt
    )) {
    throw "Write-fence snapshot has an invalid capture timestamp."
  }

  if ($null -eq $Snapshot.releaseCidrs -or
    $Snapshot.releaseCidrs.ipv4 -isnot [Array] -or
    $Snapshot.releaseCidrs.ipv6 -isnot [Array]) {
    throw "Write-fence snapshot release CIDRs must retain their array types."
  }
  $v4 = $Snapshot.releaseCidrs.ipv4
  $v6 = $Snapshot.releaseCidrs.ipv6
  if ($v4.Count -ne 1 -or $v6.Count -gt 1) {
    throw "Write-fence snapshot must retain one release IPv4 host and at most one IPv6 host."
  }
  Assert-ReleaseCidr ([string]$v4[0]) "IPv4"
  if ($v6.Count -eq 1) {
    Assert-ReleaseCidr ([string]$v6[0]) "IPv6"
  }

  $allowedStepNames = @(
    "network", "realtime", "auth", "roles", "cron", "verify", "activation",
    "restore", "migration", "migration_verification"
  )
  $allowedStepStatuses = @("pending", "applied", "failed", "started")
  $stepNames = @()
  foreach ($step in @($Snapshot.steps)) {
    $stepFields = @(
      $step.PSObject.Properties.Name | ForEach-Object { [string]$_ }
    )
    if (@(Compare-Object `
        $stepFields @("name", "status", "recordedAtUtc") -CaseSensitive).Count -ne 0 -or
      [string]$step.name -notin $allowedStepNames -or
      [string]$step.status -notin $allowedStepStatuses -or
      [string]$step.recordedAtUtc -notmatch '^\d{4}-\d{2}-\d{2}T') {
      throw "Write-fence snapshot contains an invalid journal step."
    }
    $stepNames += [string]$step.name
  }
  if (@($stepNames | Group-Object | Where-Object { $_.Count -ne 1 }).Count -ne 0) {
    throw "Write-fence snapshot contains duplicate journal steps."
  }
  Assert-FenceLifecycleGraph $Snapshot
  $rolesApplied = @($Snapshot.steps | Where-Object {
    $_.name -eq "roles" -and $_.status -eq "applied"
  }).Count -eq 1
  if ($rolesApplied) {
    $roleFenceAppliedAt = [DateTimeOffset]::MinValue
    $targetedClientBackends = if ($null -eq $Snapshot.backendFence) {
      -1L
    } else {
      [long]$Snapshot.backendFence.targetedClientBackends
    }
    $unmanagedPreFenceWriters = if ($null -eq $Snapshot.backendFence) {
      -1L
    } else {
      [long]$Snapshot.backendFence.unmanagedPreFenceWriterBackends
    }
    if ($null -eq $Snapshot.backendFence -or
      -not [DateTimeOffset]::TryParse(
        [string]$Snapshot.backendFence.appliedAtUtc,
        [ref]$roleFenceAppliedAt
      ) -or
      [string]$Snapshot.roleFenceAppliedAtUtc -ne
        [string]$Snapshot.backendFence.appliedAtUtc -or
      $targetedClientBackends -lt 0 -or
      [long]$Snapshot.backendFence.unclassifiedPreFenceClientBackends -ne 0 -or
      $unmanagedPreFenceWriters -lt 0 -or
      $unmanagedPreFenceWriters -gt $targetedClientBackends -or
      [long]$Snapshot.backendFence.terminationFailures -ne 0) {
      throw "Write-fence snapshot has an invalid protected-session cutoff."
    }
  }

  if ($null -eq $Snapshot.previous -or
    $null -eq $Snapshot.previous.management -or
    $null -eq $Snapshot.previous.database) {
    throw "Write-fence snapshot is missing its exact-restore baseline."
  }
  Assert-ManagementRestoreBaselineSchema $Snapshot.previous.management
  Assert-DatabaseBackendBaselineClassifiable $Snapshot.previous.database
  $databaseObservedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse(
      [string]$Snapshot.previous.database.backendBoundary.observedAtUtc,
      [ref]$databaseObservedAt
    ) -or $databaseObservedAt -gt $capturedAt -or
    ($capturedAt - $databaseObservedAt) -gt $script:SnapshotMaximumAge) {
    throw "Write-fence snapshot has an impossible database capture boundary."
  }
  $baselineStatus = ([string]$Snapshot.previous.management.network.status).Trim().ToLowerInvariant()
  $baselineEntitlement = ([string]$Snapshot.previous.management.network.entitlement).Trim().ToLowerInvariant()
  if ($baselineStatus -ne "applied" -or $baselineEntitlement -ne "allowed") {
    throw "Write-fence snapshot lacks an applied, entitled network restore baseline."
  }
}

function Assert-SnapshotFreshForActivation {
  param([Parameter(Mandatory = $true)] $Snapshot)

  # Freshness gates only the captured -> activating transition. Active or
  # failed journals must remain recoverable after an arbitrarily long outage.
  $capturedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse(
      [string]$Snapshot.capturedAtUtc,
      [ref]$capturedAt
    )) {
    throw "Write-fence snapshot has an invalid capture timestamp."
  }
  $now = [DateTimeOffset]::UtcNow
  if ($capturedAt -gt $now -or ($now - $capturedAt) -gt $script:SnapshotMaximumAge) {
    throw "Write-fence activation requires a baseline captured inside the five-minute window."
  }
}

function Read-FenceSnapshot {
  param([Parameter(Mandatory = $true)] [string]$Path)

  Assert-FenceSnapshotPathCanonical $Path
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Write-fence snapshot does not exist."
  }
  $payload = Read-FenceJournalPayloadBounded $Path
  try {
    $snapshot = $payload.json | ConvertFrom-Json
  } catch {
    throw "Write-fence snapshot contains malformed JSON."
  }
  if ($snapshot.contract -ne $script:Contract -or
    $snapshot.projectRef -ne $ExpectedProjectRef -or
    $snapshot.schemaVersion -ne $script:SnapshotSchemaVersion) {
    throw "Write-fence snapshot identity does not match this action."
  }
  Assert-FenceSnapshotSafety $snapshot
  $expectedProduction = $snapshot.projectRef -in @(
    $targets.productionSupabaseProjectRefs | ForEach-Object { [string]$_ }
  )
  if ($snapshot.production -ne $expectedProduction -or
    $snapshot.production -ne $isProductionTarget) {
    throw "Write-fence snapshot production identity does not match the protected-ref policy."
  }
  return $snapshot
}

function Get-FenceJournalInventory {
  $root = Ensure-FenceJournalHierarchyDurable
  $nestedDirectories = @(Get-ChildItem -LiteralPath $root -Directory -Force)
  if ($nestedDirectories.Count -ne 0) {
    throw "Write-fence journal inventory contains an unsupported nested directory."
  }

  $files = @(Get-ChildItem -LiteralPath $root -File -Force)
  if ($files.Count -gt $script:MaximumJournalArtifactCount) {
    throw "Write-fence journal inventory exceeds its bounded artifact count."
  }

  $entries = [Collections.Generic.List[object]]::new()
  foreach ($file in $files) {
    Assert-FenceJournalPathSafe $file.FullName
    if ($file.Name -ceq ".lifecycle.lock") {
      if (($file.Attributes -band [IO.FileAttributes]::Directory) -ne 0 -or
        ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Write-fence journal lifecycle lock is not an ordinary local file."
      }
      Set-FenceJournalPathPrivate -Path $file.FullName
      continue
    }
    if (($file.Attributes -band [IO.FileAttributes]::Directory) -ne 0 -or
      ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Write-fence journal inventory requires ordinary non-redirecting files."
    }
    Set-FenceJournalPathPrivate -Path $file.FullName
    if ([IO.Path]::GetExtension($file.Name) -cne ".json") {
      throw "Write-fence journal inventory contains an unsupported ordinary artifact."
    }
    if ($file.Length -le 0 -or
      $file.Length -gt $script:MaximumJournalArtifactBytes) {
      throw "Write-fence journal inventory artifact exceeds its bounded size."
    }
    $json = Read-FenceJournalJsonBounded $file.FullName
    try {
      $document = $json | ConvertFrom-Json
    } catch {
      throw "Write-fence journal inventory contains malformed JSON."
    }
    $contractProperty = if ($null -eq $document) {
      $null
    } else {
      $document.PSObject.Properties["contract"]
    }
    if ($null -eq $contractProperty) {
      throw "Write-fence journal inventory contains an unrecognized JSON artifact."
    }
    $artifactContract = [string]$contractProperty.Value
    if ($artifactContract -eq $script:PostMigrationEvidenceContract) {
      # Only this exact, strictly validated evidence contract may coexist with
      # a fence journal without participating in the unresolved generation.
      Assert-PostMigrationEvidenceInventorySchema $document
      continue
    }
    if ($artifactContract -ne $script:Contract) {
      throw "Write-fence journal inventory contains an unrecognized contract artifact."
    }

    Assert-FenceSnapshotPathCanonical $file.FullName
    if ([int](Get-OptionalProperty $document "schemaVersion" -1) -ne
        $script:SnapshotSchemaVersion -or
      [string](Get-OptionalProperty $document "projectRef" "") -ne
        $ExpectedProjectRef) {
      throw "Write-fence journal inventory contains a mismatched snapshot identity."
    }
    Assert-FenceSnapshotSafety $document
    $expectedProduction = $ExpectedProjectRef -in @(
      $targets.productionSupabaseProjectRefs | ForEach-Object { [string]$_ }
    )
    if ($document.production -ne $expectedProduction -or
      $document.production -ne $isProductionTarget) {
      throw "Write-fence journal inventory contains a mismatched production identity."
    }
    $entries.Add([pscustomobject]@{
      path = [IO.Path]::GetFullPath($file.FullName)
      snapshot = $document
    })
  }
  Write-Output -NoEnumerate $entries.ToArray()
}

function Read-FenceJournalJsonBounded {
  param([Parameter(Mandatory = $true)] [string]$Path)

  return (Read-FenceJournalPayloadBounded $Path).json
}

function Assert-NoUnresolvedFenceJournalForCapture {
  $unresolved = @(
    (Get-FenceJournalInventory) | Where-Object {
      [string]$_.snapshot.state -ne "released"
    }
  )
  if ($unresolved.Count -ne 0) {
    throw "Capture refuses to create a split-brain generation while an unresolved write-fence journal exists."
  }
}

function Assert-SnapshotIsSoleUnresolvedJournal {
  param(
    [Parameter(Mandatory = $true)] [string]$Path,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $unresolved = @(
    (Get-FenceJournalInventory) | Where-Object {
      [string]$_.snapshot.state -ne "released"
    }
  )
  if ($unresolved.Count -ne 1) {
    throw "The write-fence journal does not have a sole unresolved generation."
  }
  $comparison = if ($script:RunningOnWindows) {
    [StringComparison]::OrdinalIgnoreCase
  } else {
    [StringComparison]::Ordinal
  }
  $entry = $unresolved[0]
  if (-not $entry.path.Equals([IO.Path]::GetFullPath($Path), $comparison) -or
    [string]$entry.snapshot.fenceId -ne [string]$Snapshot.fenceId -or
    [string]$entry.snapshot.state -ne [string]$Snapshot.state -or
    [string]$entry.snapshot.reviewedHead -ne [string]$Snapshot.reviewedHead -or
    [string]$entry.snapshot.reviewedTree -ne [string]$Snapshot.reviewedTree) {
    throw "The requested write-fence snapshot does not match the durable unresolved generation."
  }
}

function Assert-SnapshotHead {
  param([Parameter(Mandatory = $true)] $Snapshot)

  $identity = Get-CleanReviewedGitIdentity
  if ($identity.head -ne [string]$Snapshot.reviewedHead -or
    $identity.tree -ne [string]$Snapshot.reviewedTree) {
    throw "Current Git HEAD or tree no longer matches the captured write-fence review identity."
  }
}

function Set-FenceStep {
  param(
    [Parameter(Mandatory = $true)] $Snapshot,
    [Parameter(Mandatory = $true)] [string]$Name,
    [Parameter(Mandatory = $true)] [string]$Status
  )

  $steps = @($Snapshot.steps | Where-Object { $_.name -ne $Name })
  $steps += [pscustomobject]@{
    name = $Name
    status = $Status
    recordedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
  }
  $Snapshot.steps = $steps
}

function Test-FenceStepApplied {
  param(
    [Parameter(Mandatory = $true)] $Snapshot,
    [Parameter(Mandatory = $true)] [string]$Name
  )

  return @($Snapshot.steps | Where-Object {
    $_.name -eq $Name -and $_.status -eq "applied"
  }).Count -eq 1
}

function Test-FenceStepTouched {
  param(
    [Parameter(Mandatory = $true)] $Snapshot,
    [Parameter(Mandatory = $true)] [string]$Name
  )

  return @($Snapshot.steps | Where-Object {
    $_.name -eq $Name -and $_.status -in @("pending", "applied")
  }).Count -eq 1
}

function Assert-FenceRemoteBudgetContract {
  $pollsPerMinute = [int][Math]::Ceiling(
    60000.0 / $script:PollIntervalMilliseconds
  )
  $worstPollingRequests = $pollsPerMinute * 2
  if ($script:ProviderRemoteRequestLimitPerMinute -ne 120 -or
    $script:NormalRemoteRequestLimit -ne
      ($script:ProviderRemoteRequestLimitPerMinute - $script:RecoveryRequestReserve) -or
    $script:PollIntervalMilliseconds -lt 3000 -or
    ($worstPollingRequests + $script:NonPollingRequestAllowance) -gt
      $script:NormalRemoteRequestLimit) {
    throw "Write-fence remote request budget contract is unsafe."
  }
}

function Enter-FenceRemoteRequestBudget {
  $now = [DateTimeOffset]::UtcNow
  while ($script:RemoteRequestTimestamps.Count -gt 0 -and
    ($now - $script:RemoteRequestTimestamps.Peek()).TotalSeconds -ge 60) {
    $script:RemoteRequestTimestamps.Dequeue() | Out-Null
  }
  $limit = if ($script:UsingRecoveryRequestReserve) {
    $script:ProviderRemoteRequestLimitPerMinute
  } else {
    $script:NormalRemoteRequestLimit
  }
  if ($script:RemoteRequestTimestamps.Count -ge $limit) {
    throw "Write-fence remote request budget is exhausted; recovery capacity remains reserved."
  }
  $script:RemoteRequestTimestamps.Enqueue($now)
}

function Invoke-FenceManagementRequest {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Get", "Post", "Patch")]
    [string]$Method,
    [Parameter(Mandatory = $true)] [string]$Path,
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    $Body = $null
  )

  $expectedPrefix = "/v1/projects/$ExpectedProjectRef/"
  if (-not $Path.StartsWith($expectedPrefix, [StringComparison]::Ordinal)) {
    throw "Management API path is outside the expected project boundary."
  }

  $request = @{
    Method = $Method
    Uri = "$($script:ManagementApiBase)$Path"
    Headers = @{ Authorization = "Bearer $AccessToken" }
    TimeoutSec = 15
    ErrorAction = "Stop"
  }
  if ($null -ne $Body) {
    $request.ContentType = "application/json"
    $request.Body = $Body | ConvertTo-Json -Depth 10 -Compress
  }

  Enter-FenceRemoteRequestBudget
  try {
    return Invoke-RestMethod @request
  } catch {
    throw "Supabase Management API $Method operation failed at a sanitized project-scoped path."
  }
}

# Legacy boundary removed: supabase db query is never invoked. Database calls
# below use the explicit project-ref Management API endpoint exclusively.
function ConvertFrom-SupabaseQueryRows {
  param([Parameter(Mandatory = $true)] [string]$Json)

  try {
    $document = $Json | ConvertFrom-Json
  } catch {
    throw "Write-fence database API returned an unexpected result shape."
  }
  if ($document -is [Array]) {
    foreach ($row in $document) {
      if ($null -eq $row -or $row -is [string] -or $row -is [Array] -or
        $row.GetType().IsValueType) {
        throw "Write-fence database API returned an unexpected result shape."
      }
    }
    Write-Output -NoEnumerate $document
    return
  }
  $hasLegacyRowsWrapper = $false
  try {
    $hasLegacyRowsWrapper = $null -ne $document -and
      $document.PSObject.Properties.Name -contains "rows"
  } catch {
    $hasLegacyRowsWrapper = $false
  }
  if ($hasLegacyRowsWrapper) {
    # The old CLI wrapper is deliberately recognized only to reject it. The
    # project-pinned Management API contract accepts a top-level row array.
    throw "Write-fence database API returned an unexpected result shape."
  }
  throw "Write-fence database API returned an unexpected result shape."
}

function ConvertFrom-FenceDatabaseRowsJson {
  param([Parameter(Mandatory = $true)] [string]$Json)

  $rows = ConvertFrom-SupabaseQueryRows $Json
  Write-Output -NoEnumerate $rows
}

function Invoke-FenceDatabaseApiRequest {
  param(
    [Parameter(Mandatory = $true)] [string]$Path,
    [Parameter(Mandatory = $true)] $Body,
    [switch]$ExpectRows
  )

  $expectedPath = "/v1/projects/$ExpectedProjectRef/database/query"
  $accessToken = $script:ManagementAccessToken
  if ($Body -isnot [Collections.IDictionary]) {
    throw "Write-fence database API request contract is invalid."
  }
  $bodyKeys = @($Body.Keys | ForEach-Object { [string]$_ })
  $query = $Body["query"]
  $readOnly = $Body["read_only"]
  if ($Path -ne $expectedPath -or [string]::IsNullOrWhiteSpace($accessToken) -or
    $bodyKeys.Count -ne 2 -or "query" -notin $bodyKeys -or
    "read_only" -notin $bodyKeys -or $query -isnot [string] -or
    [string]::IsNullOrWhiteSpace($query) -or $readOnly -isnot [bool]) {
    throw "Write-fence database API request contract is invalid."
  }
  $request = @{
    Method = "Post"
    Uri = "$($script:ManagementApiBase)$expectedPath"
    Headers = @{ Authorization = "Bearer $accessToken" }
    ContentType = "application/json"
    Body = $Body | ConvertTo-Json -Depth 5 -Compress
    TimeoutSec = 30
    ErrorAction = "Stop"
    UseBasicParsing = $true
  }
  Enter-FenceRemoteRequestBudget
  try {
    $response = Invoke-WebRequest @request
  } catch {
    throw "Supabase project-scoped database API operation failed."
  }
  if ([int]$response.StatusCode -ne 201) {
    throw "Supabase project-scoped database API returned an unexpected status."
  }
  if (-not $ExpectRows) {
    # DDL/DML may return an empty body, a command tag, or a provider-defined
    # success body. Never parse, reflect, or persist that raw response.
    return $null
  }
  return ConvertFrom-FenceDatabaseRowsJson ([string]$response.Content)
}

function Invoke-FenceDatabaseQuery {
  param(
    [Parameter(Mandatory = $true)] [string]$Sql,
    [switch]$ReadOnly,
    [switch]$ExpectSingleJsonRow
  )

  # The outer lifecycle keeps the linked ref as an operator sanity check only.
  # Database target identity is bound here by the explicit ExpectedProjectRef.
  if ([string]::IsNullOrWhiteSpace($Sql)) {
    throw "Database operation received empty SQL."
  }
  $path = "/v1/projects/$ExpectedProjectRef/database/query"
  $body = [ordered]@{
    query = $Sql
    read_only = [bool]$ReadOnly
  }
  try {
    $rows = Invoke-FenceDatabaseApiRequest -Path $path -Body $body `
      -ExpectRows:$ExpectSingleJsonRow
  } catch {
    throw "A sanitized project-scoped write-fence database operation failed."
  }
  if (-not $ExpectSingleJsonRow) {
    return $null
  }
  if ($rows -isnot [Array] -or $rows.Count -ne 1) {
    throw "Write-fence database API returned an unexpected result shape."
  }
  return $rows[0]
}

function Read-FenceDatabaseStatus {
  $row = Invoke-FenceDatabaseQuery -Sql $script:StatusSql -ReadOnly -ExpectSingleJsonRow
  $statusProperty = if ($null -eq $row) {
    $null
  } else {
    $row.PSObject.Properties["write_fence_status"]
  }
  if ($null -eq $statusProperty -or $null -eq $statusProperty.Value) {
    throw "Write-fence database status returned an unexpected result shape."
  }
  $status = $statusProperty.Value
  Assert-DatabaseReleaseConnectionSchema $status
  return $status
}

function Select-SanitizedRealtimeConfig {
  param([Parameter(Mandatory = $true)] $Config)

  $suspend = Get-RequiredManagementBoolean $Config "suspend"
  return [pscustomobject]@{
    suspend = $suspend
  }
}

function Select-SanitizedAuthConfig {
  param([Parameter(Mandatory = $true)] $Config)

  return [pscustomobject]@{
    disableSignup = Get-RequiredManagementBoolean $Config "disable_signup"
  }
}

function Select-SanitizedNetworkConfig {
  param([Parameter(Mandatory = $true)] $Response)

  # Rejected legacy coercion/default retained as an audit marker:
  # entitlement = [string](Get-OptionalProperty $Response "entitlement" "")
  $config = Get-RequiredManagementProperty $Response "config"
  if ($null -eq $config -or $config -is [string] -or
    $config -is [Array] -or $config.GetType().IsValueType) {
    throw "Management restore schema requires a network config object."
  }
  $ipv4 = Get-RequiredManagementArray $config "dbAllowedCidrs"
  $ipv6 = Get-RequiredManagementArray $config "dbAllowedCidrsV6"
  Assert-ProviderNetworkCidrArray -Cidrs $ipv4 -Family "IPv4"
  Assert-ProviderNetworkCidrArray -Cidrs $ipv6 -Family "IPv6"
  $status = Get-RequiredManagementString $Response "status"
  $entitlement = Get-RequiredManagementString $Response "entitlement"
  return [pscustomobject]@{
    ipv4 = @($ipv4 | Sort-Object -Unique)
    ipv6 = @($ipv6 | Sort-Object -Unique)
    status = $status
    entitlement = $entitlement
  }
}

function Get-LiveNetworkState {
  param([Parameter(Mandatory = $true)] [string]$AccessToken)

  $network = Invoke-FenceManagementRequest -Method Get `
    -Path "/v1/projects/$ExpectedProjectRef/network-restrictions" `
    -AccessToken $AccessToken
  return Select-SanitizedNetworkConfig $network
}

function Get-LiveRealtimeState {
  param([Parameter(Mandatory = $true)] [string]$AccessToken)

  $realtime = Invoke-FenceManagementRequest -Method Get `
    -Path "/v1/projects/$ExpectedProjectRef/config/realtime" `
    -AccessToken $AccessToken
  return Select-SanitizedRealtimeConfig $realtime
}

function Get-LiveAuthState {
  param([Parameter(Mandatory = $true)] [string]$AccessToken)

  $auth = Invoke-FenceManagementRequest -Method Get `
    -Path "/v1/projects/$ExpectedProjectRef/config/auth" `
    -AccessToken $AccessToken
  return Select-SanitizedAuthConfig $auth
}

function Get-LiveManagementState {
  param([Parameter(Mandatory = $true)] [string]$AccessToken)

  return [pscustomobject]@{
    network = Get-LiveNetworkState $AccessToken
    realtime = Get-LiveRealtimeState $AccessToken
    auth = Get-LiveAuthState $AccessToken
  }
}

function Get-ManagementBaselineProjection {
  param([Parameter(Mandatory = $true)] $State)

  Assert-ManagementRestoreBaselineSchema $State
  return [pscustomobject][ordered]@{
    network = [pscustomobject][ordered]@{
      ipv4 = @($State.network.ipv4 | Sort-Object -Unique)
      ipv6 = @($State.network.ipv6 | Sort-Object -Unique)
      status = $State.network.status
      entitlement = $State.network.entitlement
    }
    realtime = [pscustomobject][ordered]@{
      suspend = $State.realtime.suspend
    }
    auth = [pscustomobject][ordered]@{
      disableSignup = $State.auth.disableSignup
    }
  }
}

function Assert-DatabaseReleaseConnectionSchema {
  param([Parameter(Mandatory = $true)] $Database)

  try {
    $connection = Get-OptionalProperty $Database "releaseConnection" $null
    if ($null -eq $connection -or $connection -is [string] -or
      $connection -is [Array] -or $connection.GetType().IsValueType) {
      throw "invalid"
    }
    $actual = @($connection.PSObject.Properties.Name | ForEach-Object { [string]$_ })
    if (@(Compare-Object `
        $actual @("roleClass", "transactionReadOnly") -CaseSensitive).Count -ne 0) {
      throw "invalid"
    }
    $roleClass = Get-OptionalProperty $connection "roleClass" $null
    $transactionReadOnly = Get-OptionalProperty `
      $connection "transactionReadOnly" $null
    if ($roleClass -isnot [string] -or
      $roleClass -cne $script:ExpectedReleaseDatabaseRoleClass -or
      $transactionReadOnly -isnot [bool] -or $transactionReadOnly -ne $true) {
      throw "invalid"
    }
  } catch {
    throw "Database release connection role classification is invalid or not the fixed expected role."
  }
}

function Get-DatabaseCaptureBaselineProjection {
  param([Parameter(Mandatory = $true)] $State)

  Assert-DatabaseReleaseConnectionSchema $State
  $roles = [ordered]@{}
  foreach ($role in $script:ProtectedRoles) {
    $roleState = Get-OptionalProperty $State.roles $role $null
    $roles[$role] = if ($null -eq $roleState) {
      $null
    } else {
      [pscustomobject][ordered]@{
        exists = [bool](Get-OptionalProperty $roleState "exists" $false)
        configuredValue = Get-OptionalProperty $roleState "configuredValue"
      }
    }
  }

  return [pscustomobject][ordered]@{
    contract = [string]$State.contract
    database = [string]$State.database
    roles = [pscustomobject]$roles
    cron = [pscustomobject][ordered]@{
      launchActiveJobs = Get-OptionalProperty $State.cron "launchActiveJobs"
      autoOverridePresent = [bool](Get-OptionalProperty $State.cron "autoOverridePresent" $false)
      autoOverrideValue = Get-OptionalProperty $State.cron "autoOverrideValue"
    }
    drain = [pscustomobject][ordered]@{
      activeTransactions = [long](Get-OptionalProperty $State.drain "activeTransactions" -1)
      runningCronJobs = [long](Get-OptionalProperty $State.drain "runningCronJobs" -1)
      protectedRoleSessions = [long](Get-OptionalProperty $State.drain "protectedRoleSessions" -1)
      oldestProtectedRoleSessionAtUtc = Get-OptionalProperty $State.drain "oldestProtectedRoleSessionAtUtc"
      clientBackendSessions = [long](Get-OptionalProperty $State.drain "clientBackendSessions" -1)
      unclassifiedClientBackends = [long](Get-OptionalProperty $State.drain "unclassifiedClientBackends" -1)
      unclassifiedWriterSessions = [long](Get-OptionalProperty $State.drain "unclassifiedWriterSessions" -1)
      oldestClientBackendStartAtUtc = Get-OptionalProperty $State.drain "oldestClientBackendStartAtUtc"
      newestClientBackendStartAtUtc = Get-OptionalProperty $State.drain "newestClientBackendStartAtUtc"
    }
    backendBoundary = [pscustomobject][ordered]@{
      postmasterStartedAtUtc = Get-OptionalProperty $State.backendBoundary "postmasterStartedAtUtc"
      clientBackendSessions = [long](Get-OptionalProperty $State.backendBoundary "clientBackendSessions" -1)
      unclassifiedClientBackends = [long](Get-OptionalProperty $State.backendBoundary "unclassifiedClientBackends" -1)
      unclassifiedWriterSessions = [long](Get-OptionalProperty $State.backendBoundary "unclassifiedWriterSessions" -1)
      oldestClientBackendStartAtUtc = Get-OptionalProperty $State.backendBoundary "oldestClientBackendStartAtUtc"
      newestClientBackendStartAtUtc = Get-OptionalProperty $State.backendBoundary "newestClientBackendStartAtUtc"
    }
    releaseConnection = [pscustomobject][ordered]@{
      roleClass = [string]$State.releaseConnection.roleClass
      transactionReadOnly = $State.releaseConnection.transactionReadOnly
    }
  }
}

function Test-ExactManagementBaselineMatches {
  param(
    [Parameter(Mandatory = $true)] $Actual,
    [Parameter(Mandatory = $true)] $Expected
  )

  return (Get-ManagementBaselineProjection $Actual | ConvertTo-Json -Depth 20 -Compress) -eq
    (Get-ManagementBaselineProjection $Expected | ConvertTo-Json -Depth 20 -Compress)
}

function Test-ExactDatabaseCaptureBaselineMatches {
  param(
    [Parameter(Mandatory = $true)] $Actual,
    [Parameter(Mandatory = $true)] $Expected
  )

  return (Get-DatabaseCaptureBaselineProjection $Actual | ConvertTo-Json -Depth 20 -Compress) -eq
    (Get-DatabaseCaptureBaselineProjection $Expected | ConvertTo-Json -Depth 20 -Compress)
}

function Assert-DatabaseBackendBaselineClassifiable {
  param([Parameter(Mandatory = $true)] $Database)

  Assert-DatabaseReleaseConnectionSchema $Database
  $boundary = Get-OptionalProperty $Database "backendBoundary" $null
  if ($null -eq $boundary) {
    throw "Database baseline is missing its sanitized backend boundary."
  }
  $observedAt = [DateTimeOffset]::MinValue
  $postmasterStartedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse(
      [string](Get-OptionalProperty $boundary "observedAtUtc" ""),
      [ref]$observedAt
    ) -or
    -not [DateTimeOffset]::TryParse(
      [string](Get-OptionalProperty $boundary "postmasterStartedAtUtc" ""),
      [ref]$postmasterStartedAt
    )) {
    throw "Database baseline has an invalid sanitized backend boundary."
  }
  $clientBackends = [long](Get-OptionalProperty $boundary "clientBackendSessions" -1)
  $unclassified = [long](Get-OptionalProperty $boundary "unclassifiedClientBackends" -1)
  $unclassifiedWriters = [long](Get-OptionalProperty $boundary "unclassifiedWriterSessions" -1)
  if ($clientBackends -lt 0 -or $unclassified -lt 0 -or
    $unclassifiedWriters -lt 0 -or $unclassified -gt $clientBackends -or
    $unclassifiedWriters -gt $clientBackends) {
    throw "Database backend boundary contains invalid sanitized counts."
  }
  if ($unclassified -ne 0) {
    throw "Database baseline contains an unknown or unclassifiable client backend."
  }
  if ([long](Get-OptionalProperty $Database.drain "clientBackendSessions" -1) -ne
      $clientBackends -or
    [long](Get-OptionalProperty $Database.drain "unclassifiedClientBackends" -1) -ne
      $unclassified -or
    [long](Get-OptionalProperty $Database.drain "unclassifiedWriterSessions" -1) -ne
      $unclassifiedWriters) {
    throw "Database baseline boundary and drain counts do not match."
  }
}

function Assert-ActivationBaselineUnchanged {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $actualManagement = Get-LiveManagementState $AccessToken
  $actualDatabase = Read-FenceDatabaseStatus
  $confirmedManagement = Get-LiveManagementState $AccessToken
  $confirmedDatabase = Read-FenceDatabaseStatus
  if (-not (Test-ExactManagementBaselineMatches `
      $actualManagement $Snapshot.previous.management) -or
    -not (Test-ExactDatabaseCaptureBaselineMatches `
      $actualDatabase $Snapshot.previous.database) -or
    -not (Test-ExactManagementBaselineMatches `
      $confirmedManagement $Snapshot.previous.management) -or
    -not (Test-ExactDatabaseCaptureBaselineMatches `
      $confirmedDatabase $Snapshot.previous.database) -or
    -not (Test-ExactManagementBaselineMatches `
      $confirmedManagement $actualManagement) -or
    -not (Test-ExactDatabaseCaptureBaselineMatches `
      $confirmedDatabase $actualDatabase)) {
    throw "Write-fence baseline drifted before the first remote mutation."
  }
}

function New-FenceSnapshot {
  param(
    [Parameter(Mandatory = $true)] [string]$Path,
    [Parameter(Mandatory = $true)] [string]$AccessToken
  )

  Assert-NoUnresolvedFenceJournalForCapture
  Assert-ReleaseCidr $ReleaseIpv4Cidr "IPv4"
  if (-not [string]::IsNullOrWhiteSpace($ReleaseIpv6Cidr)) {
    Assert-ReleaseCidr $ReleaseIpv6Cidr "IPv6"
  }
  # Bind every remote capture to one committed tree before the first remote read.
  $identity = Get-CleanReviewedGitIdentity
  $management = Get-LiveManagementState $AccessToken
  $baselineStatus = ([string]$management.network.status).Trim().ToLowerInvariant()
  $baselineEntitlement = ([string]$management.network.entitlement).Trim().ToLowerInvariant()
  if ($baselineStatus -ne "applied" -or $baselineEntitlement -ne "allowed") {
    throw "Captured network baseline is not proven applied and entitled."
  }
  $database = Read-FenceDatabaseStatus
  Assert-DatabaseBackendBaselineClassifiable $database
  $postCaptureIdentity = Get-CleanReviewedGitIdentity
  if ($postCaptureIdentity.head -ne $identity.head -or
    $postCaptureIdentity.tree -ne $identity.tree) {
    throw "Git review identity changed while the fence baseline was captured."
  }

  $snapshot = [pscustomobject][ordered]@{
    schemaVersion = $script:SnapshotSchemaVersion
    contract = $script:Contract
    fenceId = [Guid]::NewGuid().ToString("D")
    projectRef = $ExpectedProjectRef
    state = "captured"
    production = $isProductionTarget
    capturedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
    reviewedHead = $identity.head
    reviewedTree = $identity.tree
    roleFenceAppliedAtUtc = $null
    backendFence = $null
    releaseCidrs = [pscustomobject]@{
      ipv4 = @($ReleaseIpv4Cidr)
      ipv6 = if ([string]::IsNullOrWhiteSpace($ReleaseIpv6Cidr)) {
        @()
      } else {
        @($ReleaseIpv6Cidr)
      }
    }
    previous = [pscustomobject]@{
      management = $management
      database = $database
    }
    steps = @()
    migrationStarted = $false
    migrationVerified = $false
    postMigrationEvidence = $null
  }
  Write-FenceSnapshot $Path $snapshot -CreateNew
  return $snapshot
}

function Set-NetworkFence {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $body = [ordered]@{
    dbAllowedCidrs = @($Snapshot.releaseCidrs.ipv4)
    dbAllowedCidrsV6 = @($Snapshot.releaseCidrs.ipv6)
  }
  Invoke-FenceManagementRequest -Method Post `
    -Path "/v1/projects/$ExpectedProjectRef/network-restrictions/apply" `
    -AccessToken $AccessToken -Body $body | Out-Null
}

function Set-RealtimeFence {
  param([Parameter(Mandatory = $true)] [string]$AccessToken)

  Invoke-FenceManagementRequest -Method Patch `
    -Path "/v1/projects/$ExpectedProjectRef/config/realtime" `
    -AccessToken $AccessToken -Body ([ordered]@{ suspend = $true }) | Out-Null
  Invoke-FenceManagementRequest -Method Post `
    -Path "/v1/projects/$ExpectedProjectRef/config/realtime/shutdown" `
    -AccessToken $AccessToken | Out-Null
}

function Set-AuthFence {
  param([Parameter(Mandatory = $true)] [string]$AccessToken)

  Invoke-FenceManagementRequest -Method Patch `
    -Path "/v1/projects/$ExpectedProjectRef/config/auth" `
    -AccessToken $AccessToken `
    -Body ([ordered]@{ disable_signup = $true }) | Out-Null
}

function Set-DatabaseRoleFence {
  $roleSql = @'
ALTER ROLE authenticator IN DATABASE postgres SET default_transaction_read_only TO on;
ALTER ROLE supabase_auth_admin IN DATABASE postgres SET default_transaction_read_only TO on;
ALTER ROLE supabase_storage_admin IN DATABASE postgres SET default_transaction_read_only TO on;
ALTER ROLE dashboard_user IN DATABASE postgres SET default_transaction_read_only TO on;
'@
  Invoke-FenceDatabaseQuery -Sql $roleSql

  # The ALTER ROLE transaction must commit before this separate connection
  # boundary. Every later protected session then inherits read-only state.
  $terminationSql = @'
WITH cutoff AS MATERIALIZED (
  SELECT clock_timestamp() AS applied_at_utc
), targets AS MATERIALIZED (
  SELECT
    activity.pid,
    (
      activity.backend_type IS NULL
      OR activity.backend_start IS NULL
      OR activity.usename IS NULL
      OR session_role.oid IS NULL
    ) AS unclassified,
    (
      session_role.oid IS NULL
      OR activity.usename NOT IN (
        'authenticator',
        'supabase_auth_admin',
        'supabase_storage_admin',
        'dashboard_user'
      )
    ) AS unmanaged_writer
  FROM pg_catalog.pg_stat_activity activity
  LEFT JOIN pg_catalog.pg_roles session_role
    ON session_role.rolname = activity.usename
  CROSS JOIN cutoff
  WHERE activity.datname = current_database()
    AND activity.pid <> pg_backend_pid()
    AND (
      activity.backend_type = 'client backend'
      OR activity.backend_type IS NULL
    )
    AND (
      activity.backend_start IS NULL
      OR activity.backend_start <= cutoff.applied_at_utc
    )
), terminated AS (
  SELECT
    target.unclassified,
    target.unmanaged_writer,
    pg_terminate_backend(target.pid) AS terminated
  FROM targets target
)
SELECT json_build_object(
  'appliedAtUtc', (SELECT applied_at_utc FROM cutoff),
  'targetedClientBackends', count(*),
  'unclassifiedPreFenceClientBackends',
    count(*) FILTER (WHERE unclassified),
  'unmanagedPreFenceWriterBackends',
    count(*) FILTER (WHERE unmanaged_writer),
  'terminationFailures', count(*) FILTER (WHERE terminated IS NOT TRUE)
) AS backend_fence_activation
FROM terminated;
'@
  $row = Invoke-FenceDatabaseQuery -Sql $terminationSql `
    -ExpectSingleJsonRow
  $activationProperty = if ($null -eq $row) {
    $null
  } else {
    $row.PSObject.Properties["backend_fence_activation"]
  }
  $activation = if ($null -eq $activationProperty) {
    $null
  } else {
    $activationProperty.Value
  }
  if ($null -eq $activation) {
    throw "Database backend fence returned an invalid sanitized result."
  }
  $appliedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse(
      [string]$activation.appliedAtUtc,
      [ref]$appliedAt
    )) {
    throw "Database role fence did not return a valid activation boundary."
  }
  $targeted = [long]$activation.targetedClientBackends
  $unclassified = [long]$activation.unclassifiedPreFenceClientBackends
  $unmanagedWriters = [long]$activation.unmanagedPreFenceWriterBackends
  $terminationFailures = [long]$activation.terminationFailures
  if ($targeted -lt 0 -or $unclassified -lt 0 -or $unmanagedWriters -lt 0 -or
    $terminationFailures -lt 0 -or $unclassified -gt $targeted -or
    $unmanagedWriters -gt $targeted -or $terminationFailures -gt $targeted) {
    throw "Database backend fence returned invalid sanitized counts."
  }
  if ($unclassified -ne 0) {
    throw "An unknown or unclassifiable pre-fence client backend was terminated; manual review is required."
  }
  if ($terminationFailures -ne 0) {
    throw "A pre-fence client backend could not be terminated."
  }
  return [pscustomobject]@{
    appliedAtUtc = $appliedAt.ToUniversalTime().ToString("o")
    targetedClientBackends = $targeted
    unclassifiedPreFenceClientBackends = $unclassified
    unmanagedPreFenceWriterBackends = $unmanagedWriters
    terminationFailures = $terminationFailures
  }
}

function Set-CronFence {
  Invoke-FenceDatabaseQuery -Sql `
    "ALTER SYSTEM SET cron.launch_active_jobs TO off; SELECT pg_reload_conf();"
}

function Assert-ReleaseConnectionWritable {
  # This proves the explicit-ref Beta Management API writer can perform a
  # rollback-contained write. It does not attest the separate migration CLI's
  # linked target or credential; production remains hard-stopped until that
  # ship path is pinned and rehearsed with its own connection fingerprint.
  $sql = @'
BEGIN;
CREATE TABLE public.release_fence_write_probe(id integer);
INSERT INTO public.release_fence_write_probe(id) VALUES (1);
ROLLBACK;
'@
  Invoke-FenceDatabaseQuery -Sql $sql
}

function Wait-NetworkFenceEnforced {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($DrainTimeoutSeconds)
  do {
    $network = Get-LiveNetworkState $AccessToken
    $networkStatus = ([string]$network.status).Trim().ToLowerInvariant()
    $networkEntitlement = ([string]$network.entitlement).Trim().ToLowerInvariant()
    if ($networkEntitlement -ne "allowed") {
      throw "Network restriction entitlement cannot prove enforcement."
    }
    if ($networkStatus -notin $script:EnforcedNetworkStatuses -and
      $networkStatus -notin $script:PendingNetworkStatuses) {
      throw "Network restriction status cannot prove enforcement."
    }

    $actualV4 = @($network.ipv4 | Sort-Object -Unique)
    $expectedV4 = @($Snapshot.releaseCidrs.ipv4 | Sort-Object -Unique)
    $actualV6 = @($network.ipv6 | Sort-Object -Unique)
    $expectedV6 = @($Snapshot.releaseCidrs.ipv6 | Sort-Object -Unique)
    $cidrsMatch = @(
      Compare-Object $actualV4 $expectedV4
      Compare-Object $actualV6 $expectedV6
    ).Count -eq 0
    if ($networkStatus -in $script:EnforcedNetworkStatuses -and $cidrsMatch) {
      return $network
    }
    Start-Sleep -Milliseconds $script:PollIntervalMilliseconds
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "Network restriction did not become enforced before the bounded timeout."
}

function Wait-FenceDrain {
  param([Parameter(Mandatory = $true)] $Snapshot)

  if ($null -eq $Snapshot.backendFence) {
    throw "Write-fence snapshot lacks its sanitized client-backend fence evidence."
  }
  $roleFenceAppliedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse(
      [string]$Snapshot.backendFence.appliedAtUtc,
      [ref]$roleFenceAppliedAt
    ) -or [string]$Snapshot.roleFenceAppliedAtUtc -ne
      [string]$Snapshot.backendFence.appliedAtUtc) {
    throw "Write-fence snapshot lacks a valid protected-session cutoff."
  }
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($DrainTimeoutSeconds)
  do {
    $status = Read-FenceDatabaseStatus
    $activeTransactions = [long]$status.drain.activeTransactions
    $runningCronJobs = [long]$status.drain.runningCronJobs
    $protectedRoleSessions = [long]$status.drain.protectedRoleSessions
    $clientBackendSessions = [long]$status.drain.clientBackendSessions
    $unclassifiedClientBackends = [long]$status.drain.unclassifiedClientBackends
    $unclassifiedWriterSessions = [long]$status.drain.unclassifiedWriterSessions
    if ($activeTransactions -lt 0 -or $runningCronJobs -lt 0 -or
      $protectedRoleSessions -lt 0 -or $clientBackendSessions -lt 0 -or
      $unclassifiedClientBackends -lt 0 -or $unclassifiedWriterSessions -lt 0) {
      throw "Client-backend drain returned invalid sanitized counts."
    }
    if ($unclassifiedClientBackends -ne 0 -or $unclassifiedWriterSessions -ne 0) {
      throw "An unknown, unclassifiable, or unmanaged writer session exists behind the fence."
    }
    $oldProtectedSessions = $false
    if ($protectedRoleSessions -gt 0) {
      $oldest = [DateTimeOffset]::MinValue
      $oldestRaw = [string]$status.drain.oldestProtectedRoleSessionAtUtc
      if (-not [DateTimeOffset]::TryParse($oldestRaw, [ref]$oldest)) {
        throw "Protected-session drain evidence is malformed."
      }
      $oldProtectedSessions = $oldest -lt $roleFenceAppliedAt
    }
    $oldPreFenceClientBackends = $false
    if ($clientBackendSessions -gt 0) {
      $oldestClient = [DateTimeOffset]::MinValue
      $oldestClientRaw = [string]$status.drain.oldestClientBackendStartAtUtc
      if (-not [DateTimeOffset]::TryParse($oldestClientRaw, [ref]$oldestClient)) {
        throw "Client-backend drain evidence is malformed."
      }
      $oldPreFenceClientBackends = $oldestClient -le $roleFenceAppliedAt
    }
    if ($activeTransactions -eq 0 -and $runningCronJobs -eq 0 -and
      -not $oldProtectedSessions -and -not $oldPreFenceClientBackends) {
      return $status
    }
    Start-Sleep -Milliseconds $script:PollIntervalMilliseconds
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "Write-fence drain did not reach zero before the bounded timeout."
}

function Assert-FenceActive {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  Wait-NetworkFenceEnforced $AccessToken $Snapshot | Out-Null
  $realtime = Get-LiveRealtimeState $AccessToken
  $auth = Get-LiveAuthState $AccessToken
  if ($realtime.suspend -ne $true -or $auth.disableSignup -ne $true) {
    throw "Realtime or Auth management fence is not active."
  }

  $database = Wait-FenceDrain $Snapshot
  foreach ($role in $script:ProtectedRoles) {
    $roleStatus = $database.roles.PSObject.Properties[$role].Value
    if ($null -eq $roleStatus -or $roleStatus.exists -ne $true -or
      $roleStatus.configuredValue -ne "on") {
      throw "A required Supabase service role is not database-readonly."
    }
  }
  if ($database.cron.launchActiveJobs -ne "off") {
    throw "pg_cron launcher remains active."
  }
  Assert-ReleaseConnectionWritable
}

function Restore-CronFence {
  param([Parameter(Mandatory = $true)] $Snapshot)

  $cron = $Snapshot.previous.database.cron
  $autoOverridePresent = [bool](Get-OptionalProperty $cron "autoOverridePresent" $false)
  $autoOverrideValue = [string](Get-OptionalProperty $cron "autoOverrideValue" "")
  if ($autoOverridePresent) {
    if ($autoOverrideValue -notin @("on", "off")) {
      throw "Captured cron auto-override is not safely restorable."
    }
    Invoke-FenceDatabaseQuery -Sql `
      "ALTER SYSTEM SET cron.launch_active_jobs TO $autoOverrideValue; SELECT pg_reload_conf();"
  } else {
    Invoke-FenceDatabaseQuery -Sql `
      "ALTER SYSTEM RESET cron.launch_active_jobs; SELECT pg_reload_conf();"
  }
}

function Restore-DatabaseRoleFence {
  param([Parameter(Mandatory = $true)] $Snapshot)

  $statements = @()
  foreach ($role in $script:ProtectedRoles) {
    $roleSnapshot = $Snapshot.previous.database.roles.PSObject.Properties[$role].Value
    $priorValue = [string](Get-OptionalProperty $roleSnapshot "configuredValue" "")
    if ($priorValue -in @("on", "off")) {
      $statements += "ALTER ROLE $role IN DATABASE postgres SET default_transaction_read_only TO $priorValue;"
    } else {
      $statements += "ALTER ROLE $role IN DATABASE postgres RESET default_transaction_read_only;"
    }
  }
  Invoke-FenceDatabaseQuery -Sql ($statements -join "`n")

  # Terminate in a second committed command so every surviving/reconnected
  # protected session inherits the restored baseline.
  $terminateSql = @'
SELECT pg_terminate_backend(pid)
FROM pg_catalog.pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND usename IN (
    'authenticator',
    'supabase_auth_admin',
    'supabase_storage_admin',
    'dashboard_user'
  );
'@
  Invoke-FenceDatabaseQuery -Sql $terminateSql
}

function Restore-ManagementFence {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  if ((Test-FenceStepTouched $Snapshot "auth")) {
    Invoke-FenceManagementRequest -Method Patch `
      -Path "/v1/projects/$ExpectedProjectRef/config/auth" `
      -AccessToken $AccessToken -Body ([ordered]@{
        disable_signup = $Snapshot.previous.management.auth.disableSignup
      }) | Out-Null
  }
  if ((Test-FenceStepTouched $Snapshot "realtime")) {
    Invoke-FenceManagementRequest -Method Patch `
      -Path "/v1/projects/$ExpectedProjectRef/config/realtime" `
      -AccessToken $AccessToken -Body ([ordered]@{
        suspend = $Snapshot.previous.management.realtime.suspend
      }) | Out-Null
  }
}

function Restore-NetworkFence {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  # Database network access is deliberately a separate phase. It must remain
  # release-only until Auth/Realtime and the protected DB roles have each
  # returned to, and been verified against, their captured baselines.
  if ((Test-FenceStepTouched $Snapshot "network")) {
    Invoke-FenceManagementRequest -Method Post `
      -Path "/v1/projects/$ExpectedProjectRef/network-restrictions/apply" `
      -AccessToken $AccessToken -Body ([ordered]@{
        dbAllowedCidrs = @($Snapshot.previous.management.network.ipv4)
        dbAllowedCidrsV6 = @($Snapshot.previous.management.network.ipv6)
      }) | Out-Null
  }
}

function Test-DatabaseRoleBaselineMatches {
  param(
    [Parameter(Mandatory = $true)] $Actual,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $expected = $Snapshot.previous.database
  if ([string]$Actual.contract -ne [string]$expected.contract -or
    [string]$Actual.database -ne [string]$expected.database) {
    return $false
  }
  foreach ($role in $script:ProtectedRoles) {
    $actualRole = Get-OptionalProperty $Actual.roles $role $null
    $expectedRole = Get-OptionalProperty $expected.roles $role $null
    if ($null -eq $actualRole -or $null -eq $expectedRole -or
      [bool]$actualRole.exists -ne [bool]$expectedRole.exists -or
      [string](Get-OptionalProperty $actualRole "configuredValue" "") -ne
        [string](Get-OptionalProperty $expectedRole "configuredValue" "")) {
      return $false
    }
  }

  return $true
}

function Test-CronBaselineMatches {
  param(
    [Parameter(Mandatory = $true)] $Actual,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $actualCron = $Actual.cron
  $expectedCron = $Snapshot.previous.database.cron
  if ([string]$actualCron.launchActiveJobs -ne [string]$expectedCron.launchActiveJobs -or
    [bool]$actualCron.autoOverridePresent -ne [bool]$expectedCron.autoOverridePresent -or
    [string](Get-OptionalProperty $actualCron "autoOverrideValue" "") -ne
      [string](Get-OptionalProperty $expectedCron "autoOverrideValue" "")) {
    return $false
  }
  return $true
}

function Test-DatabaseBaselineMatches {
  param(
    [Parameter(Mandatory = $true)] $Actual,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  return (Test-DatabaseRoleBaselineMatches $Actual $Snapshot) -and
    (Test-CronBaselineMatches $Actual $Snapshot)
}

function Wait-ManagementStateRestored {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $expected = $Snapshot.previous.management
  $expectedRealtime = $expected.realtime | ConvertTo-Json -Depth 10 -Compress
  $expectedAuth = $expected.auth | ConvertTo-Json -Depth 10 -Compress
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($DrainTimeoutSeconds)
  do {
    $actualRealtime = Get-LiveRealtimeState $AccessToken
    $actualAuth = Get-LiveAuthState $AccessToken
    $realtimeMatches = ($actualRealtime | ConvertTo-Json -Depth 10 -Compress) -eq
      $expectedRealtime
    $authMatches = ($actualAuth | ConvertTo-Json -Depth 10 -Compress) -eq
      $expectedAuth
    if ($realtimeMatches -and $authMatches) {
      return
    }
    Start-Sleep -Milliseconds $script:PollIntervalMilliseconds
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "Auth or Realtime controls did not return to the exact captured baseline before timeout."
}

function Wait-NetworkStateRestored {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  $expected = $Snapshot.previous.management.network
  $expectedStatus = ([string]$expected.status).Trim().ToLowerInvariant()
  $expectedEntitlement = ([string]$expected.entitlement).Trim().ToLowerInvariant()
  if ($expectedStatus -ne "applied" -or $expectedEntitlement -ne "allowed") {
    throw "Captured network baseline cannot be exactly restored automatically."
  }

  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($DrainTimeoutSeconds)
  do {
    $actual = Get-LiveNetworkState $AccessToken
    $actualStatus = ([string]$actual.status).Trim().ToLowerInvariant()
    $actualEntitlement = ([string]$actual.entitlement).Trim().ToLowerInvariant()
    if ($actualStatus -notin $script:EnforcedNetworkStatuses -and
      $actualStatus -notin $script:PendingNetworkStatuses) {
      throw "Restored network status cannot prove the captured baseline."
    }
    if ($actualEntitlement -ne "allowed") {
      throw "Restored network entitlement cannot prove enforcement."
    }

    $actualV4 = @($actual.ipv4 | Sort-Object -Unique)
    $expectedV4 = @($expected.ipv4 | Sort-Object -Unique)
    $actualV6 = @($actual.ipv6 | Sort-Object -Unique)
    $expectedV6 = @($expected.ipv6 | Sort-Object -Unique)
    $networkMatches = @(
      Compare-Object $actualV4 $expectedV4
      Compare-Object $actualV6 $expectedV6
    ).Count -eq 0
    if ($actualStatus -eq $expectedStatus -and
      $actualEntitlement -eq $expectedEntitlement -and $networkMatches) {
      return
    }
    Start-Sleep -Milliseconds $script:PollIntervalMilliseconds
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "Database network controls did not return to the exact captured baseline before timeout."
}

function Wait-DatabaseRoleStateRestored {
  param([Parameter(Mandatory = $true)] $Snapshot)

  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($DrainTimeoutSeconds)
  do {
    $actual = Read-FenceDatabaseStatus
    if ((Test-DatabaseRoleBaselineMatches $actual $Snapshot)) {
      return
    }
    Start-Sleep -Milliseconds $script:PollIntervalMilliseconds
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "Database role controls did not return to the exact captured baseline before timeout."
}

function Wait-DatabaseStateRestored {
  param([Parameter(Mandatory = $true)] $Snapshot)

  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($DrainTimeoutSeconds)
  do {
    $actual = Read-FenceDatabaseStatus
    if ((Test-DatabaseBaselineMatches $actual $Snapshot)) {
      return
    }
    Start-Sleep -Milliseconds $script:PollIntervalMilliseconds
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "Database controls did not return to the exact captured baseline before timeout."
}

function Assert-FenceRestored {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot
  )

  Wait-ManagementStateRestored $AccessToken $Snapshot
  Wait-NetworkStateRestored $AccessToken $Snapshot
  Wait-DatabaseStateRestored $Snapshot
  Wait-ManagementStateRestored $AccessToken $Snapshot
  Wait-NetworkStateRestored $AccessToken $Snapshot
  Wait-DatabaseStateRestored $Snapshot
  Assert-ReleaseConnectionWritable
}

function Assert-RestoreTransitionAllowed {
  param(
    [Parameter(Mandatory = $true)] $Snapshot,
    [Parameter(Mandatory = $true)]
    [ValidateSet("Deactivate", "Recover", "ActivationRollback")]
    [string]$Mode
  )

  $state = [string]$Snapshot.state
  if ($state -eq "released") {
    throw "A released write-fence journal is terminal and cannot be replayed."
  }
  $touchedControls = @(
    "network", "realtime", "auth", "roles", "cron" | Where-Object {
      Test-FenceStepTouched $Snapshot $_
    }
  )
  switch ($Mode) {
    "Deactivate" {
      $plainActive = $state -eq "active" -and
        $Snapshot.migrationStarted -eq $false -and
        $Snapshot.migrationVerified -eq $false
      $verifiedMigration = $state -eq "migration_verified" -and
        $Snapshot.migrationStarted -eq $true -and
        $Snapshot.migrationVerified -eq $true -and
        $null -ne $Snapshot.postMigrationEvidence -and
        (Get-OptionalProperty `
          $Snapshot.postMigrationEvidence "allRequiredChecksPassed" $false) -eq $true
      if (-not $plainActive -and -not $verifiedMigration) {
        throw "Deactivate is not allowed from this write-fence journal state."
      }
    }
    "Recover" {
      $recoverableCrashState = $state -in @(
        "activating", "activation_failed", "restoring"
      )
      if ($state -ne "manual_recovery_required" -and -not $recoverableCrashState) {
        throw "Recover requires a durable failed or crash-interrupted recovery state."
      }
      # activating can be durably published before its first pending control,
      # and restoring can be durably published while recovering that exact
      # boundary. In both cases Restore-Fence performs full exact-live-state
      # verification before publishing released. All other recovery states
      # require evidence that at least one live control may have been touched.
      if ($state -in @("manual_recovery_required", "activation_failed") -and
        $touchedControls.Count -eq 0) {
        throw "Recover requires at least one touched write-fence control."
      }
    }
    "ActivationRollback" {
      if ($state -ne "activation_failed" -or $touchedControls.Count -eq 0) {
        throw "Activation rollback requires a failed journal with a touched control."
      }
    }
  }

  # Do not apply capture freshness here: an active or failed fence must remain
  # recoverable after an outage. It must, however, bind to the reviewed tree.
  Assert-SnapshotHead $Snapshot
}

function Restore-Fence {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot,
    [Parameter(Mandatory = $true)] [string]$Path,
    [Parameter(Mandatory = $true)]
    [ValidateSet("Deactivate", "Recover", "ActivationRollback")]
    [string]$Mode
  )

  Assert-SnapshotIsSoleUnresolvedJournal -Path $Path -Snapshot $Snapshot
  Assert-RestoreTransitionAllowed $Snapshot $Mode
  if ($Snapshot.migrationStarted -eq $true -and $Snapshot.migrationVerified -ne $true) {
    $Snapshot.state = "manual_recovery_required"
    Write-FenceSnapshot $Path $Snapshot
    throw "Migration started without separate post-migration evidence; the fence remains active."
  }
  $Snapshot.state = "restoring"
  Set-FenceStep $Snapshot "restore" "pending"
  Write-FenceSnapshot $Path $Snapshot
  $liveRestoreVerified = $false
  try {
    # Keep DB roles readonly and the DB network release-only while restoring
    # the non-DB management controls. The Data API is HTTP-based, so restoring
    # roles before Auth would reopen writes even with the DB network fenced.
    Restore-ManagementFence $AccessToken $Snapshot
    Wait-ManagementStateRestored $AccessToken $Snapshot

    # Only after Auth and Realtime are verified may protected roles resume their
    # captured baseline. Existing protected sessions are terminated by the
    # restore helper so no connection keeps a stale readonly GUC.
    if ((Test-FenceStepTouched $Snapshot "roles")) {
      Restore-DatabaseRoleFence $Snapshot
    }
    Wait-DatabaseRoleStateRestored $Snapshot

    # Reopen database network access only after both prior phases are verified.
    Restore-NetworkFence $AccessToken $Snapshot
    Wait-NetworkStateRestored $AccessToken $Snapshot

    # Cron is the final writer to resume. A job must never run while any other
    # control is still restricted or unverified.
    if ((Test-FenceStepTouched $Snapshot "cron")) {
      Restore-CronFence $Snapshot
    }
    Assert-FenceRestored $AccessToken $Snapshot
    $liveRestoreVerified = $true
    $Snapshot.state = "released"
    Set-FenceStep $Snapshot "restore" "applied"
    Write-FenceSnapshot $Path $Snapshot
  } catch {
    if ($liveRestoreVerified -and
      $_.Exception.Data["WriteFencePublishedPayloadVisible"] -eq $true) {
      throw "Live controls were restored and the released journal payload is visible, but its directory metadata durability was not confirmed. Live controls were not re-fenced; retry Recover only if the durable journal remains unresolved."
    }
    $refenced = $false
    $previousReserveMode = $script:UsingRecoveryRequestReserve
    $script:UsingRecoveryRequestReserve = $true
    try {
      try {
        Set-NetworkFence $AccessToken $Snapshot
        Set-RealtimeFence $AccessToken
        Set-AuthFence $AccessToken
        $Snapshot.backendFence = Set-DatabaseRoleFence
        $Snapshot.roleFenceAppliedAtUtc = $Snapshot.backendFence.appliedAtUtc
        Set-CronFence
        Assert-FenceActive $AccessToken $Snapshot
        $refenced = $true
      } catch {
        $refenced = $false
      }
    } finally {
      $script:UsingRecoveryRequestReserve = $previousReserveMode
    }
    $Snapshot.state = "manual_recovery_required"
    Set-FenceStep $Snapshot "restore" "failed"
    Write-FenceSnapshot $Path $Snapshot
    if ($refenced) {
      throw "Write-fence restore failed; live controls were re-fenced and manual exact restoration is required."
    }
    throw "Write-fence restore failed and live controls could not be proven; follow the emergency recovery runbook immediately."
  }
}

function Invoke-FenceActivation {
  param(
    [Parameter(Mandatory = $true)] [string]$AccessToken,
    [Parameter(Mandatory = $true)] $Snapshot,
    [Parameter(Mandatory = $true)] [string]$Path
  )

  Assert-SnapshotIsSoleUnresolvedJournal -Path $Path -Snapshot $Snapshot
  if ($Snapshot.state -ne "captured") {
    throw "Only a captured snapshot can be activated."
  }
  Assert-SnapshotHead $Snapshot
  Assert-SnapshotFreshForActivation $Snapshot
  $Snapshot.state = "activating"
  Write-FenceSnapshot $Path $Snapshot

  Set-FenceStep $Snapshot "network" "pending"
  Write-FenceSnapshot $Path $Snapshot
  try {
    # This is the last remote read boundary before network restrictions become
    # the first mutation. Any management, DB-control, drain, or backend drift
    # invalidates the captured restore point without attempting a rollback.
    Assert-ActivationBaselineUnchanged $AccessToken $Snapshot
  } catch {
    $Snapshot.state = "captured"
    $Snapshot.steps = @($Snapshot.steps | Where-Object { $_.name -ne "network" })
    Write-FenceSnapshot $Path $Snapshot
    throw
  }

  try {
    Set-NetworkFence $AccessToken $Snapshot
    Set-FenceStep $Snapshot "network" "applied"
    Write-FenceSnapshot $Path $Snapshot

    Set-FenceStep $Snapshot "realtime" "pending"
    Write-FenceSnapshot $Path $Snapshot
    Set-RealtimeFence $AccessToken
    Set-FenceStep $Snapshot "realtime" "applied"
    Write-FenceSnapshot $Path $Snapshot

    Set-FenceStep $Snapshot "auth" "pending"
    Write-FenceSnapshot $Path $Snapshot
    Set-AuthFence $AccessToken
    Set-FenceStep $Snapshot "auth" "applied"
    Write-FenceSnapshot $Path $Snapshot

    Set-FenceStep $Snapshot "roles" "pending"
    Write-FenceSnapshot $Path $Snapshot
    $Snapshot.backendFence = Set-DatabaseRoleFence
    $Snapshot.roleFenceAppliedAtUtc = $Snapshot.backendFence.appliedAtUtc
    Set-FenceStep $Snapshot "roles" "applied"
    Write-FenceSnapshot $Path $Snapshot

    Set-FenceStep $Snapshot "cron" "pending"
    Write-FenceSnapshot $Path $Snapshot
    Set-CronFence
    Set-FenceStep $Snapshot "cron" "applied"
    Write-FenceSnapshot $Path $Snapshot

    Assert-FenceActive $AccessToken $Snapshot
    Set-FenceStep $Snapshot "verify" "applied"
    $Snapshot.state = "active"
    Write-FenceSnapshot $Path $Snapshot
  } catch {
    $Snapshot.state = "activation_failed"
    Set-FenceStep $Snapshot "activation" "failed"
    Write-FenceSnapshot $Path $Snapshot
    try {
      Restore-Fence $AccessToken $Snapshot $Path "ActivationRollback"
    } catch {
      $Snapshot.state = "manual_recovery_required"
      Write-FenceSnapshot $Path $Snapshot
    }
    throw "Write-fence activation failed; completed steps were rolled back or journaled for recovery."
  }
}

# The offline test harness evaluates an isolated, credential-free copy after
# removing the entrypoint-only dot-source rejection above. The checked-in
# operational entrypoint itself never exports these remote mutation functions.
if ($MyInvocation.InvocationName -eq ".") {
  return
}

if ($Action -eq "Plan") {
  [pscustomobject]@{
    contract = $script:Contract
    projectRef = $ExpectedProjectRef
    production = $isProductionTarget
    remoteCallsExecuted = $false
    coordinationScope = "single_host_local_journal_only"
    productionBlockers = @(
      "provider_side_project_lease_or_cas_across_hosts_and_ci"
      "same_lease_migration_started_exact_target_push_evidence_restore"
      "fresh_live_fence_and_black_box_denial_recheck_immediately_before_push"
      "pinned_migration_connection_and_disposable_beta_api_rehearsal"
      "continuous_writer_role_coverage_and_provider_change_freeze"
    )
    operations = @(
      "restrict_database_network"
      "suspend_and_shutdown_realtime"
      "disable_auth_signup"
      "set_service_roles_read_only"
      "stop_and_drain_pg_cron"
      "verify_release_connection_writable"
    )
  } | ConvertTo-Json
  exit 0
}

throw "The write-fence entrypoint reached an invalid post-Plan state."
