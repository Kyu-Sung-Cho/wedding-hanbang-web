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

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const REF = "abcdefghijklmnopqrst";
const URL_ = `https://${REF}.supabase.co`;

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
// 서명이 없는 JWT다. fence는 헤더·role·ref·iss·exp만 본다(서명 검증은 하지 않는다).
// 어차피 실제 프로젝트를 가리키지 않으므로 이 토큰으로는 아무것도 할 수 없다.
const placeholderServiceKey = [
  b64url({ alg: "HS256", typ: "JWT" }),
  b64url({ role: "service_role", ref: REF, iss: "supabase", exp: 4102444800 }),
  "local-dev-only-not-a-signature",
].join(".");

const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "web-dev-safely.mjs")], {
  cwd: path.join(repoRoot, "apps", "web"),
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: URL_,
    SUPABASE_EXPECTED_URL: URL_,
    SUPABASE_EXPECTED_PROJECT_REF: REF,
    SUPABASE_PRODUCTION_PROJECT_REF: "zyxwvutsrqponmlkjihg",
    SUPABASE_PRODUCTION_WRITE_CONFIRM: "",
    SUPABASE_SERVICE_ROLE_KEY: placeholderServiceKey,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  },
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 0));
