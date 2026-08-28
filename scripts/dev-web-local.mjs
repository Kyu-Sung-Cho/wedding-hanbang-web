// 로컬에서 화면을 눈으로 보기 위한 dev 런처.
//
// 왜 필요한가: `apps/web/.env.local`에 실제 프로덕션 service_role 키가 들어 있으면
// destination fence가 부팅을 막는다(정상 동작). 핀을 프로덕션에 맞추면 로컬 dev 서버가
// 운영 DB에 service_role로 붙게 되므로 **그렇게 하지 않는다.** 대신 이 실행에만
// 자격증명 없는 가짜 값을 덮어써서 띄운다 — 이 서버는 어떤 실제 프로젝트에도 접근할 수 없다.
//
// `/today`와 `/wedding-code`는 Supabase를 건드리지 않으므로 이 상태로 충분하다.
// 운영 데이터가 필요한 화면을 보려면 이 런처를 쓰지 말고 정상 `.env.local`로 띄운다.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SYNTHETIC_SUPABASE_ENVIRONMENT } from "./lib/synthetic-supabase-environment.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// 로컬 QA 빌드가 쓰는 것과 **같은** 합성 값이다. 따로 만들면 두 곳이 어긋나고,
// 어긋난 쪽이 fence를 통과하는 순간 그 경로만 운영을 가리킬 수 있다.
// 인자를 그대로 넘긴다(`-p 3500` 등).
//
// 2026-08-28에 붙였다. 그전에는 이 런처가 포트를 못 받아서 **다른 포트가 필요하면
// 안전 런처를 건너뛰고** `web-dev-safely.mjs` 를 직접 부르는 설정이 생겼다
// (`.claude/launch.json` 의 `amora-observe`). 그 경로는 위의 합성 값을 받지 않으므로
// `.env.local` 이 있는 워크트리에서는 실제 프로젝트를 가리킬 수 있다.
// 우회할 이유를 없애는 것이 우회를 막는 방법이다.
const forwarded = process.argv.slice(2);
const portIndex = forwarded.findIndex((a) => a === "-p" || a === "--port");
const port = portIndex >= 0 ? forwarded[portIndex + 1] : "3000";

const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "web-dev-safely.mjs"), ...forwarded], {
  cwd: path.join(repoRoot, "apps", "web"),
  env: {
    ...process.env,
    ...SYNTHETIC_SUPABASE_ENVIRONMENT,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? `http://localhost:${port}`,
  },
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 0));
