import { spawnSync } from "node:child_process";

function createCommand(args) {
  if (process.platform !== "win32" && process.env.PNPM_HOME && args[0] === "pnpm") {
    return { command: "pnpm", args: args.slice(1) };
  }

  if (process.platform !== "win32") {
    return { command: "corepack", args };
  }

  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", ["corepack", ...args].join(" ")],
  };
}

const checks = [
  {
    name: "web typecheck",
    args: ["pnpm", "--filter", "@hanbang/web", "exec", "tsc", "--noEmit"],
  },
  {
    name: "web lint",
    args: ["pnpm", "--filter", "@hanbang/web", "exec", "eslint", "."],
  },
  {
    name: "web tests",
    args: ["pnpm", "--filter", "@hanbang/web", "exec", "vitest", "run"],
  },
  {
    name: "web production build",
    args: ["pnpm", "--filter", "@hanbang/web", "exec", "next", "build"],
  },
  {
    name: "mobile release readiness",
    args: ["pnpm", "mobile:release-check"],
  },
  {
    name: "mobile tests",
    args: ["pnpm", "--filter", "@hanbang/mobile", "test"],
  },
  {
    name: "mobile typecheck",
    args: ["pnpm", "--filter", "@hanbang/mobile", "typecheck"],
  },
  {
    name: "mobile lint",
    args: ["pnpm", "--filter", "@hanbang/mobile", "lint"],
  },
  {
    name: "mobile bundle export",
    args: ["pnpm", "--filter", "@hanbang/mobile", "build"],
  },
  {
    name: "shared typecheck",
    args: ["pnpm", "--filter", "@hanbang/shared", "typecheck"],
  },
  {
    name: "design tokens typecheck",
    args: ["pnpm", "--filter", "@hanbang/design-tokens", "typecheck"],
  },
];

const failures = [];

for (const check of checks) {
  console.log(`\n[verify-local] ${check.name}`);
  const { command, args } = createCommand(check.args);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    failures.push(`${check.name}: ${result.error.message}`);
    continue;
  }

  if (result.status !== 0) {
    failures.push(`${check.name}: exit ${result.status ?? "unknown"}`);
  }
}

if (failures.length > 0) {
  console.error("\n[verify-local] failed");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("\n[verify-local] all checks passed");
