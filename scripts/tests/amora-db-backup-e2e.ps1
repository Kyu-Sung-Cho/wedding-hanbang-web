param(
  [switch] $KeepArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$ExpectedTables = @(
  'ai_interactions_log',
  'amora_actions',
  'amora_couple_profiles',
  'amora_mediation_acceptances',
  'amora_memory_consents',
  'amora_memory_jobs',
  'amora_memory_settings',
  'amora_turn_counters',
  'chat_feedback',
  'chat_messages',
  'chat_summaries',
  'couples',
  'decision_nodes',
  'profiles',
  'wedding_journeys'
)
$ExpectedFiles = @(
  'logical-data.json.hbam2',
  'logical-data.json.key.dpapi',
  'manifest.json',
  'schema-inventory.json.hbam2',
  'schema-inventory.json.key.dpapi'
)

function Assert-True {
  param(
    [Parameter(Mandatory = $true)] [bool] $Condition,
    [Parameter(Mandatory = $true)] [string] $Message
  )

  if (-not $Condition) { throw $Message }
}

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)] [byte[]] $Bytes)

  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '')
  } finally {
    $sha.Dispose()
  }
}

function Get-FileSha256Hex {
  param([Parameter(Mandatory = $true)] [string] $Path)

  return Get-Sha256Hex -Bytes ([IO.File]::ReadAllBytes($Path))
}

function Get-JsonOutput {
  param([Parameter(Mandatory = $true)] [string] $Output)

  foreach ($line in @($Output -split "`r?`n") | Select-Object -Last 20) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try {
      $value = $line | ConvertFrom-Json
      if ($value) { return $value }
    } catch {
      # A script may emit status text before its single receipt line.
    }
  }
  throw 'The child script did not return a JSON receipt.'
}

function Quote-ProcessArgument {
  param([Parameter(Mandatory = $true)] [string] $Value)

  # All generated paths are quote-free and do not end in a slash. Doubling quotes
  # is sufficient for the Windows PowerShell command line used by this harness.
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-PowerShellFile {
  param(
    [Parameter(Mandatory = $true)] [string] $ScriptPath,
    [Parameter(Mandatory = $true)] [Collections.Specialized.OrderedDictionary] $Parameters,
    [hashtable] $Environment = @{}
  )

  $argumentList = [Collections.Generic.List[string]]::new()
  foreach ($prefixArgument in @(
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', $ScriptPath
  )) {
    [void]$argumentList.Add($prefixArgument)
  }
  foreach ($entry in $Parameters.GetEnumerator()) {
    if ($entry.Value -is [bool]) {
      if ([bool]$entry.Value) { [void]$argumentList.Add("-$($entry.Key)") }
      continue
    }
    [void]$argumentList.Add("-$($entry.Key)")
    [void]$argumentList.Add([string]$entry.Value)
  }

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = (Get-Command powershell.exe -ErrorAction Stop).Source
  $startInfo.Arguments = (($argumentList | ForEach-Object {
    Quote-ProcessArgument -Value $_
  }) -join ' ')
  $startInfo.WorkingDirectory = (Get-Location).Path
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($entry in $Environment.GetEnumerator()) {
    $startInfo.EnvironmentVariables[[string]$entry.Key] = [string]$entry.Value
  }

  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw "Could not start $ScriptPath." }
  try {
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(180000)) {
      $process.Kill()
      throw "Child script exceeded the 180-second harness timeout: $ScriptPath"
    }
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      StdOut = $stdoutTask.Result
      StdErr = $stderrTask.Result
      Arguments = $startInfo.Arguments
    }
  } finally {
    $process.Dispose()
  }
}

function Invoke-NodeSelfTest {
  param(
    [Parameter(Mandatory = $true)] [string] $NodeCli,
    [Parameter(Mandatory = $true)] [string] $ScriptPath,
    [Parameter(Mandatory = $true)] [string] $SqlPath,
    [Parameter(Mandatory = $true)] [string] $WorkingDirectory
  )

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $NodeCli
  $startInfo.Arguments = "$(Quote-ProcessArgument -Value $ScriptPath) $(Quote-ProcessArgument -Value $SqlPath)"
  $startInfo.WorkingDirectory = $WorkingDirectory
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start the logical SQL PGlite self-test.' }
  try {
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(120000)) {
      $process.Kill()
      throw 'Logical SQL PGlite self-test exceeded 120 seconds.'
    }
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      StdOut = $stdoutTask.Result
      StdErr = $stderrTask.Result
      Arguments = $startInfo.Arguments
    }
  } finally {
    $process.Dispose()
  }
}

function Invoke-TrustedPGliteSmoke {
  param(
    [Parameter(Mandatory = $true)] $RuntimeFence,
    [Parameter(Mandatory = $true)] [string] $ScriptPath,
    [Parameter(Mandatory = $true)] [string[]] $TableNames
  )

  $emptyDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  $inventory = [ordered]@{
    columns = @($TableNames | ForEach-Object {
      [ordered]@{ table_name = $_; column_name = 'id' }
    }) + @([ordered]@{ table_name = 'chat_messages'; column_name = 'couple_id' })
    constraints = @(
      [ordered]@{ table = 'couples'; type = 'p'; columns = @('id') },
      [ordered]@{ table = 'chat_messages'; type = 'f'; columns = @('couple_id'); referenced_table = 'public.couples'; referenced_columns = @('id') }
    )
  }
  $tables = [ordered]@{}
  foreach ($tableName in $TableNames) {
    $tables[$tableName] = [ordered]@{
      row_count = 0
      rows = @()
      canonical_sha256 = $emptyDigest
    }
  }
  $data = [ordered]@{ tables = $tables }
  $inventoryLine = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($inventory | ConvertTo-Json -Compress -Depth 20)))
  $dataLine = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($data | ConvertTo-Json -Compress -Depth 20)))

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $RuntimeFence.NodePath
  $startInfo.Arguments = Quote-ProcessArgument -Value $ScriptPath
  $startInfo.WorkingDirectory = [IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($ScriptPath))
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($name in @('NODE_OPTIONS', 'NODE_PATH', 'NODE_COMPILE_CACHE', 'NODE_V8_COVERAGE', 'NODE_REDIRECT_WARNINGS', 'NODE_CHANNEL_FD')) {
    [void]$startInfo.EnvironmentVariables.Remove($name)
  }
  $startInfo.EnvironmentVariables['HBAM_PGLITE_ENTRY'] = $RuntimeFence.PGliteEntryPath
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start trusted PGlite runtime smoke.' }
  try {
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.WriteLine($inventoryLine)
    $process.StandardInput.WriteLine($dataLine)
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(30000)) {
      $process.Kill()
      throw 'Trusted PGlite runtime smoke exceeded 30 seconds.'
    }
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      StdOut = $stdoutTask.Result
      StdErr = $stderrTask.Result
    }
  } finally { $process.Dispose() }
}

function Assert-Rejected {
  param(
    [Parameter(Mandatory = $true)] $Result,
    [Parameter(Mandatory = $true)] [string] $CaseName
  )

  if ($Result.ExitCode -eq 0) {
    throw "$CaseName was accepted but must be rejected. stdout=$($Result.StdOut)"
  }
  if ($CaseName -ne 'unexpected Everyone ACL' -and
      $Result.StdErr -match 'ACL inheritance is enabled|private rule set') {
    throw "$CaseName was masked by an unintended ACL precondition failure. stderr=$($Result.StdErr)"
  }
}

function New-SelfTestRoot {
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  $path = Join-Path $tempRoot "WeddingHanbang-Amora-Backup-SelfTest-$([Guid]::NewGuid().ToString('N'))"
  $fullPath = [IO.Path]::GetFullPath($path)
  Assert-True `
    -Condition ([IO.Path]::GetDirectoryName($fullPath).TrimEnd('\') -eq $tempRoot) `
    -Message 'Self-test root escaped the Windows temporary directory.'
  Assert-True `
    -Condition ([IO.Path]::GetFileName($fullPath) -match '^WeddingHanbang-Amora-Backup-SelfTest-[a-f0-9]{32}$') `
    -Message 'Self-test root name does not satisfy the production script test fence.'
  return $fullPath
}

function Assert-SafeTemporaryPath {
  param([Parameter(Mandatory = $true)] [string] $Path)

  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $name = [IO.Path]::GetFileName($fullPath)
  if ([IO.Path]::GetDirectoryName($fullPath).TrimEnd('\') -ne $tempRoot -or
      $name -notmatch '^WeddingHanbang-Amora-Backup-(SelfTest|Harness)-[a-f0-9]{32}$') {
    throw "Refusing recursive cleanup outside a harness-owned temporary root: $fullPath"
  }
}

function Copy-BackupCase {
  param(
    [Parameter(Mandatory = $true)] [string] $Source,
    [Parameter(Mandatory = $true)] [string] $Root,
    [Parameter(Mandatory = $true)] [int] $Ordinal
  )

  $name = "20990101-$($Ordinal.ToString('000000'))"
  $destination = Join-Path $Root $name
  $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  Assert-True `
    -Condition ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($destination)).TrimEnd('\') -eq $resolvedRoot) `
    -Message 'Negative test directory escaped its self-test root.'
  Copy-Item -LiteralPath $Source -Destination $destination -Recurse
  Set-HBAM2PrivateDirectoryAcl -Path $destination
  return $destination
}

function Read-Manifest {
  param([Parameter(Mandatory = $true)] [string] $Directory)

  return ([IO.File]::ReadAllText((Join-Path $Directory 'manifest.json'))) | ConvertFrom-Json
}

function Write-Manifest {
  param(
    [Parameter(Mandatory = $true)] [string] $Directory,
    [Parameter(Mandatory = $true)] $Manifest
  )

  $json = $Manifest | ConvertTo-Json -Depth 100
  [IO.File]::WriteAllText(
    (Join-Path $Directory 'manifest.json'),
    $json,
    [Text.UTF8Encoding]::new($false)
  )
}

function Invoke-Backup {
  param(
    [Parameter(Mandatory = $true)] [string] $BackupScript,
    [Parameter(Mandatory = $true)] [string] $FakeCli,
    [Parameter(Mandatory = $true)] [string] $Root,
    [Parameter(Mandatory = $true)] [string] $ProjectRef,
    [Parameter(Mandatory = $true)] [string] $StateDirectory,
    [Parameter(Mandatory = $true)] [string] $RepoRoot,
    [string] $Mode = 'normal',
    [DateTimeOffset] $CaptureTime = [DateTimeOffset]::UtcNow
  )

  foreach ($stateFile in @('counter.txt', 'invocations.jsonl')) {
    $path = Join-Path $StateDirectory $stateFile
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
  }
  $environment = @{
    HBAM_SELFTEST_STATE_DIR = $StateDirectory
    HBAM_SELFTEST_REPO_ROOT = $RepoRoot
    HBAM_SELFTEST_PROJECT_REF = $ProjectRef
    HBAM_SELFTEST_MODE = $Mode
    HBAM_SELFTEST_CAPTURED_AT = $CaptureTime.ToUniversalTime().ToString('o')
  }
  $parameters = [ordered]@{
    ExpectedProjectRef = $ProjectRef
    SupabaseCli = $FakeCli
    QueryTimeoutSeconds = 30
    SelfTest = $true
    SelfTestBackupRoot = $Root
  }
  return Invoke-PowerShellFile `
    -ScriptPath $BackupScript `
    -Parameters $parameters `
    -Environment $environment
}

function Invoke-Verify {
  param(
    [Parameter(Mandatory = $true)] [string] $VerifyScript,
    [Parameter(Mandatory = $true)] [string] $Directory,
    [Parameter(Mandatory = $true)] [string] $Root,
    [Parameter(Mandatory = $true)] [string] $ProjectRef,
    [Parameter(Mandatory = $true)] [string] $BackupSetId,
    [Parameter(Mandatory = $true)] [string] $ManifestSha256,
    [Parameter(Mandatory = $true)] [string] $NodeCli
  )

  $parameters = [ordered]@{
    BackupDirectory = $Directory
    ExpectedProjectRef = $ProjectRef
    ExpectedBackupSetId = $BackupSetId
    ExpectedManifestSha256 = $ManifestSha256
    MaximumAgeMinutes = 30
    NodeCli = $NodeCli
    SelfTest = $true
    SelfTestBackupRoot = $Root
  }
  return Invoke-PowerShellFile -ScriptPath $VerifyScript -Parameters $parameters
}

function Assert-FakeInvocationContract {
  param(
    [Parameter(Mandatory = $true)] [string] $StateDirectory,
    [Parameter(Mandatory = $true)] [string] $RepoRoot
  )

  $logPath = Join-Path $StateDirectory 'invocations.jsonl'
  Assert-True -Condition (Test-Path -LiteralPath $logPath -PathType Leaf) -Message 'Fake CLI invocation log is missing.'
  $records = @([IO.File]::ReadAllLines($logPath) | ForEach-Object { $_ | ConvertFrom-Json })
  Assert-True -Condition ($records.Count -eq 4) -Message "Expected four Supabase calls; got $($records.Count)."
  $expectedKinds = @('preflight', 'inventory-before', 'logical-data', 'inventory-after')
  for ($index = 0; $index -lt $records.Count; $index++) {
    Assert-True -Condition ($records[$index].kind -eq $expectedKinds[$index]) -Message 'Fake CLI call order changed.'
    Assert-True -Condition ($records[$index].workdir -eq $RepoRoot) -Message 'Supabase call did not carry the exact repo --workdir.'
    Assert-True -Condition ([int]$records[$index].workdir_count -eq 1) -Message 'Supabase call did not carry exactly one --workdir.'
  }
}

function Read-AndAuthenticateHbam2Artifact {
  param(
    [Parameter(Mandatory = $true)] [string] $Directory,
    [Parameter(Mandatory = $true)] $Metadata,
    [Parameter(Mandatory = $true)] [string] $ArtifactName,
    [Parameter(Mandatory = $true)] [string] $ProjectRef,
    [Parameter(Mandatory = $true)] [string] $BackupSetId
  )

  $artifactBytes = [IO.File]::ReadAllBytes((Join-Path $Directory "$ArtifactName.hbam2"))
  $protectedKey = [IO.File]::ReadAllBytes((Join-Path $Directory "$ArtifactName.key.dpapi"))
  Assert-True -Condition ((Get-Sha256Hex -Bytes $artifactBytes) -eq [string]$Metadata.encrypted_sha256) -Message 'Independent encrypted hash check failed.'
  Assert-True -Condition ((Get-Sha256Hex -Bytes $protectedKey) -eq [string]$Metadata.key_sha256) -Message 'Independent DPAPI blob hash check failed.'
  Assert-True -Condition ([Text.Encoding]::ASCII.GetString($artifactBytes, 0, 5) -eq 'HBAM2') -Message 'HBAM2 magic is missing.'
  Assert-True -Condition ($artifactBytes[5] -eq 2) -Message 'HBAM2 version is not 2.'

  $expectedSetBytes = ([Guid]::ParseExact($BackupSetId, 'D')).ToByteArray()
  $actualSetBytes = New-Object byte[] 16
  [Buffer]::BlockCopy($artifactBytes, 6, $actualSetBytes, 0, 16)
  Assert-True `
    -Condition (([BitConverter]::ToString($actualSetBytes)) -eq ([BitConverter]::ToString($expectedSetBytes))) `
    -Message 'Authenticated envelope does not carry the shared backup set id.'

  $entropy = [Text.Encoding]::UTF8.GetBytes("HBAM2|$ProjectRef|$BackupSetId|$ArtifactName")
  $masterKey = [Security.Cryptography.ProtectedData]::Unprotect(
    $protectedKey,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  $encKey = New-Object byte[] 32
  $macKey = New-Object byte[] 32
  $plaintext = $null
  try {
    Assert-True -Condition ($masterKey.Length -eq 64) -Message 'DPAPI did not return a 64-byte HBAM2 master key.'
    [Buffer]::BlockCopy($masterKey, 0, $encKey, 0, 32)
    [Buffer]::BlockCopy($masterKey, 32, $macKey, 0, 32)

    $tagOffset = $artifactBytes.Length - 32
    $envelope = New-Object byte[] $tagOffset
    $actualTag = New-Object byte[] 32
    [Buffer]::BlockCopy($artifactBytes, 0, $envelope, 0, $tagOffset)
    [Buffer]::BlockCopy($artifactBytes, $tagOffset, $actualTag, 0, 32)
    $hmac = [Security.Cryptography.HMACSHA256]::new($macKey)
    try {
      $expectedTag = $hmac.ComputeHash($envelope)
    } finally {
      $hmac.Dispose()
    }
    Assert-True `
      -Condition (([BitConverter]::ToString($actualTag)) -eq ([BitConverter]::ToString($expectedTag))) `
      -Message 'Independent HBAM2 HMAC authentication failed.'

    $iv = New-Object byte[] 16
    [Buffer]::BlockCopy($artifactBytes, 22, $iv, 0, 16)
    $cipherOffset = 46
    $cipherLength = $tagOffset - $cipherOffset
    Assert-True -Condition ($cipherLength -gt 0 -and ($cipherLength % 16) -eq 0) -Message 'HBAM2 ciphertext is not AES block aligned.'
    $ciphertext = New-Object byte[] $cipherLength
    [Buffer]::BlockCopy($artifactBytes, $cipherOffset, $ciphertext, 0, $cipherLength)
    $aes = [Security.Cryptography.Aes]::Create()
    try {
      $aes.KeySize = 256
      $aes.BlockSize = 128
      $aes.Mode = [Security.Cryptography.CipherMode]::CBC
      $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
      $aes.Key = $encKey
      $aes.IV = $iv
      $decryptor = $aes.CreateDecryptor()
      try {
        $plaintext = $decryptor.TransformFinalBlock($ciphertext, 0, $ciphertext.Length)
      } finally {
        $decryptor.Dispose()
      }
    } finally {
      $aes.Dispose()
    }

    Assert-True -Condition ((Get-Sha256Hex -Bytes $plaintext) -eq [string]$Metadata.plaintext_sha256) -Message 'Independent AES plaintext hash check failed.'
    Assert-True -Condition ($plaintext.Length -eq [int64]$Metadata.plaintext_bytes) -Message 'Independent AES plaintext length check failed.'
    return [pscustomobject]@{
      Plaintext = $plaintext
      EnvelopeBackupSetId = ([Guid]::new($actualSetBytes)).ToString('D')
      IvHex = [BitConverter]::ToString($iv)
      MasterKeySha256 = Get-Sha256Hex -Bytes $masterKey
    }
  } finally {
    if ($masterKey) { [Array]::Clear($masterKey, 0, $masterKey.Length) }
    [Array]::Clear($encKey, 0, $encKey.Length)
    [Array]::Clear($macKey, 0, $macKey.Length)
  }
}

$fakeCliSource = @'
param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $CliArguments)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail([string] $Message) {
  [Console]::Error.WriteLine($Message)
  exit 91
}

$stateDirectory = $env:HBAM_SELFTEST_STATE_DIR
$expectedRepoRoot = $env:HBAM_SELFTEST_REPO_ROOT
$projectRef = $env:HBAM_SELFTEST_PROJECT_REF
$mode = $env:HBAM_SELFTEST_MODE
if ([string]::IsNullOrWhiteSpace($stateDirectory) -or
    [string]::IsNullOrWhiteSpace($expectedRepoRoot) -or
    [string]::IsNullOrWhiteSpace($projectRef)) {
  Fail 'Fake Supabase CLI is not fenced by the harness environment.'
}

$arguments = @($CliArguments)
$workdirIndexes = @(for ($i = 0; $i -lt $arguments.Count; $i++) {
  if ($arguments[$i] -eq '--workdir') { $i }
})
if ($workdirIndexes.Count -ne 1 -or $workdirIndexes[0] + 1 -ge $arguments.Count) {
  Fail 'Fake Supabase CLI requires exactly one --workdir value.'
}
$workdir = [IO.Path]::GetFullPath($arguments[$workdirIndexes[0] + 1]).TrimEnd('\')
$expectedWorkdir = [IO.Path]::GetFullPath($expectedRepoRoot).TrimEnd('\')
if (-not [string]::Equals($workdir, $expectedWorkdir, [StringComparison]::OrdinalIgnoreCase)) {
  Fail 'Fake Supabase CLI received the wrong --workdir.'
}
if (@($arguments | Where-Object { $_ -eq 'db' }).Count -ne 1 -or
    @($arguments | Where-Object { $_ -eq 'query' }).Count -ne 1 -or
    @($arguments | Where-Object { $_ -eq '--linked' }).Count -ne 1) {
  Fail 'Fake Supabase CLI accepts only a linked db query.'
}
$outputIndex = [Array]::IndexOf($arguments, '--output')
if ($outputIndex -lt 0 -or $outputIndex + 1 -ge $arguments.Count -or $arguments[$outputIndex + 1] -ne 'json') {
  Fail 'Fake Supabase CLI requires --output json.'
}
$fileIndex = [Array]::IndexOf($arguments, '--file')
if ($fileIndex -lt 0 -or $fileIndex + 1 -ge $arguments.Count) {
  Fail 'Fake Supabase CLI requires one SQL --file.'
}
$sqlFile = [IO.Path]::GetFullPath($arguments[$fileIndex + 1])
if (-not [string]::Equals([IO.Path]::GetDirectoryName($sqlFile).TrimEnd('\'), (Join-Path $expectedWorkdir 'scripts\sql').TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
  Fail 'Fake Supabase CLI SQL file escaped scripts/sql.'
}

$counterPath = Join-Path $stateDirectory 'counter.txt'
$call = if (Test-Path -LiteralPath $counterPath) { [int]([IO.File]::ReadAllText($counterPath)) + 1 } else { 1 }
[IO.File]::WriteAllText($counterPath, [string]$call, [Text.UTF8Encoding]::new($false))
$baseName = [IO.Path]::GetFileName($sqlFile)
$kind = switch ($call) {
  1 { if ($baseName -notmatch 'preflight') { Fail 'Call 1 must be preflight SQL.' }; 'preflight' }
  2 { if ($baseName -notmatch 'inventory') { Fail 'Call 2 must be inventory-before SQL.' }; 'inventory-before' }
  3 { if ($baseName -notmatch '(logical|data)') { Fail 'Call 3 must be logical-data SQL.' }; 'logical-data' }
  4 { if ($baseName -notmatch 'inventory') { Fail 'Call 4 must be inventory-after SQL.' }; 'inventory-after' }
  default { Fail 'Fake Supabase CLI refuses calls after inventory-after.' }
}

if ($mode -eq 'relink-attempt' -and $call -eq 2) {
  $linkedRefPath = Join-Path $expectedWorkdir 'supabase\.temp\project-ref'
  try {
    $writeProbe = [IO.File]::Open(
      $linkedRefPath,
      [IO.FileMode]::Open,
      [IO.FileAccess]::Write,
      [IO.FileShare]::None
    )
    $writeProbe.Dispose()
    Fail 'The linked project ref was writable while the backup source fence was active.'
  } catch {
    [Console]::Error.WriteLine('Synthetic relink was blocked by the held source fence.')
    exit 92
  }
}

$record = [ordered]@{
  call = $call
  kind = $kind
  workdir = $workdir
  workdir_count = $workdirIndexes.Count
  sql_file = $baseName
  arguments = $arguments
}
[IO.File]::AppendAllText(
  (Join-Path $stateDirectory 'invocations.jsonl'),
  (($record | ConvertTo-Json -Compress -Depth 10) + [Environment]::NewLine),
  [Text.UTF8Encoding]::new($false)
)

$tableNames = @(
  'ai_interactions_log', 'amora_actions', 'amora_couple_profiles',
  'amora_mediation_acceptances', 'amora_memory_consents', 'amora_memory_jobs', 'amora_memory_settings',
  'amora_turn_counters', 'chat_feedback', 'chat_messages',
  'chat_summaries', 'couples', 'decision_nodes', 'profiles',
  'wedding_journeys'
)
$baseCapture = [DateTimeOffset]::Parse($env:HBAM_SELFTEST_CAPTURED_AT).ToUniversalTime()
$emptyDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function New-RelationMetadata([string[]] $Names, [string] $Stage) {
  return @($Names | ForEach-Object {
    $index = [Array]::IndexOf($tableNames, $_)
    $relationOid = 10000 + $index
    if ($_ -eq $tableNames[0] -and
        (($mode -eq 'preflight-oid-drift' -and $Stage -eq 'preflight') -or
         ($mode -eq 'data-oid-drift' -and $Stage -eq 'data'))) {
      $relationOid += 5000
    }
    [ordered]@{
      name = $_
      relation_oid = [string]$relationOid
      relkind = 'r'
      has_inheritance_children = ($mode -eq 'inherited-data-relation' -and $Stage -eq 'data' -and $_ -eq $tableNames[0])
      is_inheritance_child = $false
    }
  })
}

function New-Inventory([DateTimeOffset] $CapturedAt, [bool] $Drift) {
  $tables = @(New-RelationMetadata -Names $tableNames -Stage 'inventory' | ForEach-Object {
    [ordered]@{
      name = $_.name
      relation_oid = $_.relation_oid
      relkind = $_.relkind
      has_inheritance_children = $_.has_inheritance_children
      is_inheritance_child = $_.is_inheritance_child
      rls = $true
      force_rls = $false
      owner = 'postgres'
      acl = $null
    }
  })
  $columns = @()
  foreach ($tableName in $tableNames) {
    $columns += [ordered]@{
      table_name = $tableName
      ordinal_position = 1
      column_name = 'id'
      data_type = 'uuid'
      udt_schema = 'pg_catalog'
      udt_name = 'uuid'
      type_modifier = -1
      formatted_type = 'uuid'
      character_maximum_length = $null
      character_octet_length = $null
      numeric_precision = $null
      numeric_precision_radix = $null
      numeric_scale = $null
      datetime_precision = $null
      interval_type = $null
      interval_precision = $null
      domain_schema = $null
      domain_name = $null
      collation_schema = $null
      collation_name = $null
      is_nullable = 'NO'
      column_default = $null
      is_identity = 'NO'
      identity_generation = $null
      identity_start = $null
      identity_increment = $null
      identity_maximum = $null
      identity_minimum = $null
      identity_cycle = 'NO'
      is_generated = 'NEVER'
      generation_expression = $null
    }
    $columns += [ordered]@{
      table_name = $tableName
      ordinal_position = 2
      column_name = 'couple_id'
      data_type = 'uuid'
      udt_schema = 'pg_catalog'
      udt_name = 'uuid'
      type_modifier = -1
      formatted_type = 'uuid'
      character_maximum_length = $null
      character_octet_length = $null
      numeric_precision = $null
      numeric_precision_radix = $null
      numeric_scale = $null
      datetime_precision = $null
      interval_type = $null
      interval_precision = $null
      domain_schema = $null
      domain_name = $null
      collation_schema = $null
      collation_name = $null
      is_nullable = 'YES'
      column_default = $null
      is_identity = 'NO'
      identity_generation = $null
      identity_start = $null
      identity_increment = $null
      identity_maximum = $null
      identity_minimum = $null
      identity_cycle = 'NO'
      is_generated = 'NEVER'
      generation_expression = $null
    }
  }
  $functions = @(
    [ordered]@{ identity = 'update_updated_at_column()'; definition = 'create function public.update_updated_at_column() returns trigger language plpgsql as $$ begin return new; end $$;'; owner = 'postgres'; acl = $null; security_definer = $false; config = $null },
    [ordered]@{ identity = 'is_couple_member(uuid)'; definition = 'create function public.is_couple_member(uuid) returns boolean language sql stable as $$ select true $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=public') },
    [ordered]@{ identity = 'reserve_amora_turn(uuid,integer,integer)'; definition = 'create function public.reserve_amora_turn(uuid,integer,integer) returns boolean language sql as $$ select true $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=public') },
    [ordered]@{ identity = 'apply_journey_progress_patch(uuid,jsonb,text[])'; definition = 'create function public.apply_journey_progress_patch(uuid,jsonb,text[]) returns jsonb language sql as $$ select $2 $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=public') },
    [ordered]@{ identity = 'join_couple(text,text)'; definition = 'create function public.join_couple(text,text) returns uuid language sql as $$ select null::uuid $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=public') },
    [ordered]@{ identity = 'generate_invite_code()'; definition = 'create function public.generate_invite_code() returns text language sql as $$ select ''TEST'' $$;'; owner = 'postgres'; acl = $null; security_definer = $false; config = $null },
    [ordered]@{ identity = 'redact_old_ai_interactions(interval)'; definition = 'create function public.redact_old_ai_interactions(interval) returns integer language sql as $$ select 0 $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=public') },
    [ordered]@{ identity = 'create_profile_on_signup()'; definition = 'create function public.create_profile_on_signup() returns trigger language plpgsql as $$ begin return new; end $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=public') },
    [ordered]@{ identity = 'enqueue_amora_memory_job(uuid,uuid,text,uuid)'; definition = 'create function public.enqueue_amora_memory_job(uuid,uuid,text,uuid) returns text language sql as $$ select ''disabled''::text $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=pg_catalog, public') },
    [ordered]@{ identity = 'claim_amora_memory_job(integer)'; definition = 'create function public.claim_amora_memory_job(integer) returns setof public.amora_memory_jobs language sql as $$ select * from public.amora_memory_jobs where false $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=pg_catalog, public') },
    [ordered]@{ identity = 'finish_amora_memory_job(uuid,boolean,text,integer)'; definition = 'create function public.finish_amora_memory_job(uuid,boolean,text,integer) returns boolean language sql as $$ select true $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=pg_catalog, public') },
    [ordered]@{ identity = 'upsert_amora_memory_node(uuid,text,text,text,text,text,text,numeric,text,uuid,jsonb)'; definition = 'create function public.upsert_amora_memory_node(uuid,text,text,text,text,text,text,numeric,text,uuid,jsonb) returns uuid language sql as $$ select null::uuid $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=pg_catalog, public') },
    [ordered]@{ identity = 'update_amora_memory_node(uuid,text,uuid,uuid,text,text)'; definition = 'create function public.update_amora_memory_node(uuid,text,uuid,uuid,text,text) returns uuid language sql as $$ select null::uuid $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=pg_catalog, public') },
    [ordered]@{ identity = 'delete_amora_memory_node(uuid,text,uuid,uuid)'; definition = 'create function public.delete_amora_memory_node(uuid,text,uuid,uuid) returns boolean language sql as $$ select true $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=pg_catalog, public') },
    [ordered]@{ identity = 'insert_amora_memory_summary(uuid,uuid,text,text,integer,uuid,uuid)'; definition = 'create function public.insert_amora_memory_summary(uuid,uuid,text,text,integer,uuid,uuid) returns boolean language sql as $$ select true $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=pg_catalog, public') },
    [ordered]@{ identity = 'accept_amora_mediation(uuid,uuid,uuid,text,text)'; definition = 'create function public.accept_amora_mediation(uuid,uuid,uuid,text,text) returns jsonb language sql as $$ select ''{}''::jsonb $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=pg_catalog, public') },
    [ordered]@{ identity = 'insert_amora_care_message(uuid,text,jsonb)'; definition = 'create function public.insert_amora_care_message(uuid,text,jsonb) returns uuid language sql as $$ select null::uuid $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=pg_catalog, public') },
    [ordered]@{ identity = 'set_amora_memory_consent(uuid,text,uuid,boolean)'; definition = 'create function public.set_amora_memory_consent(uuid,text,uuid,boolean) returns jsonb language sql as $$ select ''{}''::jsonb $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=pg_catalog, public') },
    [ordered]@{ identity = 'clear_amora_memory_scope(uuid,text,uuid)'; definition = 'create function public.clear_amora_memory_scope(uuid,text,uuid) returns jsonb language sql as $$ select ''{}''::jsonb $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=pg_catalog, public') },
    [ordered]@{ identity = 'set_updated_at()'; definition = 'create function public.set_updated_at() returns trigger language plpgsql as $$ begin return new; end $$;'; owner = 'postgres'; acl = $null; security_definer = $false; config = $null },
    [ordered]@{ identity = 'can_read_profile(uuid)'; definition = 'create function public.can_read_profile(uuid) returns boolean language sql stable as $$ select true $$;'; owner = 'postgres'; acl = $null; security_definer = $true; config = @('search_path=public') },
    [ordered]@{ identity = 'set_amora_action_status_timestamps()'; definition = 'create function public.set_amora_action_status_timestamps() returns trigger language plpgsql as $$ begin return new; end $$;'; owner = 'postgres'; acl = $null; security_definer = $false; config = $null }
  )
  if ($Drift) {
    $functions[0].definition = $functions[0].definition + ' -- synthetic-schema-drift'
  }
  $authTriggerEnabled = if ($mode -eq 'disabled-auth-trigger') { 'D' } else { 'O' }
  $authTriggerFiresInsert = $mode -ne 'wrong-auth-trigger-event'
  return [ordered]@{
    captured_at = $CapturedAt.ToString('o')
    source_project_ref = $projectRef
    current_user = 'postgres'
    session_user = 'postgres'
    current_role_bypasses_rls = $true
    row_security = 'off'
    server_version_num = '170004'
    migration_history = @([ordered]@{ version = '20260714000000'; name = 'synthetic_self_test' })
    tables = $tables
    columns = $columns
    constraints = @(
      [ordered]@{ table = 'couples'; name = 'couples_pkey'; type = 'p'; validated = $true; definition = 'PRIMARY KEY (id)'; columns = @('id'); referenced_table = $null; referenced_columns = @() },
      [ordered]@{ table = 'chat_messages'; name = 'chat_messages_couple_id_fkey'; type = 'f'; validated = $true; definition = 'FOREIGN KEY (couple_id) REFERENCES couples(id)'; columns = @('couple_id'); referenced_table = 'public.couples'; referenced_columns = @('id') }
    )
    indexes = @([ordered]@{ table = 'couples'; name = 'couples_pkey'; definition = 'CREATE UNIQUE INDEX couples_pkey ON public.couples USING btree (id)' })
    policies = @($tableNames | ForEach-Object { [ordered]@{ schemaname = 'public'; tablename = $_; policyname = "synthetic_$($_)_service"; permissive = 'PERMISSIVE'; roles = '{service_role}'; cmd = 'ALL'; qual = 'true'; with_check = 'true' } })
    triggers = @([ordered]@{ table = 'couples'; name = 'set_updated_at'; enabled = 'O'; type_bits = 19; row_level = $true; timing = 'BEFORE'; fires_insert = $false; fires_delete = $false; fires_update = $true; fires_truncate = $false; function_identity = 'update_updated_at_column()'; definition = 'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.couples FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()' })
    functions = $functions
    external_triggers = @([ordered]@{ schema = 'auth'; table = 'users'; name = 'on_auth_user_created'; enabled = $authTriggerEnabled; type_bits = $(if ($authTriggerFiresInsert) { 5 } else { 17 }); row_level = $true; timing = 'AFTER'; fires_insert = $authTriggerFiresInsert; fires_delete = $false; fires_update = (-not $authTriggerFiresInsert); fires_truncate = $false; function_identity = 'create_profile_on_signup()'; definition = $(if ($authTriggerFiresInsert) { 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_profile_on_signup()' } else { 'CREATE TRIGGER on_auth_user_created AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_profile_on_signup()' }) })
  }
}

$payload = switch ($call) {
  1 {
    $preflightTables = if ($mode -eq 'partitioned-preflight') { @($tableNames | Select-Object -First 10) } else { $tableNames }
    [ordered]@{
      captured_at = $baseCapture.AddSeconds(-3).ToString('o')
      source_project_ref = $projectRef
      current_user = 'postgres'
      session_user = 'postgres'
      current_role_bypasses_rls = $true
      row_security = 'off'
      server_version_num = '170004'
      table_count = $preflightTables.Count
      estimated_total_bytes = 0
      estimated_total_rows = 0
      tables = @(New-RelationMetadata -Names $preflightTables -Stage 'preflight' | ForEach-Object {
        [ordered]@{
          name = $_.name
          relation_oid = $_.relation_oid
          relkind = $_.relkind
          has_inheritance_children = $_.has_inheritance_children
          is_inheritance_child = $_.is_inheritance_child
          estimated_bytes = 0
          estimated_rows = 0
        }
      })
    }
  }
  2 { New-Inventory -CapturedAt $baseCapture.AddSeconds(-2) -Drift $false }
  3 {
    $tablePayloads = [ordered]@{}
    foreach ($tableName in $tableNames) {
      $tablePayloads[$tableName] = [ordered]@{
        row_count = 0
        rows = @()
        canonical_sha256 = $emptyDigest
      }
    }
    [ordered]@{
      captured_at = $baseCapture.AddSeconds(-1).ToString('o')
      current_user = 'postgres'
      session_user = 'postgres'
      current_role_bypasses_rls = $true
      row_security = 'off'
      relations = @(New-RelationMetadata -Names $tableNames -Stage 'data')
      tables = $tablePayloads
    }
  }
  4 { New-Inventory -CapturedAt $baseCapture -Drift ($mode -eq 'schema-drift') }
}

$payloadJson = $payload | ConvertTo-Json -Compress -Depth 100
$wrapper = [ordered]@{
  rows = @([ordered]@{
    payload = $payloadJson
    payload_bytes = [Text.Encoding]::UTF8.GetByteCount($payloadJson)
  })
}
[Console]::Out.WriteLine(($wrapper | ConvertTo-Json -Compress -Depth 100))
exit 0
'@

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'scripts\amora-db-backup-common.ps1')
$backupScript = Join-Path $repoRoot 'scripts\amora-db-backup.ps1'
$verifyScript = Join-Path $repoRoot 'scripts\amora-db-verify-backup.ps1'
$linkedRefPath = Join-Path $repoRoot 'supabase\.temp\project-ref'
Assert-True -Condition (Test-Path -LiteralPath $backupScript -PathType Leaf) -Message 'Backup creator script is missing.'
Assert-True -Condition (Test-Path -LiteralPath $verifyScript -PathType Leaf) -Message 'Backup verifier script is missing.'
Assert-True -Condition (Test-Path -LiteralPath $linkedRefPath -PathType Leaf) -Message 'The self-test worktree must have an explicit linked project ref fence.'
$projectRef = ([IO.File]::ReadAllText($linkedRefPath)).Trim()
Assert-True -Condition ($projectRef -match '^[a-z0-9]{20}$') -Message 'Linked project ref is not a canonical 20-character ref.'
$nodeCli = (Get-Command node.exe -ErrorAction Stop).Source
$logicalSqlSelfTestScript = Join-Path $repoRoot 'apps\web\scripts\amora-db-logical-backup-sql-selftest.mjs'
$logicalSqlPath = Join-Path $repoRoot 'scripts\sql\amora-db-logical-backup.sql'
Assert-True -Condition (Test-Path -LiteralPath $logicalSqlSelfTestScript -PathType Leaf) -Message 'Logical SQL PGlite self-test script is missing.'
Assert-True -Condition (Test-Path -LiteralPath $logicalSqlPath -PathType Leaf) -Message 'Logical backup SQL is missing.'

$stateDirectory = Join-Path ([IO.Path]::GetTempPath()) "WeddingHanbang-Amora-Backup-Harness-$([Guid]::NewGuid().ToString('N'))"
$roots = [Collections.Generic.List[string]]::new()
$testNames = [Collections.Generic.List[string]]::new()
[IO.Directory]::CreateDirectory($stateDirectory) | Out-Null
$fakeCliScript = Join-Path $stateDirectory 'fake-supabase.ps1'
$fakeCliCommand = Join-Path $stateDirectory 'fake-supabase.cmd'
[IO.File]::WriteAllText($fakeCliScript, $fakeCliSource, [Text.UTF8Encoding]::new($false))
$cmdSource = "@echo off`r`n`"$((Get-Command powershell.exe).Source)`" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"%~dp0fake-supabase.ps1`" %*`r`nexit /b %ERRORLEVEL%`r`n"
[IO.File]::WriteAllText($fakeCliCommand, $cmdSource, [Text.Encoding]::ASCII)

try {
  $maliciousSqlPath = Join-Path $stateDirectory 'commit-escape.sql'
  [IO.File]::WriteAllText(
    $maliciousSqlPath,
    "begin transaction read only;`nset local statement_timeout = '120s';`nset local lock_timeout = '5s';`nset local row_security = off;`nselect 1;`ncommit work;`nupdate public.profiles set updated_at = now();`ncommit;`n",
    [Text.UTF8Encoding]::new($false)
  )
  $sqlEscapeRejected = $false
  try { Assert-HBAM2ReadOnlySqlSafetyGuard -Path $maliciousSqlPath }
  catch { $sqlEscapeRejected = $true }
  Assert-True -Condition $sqlEscapeRejected -Message 'Read-only SQL guard accepted an intermediate COMMIT WORK escape.'
  [void]$testNames.Add('read-only SQL guard rejects intermediate transaction escape')

  $savedCliOverride = $env:SUPABASE_CLI_BINARY_OVERRIDE
  $env:SUPABASE_CLI_BINARY_OVERRIDE = $fakeCliCommand
  $cliOverrideRejected = $false
  $unexpectedCliFence = $null
  try {
    $unexpectedCliFence = New-HBAM2SupabaseCliFence `
      -RepoRoot $repoRoot -RequestedCli 'supabase' -SelfTest $false
  } catch { $cliOverrideRejected = $true }
  finally {
    if ($unexpectedCliFence) { Close-HBAM2SupabaseCliFence -Fence $unexpectedCliFence }
    if ($null -eq $savedCliOverride) { Remove-Item Env:SUPABASE_CLI_BINARY_OVERRIDE -ErrorAction SilentlyContinue }
    else { $env:SUPABASE_CLI_BINARY_OVERRIDE = $savedCliOverride }
  }
  Assert-True -Condition $cliOverrideRejected -Message 'Production CLI fence accepted SUPABASE_CLI_BINARY_OVERRIDE.'
  [void]$testNames.Add('production Supabase binary override rejected')

  $customCliRejected = $false
  $unexpectedCliFence = $null
  try {
    $unexpectedCliFence = New-HBAM2SupabaseCliFence `
      -RepoRoot $repoRoot -RequestedCli $fakeCliCommand -SelfTest $false
  } catch { $customCliRejected = $true }
  finally { if ($unexpectedCliFence) { Close-HBAM2SupabaseCliFence -Fence $unexpectedCliFence } }
  Assert-True -Condition $customCliRejected -Message 'Production CLI fence accepted a custom executable.'
  [void]$testNames.Add('production custom Supabase CLI rejected')

  $runtimeContract = Get-HBAM2VerifierRuntimeContract -RepoRoot $repoRoot
  $savedNodeOptions = $env:NODE_OPTIONS
  $env:NODE_OPTIONS = '--import=synthetic-malicious-preload.mjs'
  $nodeOptionsRejected = $false
  $unexpectedRuntimeFence = $null
  try {
    $unexpectedRuntimeFence = New-HBAM2VerifierRuntimeFence `
      -RepoRoot $repoRoot -RequestedNode 'node.exe' -SelfTest $false -Contract $runtimeContract
  } catch { $nodeOptionsRejected = $true }
  finally {
    if ($unexpectedRuntimeFence) { Close-HBAM2VerifierRuntimeFence -Fence $unexpectedRuntimeFence }
    if ($null -eq $savedNodeOptions) { Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue }
    else { $env:NODE_OPTIONS = $savedNodeOptions }
  }
  Assert-True -Condition $nodeOptionsRejected -Message 'Production runtime fence accepted inherited NODE_OPTIONS.'
  [void]$testNames.Add('production inherited Node preload options rejected')

  $customNodeRejected = $false
  $unexpectedRuntimeFence = $null
  try {
    $unexpectedRuntimeFence = New-HBAM2VerifierRuntimeFence `
      -RepoRoot $repoRoot -RequestedNode $fakeCliCommand -SelfTest $false -Contract $runtimeContract
  } catch { $customNodeRejected = $true }
  finally { if ($unexpectedRuntimeFence) { Close-HBAM2VerifierRuntimeFence -Fence $unexpectedRuntimeFence } }
  Assert-True -Condition $customNodeRejected -Message 'Production runtime fence accepted a custom Node executable.'
  [void]$testNames.Add('production custom Node runtime rejected')

  $trustedRuntimeFence = $null
  try {
    $trustedRuntimeFence = New-HBAM2VerifierRuntimeFence `
      -RepoRoot $repoRoot -RequestedNode 'node.exe' -SelfTest $false -Contract $runtimeContract
    $trustedSmoke = Invoke-TrustedPGliteSmoke `
      -RuntimeFence $trustedRuntimeFence `
      -ScriptPath (Join-Path $repoRoot 'apps\web\scripts\amora-db-jsonb-roundtrip.mjs') `
      -TableNames $ExpectedTables
    Assert-True -Condition ($trustedSmoke.ExitCode -eq 0) -Message "Trusted runtime smoke failed: $($trustedSmoke.StdErr)"
    $trustedReceipt = Get-JsonOutput -Output $trustedSmoke.StdOut
    Assert-True `
      -Condition ([bool]$trustedReceipt.JsonbRoundTripVerified -and [int]$trustedReceipt.TableCount -eq $ExpectedTables.Count) `
      -Message 'Trusted runtime smoke returned an invalid receipt.'
    Assert-HBAM2VerifierRuntimeFence -Fence $trustedRuntimeFence
  } finally { Close-HBAM2VerifierRuntimeFence -Fence $trustedRuntimeFence }
  [void]$testNames.Add('trusted Node and physical PGlite tree import/query/lock passes')

  $logicalSqlResult = Invoke-NodeSelfTest `
    -NodeCli $nodeCli `
    -ScriptPath $logicalSqlSelfTestScript `
    -SqlPath $logicalSqlPath `
    -WorkingDirectory (Join-Path $repoRoot 'apps\web')
  Assert-True -Condition ($logicalSqlResult.ExitCode -eq 0) -Message "Actual logical SQL PGlite self-test failed: $($logicalSqlResult.StdErr)"
  $logicalSqlReceipt = Get-JsonOutput -Output $logicalSqlResult.StdOut
  Assert-True `
    -Condition (
      [bool]$logicalSqlReceipt.ActualLogicalSqlExecuted -and
      [bool]$logicalSqlReceipt.OnlyTargetTablesRead -and
      [bool]$logicalSqlReceipt.RelationIdentityContractCaptured -and
      [bool]$logicalSqlReceipt.CanonicalDigestsLowercase -and
      [bool]$logicalSqlReceipt.ExactLargeIntegerPreserved -and
      [bool]$logicalSqlReceipt.ExactNumericPreserved -and
      -not [bool]$logicalSqlReceipt.PlaintextWrittenToDisk -and
      [int]$logicalSqlReceipt.TableCount -eq $ExpectedTables.Count
    ) `
    -Message 'Actual logical SQL PGlite receipt failed its contract.'
  [void]$testNames.Add('actual logical backup SQL executes with exact numerics + lowercase canonical digests')

  $rootA = New-SelfTestRoot
  [void]$roots.Add($rootA)
  $createA = Invoke-Backup `
    -BackupScript $backupScript `
    -FakeCli $fakeCliCommand `
    -Root $rootA `
    -ProjectRef $projectRef `
    -StateDirectory $stateDirectory `
    -RepoRoot $repoRoot
  Assert-True -Condition ($createA.ExitCode -eq 0) -Message "Synthetic creator failed: $($createA.StdErr)"
  $receiptA = Get-JsonOutput -Output $createA.StdOut
  $backupA = [string]$receiptA.BackupDirectory
  Assert-True -Condition (Test-Path -LiteralPath $backupA -PathType Container) -Message 'Creator receipt backup directory is missing.'
  Assert-FakeInvocationContract -StateDirectory $stateDirectory -RepoRoot $repoRoot
  [void]$testNames.Add('fake CLI preflight/inventory/data/inventory order + exact --workdir')

  $manifestAPath = Join-Path $backupA 'manifest.json'
  $manifestAHash = Get-FileSha256Hex -Path $manifestAPath
  Assert-True -Condition ($manifestAHash -eq [string]$receiptA.ManifestSha256) -Message 'Creator external manifest anchor is not the actual manifest hash.'
  Assert-True -Condition ([string]$receiptA.BackupSetId -match '^[a-f0-9-]{36}$') -Message 'Creator receipt has no canonical backup set id anchor.'
  $manifestA = Read-Manifest -Directory $backupA
  Assert-True -Condition ([string]$manifestA.backup_set_id -eq [string]$receiptA.BackupSetId) -Message 'Receipt and manifest backup set ids differ.'
  Assert-True -Condition ([string]$manifestA.inventory_contract_sha256 -match '^[A-Fa-f0-9]{64}$') -Message 'Manifest has no schema inventory contract digest.'
  $actualFiles = @(Get-ChildItem -LiteralPath $backupA -Force | ForEach-Object Name | Sort-Object)
  Assert-True -Condition ($actualFiles.Count -eq $ExpectedFiles.Count) -Message 'Creator wrote plaintext or an unexpected artifact.'
  Assert-True -Condition (@(Compare-Object -ReferenceObject $ExpectedFiles -DifferenceObject $actualFiles).Count -eq 0) -Message 'Creator artifact allowlist differs from HBAM2 contract.'
  [void]$testNames.Add('manifest external anchors + exact encrypted artifact allowlist')

  $inventoryAuth = Read-AndAuthenticateHbam2Artifact `
    -Directory $backupA `
    -Metadata $manifestA.artifacts.schema_inventory `
    -ArtifactName 'schema-inventory.json' `
    -ProjectRef $projectRef `
    -BackupSetId ([string]$receiptA.BackupSetId)
  $logicalAuth = Read-AndAuthenticateHbam2Artifact `
    -Directory $backupA `
    -Metadata $manifestA.artifacts.logical_data `
    -ArtifactName 'logical-data.json' `
    -ProjectRef $projectRef `
    -BackupSetId ([string]$receiptA.BackupSetId)
  Assert-True -Condition ($inventoryAuth.EnvelopeBackupSetId -eq $logicalAuth.EnvelopeBackupSetId) -Message 'HBAM2 artifacts do not share one authenticated set id.'
  Assert-True -Condition ($inventoryAuth.MasterKeySha256 -ne $logicalAuth.MasterKeySha256) -Message 'HBAM2 artifacts unexpectedly reused one master key.'
  Assert-True -Condition ($inventoryAuth.IvHex -ne $logicalAuth.IvHex) -Message 'HBAM2 artifacts unexpectedly reused one AES IV.'
  $inventoryPayload = ([Text.Encoding]::UTF8.GetString($inventoryAuth.Plaintext)) | ConvertFrom-Json
  $logicalPayload = ([Text.Encoding]::UTF8.GetString($logicalAuth.Plaintext)) | ConvertFrom-Json
  Assert-True -Condition ([string]$manifestA.source_captured_at -eq [string]$logicalPayload.captured_at) -Message 'Manifest source captured_at is not bound to authenticated logical data.'
  $inventoryCapturedField = if ($manifestA.PSObject.Properties['inventory_captured_at_before']) {
    'inventory_captured_at_before'
  } else {
    'inventory_captured_at'
  }
  Assert-True -Condition ([string]$manifestA.$inventoryCapturedField -eq [string]$inventoryPayload.captured_at) -Message 'Manifest inventory captured_at is not bound to authenticated inventory.'
  [void]$testNames.Add('DPAPI + AES-256-CBC + HMAC + shared set id + captured_at binding')

  $verifyA = Invoke-Verify `
    -VerifyScript $verifyScript `
    -Directory $backupA `
    -Root $rootA `
    -ProjectRef $projectRef `
    -BackupSetId ([string]$receiptA.BackupSetId) `
    -ManifestSha256 ([string]$receiptA.ManifestSha256) `
    -NodeCli $nodeCli
  Assert-True -Condition ($verifyA.ExitCode -eq 0) -Message "Synthetic verifier failed: $($verifyA.StdErr)"
  $verifyReceipt = Get-JsonOutput -Output $verifyA.StdOut
  Assert-True `
    -Condition (
      [bool]$verifyReceipt.Verified -and
      [bool]$verifyReceipt.SourceCanonicalDigestsVerified -and
      [bool]$verifyReceipt.PGliteJsonbRoundTripVerified -and
      -not [bool]$verifyReceipt.PlaintextWrittenToDisk
    ) `
    -Message 'Verifier did not return the complete source-digest/JSONB integrity receipt.'
  [void]$testNames.Add('creator to verifier positive end-to-end')

  $heldCaptureLock = New-HBAM2CaptureLock -Root $rootA
  try {
    $concurrentCapture = Invoke-Backup `
      -BackupScript $backupScript -FakeCli $fakeCliCommand -Root $rootA -ProjectRef $projectRef `
      -StateDirectory $stateDirectory -RepoRoot $repoRoot
  } finally {
    $heldCaptureLock.Dispose()
  }
  Assert-Rejected -CaseName 'concurrent capture lock contention' -Result $concurrentCapture
  Assert-True `
    -Condition ($concurrentCapture.StdErr -match 'exclusive capture lock') `
    -Message 'Concurrent capture was not rejected by the exclusive root lock.'
  Assert-True `
    -Condition ((Get-FileSha256Hex -Path $manifestAPath) -eq $manifestAHash) `
    -Message 'Rejected concurrent capture changed or deleted the completed winner backup.'
  [void]$testNames.Add('exclusive capture lock rejects loser and preserves winner backup')

  $wrongHash = ('0' * 64)
  if ($wrongHash -eq [string]$receiptA.ManifestSha256) { $wrongHash = ('F' * 64) }
  Assert-Rejected -CaseName 'wrong external manifest anchor' -Result (Invoke-Verify `
    -VerifyScript $verifyScript -Directory $backupA -Root $rootA -ProjectRef $projectRef `
    -BackupSetId ([string]$receiptA.BackupSetId) -ManifestSha256 $wrongHash -NodeCli $nodeCli)
  [void]$testNames.Add('wrong external manifest anchor rejected')

  Assert-Rejected -CaseName 'wrong external backup set anchor' -Result (Invoke-Verify `
    -VerifyScript $verifyScript -Directory $backupA -Root $rootA -ProjectRef $projectRef `
    -BackupSetId ([Guid]::NewGuid().ToString('D')) -ManifestSha256 ([string]$receiptA.ManifestSha256) -NodeCli $nodeCli)
  [void]$testNames.Add('wrong external backup set anchor rejected')

  $wrongProjectRef = if ($projectRef -eq ('a' * 20)) { 'b' * 20 } else { 'a' * 20 }
  Assert-Rejected -CaseName 'wrong source project ref' -Result (Invoke-Verify `
    -VerifyScript $verifyScript -Directory $backupA -Root $rootA -ProjectRef $wrongProjectRef `
    -BackupSetId ([string]$receiptA.BackupSetId) -ManifestSha256 ([string]$receiptA.ManifestSha256) -NodeCli $nodeCli)
  [void]$testNames.Add('wrong project ref rejected')

  $byteTamper = Copy-BackupCase -Source $backupA -Root $rootA -Ordinal 1
  $tamperedArtifactPath = Join-Path $byteTamper 'logical-data.json.hbam2'
  $tamperedBytes = [IO.File]::ReadAllBytes($tamperedArtifactPath)
  $tamperedBytes[50] = $tamperedBytes[50] -bxor 1
  [IO.File]::WriteAllBytes($tamperedArtifactPath, $tamperedBytes)
  Assert-Rejected -CaseName 'ciphertext byte tamper' -Result (Invoke-Verify `
    -VerifyScript $verifyScript -Directory $byteTamper -Root $rootA -ProjectRef $projectRef `
    -BackupSetId ([string]$receiptA.BackupSetId) -ManifestSha256 ([string]$receiptA.ManifestSha256) -NodeCli $nodeCli)
  [void]$testNames.Add('ciphertext byte tamper rejected')

  $hmacTamper = Copy-BackupCase -Source $backupA -Root $rootA -Ordinal 2
  $hmacArtifactPath = Join-Path $hmacTamper 'logical-data.json.hbam2'
  $hmacBytes = [IO.File]::ReadAllBytes($hmacArtifactPath)
  $hmacBytes[50] = $hmacBytes[50] -bxor 2
  [IO.File]::WriteAllBytes($hmacArtifactPath, $hmacBytes)
  $hmacManifest = Read-Manifest -Directory $hmacTamper
  $hmacManifest.artifacts.logical_data.encrypted_sha256 = Get-Sha256Hex -Bytes $hmacBytes
  Write-Manifest -Directory $hmacTamper -Manifest $hmacManifest
  $hmacManifestHash = Get-FileSha256Hex -Path (Join-Path $hmacTamper 'manifest.json')
  Assert-Rejected -CaseName 'HMAC tamper with refreshed unauthenticated hashes' -Result (Invoke-Verify `
    -VerifyScript $verifyScript -Directory $hmacTamper -Root $rootA -ProjectRef $projectRef `
    -BackupSetId ([string]$receiptA.BackupSetId) -ManifestSha256 $hmacManifestHash -NodeCli $nodeCli)
  [void]$testNames.Add('HMAC tamper rejected even after manifest hashes are refreshed')

  $capturedAtTamper = Copy-BackupCase -Source $backupA -Root $rootA -Ordinal 3
  $capturedManifest = Read-Manifest -Directory $capturedAtTamper
  $capturedManifest.source_captured_at = ([DateTimeOffset]::Parse([string]$capturedManifest.source_captured_at)).AddSeconds(1).ToString('o')
  Write-Manifest -Directory $capturedAtTamper -Manifest $capturedManifest
  $capturedManifestHash = Get-FileSha256Hex -Path (Join-Path $capturedAtTamper 'manifest.json')
  Assert-Rejected -CaseName 'captured_at mismatch with refreshed external hash' -Result (Invoke-Verify `
    -VerifyScript $verifyScript -Directory $capturedAtTamper -Root $rootA -ProjectRef $projectRef `
    -BackupSetId ([string]$receiptA.BackupSetId) -ManifestSha256 $capturedManifestHash -NodeCli $nodeCli)
  [void]$testNames.Add('manifest/authenticated payload captured_at mismatch rejected')

  $extraFileCase = Copy-BackupCase -Source $backupA -Root $rootA -Ordinal 4
  [IO.File]::WriteAllText((Join-Path $extraFileCase 'unexpected.txt'), 'synthetic', [Text.UTF8Encoding]::new($false))
  Assert-Rejected -CaseName 'extra backup file' -Result (Invoke-Verify `
    -VerifyScript $verifyScript -Directory $extraFileCase -Root $rootA -ProjectRef $projectRef `
    -BackupSetId ([string]$receiptA.BackupSetId) -ManifestSha256 ([string]$receiptA.ManifestSha256) -NodeCli $nodeCli)
  [void]$testNames.Add('extra artifact rejected')

  $aclCase = Copy-BackupCase -Source $backupA -Root $rootA -Ordinal 5
  $aclTarget = Join-Path $aclCase 'manifest.json'
  $acl = Get-Acl -LiteralPath $aclTarget
  $everyone = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $everyone,
    [Security.AccessControl.FileSystemRights]::Read,
    [Security.AccessControl.AccessControlType]::Allow
  )
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $aclTarget -AclObject $acl
  Assert-Rejected -CaseName 'unexpected Everyone ACL' -Result (Invoke-Verify `
    -VerifyScript $verifyScript -Directory $aclCase -Root $rootA -ProjectRef $projectRef `
    -BackupSetId ([string]$receiptA.BackupSetId) -ManifestSha256 ([string]$receiptA.ManifestSha256) -NodeCli $nodeCli)
  [void]$testNames.Add('unexpected ACL rejected')

  $rootB = New-SelfTestRoot
  [void]$roots.Add($rootB)
  $createB = Invoke-Backup `
    -BackupScript $backupScript -FakeCli $fakeCliCommand -Root $rootB -ProjectRef $projectRef `
    -StateDirectory $stateDirectory -RepoRoot $repoRoot -CaptureTime ([DateTimeOffset]::UtcNow.AddSeconds(1))
  Assert-True -Condition ($createB.ExitCode -eq 0) -Message "Second synthetic creator failed: $($createB.StdErr)"
  $receiptB = Get-JsonOutput -Output $createB.StdOut
  $backupB = [string]$receiptB.BackupDirectory
  Assert-FakeInvocationContract -StateDirectory $stateDirectory -RepoRoot $repoRoot

  $mixCase = Copy-BackupCase -Source $backupA -Root $rootA -Ordinal 6
  foreach ($fileName in @('logical-data.json.hbam2', 'logical-data.json.key.dpapi')) {
    Copy-Item -LiteralPath (Join-Path $backupB $fileName) -Destination (Join-Path $mixCase $fileName) -Force
  }
  $mixManifest = Read-Manifest -Directory $mixCase
  $manifestB = Read-Manifest -Directory $backupB
  $mixManifest.artifacts.logical_data = $manifestB.artifacts.logical_data
  Write-Manifest -Directory $mixCase -Manifest $mixManifest
  $mixManifestHash = Get-FileSha256Hex -Path (Join-Path $mixCase 'manifest.json')
  Assert-Rejected -CaseName 'cross-set artifact mix' -Result (Invoke-Verify `
    -VerifyScript $verifyScript -Directory $mixCase -Root $rootA -ProjectRef $projectRef `
    -BackupSetId ([string]$receiptA.BackupSetId) -ManifestSha256 $mixManifestHash -NodeCli $nodeCli)
  [void]$testNames.Add('cross-set artifact/key/metadata mix rejected')

  $replayCase = Copy-BackupCase -Source $backupA -Root $rootA -Ordinal 7
  Assert-Rejected -CaseName 'old set replay under newer anchors' -Result (Invoke-Verify `
    -VerifyScript $verifyScript -Directory $replayCase -Root $rootA -ProjectRef $projectRef `
    -BackupSetId ([string]$receiptB.BackupSetId) -ManifestSha256 ([string]$receiptB.ManifestSha256) -NodeCli $nodeCli)
  [void]$testNames.Add('replay under a different external receipt rejected')

  $rootStale = New-SelfTestRoot
  [void]$roots.Add($rootStale)
  $createStale = Invoke-Backup `
    -BackupScript $backupScript -FakeCli $fakeCliCommand -Root $rootStale -ProjectRef $projectRef `
    -StateDirectory $stateDirectory -RepoRoot $repoRoot -CaptureTime ([DateTimeOffset]::UtcNow.AddHours(-2))
  Assert-True -Condition ($createStale.ExitCode -eq 0) -Message "Stale synthetic creator failed before the verifier age gate: $($createStale.StdErr)"
  $receiptStale = Get-JsonOutput -Output $createStale.StdOut
  Assert-FakeInvocationContract -StateDirectory $stateDirectory -RepoRoot $repoRoot
  Assert-Rejected -CaseName 'stale captured_at replay' -Result (Invoke-Verify `
    -VerifyScript $verifyScript -Directory ([string]$receiptStale.BackupDirectory) -Root $rootStale -ProjectRef $projectRef `
    -BackupSetId ([string]$receiptStale.BackupSetId) -ManifestSha256 ([string]$receiptStale.ManifestSha256) -NodeCli $nodeCli)
  [void]$testNames.Add('stale captured_at replay rejected by MaximumAgeMinutes')

  $rootDrift = New-SelfTestRoot
  [void]$roots.Add($rootDrift)
  $driftResult = Invoke-Backup `
    -BackupScript $backupScript -FakeCli $fakeCliCommand -Root $rootDrift -ProjectRef $projectRef `
    -StateDirectory $stateDirectory -RepoRoot $repoRoot -Mode 'schema-drift'
  Assert-Rejected -CaseName 'schema inventory drift during backup' -Result $driftResult
  Assert-FakeInvocationContract -StateDirectory $stateDirectory -RepoRoot $repoRoot
  if (Test-Path -LiteralPath $rootDrift) {
    $driftEntries = @(Get-ChildItem -LiteralPath $rootDrift -Force)
    $unexpectedDriftEntries = @($driftEntries | Where-Object {
      $_.Name -notin @('.amora-backup-root-v2', '.amora-backup-capture-v2.lock')
    })
    Assert-True -Condition ($unexpectedDriftEntries.Count -eq 0) -Message 'Schema-drift failure published or left a partial backup.'
  }
  [void]$testNames.Add('inventory-before/after schema drift rejected without publication')

  $rootRelink = New-SelfTestRoot
  [void]$roots.Add($rootRelink)
  $relinkResult = Invoke-Backup `
    -BackupScript $backupScript -FakeCli $fakeCliCommand -Root $rootRelink -ProjectRef $projectRef `
    -StateDirectory $stateDirectory -RepoRoot $repoRoot -Mode 'relink-attempt'
  Assert-Rejected -CaseName 'linked project relink during capture' -Result $relinkResult
  Assert-True `
    -Condition (([IO.File]::ReadAllText($linkedRefPath)).Trim() -eq $projectRef) `
    -Message 'Synthetic relink test changed the actual linked project ref.'
  if (Test-Path -LiteralPath $rootRelink) {
    $relinkEntries = @(Get-ChildItem -LiteralPath $rootRelink -Force)
    $unexpectedRelinkEntries = @($relinkEntries | Where-Object {
      $_.Name -notin @('.amora-backup-root-v2', '.amora-backup-capture-v2.lock')
    })
    Assert-True -Condition ($unexpectedRelinkEntries.Count -eq 0) -Message 'Relink failure published or left a partial backup.'
  }
  [void]$testNames.Add('linked project ref is held read-only for the full capture')

  $rootDisabledTrigger = New-SelfTestRoot
  [void]$roots.Add($rootDisabledTrigger)
  $disabledTriggerResult = Invoke-Backup `
    -BackupScript $backupScript -FakeCli $fakeCliCommand -Root $rootDisabledTrigger -ProjectRef $projectRef `
    -StateDirectory $stateDirectory -RepoRoot $repoRoot -Mode 'disabled-auth-trigger'
  Assert-Rejected -CaseName 'disabled auth signup trigger' -Result $disabledTriggerResult
  [void]$testNames.Add('disabled auth.users signup trigger rejected')

  $rootWrongTriggerEvent = New-SelfTestRoot
  [void]$roots.Add($rootWrongTriggerEvent)
  $wrongTriggerEventResult = Invoke-Backup `
    -BackupScript $backupScript -FakeCli $fakeCliCommand -Root $rootWrongTriggerEvent -ProjectRef $projectRef `
    -StateDirectory $stateDirectory -RepoRoot $repoRoot -Mode 'wrong-auth-trigger-event'
  Assert-Rejected -CaseName 'wrong auth signup trigger event' -Result $wrongTriggerEventResult
  [void]$testNames.Add('non-INSERT auth.users signup trigger rejected')

  $rootPartitioned = New-SelfTestRoot
  [void]$roots.Add($rootPartitioned)
  $partitionedResult = Invoke-Backup `
    -BackupScript $backupScript -FakeCli $fakeCliCommand -Root $rootPartitioned -ProjectRef $projectRef `
    -StateDirectory $stateDirectory -RepoRoot $repoRoot -Mode 'partitioned-preflight'
  Assert-Rejected -CaseName 'partitioned target preflight' -Result $partitionedResult
  [void]$testNames.Add('partitioned/missing target preflight rejected')

  $rootPreflightOidDrift = New-SelfTestRoot
  [void]$roots.Add($rootPreflightOidDrift)
  $preflightOidDriftResult = Invoke-Backup `
    -BackupScript $backupScript -FakeCli $fakeCliCommand -Root $rootPreflightOidDrift -ProjectRef $projectRef `
    -StateDirectory $stateDirectory -RepoRoot $repoRoot -Mode 'preflight-oid-drift'
  Assert-Rejected -CaseName 'preflight to inventory relation replacement' -Result $preflightOidDriftResult
  [void]$testNames.Add('preflight-to-inventory relation OID replacement rejected')

  $rootDataOidDrift = New-SelfTestRoot
  [void]$roots.Add($rootDataOidDrift)
  $dataOidDriftResult = Invoke-Backup `
    -BackupScript $backupScript -FakeCli $fakeCliCommand -Root $rootDataOidDrift -ProjectRef $projectRef `
    -StateDirectory $stateDirectory -RepoRoot $repoRoot -Mode 'data-oid-drift'
  Assert-Rejected -CaseName 'inventory to data relation replacement' -Result $dataOidDriftResult
  [void]$testNames.Add('inventory-to-data relation OID replacement rejected')

  $rootInheritedData = New-SelfTestRoot
  [void]$roots.Add($rootInheritedData)
  $inheritedDataResult = Invoke-Backup `
    -BackupScript $backupScript -FakeCli $fakeCliCommand -Root $rootInheritedData -ProjectRef $projectRef `
    -StateDirectory $stateDirectory -RepoRoot $repoRoot -Mode 'inherited-data-relation'
  Assert-Rejected -CaseName 'transient inherited data relation' -Result $inheritedDataResult
  [void]$testNames.Add('transient inherited relation shape rejected at data statement')

  [pscustomobject]@{
    Passed = $true
    TestCount = $testNames.Count
    Tests = @($testNames)
    ProductionDatabaseQueried = $false
    FakeSupabaseCli = $true
    PlaintextWrittenToBackupDirectory = $false
    TemporaryArtifactsKept = [bool]$KeepArtifacts
  } | ConvertTo-Json -Compress -Depth 5
} finally {
  if (-not $KeepArtifacts) {
    foreach ($root in $roots) {
      Assert-SafeTemporaryPath -Path $root
      if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
    }
    Assert-SafeTemporaryPath -Path $stateDirectory
    if (Test-Path -LiteralPath $stateDirectory) { Remove-Item -LiteralPath $stateDirectory -Recurse -Force }
  } else {
    Write-Warning "Synthetic backup roots retained: $($roots -join ', ')"
    Write-Warning "Harness state retained: $stateDirectory"
  }
}
