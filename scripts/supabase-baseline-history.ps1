param([switch]$Help)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$message = "Broad migration-history repair is retired. Use supabase:baseline:core for the one reviewed baseline version."
if ($Help) {
  Write-Host $message
  exit 0
}
throw $message
