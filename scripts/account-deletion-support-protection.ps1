param(
  [Parameter(Mandatory=$true)][ValidateSet('init','check','protect','unprotect')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$CaseId,
  [string]$FileName = ''
)
$ErrorActionPreference = 'Stop'
try {
  . (Join-Path $PSScriptRoot 'amora-db-backup-common.ps1')
  if ($env:OS -ne 'Windows_NT' -or $CaseId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') { throw 'invalid' }
  $anchor = [Environment]::GetFolderPath('LocalApplicationData')
  $product = Join-Path $anchor 'WeddingHanbang'
  Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $product -Anchor $anchor
  if (-not (Test-Path -LiteralPath $product)) {
    if ($Mode -ne 'init') { throw 'missing' }
    [void][IO.Directory]::CreateDirectory($product)
  }
  $root = Join-Path $product 'DeletionSupport'
  $directory = Join-Path $root $CaseId
  foreach ($path in @($root, $directory)) {
    Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $path -Anchor $anchor
    if (-not (Test-Path -LiteralPath $path)) {
      if ($Mode -ne 'init') { throw 'missing' }
      [void][IO.Directory]::CreateDirectory($path)
      Set-HBAM2PrivateDirectoryAcl -Path $path
    }
    Assert-HBAM2PrivateDirectoryAcl -Path $path
  }
  if ($FileName) {
    if ($FileName -cnotmatch '^([0-9]{5}\.dpapi|case\.lock)$') { throw 'invalid' }
    $file = Join-Path $directory $FileName
    Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $file -Anchor $anchor
    Assert-HBAM2PrivateFileAcl -Path $file
  }
  if ($Mode -in @('init','check')) { [Console]::Out.Write($directory); exit 0 }
  $text = [Console]::In.ReadToEnd()
  if ($text.Length -lt 1 -or $text.Length -gt 524288) { throw 'invalid' }
  $bytes = [Convert]::FromBase64String($text)
  $entropy = [Text.Encoding]::UTF8.GetBytes("WeddingHanbang|DeletionSupport|v1|slrtobkksjmxgzatjyqb|$CaseId")
  try {
    if ($Mode -eq 'protect') {
      $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    } else {
      $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    }
    try { [Console]::Out.Write([Convert]::ToBase64String($result)) } finally { [Array]::Clear($result,0,$result.Length) }
  } finally { [Array]::Clear($bytes,0,$bytes.Length) }
} catch {
  [Console]::Error.WriteLine('SUPPORT_CASE_PROTECTION_FAILED')
  exit 2
}
