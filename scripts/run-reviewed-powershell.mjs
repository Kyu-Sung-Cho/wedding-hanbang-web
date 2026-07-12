import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = realpathSync(path.dirname(fileURLToPath(import.meta.url)));
const allowedScripts = new Set([
  "supabase-reconcile-core-baseline.ps1",
  "supabase-ship-safe.ps1",
  "supabase-write-fence.ps1",
]);

const requested = process.argv[2] ?? "";
const basename = path.basename(requested);
if (!allowedScripts.has(basename)) {
  console.error("Only reviewed Supabase PowerShell entrypoints may use this launcher.");
  process.exit(2);
}

let resolved;
try {
  resolved = realpathSync(path.resolve(process.cwd(), requested));
} catch {
  console.error("The reviewed PowerShell entrypoint does not exist.");
  process.exit(2);
}
if (path.dirname(resolved) !== scriptDirectory) {
  console.error("The PowerShell entrypoint must remain inside the repository scripts directory.");
  process.exit(2);
}

const executable = process.platform === "win32" ? "powershell.exe" : "pwsh";
const prefix = process.platform === "win32"
  ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolved]
  : ["-NoProfile", "-File", resolved];
const forwarded = process.argv.slice(3);
if (forwarded[0] === "--") forwarded.shift();
const result = spawnSync(executable, [...prefix, ...forwarded], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(`Unable to start the required PowerShell runtime: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
