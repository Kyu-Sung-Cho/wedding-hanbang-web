param([switch]$Help)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$message = "This mutation path is retired. Use supabase:ship:safe with the reviewed project, fence, backup, and rollback evidence."
if ($Help) {
  Write-Host $message
  exit 0
}
throw $message
