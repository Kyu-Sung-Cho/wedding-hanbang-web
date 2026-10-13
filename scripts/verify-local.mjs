import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLocalQaWebBuildEnvironment } from "./lib/local-qa-environment.mjs";

export function createCommand(args) {
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

/**
 * `qa:local`이 도는 검사 목록.
 *
 * `qa:merged`(`scripts/qa-merged.mjs`)가 이 배열을 **그대로 가져다 쓴다.** 목록을 복사하면
 * 두 곳이 조용히 어긋나고, 그러면 「머지 후 검사」가 실제로는 더 적게 검사하면서 초록불을 준다.
 * 새 검사를 넣을 때는 여기만 고친다.
 *
 * `kind`는 qa:merged가 순서를 바꾸려고 읽는다 — 느린 빌드를 뒤로 미뤄 실패를 빨리 보기 위해서다.
 */
export const checks = [
  {
    kind: "typecheck",
    name: "web typecheck",
    args: ["pnpm", "--filter", "@hanbang/web", "exec", "tsc", "--noEmit"],
  },
  {
    kind: "lint",
    name: "web lint",
    args: ["pnpm", "--filter", "@hanbang/web", "exec", "eslint", "."],
  },
  {
    kind: "test",
    name: "web tests",
    args: ["pnpm", "--filter", "@hanbang/web", "exec", "vitest", "run"],
  },
  {
    kind: "build",
    name: "web production build",
    args: ["pnpm", "--filter", "@hanbang/web", "build"],
    createEnvironment: createLocalQaWebBuildEnvironment,
  },
  {
    kind: "check",
    name: "mobile release readiness",
    args: ["pnpm", "mobile:release-check"],
  },
  {
    kind: "test",
    name: "mobile tests",
    args: ["pnpm", "--filter", "@hanbang/mobile", "test"],
  },
  {
    kind: "typecheck",
    name: "mobile typecheck",
    args: ["pnpm", "--filter", "@hanbang/mobile", "typecheck"],
  },
  {
    kind: "lint",
    name: "mobile lint",
    args: ["pnpm", "--filter", "@hanbang/mobile", "lint"],
  },
  {
    kind: "build",
    name: "mobile bundle export",
    args: ["pnpm", "--filter", "@hanbang/mobile", "build"],
  },
  {
    kind: "typecheck",
    name: "shared typecheck",
    args: ["pnpm", "--filter", "@hanbang/shared", "typecheck"],
  },
  {
    kind: "typecheck",
    name: "design tokens typecheck",
    args: ["pnpm", "--filter", "@hanbang/design-tokens", "typecheck"],
  },

  // 2026-08-19에 GitHub Actions를 workflow_dispatch 전용으로 내리면서, CI만 돌던
  // 세 검사를 여기로 옮겼다. 옮기지 않으면 릴리스 fence·공시 정합성·적재 스크립트가
  // 아무 데서도 검사되지 않는 상태가 된다.
  //
  // `test:repo`가 `test:ingest`와 supabase 릴리스 테스트를 이미 포함하므로 그 둘은
  // 따로 넣지 않는다.
  {
    kind: "typecheck",
    name: "ingest typecheck",
    args: ["pnpm", "ingest:typecheck"],
  },
  {
    kind: "test",
    name: "repository tests",
    args: ["pnpm", "test:repo"],
  },
  {
    kind: "check",
    name: "supabase release fence",
    args: ["pnpm", "supabase:release:fence", "--amora-action-writer-retirement"],
  },
];

/** 검사 하나를 돌리고 실패 사유를 돌려준다. 통과면 `null`. */
export function runCheck(check, { label = "verify-local", extraEnv = {} } = {}) {
  console.log(`\n[${label}] ${check.name}`);
  const { command, args } = createCommand(check.args);
  const baseEnv = check.createEnvironment?.(process.env) ?? process.env;
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...baseEnv, ...extraEnv },
    stdio: "inherit",
  });

  if (result.error) return `${check.name}: ${result.error.message}`;
  if (result.status !== 0) return `${check.name}: exit ${result.status ?? "unknown"}`;
  return null;
}

function main() {
  const failures = [];

  for (const check of checks) {
    const failure = runCheck(check);
    if (failure) failures.push(failure);
  }

  if (failures.length > 0) {
    console.error("\n[verify-local] failed");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("\n[verify-local] all checks passed");
}

// 모듈로 가져다 쓸 때는 돌지 않는다 — `qa:merged`가 이 파일의 `checks`를 import한다.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
