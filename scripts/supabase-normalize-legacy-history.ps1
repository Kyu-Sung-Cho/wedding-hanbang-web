param([switch]$Help)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$message = "Legacy migration-history normalization is retired. Unchecked linked-project mutation is forbidden."
if ($Help) {
  Write-Host $message
  exit 0
}
throw $message
