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
const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "web-dev-safely.mjs")], {
  cwd: path.join(repoRoot, "apps", "web"),
  env: {
    ...process.env,
    ...SYNTHETIC_SUPABASE_ENVIRONMENT,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  },
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 0));
