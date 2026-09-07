param(
  [Parameter(Mandatory = $true)] [string] $EvidenceRoot,
  [Parameter(Mandatory = $true)] [string] $BackupReport,
  [Parameter(Mandatory = $true)] [string] $ExpectedProjectRef,
  [Parameter(Mandatory = $true)] [string] $ExpectedCommit
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'amora-db-backup-common.ps1')

try {
  if ($ExpectedProjectRef -cnotmatch '^[a-z0-9]{20}$' -or $ExpectedCommit -cnotmatch '^[a-f0-9]{40}$' -or
      $BackupReport -cnotmatch '^[a-f0-9]{64}$') { throw 'INVALID_BINDING' }
  $rootInfo = Resolve-HBAM2BackupRoot -SelfTest $false
  Assert-HBAM2BackupRoot -Root $rootInfo.Root -Anchor $rootInfo.Anchor
  $evidenceDirectory = (Resolve-Path -LiteralPath $EvidenceRoot).Path
  Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $evidenceDirectory -Anchor $rootInfo.Root
  Assert-HBAM2PrivateDirectoryAcl -Path $evidenceDirectory

  function Read-PrivateJson([string] $Root, [string] $Relative, [string] $Hash) {
    if ($Relative -match '\\|(^|/)\.\.?(/|$)' -or [IO.Path]::IsPathRooted($Relative)) { throw 'INVALID_PATH' }
    $candidate = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $candidate -Anchor $Root
    Assert-HBAM2PrivateFileAcl -Path $candidate
    $bytes = Read-HBAM2BoundedFileBytes -Path $candidate -MaximumBytes (4 * 1024 * 1024)
    try {
      if ((Get-HBAM2Sha256Hex -Bytes $bytes) -ine $Hash) { throw 'JSON_HASH_MISMATCH' }
      return [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
  }
  function Convert-CanonicalValue($Value) {
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [string] -or $Value -is [ValueType]) { return ConvertTo-Json -InputObject $Value -Compress }
    if ($Value -is [Array]) { return '[' + ((@($Value | ForEach-Object { Convert-CanonicalValue $_ })) -join ',') + ']' }
    $names = @($Value.PSObject.Properties.Name)
    [Array]::Sort($names, [StringComparer]::Ordinal)
    $parts = @($names | ForEach-Object { (ConvertTo-Json -InputObject $_ -Compress) + ':' + (Convert-CanonicalValue $Value.$_) })
    return '{' + ($parts -join ',') + '}'
  }
  function Assert-CanonicalEqual($Actual, $Expected) {
    if ((Convert-CanonicalValue $Actual) -cne (Convert-CanonicalValue $Expected)) { throw 'CANONICAL_PAYLOAD_MISMATCH' }
  }
  $index = Read-PrivateJson $evidenceDirectory 'current-release-evidence.json' $BackupReport
  $report = Read-PrivateJson $evidenceDirectory $index.backup.file $index.backup.sha256
  if ($report.projectRef -cne $ExpectedProjectRef -or $report.releaseCommit -cne $ExpectedCommit -or
      $report.format -cne 'hbam2-encrypted-current-user' -or $report.plaintextWrittenToDisk -ne $false) { throw 'REPORT_BINDING_MISMATCH' }
  $backupDirectory = [IO.Path]::GetFullPath((Join-Path $evidenceDirectory $report.directory))
  Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $backupDirectory -Anchor $evidenceDirectory
  Assert-HBAM2PrivateDirectoryAcl -Path $backupDirectory
  $expectedFiles = @($report.artifacts | ForEach-Object { $_.directory } | Sort-Object)
  $actualFiles = @(Get-ChildItem -LiteralPath $backupDirectory -Force | ForEach-Object Name | Sort-Object)
  if (@(Compare-Object $expectedFiles $actualFiles -CaseSensitive).Count -ne 0 -or
      @($expectedFiles | Select-Object -Unique).Count -ne $expectedFiles.Count) { throw 'ARTIFACT_SET_MISMATCH' }
  foreach ($artifact in $report.artifacts) {
    $expectedName = if ($artifact.scope -ceq 'schema-original') { 'schema-inventory.json' } else { 'logical-data.json' }
    if ($artifact.directory -cnotmatch '^part-[0-9]{6}$' -or $artifact.name -cne $expectedName -or
        $artifact.artifact -cne ($expectedName + '.hbam2') -or $artifact.key -cne ($expectedName + '.key.dpapi')) { throw 'ARTIFACT_NAME_INVALID' }
    $shardDirectory = Join-Path $backupDirectory $artifact.directory
    Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $shardDirectory -Anchor $backupDirectory
    Assert-HBAM2PrivateDirectoryAcl -Path $shardDirectory
    $shardFiles = @(Get-ChildItem -LiteralPath $shardDirectory -Force | ForEach-Object Name | Sort-Object)
    if (@(Compare-Object @($artifact.artifact, $artifact.key | Sort-Object) $shardFiles -CaseSensitive).Count -ne 0) { throw 'SHARD_SET_MISMATCH' }
    Assert-HBAM2PrivateFileAcl -Path (Join-Path $shardDirectory $artifact.artifact)
    Assert-HBAM2PrivateFileAcl -Path (Join-Path $shardDirectory $artifact.key)
    $plaintext = $null
    try {
      $plaintext = Unprotect-HBAM2Artifact -Directory $shardDirectory -Metadata $artifact `
        -ArtifactName $artifact.name -ProjectRef $ExpectedProjectRef -BackupSetId $report.backupSetId
      if ($artifact.scope.StartsWith('relation:')) {
        $payload = [Text.Encoding]::UTF8.GetString($plaintext) | ConvertFrom-Json
        $relation = @($report.relations | Where-Object { ('relation:' + $_.identity) -ceq $artifact.scope })
        if ($relation.Count -ne 1 -or $payload.format -cne 'current-baseline-relation-v1' -or
            $payload.identity -cne $relation[0].identity -or @($payload.rows).Count -ne $relation[0].rows -or
            @($payload.columns).Count -lt 1) { throw 'RELATION_PAYLOAD_INVALID' }
        $payload = $null
      } elseif ($artifact.scope -ceq 'schema-original') {
        $payload = [Text.Encoding]::UTF8.GetString($plaintext) | ConvertFrom-Json
        if ($payload.format -cne 'current-baseline-schema-original-v1' -or @($payload.statements).Count -lt 1 -or
            @($payload.objects).Count -ne @($report.objects).Count -or @($payload.ledger).Count -ne @($report.ledger).Count) { throw 'SCHEMA_ORIGINAL_INVALID' }
        Assert-CanonicalEqual $payload.objects $report.objects
        Assert-CanonicalEqual $payload.ledger $report.ledger
        $payload = $null
      } elseif ($artifact.scope -ceq 'storage-index') {
        $payload = [Text.Encoding]::UTF8.GetString($plaintext) | ConvertFrom-Json
        if ($payload.format -cne 'current-baseline-storage-index-v1' -or $null -eq $payload.objects) { throw 'STORAGE_INDEX_INVALID' }
        $storageReport = Read-PrivateJson $evidenceDirectory $index.storage.file $index.storage.sha256
        $summary = @($payload.objects | ForEach-Object { [PSCustomObject]@{ identity = $_.identity; sha256 = $_.sha256; bytes = $_.bytes } })
        Assert-CanonicalEqual $summary $storageReport.firstObjects
        foreach ($object in $payload.objects) {
          $identityBytes = [Text.Encoding]::UTF8.GetBytes([string]$object.bucket + [char]0 + [string]$object.name)
          try { if ((Get-HBAM2Sha256Hex -Bytes $identityBytes) -ine $object.identity) { throw 'STORAGE_KEY_BINDING_MISMATCH' } }
          finally { [Array]::Clear($identityBytes, 0, $identityBytes.Length) }
        }
        $payload = $null
      } elseif ($artifact.scope.StartsWith('storage:')) {
        $payload = [Text.Encoding]::UTF8.GetString($plaintext) | ConvertFrom-Json
        if ($payload.format -cne 'current-baseline-storage-object-v1' -or
            ('storage:' + $payload.identity) -cne $artifact.scope -or $payload.bytes -ne $artifact.original_bytes -or
            $payload.sha256 -cne $artifact.original_sha256 -or $payload.bytes -lt 0 -or
            $payload.bytes -gt (24 * 1024 * 1024 - 1024)) { throw 'STORAGE_ENVELOPE_INVALID' }
        $original = [Convert]::FromBase64String($payload.base64)
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
          $originalHash = ([BitConverter]::ToString($sha.ComputeHash($original))).Replace('-', '').ToLowerInvariant()
          if ($original.Length -ne $payload.bytes -or $originalHash -cne $payload.sha256) { throw 'STORAGE_BYTES_MISMATCH' }
        } finally { $sha.Dispose(); [Array]::Clear($original, 0, $original.Length); $payload = $null }
      } else { throw 'UNRECOGNIZED_BACKUP_SCOPE' }
    } finally { if ($plaintext) { [Array]::Clear($plaintext, 0, $plaintext.Length) } }
  }
  [ordered]@{ verified = $true; projectRef = $ExpectedProjectRef; releaseCommit = $ExpectedCommit;
    evidenceIndexSha256 = $BackupReport; artifactCount = @($report.artifacts).Count } | ConvertTo-Json -Compress
} catch {
  # 원본 경로·복호화 내용·PowerShell/SDK 예외를 출력하지 않는다.
  [Console]::Error.WriteLine('CURRENT_BASELINE_BACKUP_VERIFY_FAILED')
  exit 1
}
