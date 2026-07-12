Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Windows PowerShell reconstructs PSModulePath at startup even when the parent
# environment supplies a narrower value. Reset it inside the process before any
# module-discovered command can run, import only fixed OS modules by manifest,
# then disable all further automatic module loading.
$systemModuleRoot = [IO.Path]::Combine(
  "C:\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "Modules"
)
$systemModuleRoot = [IO.Path]::GetFullPath($systemModuleRoot)
$env:PSModulePath = $systemModuleRoot
$global:PSModuleAutoLoadingPreference = "None"

foreach ($moduleName in @(
  "Microsoft.PowerShell.Management",
  "Microsoft.PowerShell.Security",
  "Microsoft.PowerShell.Utility"
)) {
  $manifest = [IO.Path]::Combine(
    $systemModuleRoot,
    $moduleName,
    "$moduleName.psd1"
  )
  if (-not [IO.File]::Exists($manifest)) {
    throw "A required reviewed Windows PowerShell module is unavailable."
  }
  Import-Module -Name $manifest -Force -ErrorAction Stop
}

$modulePaths = @($env:PSModulePath -split [IO.Path]::PathSeparator)
if (@($modulePaths).Count -ne 1 -or
  -not $modulePaths[0].Equals($systemModuleRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The reviewed Windows PowerShell module boundary was not preserved."
}

$envelopeBase64 = $env:HANBANG_REVIEWED_ENVELOPE_BASE64
$env:HANBANG_REVIEWED_ENVELOPE_BASE64 = $null
try {
  $envelopeJson = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String($envelopeBase64)
  )
  $envelope = ConvertFrom-Json -InputObject $envelopeJson
} catch {
  throw "The reviewed PowerShell execution envelope is invalid."
}
$expectedEnvelopeProperties = @(
  "reviewedScript",
  "reviewedDirectory",
  "expectedScriptSha256",
  "forwardedArgumentsBase64",
  "reviewedReleaseTargetsJson",
  "reviewedFenceStatusSql"
)
$actualEnvelopeProperties = @($envelope.PSObject.Properties.Name)
if ($envelope -isnot [pscustomobject] -or
  @($actualEnvelopeProperties).Count -ne @($expectedEnvelopeProperties).Count -or
  @($actualEnvelopeProperties | Where-Object { $_ -notin $expectedEnvelopeProperties }).Count -ne 0 -or
  @($expectedEnvelopeProperties | Where-Object { $_ -notin $actualEnvelopeProperties }).Count -ne 0 -or
  $envelope.reviewedScript -isnot [string] -or
  $envelope.reviewedDirectory -isnot [string] -or
  $envelope.expectedScriptSha256 -isnot [string] -or
  $envelope.forwardedArgumentsBase64 -isnot [string] -or
  $envelope.reviewedReleaseTargetsJson -isnot [string] -or
  $envelope.reviewedFenceStatusSql -isnot [string] -or
  $envelope.reviewedReleaseTargetsJson.Length -lt 1 -or
  $envelope.reviewedReleaseTargetsJson.Length -gt 16384 -or
  $envelope.reviewedFenceStatusSql.Length -lt 1 -or
  $envelope.reviewedFenceStatusSql.Length -gt 65536 -or
  $envelope.reviewedReleaseTargetsJson.Contains([char]0) -or
  $envelope.reviewedFenceStatusSql.Contains([char]0)) {
  throw "The reviewed PowerShell execution envelope has an unexpected schema."
}
$ReviewedScript = [string]$envelope.reviewedScript
$ExpectedScriptSha256 = [string]$envelope.expectedScriptSha256
$ForwardedArgumentsBase64 = [string]$envelope.forwardedArgumentsBase64
$ReviewedReleaseTargetsJson = [string]$envelope.reviewedReleaseTargetsJson
$ReviewedFenceStatusSql = [string]$envelope.reviewedFenceStatusSql

$allowedScripts = @(
  "supabase-reconcile-core-baseline.ps1",
  "supabase-ship-safe.ps1",
  "supabase-write-fence.ps1"
)
$resolvedScript = [IO.Path]::GetFullPath($ReviewedScript)
$reviewedDirectory = [IO.Path]::GetFullPath([string]$envelope.reviewedDirectory)
if (-not [IO.File]::Exists($resolvedScript) -or
  -not [IO.Directory]::Exists($reviewedDirectory) -or
  [IO.File]::GetAttributes($reviewedDirectory).HasFlag([IO.FileAttributes]::ReparsePoint) -or
  -not [IO.Path]::GetDirectoryName($resolvedScript).Equals(
    $reviewedDirectory,
    [StringComparison]::OrdinalIgnoreCase
  ) -or
  [IO.File]::GetAttributes($resolvedScript).HasFlag([IO.FileAttributes]::ReparsePoint) -or
  [IO.Path]::GetFileName($resolvedScript).ToLowerInvariant() -notin $allowedScripts) {
  throw "The reviewed PowerShell entrypoint boundary changed."
}

$reviewedBytes = [IO.File]::ReadAllBytes($resolvedScript)
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $actualScriptSha256 = [BitConverter]::ToString(
    $sha256.ComputeHash($reviewedBytes)
  ).Replace("-", "").ToLowerInvariant()
} finally {
  $sha256.Dispose()
}
if ($ExpectedScriptSha256 -notmatch '^[0-9a-f]{64}$' -or
  $actualScriptSha256 -cne $ExpectedScriptSha256) {
  throw "The reviewed PowerShell entrypoint digest does not match the launcher trust root."
}
$reviewedSource = [Text.Encoding]::UTF8.GetString($reviewedBytes)
if ($reviewedSource.Contains([char]0xFFFD)) {
  throw "The reviewed PowerShell entrypoint is not valid UTF-8."
}
$reviewedScriptBlock = [ScriptBlock]::Create($reviewedSource)

try {
  $argumentJson = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String($ForwardedArgumentsBase64)
  )
  $parsedArguments = ConvertFrom-Json -InputObject $argumentJson
} catch {
  throw "The reviewed PowerShell argument envelope is invalid."
}
[object[]]$forwardedArguments = if ($null -eq $parsedArguments) {
  @()
} elseif ($parsedArguments -is [Array]) {
  @($parsedArguments)
} else {
  @($parsedArguments)
}
if (@($forwardedArguments).Count -gt 64 -or
  @($forwardedArguments | Where-Object { $_ -isnot [string] -or $_.Length -gt 4096 }).Count -gt 0) {
  throw "The reviewed PowerShell argument envelope is outside its safe bounds."
}

$parameterContract = switch ([IO.Path]::GetFileName($resolvedScript).ToLowerInvariant()) {
  "supabase-ship-safe.ps1" {
    @{
      Help = "switch"
      SkipBuild = "switch"
      SkipLint = "switch"
      SkipAudit = "switch"
      ExpectedProjectRef = "string"
      Production = "switch"
      BackupRef = "string"
      MaintenanceModeActive = "switch"
      TrafficDrained = "switch"
      MaintenanceAuthorizedUntilUtc = "string"
    }
  }
  "supabase-reconcile-core-baseline.ps1" {
    @{ Help = "switch"; ExpectedProjectRef = "string" }
  }
  "supabase-write-fence.ps1" {
    @{
      Action = "string"
      ExpectedProjectRef = "string"
      ReleaseIpv4Cidr = "string"
      ReleaseIpv6Cidr = "string"
      SnapshotPath = "string"
      PostMigrationEvidencePath = "string"
      DrainTimeoutSeconds = "integer"
    }
  }
  default { throw "The reviewed PowerShell parameter contract is unavailable." }
}

$boundParameters = @{}
for ($index = 0; $index -lt @($forwardedArguments).Count; $index += 1) {
  $token = [string]$forwardedArguments[$index]
  if ($token -notmatch '^-[A-Za-z][A-Za-z0-9]*$') {
    throw "Reviewed PowerShell arguments must be exact named parameters."
  }
  $name = $token.Substring(1)
  if (-not $parameterContract.ContainsKey($name) -or $boundParameters.ContainsKey($name)) {
    throw "A reviewed PowerShell parameter is unknown or duplicated."
  }
  $kind = [string]$parameterContract[$name]
  if ($kind -eq "switch") {
    $boundParameters[$name] = $true
    continue
  }
  if ($index + 1 -ge @($forwardedArguments).Count) {
    throw "A reviewed PowerShell parameter value is missing."
  }
  $index += 1
  $value = [string]$forwardedArguments[$index]
  if ($kind -eq "integer") {
    $parsedInteger = 0
    if (-not [int]::TryParse($value, [ref]$parsedInteger)) {
      throw "A reviewed PowerShell integer parameter is invalid."
    }
    $boundParameters[$name] = $parsedInteger
  } else {
    $boundParameters[$name] = $value
  }
}

$ReviewedEntrypointRoot = $reviewedDirectory
& $reviewedScriptBlock @boundParameters
