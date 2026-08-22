type SupabaseServiceAccess = "read" | "runtime" | "operator-write";

export type SupabaseServiceDestinationInput = {
  url: string | undefined;
  serviceRoleKey: string | undefined;
  expectedUrl: string | undefined;
  expectedProjectRef: string | undefined;
  productionProjectRef: string | undefined;
  productionWriteConfirmation?: string | undefined;
  access: SupabaseServiceAccess;
  /**
   * 이 코드가 배포된 서버에서 도는가.
   *
   * 관문이 확인 문자열만 보고 **어디서 실행되는지는 보지 않았다.** 그래서 운영 값을
   * 그대로 물려받은 개발 PC 의 `pnpm dev` 가 운영 DB 에 쓸 수 있었다 — 실제로 그렇게
   * 커플 기록이 상한 적이 있다.
   *
   * `runtime` 쓰기에만 건다. 릴리스 절차(`operator-write`)는 사람이 로컬에서 돌리는 것이
   * 정상이고, 그쪽은 릴리스 매니페스트와 확인 문자열이 따로 지킨다.
   */
  runningOnDeployedServer?: boolean;
};

export type VerifiedSupabaseServiceDestination = {
  url: string;
  projectRef: string;
  keyKind: "jwt" | "opaque";
};

const PROJECT_REF = /^[a-z0-9]{20}$/;
const OPAQUE_SECRET = /^sb_secret_[A-Za-z0-9_-]{24,}$/;

export class SupabaseDestinationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SupabaseDestinationError";
    this.code = code;
  }
}

function blocked(code: string, message: string): never {
  throw new SupabaseDestinationError(code, message);
}

function parseProjectRef(value: string | undefined, code: string): string {
  const canonical = value?.trim();
  if (!canonical || !PROJECT_REF.test(canonical)) {
    blocked(code, "Supabase project destination is not explicitly pinned.");
  }
  return canonical;
}

function parseCanonicalHostedUrl(value: string | undefined, missingCode: string): URL {
  if (!value?.trim()) blocked(missingCode, "Supabase URL destination is not explicitly pinned.");
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    blocked("URL_INVALID", "Supabase URL is not a canonical hosted-project origin.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !/^[a-z0-9]{20}\.supabase\.co$/.test(parsed.hostname)
  ) {
    blocked("URL_INVALID", "Supabase URL is not a canonical hosted-project origin.");
  }
  return parsed;
}

function decodeJwtJson(segment: string): Record<string, unknown> {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value as Record<string, unknown>;
  } catch {
    blocked("JWT_INVALID", "Supabase service-role credential is malformed.");
  }
}

function validateJwt(key: string, projectRef: string, url: string): "jwt" {
  const parts = key.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    blocked("JWT_INVALID", "Supabase service-role credential is malformed.");
  }
  const header = decodeJwtJson(parts[0]);
  const payload = decodeJwtJson(parts[1]);
  if (header.alg !== "HS256" || (header.typ !== undefined && header.typ !== "JWT")) {
    blocked("JWT_HEADER_INVALID", "Supabase service-role JWT header is not accepted.");
  }
  if (payload.role !== "service_role") {
    blocked("JWT_ROLE_MISMATCH", "Supabase credential is not a service-role JWT.");
  }
  if (payload.ref !== projectRef) {
    blocked("JWT_REF_MISMATCH", "Supabase service-role JWT project does not match the pinned destination.");
  }
  const acceptedIssuers = new Set(["supabase", `${url}/auth/v1`, `${url}/auth/v1/`]);
  if (typeof payload.iss !== "string" || !acceptedIssuers.has(payload.iss)) {
    blocked("JWT_ISS_MISMATCH", "Supabase service-role JWT issuer is not accepted.");
  }
  if (payload.aud !== undefined) {
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.some((audience) => audience === "authenticated" || audience === "service_role")) {
      blocked("JWT_AUD_MISMATCH", "Supabase service-role JWT audience is not accepted.");
    }
  }
  if (typeof payload.exp === "number" && payload.exp <= Math.floor(Date.now() / 1000)) {
    blocked("JWT_EXPIRED", "Supabase service-role JWT is expired.");
  }
  return "jwt";
}

function validateServiceRoleKey(
  key: string | undefined,
  projectRef: string,
  url: string,
): "jwt" | "opaque" {
  if (!key) blocked("SERVICE_ROLE_KEY_MISSING", "Supabase service-role credential is not configured.");
  if (key.includes(".") || key.startsWith("eyJ")) return validateJwt(key, projectRef, url);
  if (!OPAQUE_SECRET.test(key)) {
    blocked("SERVICE_ROLE_KEY_INVALID", "Supabase service-role credential format is not accepted.");
  }
  return "opaque";
}

export function verifySupabaseServiceDestination(
  input: SupabaseServiceDestinationInput,
): VerifiedSupabaseServiceDestination {
  const expectedProjectRef = parseProjectRef(input.expectedProjectRef, "EXPECTED_REF_INVALID");
  const productionProjectRef = parseProjectRef(input.productionProjectRef, "PRODUCTION_REF_INVALID");
  const actualUrl = parseCanonicalHostedUrl(input.url, "URL_MISSING");
  const expectedUrl = parseCanonicalHostedUrl(input.expectedUrl, "EXPECTED_URL_MISSING");
  if (actualUrl.origin !== expectedUrl.origin) {
    blocked("URL_MISMATCH", "Supabase URL does not match the explicit destination allowlist.");
  }
  if (actualUrl.hostname !== `${expectedProjectRef}.supabase.co`) {
    blocked("URL_REF_MISMATCH", "Supabase URL host does not match the explicit project ref.");
  }
  if (!(["read", "runtime", "operator-write"] as const).includes(input.access)) {
    blocked("ACCESS_INVALID", "Supabase service-role access intent is invalid.");
  }

  const keyKind = validateServiceRoleKey(input.serviceRoleKey, expectedProjectRef, actualUrl.origin);

  if (expectedProjectRef === productionProjectRef && input.access !== "read") {
    const expectedConfirmation = `${input.access === "runtime" ? "RUNTIME_WRITE" : "OPERATOR_WRITE"}:${expectedProjectRef}`;
    if (input.productionWriteConfirmation !== expectedConfirmation) {
      blocked(
        "PRODUCTION_WRITE_CONFIRMATION_REQUIRED",
        "Production service-role writes require a separate project-scoped confirmation.",
      );
    }
  }

  // 확인 문자열을 **가지고 있어도** 배포된 서버가 아니면 런타임 쓰기를 막는다.
  //
  // 실제 사고가 이 모양이었다 — 운영 환경변수를 통째로 복사한 개발 PC 의 `pnpm dev` 가
  // 운영 DB 를 가리켜 커플 기록이 상했다. 확인 문자열은 **실행 위치를 증명하지 못한다.**
  // 복사되면 같이 복사된다.
  //
  // 확인 문자열 검사 **뒤**에 둔다. 문자열이 아예 없는 흔한 경우에는 그쪽 메시지가 더
  // 알맞고, 이 검사는 문자열까지 갖춘 드문 경우의 마지막 문턱이다.
  //
  // `runtime` 에만 건다. 릴리스 절차(`operator-write`)는 사람이 로컬에서 돌리는 것이
  // 정상이고, 그쪽은 릴리스 매니페스트와 확인 문자열이 따로 지킨다.
  if (
    expectedProjectRef === productionProjectRef
    && input.access === "runtime"
    && input.runningOnDeployedServer === false
  ) {
    blocked(
      "PRODUCTION_RUNTIME_WRITE_OFF_SERVER",
      "Production runtime writes are only allowed from the deployed server.",
    );
  }

  return { url: actualUrl.origin, projectRef: expectedProjectRef, keyKind };
}

export function verifyRuntimeSupabaseServiceDestination(
  env: NodeJS.ProcessEnv = process.env,
): VerifiedSupabaseServiceDestination {
  return verifySupabaseServiceDestination({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    expectedUrl: env.SUPABASE_EXPECTED_URL,
    expectedProjectRef: env.SUPABASE_EXPECTED_PROJECT_REF,
    productionProjectRef: env.SUPABASE_PRODUCTION_PROJECT_REF,
    productionWriteConfirmation: env.SUPABASE_PRODUCTION_WRITE_CONFIRM,
    access: "runtime",
    // Vercel 이 배포 실행에만 넣어 주는 표식. 개발 PC 에는 없다.
    runningOnDeployedServer: env.VERCEL === "1",
  });
}
