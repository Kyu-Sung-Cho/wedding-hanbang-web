Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$script:HBAM2FormatName = 'HBAM2-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser'
$script:HBAM2RootMarkerName = '.amora-backup-root-v2'
$script:HBAM2RootMarkerContent = "WeddingHanbang Amora private backup root v2`n"
$script:HBAM2Magic = [Text.Encoding]::ASCII.GetBytes('HBAM2')
$script:HBAM2Version = [byte]2
$script:HBAM2MaximumPayloadBytes = 33554432
$script:HBAM2MaximumManifestBytes = 262144

function Get-HBAM2Sha256Hex {
  param([Parameter(Mandatory = $true)] [byte[]] $Bytes)

  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '')
  } finally {
    $sha.Dispose()
  }
}

function Join-HBAM2ByteArrays {
  param([Parameter(Mandatory = $true)] [object[]] $Arrays)

  $length = 0
  foreach ($array in $Arrays) { $length += ([byte[]]$array).Length }
  $result = New-Object byte[] $length
  $offset = 0
  foreach ($array in $Arrays) {
    $bytes = [byte[]]$array
    [Buffer]::BlockCopy($bytes, 0, $result, $offset, $bytes.Length)
    $offset += $bytes.Length
  }
  return ,$result
}

function Get-HBAM2Entropy {
  param(
    [Parameter(Mandatory = $true)] [string] $ProjectRef,
    [Parameter(Mandatory = $true)] [string] $ArtifactName,
    [Parameter(Mandatory = $true)] [string] $BackupSetId
  )

  return ,[Text.Encoding]::UTF8.GetBytes("HBAM2|$ProjectRef|$BackupSetId|$ArtifactName")
}

function Test-HBAM2FixedTimeEqual {
  param(
    [Parameter(Mandatory = $true)] [byte[]] $Left,
    [Parameter(Mandatory = $true)] [byte[]] $Right
  )

  if ($Left.Length -ne $Right.Length) { return $false }
  $difference = 0
  for ($i = 0; $i -lt $Left.Length; $i++) {
    $difference = $difference -bor ($Left[$i] -bxor $Right[$i])
  }
  return $difference -eq 0
}

function Test-HBAM2SamePath {
  param(
    [Parameter(Mandatory = $true)] [string] $Left,
    [Parameter(Mandatory = $true)] [string] $Right
  )

  return [string]::Equals(
    [IO.Path]::GetFullPath($Left).TrimEnd('\'),
    [IO.Path]::GetFullPath($Right).TrimEnd('\'),
    [StringComparison]::OrdinalIgnoreCase
  )
}

function Assert-HBAM2PathUnderAnchorWithoutReparsePoints {
  param(
    [Parameter(Mandatory = $true)] [string] $Path,
    [Parameter(Mandatory = $true)] [string] $Anchor
  )

  $resolvedPath = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $resolvedAnchor = [IO.Path]::GetFullPath($Anchor).TrimEnd('\')
  $prefix = "$resolvedAnchor\"
  if (-not $resolvedPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Backup path is outside its fixed safety anchor.'
  }

  $current = $resolvedAnchor
  if (Test-Path -LiteralPath $current) {
    $item = Get-Item -LiteralPath $current -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'Backup safety anchor must not be a reparse point.'
    }
  }
  $relative = $resolvedPath.Substring($prefix.Length)
  foreach ($segment in @($relative -split '\\' | Where-Object { $_ })) {
    $current = Join-Path $current $segment
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Backup path must not traverse a reparse point.'
      }
    }
  }
}

function Get-HBAM2RequiredAclSidValues {
  return @(
    [Security.Principal.WindowsIdentity]::GetCurrent().User.Value,
    'S-1-5-18',
    'S-1-5-32-544'
  )
}

function Assert-HBAM2PrivateAclOwner {
  param([Parameter(Mandatory = $true)] $Acl)

  $owner = [Security.Principal.NTAccount]::new([string]$Acl.Owner)
  $ownerSid = $owner.Translate([Security.Principal.SecurityIdentifier]).Value
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ($ownerSid -ne $currentSid) {
    throw 'Backup path owner is not the creating Windows user.'
  }
}

function Assert-HBAM2PrivateDirectoryAcl {
  param([Parameter(Mandatory = $true)] [string] $Path)

  $acl = Get-Acl -LiteralPath $Path
  $allowedSids = @(Get-HBAM2RequiredAclSidValues)
  $allow = [Security.AccessControl.AccessControlType]::Allow
  $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $propagation = [Security.AccessControl.PropagationFlags]::None
  $rights = [Security.AccessControl.FileSystemRights]::FullControl
  Assert-HBAM2PrivateAclOwner -Acl $acl
  if (-not $acl.AreAccessRulesProtected) {
    throw 'Backup directory ACL inheritance is enabled.'
  }
  $rules = @($acl.Access)
  if ($rules.Count -ne $allowedSids.Count) {
    throw 'Backup directory ACL does not contain the exact private rule set.'
  }
  foreach ($rule in $rules) {
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($rule.AccessControlType -ne $allow -or
        $sid -notin $allowedSids -or
        $rule.IsInherited -or
        $rule.FileSystemRights -ne $rights -or
        $rule.InheritanceFlags -ne $inheritance -or
        $rule.PropagationFlags -ne $propagation) {
      throw 'Backup directory ACL contains an unexpected access rule.'
    }
  }
  foreach ($sid in $allowedSids) {
    $matches = @($rules | Where-Object {
      $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $sid
    })
    if ($matches.Count -ne 1) {
      throw 'Backup directory ACL is missing a required identity.'
    }
  }
}

function Assert-HBAM2PrivateFileAcl {
  param([Parameter(Mandatory = $true)] [string] $Path)

  $acl = Get-Acl -LiteralPath $Path
  $allowedSids = @(Get-HBAM2RequiredAclSidValues)
  $allow = [Security.AccessControl.AccessControlType]::Allow
  $rights = [Security.AccessControl.FileSystemRights]::FullControl
  Assert-HBAM2PrivateAclOwner -Acl $acl
  $rules = @($acl.Access)
  if ($rules.Count -ne $allowedSids.Count) {
    throw 'Backup artifact ACL does not contain the exact private rule set.'
  }
  foreach ($rule in $rules) {
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($rule.AccessControlType -ne $allow -or
        $sid -notin $allowedSids -or
        $rule.FileSystemRights -ne $rights) {
      throw 'Backup artifact ACL contains an unexpected access rule.'
    }
  }
  foreach ($sid in $allowedSids) {
    $matches = @($rules | Where-Object {
      $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $sid
    })
    if ($matches.Count -ne 1) {
      throw 'Backup artifact ACL is missing a required identity.'
    }
  }
}

function Set-HBAM2PrivateDirectoryAcl {
  param([Parameter(Mandatory = $true)] [string] $Path)

  $acl = Get-Acl -LiteralPath $Path
  $acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
  $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $propagation = [Security.AccessControl.PropagationFlags]::None
  $rights = [Security.AccessControl.FileSystemRights]::FullControl
  $allow = [Security.AccessControl.AccessControlType]::Allow
  $identities = @(
    [Security.Principal.WindowsIdentity]::GetCurrent().User,
    [Security.Principal.SecurityIdentifier]::new('S-1-5-18'),
    [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  )
  foreach ($identity in $identities) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
      $identity, $rights, $inheritance, $propagation, $allow
    )
    $acl.AddAccessRule($rule) | Out-Null
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
  Assert-HBAM2PrivateDirectoryAcl -Path $Path
}

function Resolve-HBAM2BackupRoot {
  param(
    [Parameter(Mandatory = $true)] [bool] $SelfTest,
    [string] $SelfTestBackupRoot
  )

  if ($SelfTest) {
    if ([string]::IsNullOrWhiteSpace($SelfTestBackupRoot)) {
      throw '-SelfTestBackupRoot is required with -SelfTest.'
    }
    $anchor = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    $root = [IO.Path]::GetFullPath(
      $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SelfTestBackupRoot)
    ).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName($root).TrimEnd('\') -ne $anchor -or
        [IO.Path]::GetFileName($root) -notmatch '^WeddingHanbang-Amora-Backup-SelfTest-[A-Fa-f0-9]{8,64}$') {
      throw 'Self-test backup root must be a uniquely named direct child of the temp directory.'
    }
  } else {
    if (-not [string]::IsNullOrWhiteSpace($SelfTestBackupRoot)) {
      throw '-SelfTestBackupRoot is allowed only with -SelfTest.'
    }
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
      throw 'LOCALAPPDATA is unavailable for the fixed private backup root.'
    }
    $anchor = [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\')
    $root = [IO.Path]::GetFullPath(
      (Join-Path $anchor 'WeddingHanbang\PrivateBackups\amora-openai')
    ).TrimEnd('\')
  }
  Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $root -Anchor $anchor
  return [pscustomobject]@{ Root = $root; Anchor = $anchor }
}

function Initialize-HBAM2BackupRoot {
  param(
    [Parameter(Mandatory = $true)] [string] $Root,
    [Parameter(Mandatory = $true)] [string] $Anchor
  )

  Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $Root -Anchor $Anchor
  $marker = Join-Path $Root $script:HBAM2RootMarkerName
  if (Test-Path -LiteralPath $Root) {
    if (-not (Test-Path -LiteralPath $Root -PathType Container) -or
        -not (Test-Path -LiteralPath $marker -PathType Leaf)) {
      throw 'Existing backup root is not a marked HBAM2 private root.'
    }
    Assert-HBAM2PrivateDirectoryAcl -Path $Root
    Assert-HBAM2PrivateFileAcl -Path $marker
    $markerBytes = Read-HBAM2BoundedFileBytes -Path $marker -MaximumBytes 256
    try {
      if ([Text.Encoding]::UTF8.GetString($markerBytes) -ne $script:HBAM2RootMarkerContent) {
        throw 'Existing backup root marker is invalid.'
      }
    } finally {
      [Array]::Clear($markerBytes, 0, $markerBytes.Length)
    }
    return
  }

  [IO.Directory]::CreateDirectory($Root) | Out-Null
  Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $Root -Anchor $Anchor
  Set-HBAM2PrivateDirectoryAcl -Path $Root
  [IO.File]::WriteAllText($marker, $script:HBAM2RootMarkerContent, [Text.UTF8Encoding]::new($false))
  Assert-HBAM2PrivateFileAcl -Path $marker
}

function Assert-HBAM2BackupRoot {
  param(
    [Parameter(Mandatory = $true)] [string] $Root,
    [Parameter(Mandatory = $true)] [string] $Anchor
  )

  Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $Root -Anchor $Anchor
  $marker = Join-Path $Root $script:HBAM2RootMarkerName
  if (-not (Test-Path -LiteralPath $Root -PathType Container) -or
      -not (Test-Path -LiteralPath $marker -PathType Leaf)) {
    throw 'Backup root is missing its HBAM2 private-root marker.'
  }
  Assert-HBAM2PrivateDirectoryAcl -Path $Root
  Assert-HBAM2PrivateFileAcl -Path $marker
  $markerBytes = Read-HBAM2BoundedFileBytes -Path $marker -MaximumBytes 256
  try {
    if ([Text.Encoding]::UTF8.GetString($markerBytes) -ne $script:HBAM2RootMarkerContent) {
      throw 'Backup root marker is invalid.'
    }
  } finally {
    [Array]::Clear($markerBytes, 0, $markerBytes.Length)
  }
}

function New-HBAM2CaptureLock {
  param([Parameter(Mandatory = $true)] [string] $Root)

  $path = Join-Path $Root '.amora-backup-capture-v2.lock'
  $stream = $null
  try {
    $stream = [IO.File]::Open(
      $path,
      [IO.FileMode]::OpenOrCreate,
      [IO.FileAccess]::ReadWrite,
      [IO.FileShare]::None
    )
    $expected = [Text.Encoding]::UTF8.GetBytes('HBAM2 exclusive capture lock v1')
    try {
      if ($stream.Length -eq 0) {
        $stream.Write($expected, 0, $expected.Length)
        $stream.Flush($true)
      } elseif ($stream.Length -ne $expected.Length) {
        throw 'Backup capture lock marker has an invalid length.'
      } else {
        $actual = New-Object byte[] $expected.Length
        $stream.Position = 0
        $read = $stream.Read($actual, 0, $actual.Length)
        if ($read -ne $actual.Length -or
            ([BitConverter]::ToString($actual)) -ne ([BitConverter]::ToString($expected))) {
          throw 'Backup capture lock marker is invalid.'
        }
        [Array]::Clear($actual, 0, $actual.Length)
      }
    } finally {
      [Array]::Clear($expected, 0, $expected.Length)
      $stream.Position = 0
    }
    Assert-HBAM2PrivateFileAcl -Path $path
    return $stream
  } catch {
    if ($stream) { $stream.Dispose() }
    throw 'Another backup capture is active or the exclusive capture lock is invalid.'
  }
}

function Read-HBAM2BoundedFileBytes {
  param(
    [Parameter(Mandatory = $true)] [string] $Path,
    [Parameter(Mandatory = $true)] [int64] $MaximumBytes
  )

  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
  try {
    if ($stream.Length -lt 1 -or $stream.Length -gt $MaximumBytes -or $stream.Length -gt [int]::MaxValue) {
      throw 'Backup file length is outside its configured bound.'
    }
    $bytes = New-Object byte[] ([int]$stream.Length)
    $offset = 0
    while ($offset -lt $bytes.Length) {
      $read = $stream.Read($bytes, $offset, $bytes.Length - $offset)
      if ($read -le 0) { throw 'Backup file ended before its declared length.' }
      $offset += $read
    }
    if ($stream.ReadByte() -ne -1) { throw 'Backup file changed while it was read.' }
    return ,$bytes
  } finally {
    $stream.Dispose()
  }
}

function Get-HBAM2ImplementationRelativePaths {
  return @(
    'apps/web/scripts/amora-db-jsonb-roundtrip.mjs',
    'apps/web/package.json',
    'package.json',
    'pnpm-lock.yaml',
    'scripts/amora-db-backup-common.ps1',
    'scripts/amora-db-backup.ps1',
    'scripts/provenance/amora-verifier-runtime.json',
    'scripts/amora-db-verify-backup.ps1',
    'scripts/sql/amora-db-inventory.sql',
    'scripts/sql/amora-db-logical-backup.sql',
    'scripts/sql/amora-db-preflight.sql'
  )
}

function Assert-HBAM2ReadOnlySqlSafetyGuard {
  param([Parameter(Mandatory = $true)] [string] $Path)

  $sql = [IO.File]::ReadAllText($Path)
  $beginCount = [Regex]::Matches($sql, '(?i)\bbegin\s+transaction\b').Count
  $beginTokenCount = [Regex]::Matches($sql, '(?i)\bbegin\b').Count
  $commitCount = [Regex]::Matches($sql, '(?i)\bcommit\s*;').Count
  $commitTokenCount = [Regex]::Matches($sql, '(?i)\bcommit\b').Count
  $escapeCount = [Regex]::Matches(
    $sql,
    '(?i)\brollback\b|\babort\b|\bend\s*;|\bstart\s+transaction\b|' +
    '\bset\s+transaction\b|\bprepare\s+transaction\b|\bbegin\s*;|' +
    '\bsavepoint\b|\brelease\s+savepoint\b|\bend\s+(transaction|work)\b'
  ).Count
  if ($sql.Length -gt 1048576 -or
      $beginCount -ne 1 -or
      $beginTokenCount -ne 1 -or
      $commitCount -ne 1 -or
      $commitTokenCount -ne 1 -or
      $escapeCount -ne 0 -or
      $sql -notmatch (
      "(?is)^\s*begin transaction read only;\s*" +
      "set local statement_timeout = '120s';\s*" +
      "set local lock_timeout = '5s';\s*" +
      "set local row_security = off;[\s\S]*;\s*commit;\s*$"
    )) {
    throw 'Backup SQL is missing the exact server-side read-only timeout guard.'
  }
}

function Assert-HBAM2RelationShapes {
  param(
    [Parameter(Mandatory = $true)] $Relations,
    [Parameter(Mandatory = $true)] [string[]] $ExpectedNames,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  $items = @($Relations)
  $actualNames = @($items | ForEach-Object { [string]$_.name } | Sort-Object)
  $sortedExpected = @($ExpectedNames | Sort-Object)
  if ($items.Count -ne $sortedExpected.Count -or
      @(Compare-Object -ReferenceObject $sortedExpected -DifferenceObject $actualNames).Count -ne 0) {
    throw "$Label relation allowlist mismatch."
  }
  foreach ($relation in $items) {
    foreach ($field in @(
      'name', 'relation_oid', 'relkind',
      'has_inheritance_children', 'is_inheritance_child'
    )) {
      if (-not $relation.PSObject.Properties[$field]) {
        throw "$Label relation metadata is missing $field."
      }
    }
    if ([string]$relation.relation_oid -notmatch '^[1-9][0-9]{0,9}$' -or
        [uint64]$relation.relation_oid -gt [uint64]4294967295 -or
        [string]$relation.relkind -ne 'r' -or
        [bool]$relation.has_inheritance_children -or
        [bool]$relation.is_inheritance_child) {
      throw "$Label relation is not one standalone ordinary table."
    }
  }
}

function Get-HBAM2RelationContractSha256 {
  param(
    [Parameter(Mandatory = $true)] $Relations,
    [Parameter(Mandatory = $true)] [string[]] $ExpectedNames,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  Assert-HBAM2RelationShapes `
    -Relations $Relations `
    -ExpectedNames $ExpectedNames `
    -Label $Label
  $contract = @($Relations | Sort-Object { [string]$_.name } | ForEach-Object {
    [ordered]@{
      name = [string]$_.name
      relation_oid = [string]$_.relation_oid
      relkind = [string]$_.relkind
      has_inheritance_children = [bool]$_.has_inheritance_children
      is_inheritance_child = [bool]$_.is_inheritance_child
    }
  })
  $bytes = [Text.Encoding]::UTF8.GetBytes(($contract | ConvertTo-Json -Depth 5 -Compress))
  try { return Get-HBAM2Sha256Hex -Bytes $bytes }
  finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Get-HBAM2LogicalDataContractSha256 {
  param(
    [Parameter(Mandatory = $true)] $Tables,
    [Parameter(Mandatory = $true)] [string[]] $ExpectedNames,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  $properties = @($Tables.PSObject.Properties | Sort-Object Name)
  $actualNames = @($properties | ForEach-Object { [string]$_.Name })
  $sortedExpected = @($ExpectedNames | Sort-Object)
  if ($properties.Count -ne $sortedExpected.Count -or
      @(Compare-Object -ReferenceObject $sortedExpected -DifferenceObject $actualNames).Count -ne 0) {
    throw "$Label logical-data allowlist mismatch."
  }

  $contract = @($properties | ForEach-Object {
    $table = $_.Value
    if (-not $table.PSObject.Properties['row_count'] -or
        -not $table.PSObject.Properties['canonical_sha256'] -or
        [string]$table.row_count -notmatch '^(0|[1-9][0-9]{0,18})$' -or
        [string]$table.canonical_sha256 -notmatch '^[A-Fa-f0-9]{64}$') {
      throw "$Label logical-data contract metadata is invalid for $($_.Name)."
    }
    try { $rowCount = [int64]$table.row_count }
    catch { throw "$Label logical-data row count is outside int64 for $($_.Name)." }
    if ($rowCount -lt 0) {
      throw "$Label logical-data row count is negative for $($_.Name)."
    }
    [ordered]@{
      name = [string]$_.Name
      row_count = $rowCount
      canonical_sha256 = ([string]$table.canonical_sha256).ToUpperInvariant()
    }
  })
  $bytes = [Text.Encoding]::UTF8.GetBytes(($contract | ConvertTo-Json -Depth 5 -Compress))
  try { return Get-HBAM2Sha256Hex -Bytes $bytes }
  finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Get-HBAM2StreamSha256Hex {
  param([Parameter(Mandatory = $true)] [IO.FileStream] $Stream)

  if ($Stream.Length -lt 1 -or $Stream.Length -gt 1048576 -or $Stream.Length -gt [int]::MaxValue) {
    throw 'Backup implementation file is outside its size bound.'
  }
  $Stream.Position = 0
  $bytes = New-Object byte[] ([int]$Stream.Length)
  $offset = 0
  while ($offset -lt $bytes.Length) {
    $read = $Stream.Read($bytes, $offset, $bytes.Length - $offset)
    if ($read -le 0) { throw 'Backup implementation file changed while it was read.' }
    $offset += $read
  }
  try { return Get-HBAM2Sha256Hex -Bytes $bytes }
  finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
    $Stream.Position = 0
  }
}

function Get-HBAM2GitState {
  param([Parameter(Mandatory = $true)] [string] $RepoRoot)

  $git = (Get-Command git.exe -ErrorAction Stop).Source
  $headLines = @(& $git -C $RepoRoot rev-parse HEAD 2>$null)
  if ($LASTEXITCODE -ne 0 -or $headLines.Count -ne 1 -or
      [string]$headLines[0] -notmatch '^[a-f0-9]{40}$') {
    throw 'Could not resolve a canonical Git commit for backup provenance.'
  }
  $statusLines = @(& $git -C $RepoRoot status --porcelain=v1 --untracked-files=all 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'Could not verify Git worktree cleanliness.' }
  return [pscustomobject]@{
    Commit = ([string]$headLines[0]).Trim()
    Clean = @($statusLines | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count -eq 0
  }
}

function New-HBAM2ImplementationFence {
  param(
    [Parameter(Mandatory = $true)] [string] $RepoRoot,
    [Parameter(Mandatory = $true)] [bool] $SelfTest
  )

  $gitState = Get-HBAM2GitState -RepoRoot $RepoRoot
  if (-not $SelfTest -and -not $gitState.Clean) {
    throw 'Production backup requires a clean committed Git worktree.'
  }
  $streams = [Collections.Generic.List[IO.FileStream]]::new()
  $files = [ordered]@{}
  $gitBlobs = [ordered]@{}
  try {
    foreach ($relativePath in @(Get-HBAM2ImplementationRelativePaths)) {
      $nativeRelative = $relativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)
      $path = [IO.Path]::GetFullPath((Join-Path $RepoRoot $nativeRelative))
      $rootPrefix = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\') + '\'
      if (-not $path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
          -not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw 'Backup implementation provenance path escaped or is missing.'
      }
      $stream = [IO.File]::Open(
        $path,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::Read
      )
      $streams.Add($stream)
      $files[$relativePath] = Get-HBAM2StreamSha256Hex -Stream $stream
      if (-not $SelfTest) {
        $gitBlobs[$relativePath] = Get-HBAM2GitBlobSha256Hex `
          -RepoRoot $RepoRoot `
          -Commit $gitState.Commit `
          -RelativePath $relativePath
      }
    }
    return [pscustomobject]@{
      Streams = $streams
      Provenance = [ordered]@{
        git_commit = $gitState.Commit
        tree_clean = [bool]$gitState.Clean
        self_test = $SelfTest
        files = $files
        git_blobs = $gitBlobs
      }
    }
  } catch {
    foreach ($stream in $streams) { $stream.Dispose() }
    throw
  }
}

function Assert-HBAM2ImplementationFence {
  param(
    [Parameter(Mandatory = $true)] $Fence,
    [Parameter(Mandatory = $true)] [string] $RepoRoot,
    [Parameter(Mandatory = $true)] [bool] $SelfTest
  )

  $gitState = Get-HBAM2GitState -RepoRoot $RepoRoot
  if ($gitState.Commit -ne [string]$Fence.Provenance.git_commit -or
      (-not $SelfTest -and -not $gitState.Clean)) {
    throw 'Git provenance changed while the backup implementation fence was held.'
  }
  $relativePaths = @(Get-HBAM2ImplementationRelativePaths)
  if ($Fence.Streams.Count -ne $relativePaths.Count -or
      @($Fence.Provenance.files.Keys).Count -ne $relativePaths.Count) {
    throw 'Backup implementation provenance file set is incomplete.'
  }
  for ($index = 0; $index -lt $relativePaths.Count; $index++) {
    $relativePath = $relativePaths[$index]
    if ((Get-HBAM2StreamSha256Hex -Stream $Fence.Streams[$index]) -ne
        [string]$Fence.Provenance.files[$relativePath]) {
      throw 'Backup implementation changed while its source fence was held.'
    }
  }
}

function Close-HBAM2ImplementationFence {
  param($Fence)

  if ($Fence -and $Fence.Streams) {
    foreach ($stream in $Fence.Streams) { $stream.Dispose() }
  }
}

function Get-HBAM2ObjectPropertyNames {
  param([Parameter(Mandatory = $true)] $Value)

  if ($Value -is [Collections.IDictionary]) { return @($Value.Keys) }
  return @($Value.PSObject.Properties | ForEach-Object { [string]$_.Name })
}

function Get-HBAM2ObjectPropertyValue {
  param(
    [Parameter(Mandatory = $true)] $Value,
    [Parameter(Mandatory = $true)] [string] $Name
  )

  if ($Value -is [Collections.IDictionary]) { return $Value[$Name] }
  $property = $Value.PSObject.Properties[$Name]
  if (-not $property) { return $null }
  return $property.Value
}

function Get-HBAM2GitBlobSha256Hex {
  param(
    [Parameter(Mandatory = $true)] [string] $RepoRoot,
    [Parameter(Mandatory = $true)] [string] $Commit,
    [Parameter(Mandatory = $true)] [string] $RelativePath
  )

  if ($RepoRoot.Contains('"') -or $RelativePath.Contains('"') -or
      $Commit -notmatch '^[a-f0-9]{40}$') {
    throw 'Git blob provenance arguments are invalid.'
  }
  $git = (Get-Command git.exe -ErrorAction Stop).Source
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $git
  $startInfo.Arguments = "-C `"$RepoRoot`" cat-file blob `"$Commit`:$RelativePath`""
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start Git blob provenance verification.' }
  $sha = [Security.Cryptography.SHA256]::Create()
  $crypto = [Security.Cryptography.CryptoStream]::new(
    [IO.Stream]::Null,
    $sha,
    [Security.Cryptography.CryptoStreamMode]::Write,
    $true
  )
  try {
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $copyTask = $process.StandardOutput.BaseStream.CopyToAsync($crypto)
    if (-not $copyTask.Wait(15000)) {
      $process.Kill()
      throw 'Git blob provenance verification exceeded 15 seconds.'
    }
    [void]$copyTask.GetAwaiter().GetResult()
    $crypto.FlushFinalBlock()
    if (-not $process.WaitForExit(1000)) {
      $process.Kill()
      throw 'Git blob provenance process did not exit after closing stdout.'
    }
    $null = $stderrTask.Result
    if ($process.ExitCode -ne 0) {
      throw 'A recorded backup implementation file is absent from its Git commit.'
    }
    return ([BitConverter]::ToString($sha.Hash)).Replace('-', '')
  } finally {
    $crypto.Dispose()
    $sha.Dispose()
    $process.Dispose()
  }
}

function Assert-HBAM2ImplementationProvenance {
  param(
    [Parameter(Mandatory = $true)] $Recorded,
    [Parameter(Mandatory = $true)] $CurrentFence,
    [Parameter(Mandatory = $true)] [string] $RepoRoot,
    [Parameter(Mandatory = $true)] [bool] $SelfTest
  )

  foreach ($field in @('git_commit', 'tree_clean', 'self_test', 'files', 'git_blobs')) {
    if (-not $Recorded.PSObject.Properties[$field] -and
        -not ($Recorded -is [Collections.IDictionary] -and $Recorded.Contains($field))) {
      throw "Backup implementation provenance is missing $field."
    }
  }
  $recordedCommit = [string](Get-HBAM2ObjectPropertyValue -Value $Recorded -Name 'git_commit')
  $recordedClean = [bool](Get-HBAM2ObjectPropertyValue -Value $Recorded -Name 'tree_clean')
  $recordedSelfTest = [bool](Get-HBAM2ObjectPropertyValue -Value $Recorded -Name 'self_test')
  $recordedFiles = Get-HBAM2ObjectPropertyValue -Value $Recorded -Name 'files'
  $recordedGitBlobs = Get-HBAM2ObjectPropertyValue -Value $Recorded -Name 'git_blobs'
  if ($recordedCommit -notmatch '^[a-f0-9]{40}$' -or
      $recordedSelfTest -ne $SelfTest -or
      (-not $SelfTest -and -not $recordedClean) -or
      -not $recordedFiles) {
    throw 'Backup implementation provenance has an invalid safety contract.'
  }

  $git = (Get-Command git.exe -ErrorAction Stop).Source
  & $git -C $RepoRoot cat-file -e "$recordedCommit`^{commit}" 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw 'The recorded backup implementation Git commit is unavailable locally.'
  }

  $expectedPaths = @(Get-HBAM2ImplementationRelativePaths | Sort-Object)
  $recordedPaths = @(Get-HBAM2ObjectPropertyNames -Value $recordedFiles | Sort-Object)
  if ($recordedPaths.Count -ne $expectedPaths.Count -or
      @(Compare-Object -ReferenceObject $expectedPaths -DifferenceObject $recordedPaths).Count -ne 0) {
    throw 'Backup implementation provenance file set is not exact.'
  }
  foreach ($relativePath in $expectedPaths) {
    $recordedHash = [string](Get-HBAM2ObjectPropertyValue -Value $recordedFiles -Name $relativePath)
    $currentHash = [string]$CurrentFence.Provenance.files[$relativePath]
    if ($recordedHash -notmatch '^[A-F0-9]{64}$' -or $recordedHash -ne $currentHash) {
      throw 'The current backup implementation does not match the recorded source provenance.'
    }
  }
  $recordedGitPaths = @(Get-HBAM2ObjectPropertyNames -Value $recordedGitBlobs | Sort-Object)
  if ($SelfTest) {
    if ($recordedGitPaths.Count -ne 0) {
      throw 'Self-test implementation provenance must not claim committed Git blobs.'
    }
    return
  }
  if ($recordedGitPaths.Count -ne $expectedPaths.Count -or
      @(Compare-Object -ReferenceObject $expectedPaths -DifferenceObject $recordedGitPaths).Count -ne 0) {
    throw 'Recorded Git blob provenance file set is not exact.'
  }
  foreach ($relativePath in $expectedPaths) {
    $recordedBlobHash = [string](Get-HBAM2ObjectPropertyValue -Value $recordedGitBlobs -Name $relativePath)
    $currentBlobHash = [string]$CurrentFence.Provenance.git_blobs[$relativePath]
    $commitBlobHash = Get-HBAM2GitBlobSha256Hex `
      -RepoRoot $RepoRoot `
      -Commit $recordedCommit `
      -RelativePath $relativePath
    if ($recordedBlobHash -notmatch '^[A-F0-9]{64}$' -or
        $recordedBlobHash -ne $currentBlobHash -or
        $recordedBlobHash -ne $commitBlobHash) {
      throw 'Recorded Git blob provenance does not match the commit or current implementation.'
    }
  }
}

function Get-HBAM2BoundedStreamSha256Hex {
  param(
    [Parameter(Mandatory = $true)] [IO.FileStream] $Stream,
    [Parameter(Mandatory = $true)] [int64] $MaximumBytes
  )

  if ($Stream.Length -lt 1 -or $Stream.Length -gt $MaximumBytes) {
    throw 'Supabase CLI provenance file is outside its size bound.'
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $Stream.Position = 0
    return ([BitConverter]::ToString($sha.ComputeHash($Stream))).Replace('-', '')
  } finally {
    $sha.Dispose()
    $Stream.Position = 0
  }
}

function Invoke-HBAM2VersionProbe {
  param(
    [Parameter(Mandatory = $true)] [string] $Executable,
    [Parameter(Mandatory = $true)] [string] $ExpectedVersion
  )

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $Executable
  $startInfo.Arguments = '--version'
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start the pinned Supabase CLI version probe.' }
  try {
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(15000)) {
      $process.Kill()
      throw 'Pinned Supabase CLI version probe exceeded 15 seconds.'
    }
    $process.WaitForExit()
    $actual = $stdoutTask.Result.Trim()
    $null = $stderrTask.Result
    if ($process.ExitCode -ne 0 -or $actual -ne $ExpectedVersion) {
      throw 'Pinned Supabase CLI binary version does not match the committed dependency.'
    }
  } finally { $process.Dispose() }
}

function New-HBAM2SupabaseCliFence {
  param(
    [Parameter(Mandatory = $true)] [string] $RepoRoot,
    [Parameter(Mandatory = $true)] [string] $RequestedCli,
    [Parameter(Mandatory = $true)] [bool] $SelfTest
  )

  $streams = [Collections.Generic.List[IO.FileStream]]::new()
  try {
    if ($SelfTest) {
      $command = Get-Command $RequestedCli -ErrorAction Stop
      $path = [IO.Path]::GetFullPath([string]$command.Source)
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw 'Self-test Supabase CLI must resolve to a concrete file.'
      }
      $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      $streams.Add($stream)
      return [pscustomobject]@{
        Streams = $streams
        InvocationPath = $path
        Provenance = [ordered]@{
          mode = 'self-test-fake'
          version = 'self-test'
          platform = 'windows-self-test'
          invocation_relative_path = 'self-test-cli'
          files = [ordered]@{
            'self-test-cli' = Get-HBAM2BoundedStreamSha256Hex -Stream $stream -MaximumBytes 1048576
          }
        }
      }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:SUPABASE_CLI_BINARY_OVERRIDE)) {
      throw 'Production backup refuses SUPABASE_CLI_BINARY_OVERRIDE.'
    }
    $rootPackagePath = Join-Path $RepoRoot 'package.json'
    $lockPath = Join-Path $RepoRoot 'pnpm-lock.yaml'
    $rootPackage = ([IO.File]::ReadAllText($rootPackagePath)) | ConvertFrom-Json
    $version = [string]$rootPackage.devDependencies.supabase
    if ($version -notmatch '^\d+\.\d+\.\d+$') {
      throw 'Supabase CLI must be pinned to an exact version in package.json.'
    }
    $escapedVersion = [Regex]::Escape($version)
    $lockText = [IO.File]::ReadAllText($lockPath)
    if ($lockText -notmatch "(?ms)^\s+supabase:\s*\r?\n\s+specifier:\s*$escapedVersion\s*\r?\n\s+version:\s*$escapedVersion\s*$") {
      throw 'pnpm-lock.yaml does not pin the declared Supabase CLI version.'
    }
    $architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    if ($architecture -notin @('x64', 'arm64')) {
      throw 'Production backup supports only Windows x64 or arm64 Supabase CLI binaries.'
    }
    $launcherPath = [IO.Path]::GetFullPath((Join-Path $RepoRoot 'node_modules\.bin\supabase.CMD'))
    if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
      throw 'The repo-local Supabase CLI launcher is missing.'
    }
    if ($RequestedCli -ne 'supabase') {
      $requestedPath = [IO.Path]::GetFullPath([string](Get-Command $RequestedCli -ErrorAction Stop).Source)
      if (-not [string]::Equals($requestedPath, $launcherPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Production -SupabaseCli must be the exact repo-local .CMD launcher.'
      }
    }

    $packageRelative = "node_modules/.pnpm/supabase@$version/node_modules/supabase/package.json"
    $distRelative = "node_modules/.pnpm/supabase@$version/node_modules/supabase/dist/supabase.js"
    $platformPackageRelative = "node_modules/.pnpm/@supabase+cli-windows-$architecture@$version/node_modules/@supabase/cli-windows-$architecture/package.json"
    $binaryRelative = "node_modules/.pnpm/@supabase+cli-windows-$architecture@$version/node_modules/@supabase/cli-windows-$architecture/bin/supabase.exe"
    $paths = [ordered]@{
      'node_modules/.bin/supabase.CMD' = $launcherPath
      $packageRelative = [IO.Path]::GetFullPath((Join-Path $RepoRoot $packageRelative.Replace('/', '\')))
      $distRelative = [IO.Path]::GetFullPath((Join-Path $RepoRoot $distRelative.Replace('/', '\')))
      $platformPackageRelative = [IO.Path]::GetFullPath((Join-Path $RepoRoot $platformPackageRelative.Replace('/', '\')))
      $binaryRelative = [IO.Path]::GetFullPath((Join-Path $RepoRoot $binaryRelative.Replace('/', '\')))
    }
    $files = [ordered]@{}
    foreach ($entry in $paths.GetEnumerator()) {
      if (-not (Test-Path -LiteralPath $entry.Value -PathType Leaf)) {
        throw 'A pinned Supabase CLI provenance file is missing.'
      }
      $stream = [IO.File]::Open($entry.Value, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      $streams.Add($stream)
      $maximum = if ($entry.Key -eq $binaryRelative) { 268435456 } else { 1048576 }
      $files[$entry.Key] = Get-HBAM2BoundedStreamSha256Hex -Stream $stream -MaximumBytes $maximum
    }
    $installedPackage = ([IO.File]::ReadAllText($paths[$packageRelative])) | ConvertFrom-Json
    $platformPackage = ([IO.File]::ReadAllText($paths[$platformPackageRelative])) | ConvertFrom-Json
    if ([string]$installedPackage.version -ne $version -or
        [string]$platformPackage.version -ne $version -or
        [string]$platformPackage.name -ne "@supabase/cli-windows-$architecture") {
      throw 'Installed Supabase CLI packages do not match the committed version and platform.'
    }
    Invoke-HBAM2VersionProbe -Executable $paths[$binaryRelative] -ExpectedVersion $version
    return [pscustomobject]@{
      Streams = $streams
      InvocationPath = $paths[$binaryRelative]
      Provenance = [ordered]@{
        mode = 'repo-local-pnpm-direct-binary'
        version = $version
        platform = "windows-$architecture"
        invocation_relative_path = $binaryRelative
        files = $files
      }
    }
  } catch {
    foreach ($stream in $streams) { $stream.Dispose() }
    throw
  }
}

function Assert-HBAM2SupabaseCliFence {
  param([Parameter(Mandatory = $true)] $Fence)

  $paths = @(Get-HBAM2ObjectPropertyNames -Value $Fence.Provenance.files)
  if ($paths.Count -ne $Fence.Streams.Count) {
    throw 'Supabase CLI provenance file set is incomplete.'
  }
  for ($index = 0; $index -lt $paths.Count; $index++) {
    $maximum = if ($paths[$index] -match '/bin/supabase\.exe$') { 268435456 } else { 1048576 }
    $actual = Get-HBAM2BoundedStreamSha256Hex -Stream $Fence.Streams[$index] -MaximumBytes $maximum
    $expected = [string](Get-HBAM2ObjectPropertyValue -Value $Fence.Provenance.files -Name $paths[$index])
    if ($actual -ne $expected) { throw 'Supabase CLI changed while its provenance fence was held.' }
  }
}

function Assert-HBAM2SupabaseCliProvenance {
  param(
    [Parameter(Mandatory = $true)] $Recorded,
    $CurrentFence,
    [Parameter(Mandatory = $true)] [bool] $SelfTest
  )

  foreach ($field in @('mode', 'version', 'platform', 'invocation_relative_path', 'files')) {
    if (-not $Recorded.PSObject.Properties[$field] -and
        -not ($Recorded -is [Collections.IDictionary] -and $Recorded.Contains($field))) {
      throw "Supabase CLI provenance is missing $field."
    }
  }
  $recordedMode = [string](Get-HBAM2ObjectPropertyValue -Value $Recorded -Name 'mode')
  $recordedFiles = Get-HBAM2ObjectPropertyValue -Value $Recorded -Name 'files'
  $recordedNames = @(Get-HBAM2ObjectPropertyNames -Value $recordedFiles | Sort-Object)
  if ($SelfTest) {
    if ($recordedMode -ne 'self-test-fake' -or $recordedNames.Count -ne 1 -or
        [string](Get-HBAM2ObjectPropertyValue -Value $Recorded -Name 'version') -ne 'self-test') {
      throw 'Self-test Supabase CLI provenance is invalid.'
    }
    $selfTestHash = [string](Get-HBAM2ObjectPropertyValue -Value $recordedFiles -Name $recordedNames[0])
    if ($selfTestHash -notmatch '^[A-F0-9]{64}$') { throw 'Self-test Supabase CLI hash is invalid.' }
    return
  }
  if (-not $CurrentFence -or $recordedMode -ne 'repo-local-pnpm-direct-binary') {
    throw 'Production Supabase CLI provenance is unavailable or unsupported.'
  }
  foreach ($field in @('version', 'platform', 'invocation_relative_path')) {
    if ([string](Get-HBAM2ObjectPropertyValue -Value $Recorded -Name $field) -ne
        [string](Get-HBAM2ObjectPropertyValue -Value $CurrentFence.Provenance -Name $field)) {
      throw 'Current Supabase CLI does not match the recorded provenance.'
    }
  }
  $currentNames = @(Get-HBAM2ObjectPropertyNames -Value $CurrentFence.Provenance.files | Sort-Object)
  if ($recordedNames.Count -ne $currentNames.Count -or
      @(Compare-Object -ReferenceObject $currentNames -DifferenceObject $recordedNames).Count -ne 0) {
    throw 'Recorded Supabase CLI provenance file set is not exact.'
  }
  foreach ($name in $currentNames) {
    $recordedHash = [string](Get-HBAM2ObjectPropertyValue -Value $recordedFiles -Name $name)
    $currentHash = [string](Get-HBAM2ObjectPropertyValue -Value $CurrentFence.Provenance.files -Name $name)
    if ($recordedHash -notmatch '^[A-F0-9]{64}$' -or $recordedHash -ne $currentHash) {
      throw 'Current Supabase CLI file hashes do not match the backup provenance.'
    }
  }
}

function Close-HBAM2SupabaseCliFence {
  param($Fence)

  if ($Fence -and $Fence.Streams) {
    foreach ($stream in $Fence.Streams) { $stream.Dispose() }
  }
}

function Get-HBAM2VerifierRuntimeContract {
  param([Parameter(Mandatory = $true)] [string] $RepoRoot)

  $path = Join-Path $RepoRoot 'scripts\provenance\amora-verifier-runtime.json'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
      (Get-Item -LiteralPath $path).Length -gt 8192) {
    throw 'Trusted verifier runtime contract is missing or oversized.'
  }
  try { $contract = ([IO.File]::ReadAllText($path)) | ConvertFrom-Json }
  catch { throw 'Trusted verifier runtime contract is invalid JSON.' }
  foreach ($field in @('format_version', 'node', 'pglite')) {
    if (-not $contract.PSObject.Properties[$field]) {
      throw "Trusted verifier runtime contract is missing $field."
    }
  }
  foreach ($field in @('absolute_path', 'version', 'bytes', 'sha256')) {
    if (-not $contract.node.PSObject.Properties[$field]) {
      throw "Trusted Node runtime contract is missing $field."
    }
  }
  foreach ($field in @(
    'version', 'package_relative_path', 'entry_relative_path',
    'file_count', 'total_bytes', 'tree_sha256'
  )) {
    if (-not $contract.pglite.PSObject.Properties[$field]) {
      throw "Trusted PGlite runtime contract is missing $field."
    }
  }
  if ([int]$contract.format_version -ne 1 -or
      -not [IO.Path]::IsPathRooted([string]$contract.node.absolute_path) -or
      [string]$contract.node.version -notmatch '^v\d+\.\d+\.\d+$' -or
      [int64]$contract.node.bytes -lt 1048576 -or
      [int64]$contract.node.bytes -gt 134217728 -or
      [string]$contract.node.sha256 -notmatch '^[A-F0-9]{64}$' -or
      [string]$contract.pglite.version -notmatch '^\d+\.\d+\.\d+$' -or
      [string]$contract.pglite.package_relative_path -notmatch '^node_modules/\.pnpm/@electric-sql\+pglite@\d+\.\d+\.\d+/node_modules/@electric-sql/pglite$' -or
      [string]$contract.pglite.entry_relative_path -notmatch '^dist/[A-Za-z0-9._/-]+\.js$' -or
      [int]$contract.pglite.file_count -lt 1 -or
      [int]$contract.pglite.file_count -gt 512 -or
      [int64]$contract.pglite.total_bytes -lt 1 -or
      [int64]$contract.pglite.total_bytes -gt 67108864 -or
      [string]$contract.pglite.tree_sha256 -notmatch '^[A-F0-9]{64}$') {
    throw 'Trusted verifier runtime contract is outside its safety bounds.'
  }
  $webPackage = ([IO.File]::ReadAllText((Join-Path $RepoRoot 'apps\web\package.json'))) | ConvertFrom-Json
  if ([string]$webPackage.devDependencies.'@electric-sql/pglite' -ne [string]$contract.pglite.version) {
    throw 'apps/web/package.json does not exactly pin the trusted PGlite version.'
  }
  $escapedVersion = [Regex]::Escape([string]$contract.pglite.version)
  $lockText = [IO.File]::ReadAllText((Join-Path $RepoRoot 'pnpm-lock.yaml'))
  if ($lockText -notmatch "(?m)^\s{6}'@electric-sql/pglite':\s*\r?\n\s{8}specifier:\s*$escapedVersion\s*\r?\n\s{8}version:\s*$escapedVersion\s*$") {
    throw 'pnpm-lock.yaml does not pin the trusted PGlite version for apps/web.'
  }
  return $contract
}

function Assert-HBAM2VerifierRuntimeContract {
  param(
    [Parameter(Mandatory = $true)] $Recorded,
    [Parameter(Mandatory = $true)] $Expected
  )

  $recordedJson = $Recorded | ConvertTo-Json -Depth 10 -Compress
  $expectedJson = $Expected | ConvertTo-Json -Depth 10 -Compress
  if ($recordedJson -ne $expectedJson) {
    throw 'Backup verifier runtime contract does not match the trusted committed contract.'
  }
}

function Get-HBAM2PGliteTreeSha256Hex {
  param([Parameter(Mandatory = $true)] [object[]] $Descriptors)

  $builder = [Text.StringBuilder]::new()
  foreach ($descriptor in @($Descriptors | Sort-Object RelativePath)) {
    [void]$builder.Append([string]$descriptor.RelativePath)
    [void]$builder.Append("`t")
    [void]$builder.Append([int64]$descriptor.Length)
    [void]$builder.Append("`t")
    [void]$builder.Append([string]$descriptor.Hash)
    [void]$builder.Append("`n")
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes($builder.ToString())
  try { return Get-HBAM2Sha256Hex -Bytes $bytes }
  finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function New-HBAM2VerifierRuntimeFence {
  param(
    [Parameter(Mandatory = $true)] [string] $RepoRoot,
    [Parameter(Mandatory = $true)] [string] $RequestedNode,
    [Parameter(Mandatory = $true)] [bool] $SelfTest,
    $Contract
  )

  $nodeStream = $null
  $packageStreams = [Collections.Generic.List[IO.FileStream]]::new()
  try {
    if ($SelfTest) {
      $nodePath = [IO.Path]::GetFullPath([string](Get-Command $RequestedNode -ErrorAction Stop).Source)
      $nodeStream = [IO.File]::Open($nodePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      $nodeHash = Get-HBAM2BoundedStreamSha256Hex -Stream $nodeStream -MaximumBytes 134217728
      $entryPath = Join-Path $RepoRoot 'apps\web\node_modules\@electric-sql\pglite\dist\index.js'
      if (-not (Test-Path -LiteralPath $entryPath -PathType Leaf)) {
        throw 'Self-test PGlite entry is missing.'
      }
      return [pscustomobject]@{
        NodeStream = $nodeStream
        PackageStreams = $packageStreams
        Descriptors = @()
        NodePath = $nodePath
        PGliteEntryPath = [IO.Path]::GetFullPath($entryPath)
        Provenance = [ordered]@{
          mode = 'self-test-untrusted-runtime'
          node_version = 'self-test'
          node_sha256 = $nodeHash
          pglite_version = 'self-test'
          pglite_tree_sha256 = 'self-test-untrusted'
        }
      }
    }

    if (-not $Contract) { throw 'Production verifier requires a trusted runtime contract.' }
    foreach ($name in @(
      'NODE_OPTIONS', 'NODE_PATH', 'NODE_COMPILE_CACHE', 'NODE_V8_COVERAGE',
      'NODE_REDIRECT_WARNINGS', 'NODE_CHANNEL_FD'
    )) {
      $value = [Environment]::GetEnvironmentVariable($name)
      if (-not [string]::IsNullOrWhiteSpace($value)) {
        throw "Production verifier refuses inherited $name."
      }
    }
    $expectedNodePath = [IO.Path]::GetFullPath([string]$Contract.node.absolute_path)
    if ($RequestedNode -ne 'node.exe') {
      $requestedPath = [IO.Path]::GetFullPath([string](Get-Command $RequestedNode -ErrorAction Stop).Source)
      if (-not [string]::Equals($requestedPath, $expectedNodePath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Production -NodeCli must be the exact trusted absolute Node runtime.'
      }
    }
    if (-not (Test-Path -LiteralPath $expectedNodePath -PathType Leaf) -or
        ((Get-Item -LiteralPath $expectedNodePath).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'Trusted Node runtime is missing or is a reparse point.'
    }
    $nodeStream = [IO.File]::Open($expectedNodePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $nodeHash = Get-HBAM2BoundedStreamSha256Hex -Stream $nodeStream -MaximumBytes 134217728
    if ($nodeStream.Length -ne [int64]$Contract.node.bytes -or
        $nodeHash -ne [string]$Contract.node.sha256) {
      throw 'Installed Node runtime does not match the trusted size and SHA-256.'
    }
    Invoke-HBAM2VersionProbe -Executable $expectedNodePath -ExpectedVersion ([string]$Contract.node.version)

    $packageRelative = [string]$Contract.pglite.package_relative_path
    $packageRoot = [IO.Path]::GetFullPath((Join-Path $RepoRoot $packageRelative.Replace('/', '\')))
    $repoPrefix = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\') + '\'
    if (-not $packageRoot.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $packageRoot -PathType Container)) {
      throw 'Trusted PGlite package path escaped the repository or is missing.'
    }
    Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $packageRoot -Anchor $RepoRoot
    $reparseDescendants = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -Force | Where-Object {
      ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    })
    if ($reparseDescendants.Count -ne 0) {
      throw 'Trusted PGlite package tree contains a reparse point.'
    }
    $files = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File -Force | Sort-Object FullName)
    if ($files.Count -ne [int]$Contract.pglite.file_count) {
      throw 'Installed PGlite package file count does not match the trusted contract.'
    }
    $descriptors = [Collections.Generic.List[object]]::new()
    $totalBytes = [int64]0
    foreach ($file in $files) {
      if ($file.Length -lt 1 -or $file.Length -gt 16777216) {
        throw 'A PGlite package file is outside its per-file size bound.'
      }
      $totalBytes += [int64]$file.Length
      if ($totalBytes -gt 67108864) { throw 'PGlite package tree exceeds its total size bound.' }
      $stream = [IO.File]::Open($file.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      $packageStreams.Add($stream)
      $relative = $file.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
      $descriptors.Add([pscustomobject]@{
        RelativePath = $relative
        Length = [int64]$file.Length
        Hash = Get-HBAM2BoundedStreamSha256Hex -Stream $stream -MaximumBytes 16777216
      })
    }
    if ($totalBytes -ne [int64]$Contract.pglite.total_bytes -or
        (Get-HBAM2PGliteTreeSha256Hex -Descriptors @($descriptors)) -ne
          [string]$Contract.pglite.tree_sha256) {
      throw 'Installed PGlite package tree does not match the trusted byte count and SHA-256.'
    }
    $packageJson = ([IO.File]::ReadAllText((Join-Path $packageRoot 'package.json'))) | ConvertFrom-Json
    if ([string]$packageJson.name -ne '@electric-sql/pglite' -or
        [string]$packageJson.version -ne [string]$Contract.pglite.version) {
      throw 'Installed PGlite package identity does not match the trusted contract.'
    }
    $entryPath = [IO.Path]::GetFullPath((Join-Path $packageRoot ([string]$Contract.pglite.entry_relative_path).Replace('/', '\')))
    if (-not $entryPath.StartsWith(($packageRoot.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $entryPath -PathType Leaf)) {
      throw 'Trusted PGlite entry path escaped the pinned package.'
    }
    return [pscustomobject]@{
      NodeStream = $nodeStream
      PackageStreams = $packageStreams
      Descriptors = @($descriptors)
      NodePath = $expectedNodePath
      PGliteEntryPath = $entryPath
      Provenance = [ordered]@{
        mode = 'trusted-node-and-pglite-tree'
        node_version = [string]$Contract.node.version
        node_sha256 = $nodeHash
        pglite_version = [string]$Contract.pglite.version
        pglite_file_count = $files.Count
        pglite_total_bytes = $totalBytes
        pglite_tree_sha256 = [string]$Contract.pglite.tree_sha256
      }
    }
  } catch {
    if ($nodeStream) { $nodeStream.Dispose() }
    foreach ($stream in $packageStreams) { $stream.Dispose() }
    throw
  }
}

function Assert-HBAM2VerifierRuntimeFence {
  param([Parameter(Mandatory = $true)] $Fence)

  $nodeHash = Get-HBAM2BoundedStreamSha256Hex -Stream $Fence.NodeStream -MaximumBytes 134217728
  if ($nodeHash -ne [string]$Fence.Provenance.node_sha256) {
    throw 'Node runtime changed while the verifier fence was held.'
  }
  if ([string]$Fence.Provenance.mode -eq 'self-test-untrusted-runtime') { return }
  if ($Fence.PackageStreams.Count -ne $Fence.Descriptors.Count) {
    throw 'PGlite runtime fence file set is incomplete.'
  }
  $currentDescriptors = [Collections.Generic.List[object]]::new()
  for ($index = 0; $index -lt $Fence.Descriptors.Count; $index++) {
    $descriptor = $Fence.Descriptors[$index]
    $hash = Get-HBAM2BoundedStreamSha256Hex `
      -Stream $Fence.PackageStreams[$index] `
      -MaximumBytes 16777216
    $currentDescriptors.Add([pscustomobject]@{
      RelativePath = [string]$descriptor.RelativePath
      Length = [int64]$Fence.PackageStreams[$index].Length
      Hash = $hash
    })
  }
  if ((Get-HBAM2PGliteTreeSha256Hex -Descriptors @($currentDescriptors)) -ne
      [string]$Fence.Provenance.pglite_tree_sha256) {
    throw 'PGlite package tree changed while the verifier fence was held.'
  }
}

function Close-HBAM2VerifierRuntimeFence {
  param($Fence)

  if ($Fence) {
    if ($Fence.NodeStream) { $Fence.NodeStream.Dispose() }
    if ($Fence.PackageStreams) {
      foreach ($stream in $Fence.PackageStreams) { $stream.Dispose() }
    }
  }
}

function Write-HBAM2BytesAtomically {
  param(
    [Parameter(Mandatory = $true)] [string] $Path,
    [Parameter(Mandatory = $true)] [byte[]] $Bytes
  )

  $partial = "$Path.partial"
  [IO.File]::WriteAllBytes($partial, $Bytes)
  Move-Item -LiteralPath $partial -Destination $Path
}

function Protect-HBAM2Artifact {
  param(
    [Parameter(Mandatory = $true)] [byte[]] $Plaintext,
    [Parameter(Mandatory = $true)] [string] $Directory,
    [Parameter(Mandatory = $true)] [string] $ArtifactName,
    [Parameter(Mandatory = $true)] [string] $ProjectRef,
    [Parameter(Mandatory = $true)] [string] $BackupSetId
  )

  if ($Plaintext.Length -lt 1 -or $Plaintext.Length -gt $script:HBAM2MaximumPayloadBytes) {
    throw 'Backup plaintext exceeds the configured size limit.'
  }
  if ($ArtifactName -notin @('schema-inventory.json', 'logical-data.json')) {
    throw 'Backup artifact name is not allowed.'
  }

  $masterKey = New-Object byte[] 64
  $encKey = New-Object byte[] 32
  $macKey = New-Object byte[] 32
  $iv = New-Object byte[] 16
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $aes = [Security.Cryptography.Aes]::Create()
  try {
    $rng.GetBytes($masterKey)
    $rng.GetBytes($iv)
    [Buffer]::BlockCopy($masterKey, 0, $encKey, 0, 32)
    [Buffer]::BlockCopy($masterKey, 32, $macKey, 0, 32)
    $aes.KeySize = 256
    $aes.BlockSize = 128
    $aes.Mode = [Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
    $aes.Key = $encKey
    $aes.IV = $iv
    $encryptor = $aes.CreateEncryptor()
    try {
      $ciphertext = $encryptor.TransformFinalBlock($Plaintext, 0, $Plaintext.Length)
    } finally {
      $encryptor.Dispose()
    }

    $envelope = Join-HBAM2ByteArrays -Arrays @(
      $script:HBAM2Magic,
      [byte[]]@($script:HBAM2Version),
      ([Guid]::ParseExact($BackupSetId, 'D')).ToByteArray(),
      $iv,
      [BitConverter]::GetBytes([int64]$Plaintext.Length),
      $ciphertext
    )
    $hmac = [Security.Cryptography.HMACSHA256]::new($macKey)
    try { $tag = $hmac.ComputeHash($envelope) } finally { $hmac.Dispose() }
    $artifactBytes = Join-HBAM2ByteArrays -Arrays @($envelope, $tag)
    $entropy = Get-HBAM2Entropy -ProjectRef $ProjectRef -ArtifactName $ArtifactName -BackupSetId $BackupSetId
    $protectedKey = [Security.Cryptography.ProtectedData]::Protect(
      $masterKey, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser
    )

    $artifactPath = Join-Path $Directory "$ArtifactName.hbam2"
    $keyPath = Join-Path $Directory "$ArtifactName.key.dpapi"
    $parent = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($artifactPath)).TrimEnd('\') -ne $parent -or
        [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($keyPath)).TrimEnd('\') -ne $parent) {
      throw 'Backup artifact path escaped the staging directory.'
    }
    Write-HBAM2BytesAtomically -Path $artifactPath -Bytes $artifactBytes
    Write-HBAM2BytesAtomically -Path $keyPath -Bytes $protectedKey

    return [ordered]@{
      backup_set_id = $BackupSetId
      artifact = [IO.Path]::GetFileName($artifactPath)
      key = [IO.Path]::GetFileName($keyPath)
      plaintext_sha256 = Get-HBAM2Sha256Hex -Bytes $Plaintext
      encrypted_sha256 = Get-HBAM2Sha256Hex -Bytes $artifactBytes
      key_sha256 = Get-HBAM2Sha256Hex -Bytes $protectedKey
      plaintext_bytes = $Plaintext.Length
      encrypted_bytes = $artifactBytes.Length
    }
  } finally {
    $rng.Dispose()
    $aes.Dispose()
    [Array]::Clear($masterKey, 0, $masterKey.Length)
    [Array]::Clear($encKey, 0, $encKey.Length)
    [Array]::Clear($macKey, 0, $macKey.Length)
  }
}

function Unprotect-HBAM2Artifact {
  param(
    [Parameter(Mandatory = $true)] [string] $Directory,
    [Parameter(Mandatory = $true)] $Metadata,
    [Parameter(Mandatory = $true)] [string] $ArtifactName,
    [Parameter(Mandatory = $true)] [string] $ProjectRef,
    [Parameter(Mandatory = $true)] [string] $BackupSetId
  )

  foreach ($field in @(
    'backup_set_id', 'artifact', 'key', 'plaintext_sha256',
    'encrypted_sha256', 'key_sha256', 'plaintext_bytes', 'encrypted_bytes'
  )) {
    if (-not $Metadata.PSObject.Properties[$field]) { throw 'Backup artifact metadata is incomplete.' }
  }
  if ([string]$Metadata.plaintext_sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
      [string]$Metadata.encrypted_sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
      [string]$Metadata.key_sha256 -notmatch '^[A-Fa-f0-9]{64}$') {
    throw 'Backup artifact metadata contains an invalid digest.'
  }
  try {
    $plaintextLength = [int64]$Metadata.plaintext_bytes
    $encryptedLength = [int64]$Metadata.encrypted_bytes
  } catch { throw 'Backup artifact metadata contains an invalid length.' }
  if ($plaintextLength -lt 1 -or $plaintextLength -gt $script:HBAM2MaximumPayloadBytes -or
      $encryptedLength -lt 1 -or $encryptedLength -gt ($script:HBAM2MaximumPayloadBytes + 1024)) {
    throw 'Backup artifact metadata exceeds the configured size limit.'
  }

  $artifactFile = "$ArtifactName.hbam2"
  $keyFile = "$ArtifactName.key.dpapi"
  if ([string]$Metadata.artifact -ne $artifactFile -or
      [string]$Metadata.key -ne $keyFile -or
      [string]$Metadata.backup_set_id -ne $BackupSetId) {
    throw 'Backup artifact metadata does not match the required identity.'
  }
  $artifactPath = [IO.Path]::GetFullPath((Join-Path $Directory $artifactFile))
  $keyPath = [IO.Path]::GetFullPath((Join-Path $Directory $keyFile))
  $parent = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
  if ([IO.Path]::GetDirectoryName($artifactPath).TrimEnd('\') -ne $parent -or
      [IO.Path]::GetDirectoryName($keyPath).TrimEnd('\') -ne $parent) {
    throw 'Backup artifact path failed containment validation.'
  }

  $artifactBytes = Read-HBAM2BoundedFileBytes -Path $artifactPath -MaximumBytes ($script:HBAM2MaximumPayloadBytes + 1024)
  $protectedKey = Read-HBAM2BoundedFileBytes -Path $keyPath -MaximumBytes 4096
  $masterKey = $null
  $encKey = New-Object byte[] 32
  $macKey = New-Object byte[] 32
  $plaintext = $null
  $success = $false
  try {
    if ($artifactBytes.Length -ne $encryptedLength -or
        (Get-HBAM2Sha256Hex -Bytes $artifactBytes) -ne [string]$Metadata.encrypted_sha256 -or
        (Get-HBAM2Sha256Hex -Bytes $protectedKey) -ne [string]$Metadata.key_sha256) {
      throw "Encrypted artifact hash mismatch for $ArtifactName."
    }
    if ($artifactBytes.Length -lt 94) { throw "Encrypted artifact is truncated for $ArtifactName." }
    for ($i = 0; $i -lt $script:HBAM2Magic.Length; $i++) {
      if ($artifactBytes[$i] -ne $script:HBAM2Magic[$i]) { throw "Encrypted artifact magic mismatch for $ArtifactName." }
    }
    if ($artifactBytes[5] -ne $script:HBAM2Version) { throw "Unsupported encrypted artifact version for $ArtifactName." }

    $entropy = Get-HBAM2Entropy -ProjectRef $ProjectRef -ArtifactName $ArtifactName -BackupSetId $BackupSetId
    $masterKey = [Security.Cryptography.ProtectedData]::Unprotect(
      $protectedKey, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    if ($masterKey.Length -ne 64) { throw "Unexpected key length for $ArtifactName." }
    [Buffer]::BlockCopy($masterKey, 0, $encKey, 0, 32)
    [Buffer]::BlockCopy($masterKey, 32, $macKey, 0, 32)
    $setBytes = New-Object byte[] 16
    $iv = New-Object byte[] 16
    [Buffer]::BlockCopy($artifactBytes, 6, $setBytes, 0, 16)
    [Buffer]::BlockCopy($artifactBytes, 22, $iv, 0, 16)
    if (-not (Test-HBAM2FixedTimeEqual -Left $setBytes -Right ([Guid]::ParseExact($BackupSetId, 'D')).ToByteArray())) {
      throw "Authenticated backup set identity mismatch for $ArtifactName."
    }

    $tagOffset = $artifactBytes.Length - 32
    $envelope = New-Object byte[] $tagOffset
    $actualTag = New-Object byte[] 32
    [Buffer]::BlockCopy($artifactBytes, 0, $envelope, 0, $tagOffset)
    [Buffer]::BlockCopy($artifactBytes, $tagOffset, $actualTag, 0, 32)
    $hmac = [Security.Cryptography.HMACSHA256]::new($macKey)
    try { $expectedTag = $hmac.ComputeHash($envelope) } finally { $hmac.Dispose() }
    if (-not (Test-HBAM2FixedTimeEqual -Left $actualTag -Right $expectedTag)) {
      throw "HMAC authentication failed for $ArtifactName."
    }
    $authenticatedLength = [BitConverter]::ToInt64($artifactBytes, 38)
    if ($authenticatedLength -ne $plaintextLength) { throw "Plaintext length mismatch for $ArtifactName." }
    $cipherLength = $tagOffset - 46
    if ($cipherLength -le 0 -or ($cipherLength % 16) -ne 0) { throw "Invalid ciphertext length for $ArtifactName." }
    $ciphertext = New-Object byte[] $cipherLength
    [Buffer]::BlockCopy($artifactBytes, 46, $ciphertext, 0, $cipherLength)
    $aes = [Security.Cryptography.Aes]::Create()
    try {
      $aes.KeySize = 256
      $aes.BlockSize = 128
      $aes.Mode = [Security.Cryptography.CipherMode]::CBC
      $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
      $aes.Key = $encKey
      $aes.IV = $iv
      $decryptor = $aes.CreateDecryptor()
      try { $plaintext = $decryptor.TransformFinalBlock($ciphertext, 0, $ciphertext.Length) }
      finally { $decryptor.Dispose() }
    } finally { $aes.Dispose() }
    if ($plaintext.Length -ne $plaintextLength -or
        (Get-HBAM2Sha256Hex -Bytes $plaintext) -ne [string]$Metadata.plaintext_sha256) {
      throw "Plaintext integrity mismatch for $ArtifactName."
    }
    $success = $true
    return ,$plaintext
  } finally {
    if (-not $success -and $plaintext) { [Array]::Clear($plaintext, 0, $plaintext.Length) }
    if ($masterKey) { [Array]::Clear($masterKey, 0, $masterKey.Length) }
    [Array]::Clear($encKey, 0, $encKey.Length)
    [Array]::Clear($macKey, 0, $macKey.Length)
    [Array]::Clear($artifactBytes, 0, $artifactBytes.Length)
    [Array]::Clear($protectedKey, 0, $protectedKey.Length)
  }
}
