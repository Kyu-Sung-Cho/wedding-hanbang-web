param([switch] $SelfTest, [string] $SelfTestBackupRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'amora-db-backup-common.ps1')
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$captureLock = $null
$captureDirectory = $null
$complete = $false
$written = 0
$phase = 'initializing'
$binding = $null

function Reply($Value) { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $Value -Compress -Depth 12)); [Console]::Out.Flush() }
function Save-PrivateState($Value) {
  Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $captureDirectory -Anchor $rootInfo.Root
  Assert-HBAM2PrivateDirectoryAcl -Path $captureDirectory
  $path = Join-Path $captureDirectory 'capture-state.json'
  $temporary = Join-Path $captureDirectory ('state-' + [Guid]::NewGuid().ToString('N') + '.partial')
  $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Value -Compress -Depth 12))
  try {
    $stream = [IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    if (Test-Path -LiteralPath $path) {
      Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $path -Anchor $captureDirectory
      Assert-HBAM2PrivateFileAcl -Path $path
      $prior = $temporary + '.prior'
      Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $prior -Anchor $captureDirectory
      [IO.File]::Replace($temporary,$path,$prior)
      [IO.File]::Delete($prior)
    } else { [IO.File]::Move($temporary,$path) }
    Assert-HBAM2PrivateFileAcl -Path $path
  } finally { [Array]::Clear($bytes,0,$bytes.Length) }
}

try {
  if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_REQUIRED' }
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line.Length -gt 4096) { throw 'INITIALIZATION_INVALID' }
  $binding = $line | ConvertFrom-Json
  $line = $null
  if ($binding.op -cne 'initialize' -or $binding.projectRef -cnotmatch '^[a-z0-9]{20}$' -or
      $binding.expectedCommit -cnotmatch '^[a-f0-9]{40}$' -or $binding.backupSetId -cnotmatch '^[a-f0-9-]{36}$') { throw 'INITIALIZATION_INVALID' }
  $null = [Guid]::ParseExact($binding.backupSetId,'D')
  $rootInfo = Resolve-HBAM2BackupRoot -SelfTest ([bool]$SelfTest) -SelfTestBackupRoot $SelfTestBackupRoot
  Initialize-HBAM2BackupRoot -Root $rootInfo.Root -Anchor $rootInfo.Anchor
  $captureLock = New-HBAM2CaptureLock -Root $rootInfo.Root
  $captureDirectory = Join-Path $rootInfo.Root ('current-capture-' + $binding.backupSetId)
  if (Test-Path -LiteralPath $captureDirectory) { throw 'CAPTURE_ALREADY_EXISTS' }
  [IO.Directory]::CreateDirectory($captureDirectory) | Out-Null
  Set-HBAM2PrivateDirectoryAcl -Path $captureDirectory
  $encryptedDirectory = Join-Path $captureDirectory 'encrypted'
  [IO.Directory]::CreateDirectory($encryptedDirectory) | Out-Null
  Set-HBAM2PrivateDirectoryAcl -Path $encryptedDirectory
  Save-PrivateState @{status='incomplete-do-not-restore';phase=$phase;artifactCount=0;backupSetId=$binding.backupSetId}
  Reply @{ok=$true;directory=$captureDirectory}
  while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ($line.Length -gt 48 * 1024 * 1024) { throw 'MESSAGE_TOO_LARGE' }
    $request = $line | ConvertFrom-Json
    $line = $null
    switch -CaseSensitive ($request.op) {
      'write' {
        if ($complete -or $request.directory -cne ('part-{0:D6}' -f $written) -or
            $request.name -cnotin @('schema-inventory.json','logical-data.json')) { throw 'SHARD_IDENTITY_INVALID' }
        $directory = Join-Path $encryptedDirectory $request.directory
        Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $directory -Anchor $encryptedDirectory
        if (Test-Path -LiteralPath $directory) { throw 'SHARD_ALREADY_EXISTS' }
        [IO.Directory]::CreateDirectory($directory) | Out-Null
        Set-HBAM2PrivateDirectoryAcl -Path $directory
        $bytes = [Convert]::FromBase64String($request.base64)
        $request.base64 = $null
        $roundtrip = $null
        try {
          $metadata = Protect-HBAM2Artifact -Plaintext $bytes -Directory $directory -ArtifactName $request.name `
            -ProjectRef $binding.projectRef -BackupSetId $binding.backupSetId
          $metadataObject = [PSCustomObject]$metadata
          $roundtrip = Unprotect-HBAM2Artifact -Directory $directory -Metadata $metadataObject -ArtifactName $request.name `
            -ProjectRef $binding.projectRef -BackupSetId $binding.backupSetId
          if (-not (Test-HBAM2FixedTimeEqual -Left $bytes -Right $roundtrip)) { throw 'ROUNDTRIP_MISMATCH' }
          Assert-HBAM2PrivateFileAcl -Path (Join-Path $directory $metadata.artifact)
          Assert-HBAM2PrivateFileAcl -Path (Join-Path $directory $metadata.key)
          $written++
          Reply @{ok=$true;metadata=$metadata}
        } finally {
          if ($bytes) { [Array]::Clear($bytes,0,$bytes.Length) }
          if ($roundtrip) { [Array]::Clear($roundtrip,0,$roundtrip.Length) }
        }
      }
      'progress' {
        if ($request.phase -cnotmatch '^[a-z-]+$' -or $request.artifactCount -ne $written) { throw 'PROGRESS_INVALID' }
        $phase = $request.phase
        Save-PrivateState @{status='incomplete-do-not-restore';phase=$phase;artifactCount=$written;backupSetId=$binding.backupSetId}
        Reply @{ok=$true}
      }
      'finish' {
        if ($request.receipt.status -cne 'captured-awaiting-release-evidence' -or $request.receipt.backupSetId -cne $binding.backupSetId -or
            $request.receipt.releaseCommit -cne $binding.expectedCommit -or $request.receipt.projectRef -cne $binding.projectRef -or
            @($request.receipt.artifacts).Count -ne $written) { throw 'RECEIPT_INVALID' }
        $path = Join-Path $captureDirectory 'capture-receipt.json'
        if (Test-Path -LiteralPath $path) { throw 'RECEIPT_EXISTS' }
        $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $request.receipt -Compress -Depth 100))
        try { Write-HBAM2BytesAtomically -Path $path -Bytes $bytes } finally { [Array]::Clear($bytes,0,$bytes.Length) }
        Assert-HBAM2PrivateFileAcl -Path $path
        Save-PrivateState @{status='captured-awaiting-release-evidence';phase='complete';artifactCount=$written;backupSetId=$binding.backupSetId}
        $complete=$true
        Reply @{ok=$true;directory=$captureDirectory}
        break
      }
      'fail' { Reply @{ok=$true}; break }
      default { throw 'OPERATION_INVALID' }
    }
    if ($complete -or $request.op -ceq 'fail') { break }
  }
} catch {
  # DB/원문/경로/키가 포함될 수 있는 예외를 stdout/stderr에 출력하지 않는다.
  Reply @{ok=$false;code='CAPTURE_PRIVATE_WRITER_FAILED'}
} finally {
  if ($captureDirectory -and -not $complete) {
    try { Save-PrivateState @{status='incomplete-do-not-restore';phase=$phase;artifactCount=$written;backupSetId=$binding.backupSetId} } catch {}
  }
  if ($captureLock) { $captureLock.Dispose() }
}
if (-not $complete) { exit 1 }
