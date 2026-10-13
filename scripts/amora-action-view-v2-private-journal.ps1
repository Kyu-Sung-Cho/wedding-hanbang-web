param([Parameter(Mandatory=$true)][string]$RecoveryId,[ValidateSet('rehearse','apply')][string]$Mode='rehearse')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
try {
  . (Join-Path $PSScriptRoot 'amora-db-backup-common.ps1')
  if ($env:OS -ne 'Windows_NT' -or $RecoveryId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') { throw 'invalid' }
  $anchor=[Environment]::GetFolderPath('LocalApplicationData')
  $root=Join-Path $anchor 'WeddingHanbang\AmoraActionViewV2Recovery'
  $directory=Join-Path $root $RecoveryId
  $fileName=if ($Mode -eq 'apply') { 'apply.jsonl' } else { 'rehearsal.jsonl' }
  $file=Join-Path $directory $fileName
  Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $file -Anchor $anchor
  Assert-HBAM2PrivateDirectoryAcl -Path $root
  Assert-HBAM2PrivateDirectoryAcl -Path $directory
  Assert-HBAM2PrivateFileAcl -Path $file
  $item=Get-Item -LiteralPath $file
  if (-not ($item -is [IO.FileInfo]) -or $item.Length -gt 262144) { throw 'invalid' }
  $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]'ReadWrite,Delete')
  try {
    $length=$stream.Length
    if ($length -gt 262144) { throw 'invalid' }
    $bytes=New-Object byte[] $length
    $offset=0
    while ($offset -lt $length) {
      $read=$stream.Read($bytes,$offset,$length-$offset)
      if ($read -lt 1) { throw 'incomplete' }
      $offset += $read
    }
    if ($stream.Length -ne $length) { throw 'changed' }
  } finally { $stream.Dispose() }
  try {
    $hash=if ($bytes.Length -eq 0) { 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }
      else { (Get-HBAM2Sha256Hex -Bytes $bytes).ToLowerInvariant() }
    [ordered]@{format='amora-action-view-v2-private-journal-v1';recoveryId=$RecoveryId;
      projectRef='slrtobkksjmxgzatjyqb';file=$fileName;byteLength=$bytes.Length;
      sha256=$hash;privateAclVerified=$true;
      checkedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
  } finally { if ($bytes) { [Array]::Clear($bytes,0,$bytes.Length) } }
} catch {
  [Console]::Error.WriteLine('AMORA_VIEW_V2_JOURNAL_PRIVATE_ACL_UNVERIFIED')
  exit 2
}
