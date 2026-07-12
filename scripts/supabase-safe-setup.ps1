param([switch]$Help)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$message = @"
This legacy linked-project setup path is retired.
Revoke the exposed CLI login role and PAT first, then use the reviewed release runbook.
No credential may be passed on a command line.
"@

if ($Help) {
  Write-Host $message
  exit 0
}

throw $message
