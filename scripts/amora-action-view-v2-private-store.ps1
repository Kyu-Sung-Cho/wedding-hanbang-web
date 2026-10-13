param(
  [Parameter(Mandatory=$true)][ValidateSet('create','store','read','check')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$RecoveryId,
  [string]$ExpectedSha256 = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  . (Join-Path $PSScriptRoot 'amora-db-backup-common.ps1')
  if ($env:OS -ne 'Windows_NT' -or $RecoveryId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') { throw 'invalid' }
  if ($Mode -eq 'create') {
    if ($ExpectedSha256 -ne '') { throw 'invalid' }
  } elseif ($ExpectedSha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'invalid' }
  $anchor = [Environment]::GetFolderPath('LocalApplicationData')
  $root = Join-Path $anchor 'WeddingHanbang\AmoraActionViewV2Recovery'
  $directory = Join-Path $root $RecoveryId
  Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $directory -Anchor $anchor
  if ($Mode -eq 'create') {
    if (-not (Test-Path -LiteralPath $root)) {
      [void][IO.Directory]::CreateDirectory($root)
      Set-HBAM2PrivateDirectoryAcl -Path $root
    }
    Assert-HBAM2PrivateDirectoryAcl -Path $root
    if (Test-Path -LiteralPath $directory) { throw 'exists' }
    [void][IO.Directory]::CreateDirectory($directory)
    Set-HBAM2PrivateDirectoryAcl -Path $directory
    [Console]::Out.Write($directory)
    exit 0
  }
  Assert-HBAM2PrivateDirectoryAcl -Path $root
  Assert-HBAM2PrivateDirectoryAcl -Path $directory
  $file = Join-Path $directory 'original-capsule.dpapi'
  Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $file -Anchor $anchor
  $entropy = [Text.Encoding]::UTF8.GetBytes("WeddingHanbang|AmoraActionViewV2Recovery|v1|slrtobkksjmxgzatjyqb|$RecoveryId")
  $clear = $null
  $cipher = $null
  $roundtrip = $null
  try {
    if ($Mode -eq 'store') {
      if (Test-Path -LiteralPath $file) { throw 'exists' }
      $text = [Console]::In.ReadToEnd()
      if ($text.Length -lt 1 -or $text.Length -gt 349528) { throw 'size' }
      $clear = [Convert]::FromBase64String($text)
      $text = $null
      if ($clear.Length -lt 1 -or $clear.Length -gt 262144 -or (Get-HBAM2Sha256Hex -Bytes $clear).ToLowerInvariant() -cne $ExpectedSha256) { throw 'hash' }
      $cipher = [Security.Cryptography.ProtectedData]::Protect($clear,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
      $stream = [IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
      try { $stream.Write($cipher,0,$cipher.Length);$stream.Flush($true) } finally { $stream.Dispose() }
    } else {
      if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'missing' }
    }
    Assert-HBAM2PrivateFileAcl -Path $file
    $cipherOnDisk = Read-HBAM2BoundedFileBytes -Path $file -MaximumBytes 263168
    try {
      $roundtrip = [Security.Cryptography.ProtectedData]::Unprotect($cipherOnDisk,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
      if ($roundtrip.Length -lt 1 -or $roundtrip.Length -gt 262144 -or (Get-HBAM2Sha256Hex -Bytes $roundtrip).ToLowerInvariant() -cne $ExpectedSha256) { throw 'hash' }
      if ($clear -and -not (Test-HBAM2FixedTimeEqual -Left $clear -Right $roundtrip)) { throw 'roundtrip' }
      if ($Mode -eq 'read') {
        [Console]::Out.Write([Convert]::ToBase64String($roundtrip))
      } else {
        [ordered]@{format='amora-action-view-v2-private-storage-v1';recoveryId=$RecoveryId;
          projectRef='slrtobkksjmxgzatjyqb';plaintextSha256=$ExpectedSha256;
          encryptedSha256=(Get-HBAM2Sha256Hex -Bytes $cipherOnDisk).ToLowerInvariant();
          plaintextBytes=$roundtrip.Length;encryptedBytes=$cipherOnDisk.Length;
          privateStorageVerified=$true;plaintextWrittenToDisk=$false;releaseAuthorized=$false;
          protection='Windows-DPAPI-CurrentUser';checkedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
      }
    } finally { if ($cipherOnDisk) { [Array]::Clear($cipherOnDisk,0,$cipherOnDisk.Length) } }
  } finally {
    foreach ($bytes in @($clear,$cipher,$roundtrip,$entropy)) { if ($bytes) { [Array]::Clear($bytes,0,$bytes.Length) } }
  }
} catch {
  [Console]::Error.WriteLine('AMORA_VIEW_V2_PRIVATE_STORAGE_FAILED')
  exit 2
}
