param([switch]$Help)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$message = @"
This legacy linked-project check is retired because a bare dry-run can target the wrong project.
Use supabase:baseline:core or supabase:ship:safe only after the release runbook gates pass.
No database password may be passed on a command line.
"@

if ($Help) {
  Write-Host $message
  exit 0
}

throw $message
