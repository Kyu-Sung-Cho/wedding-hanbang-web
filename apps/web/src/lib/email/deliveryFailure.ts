import { redactSentryText } from "@hanbang/shared";

/**
 * 메일이 나가지 못한 이유를 사용자가 할 수 있는 일 기준으로 가른다.
 *
 * ## 왜 필요한가
 *
 * 가입 라우트는 발송 실패를 전부 한 문장으로 답했다 —
 * "인증 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요."
 * 그 문장이 참인 경우는 **제공자가 잠깐 흔들렸을 때뿐**이다. 키가 거절되거나
 * 보내는 도메인이 등록돼 있지 않으면 잠시 후에도, 내일도 같은 결과다.
 * 그 사람은 오지 않을 메일을 기다리며 같은 버튼을 계속 누른다.
 *
 * 실패 원인은 서버 콘솔 한 줄로만 남아 Sentry 에도 오르지 않았다. 그래서 밖에서는
 * "가입이 안 된다"만 보이고 안에서는 무엇이 고장 났는지 아무도 몰랐다.
 *
 * 여기서 가르는 기준은 제공자의 내부 분류가 아니라 **받는 사람이 취할 행동**이다.
 * 다시 눌러서 될 일인가, 주소를 고쳐야 할 일인가, 우리가 고쳐야 할 일인가.
 */
export type EmailDeliveryFailureKind =
  /** 발송 자격 자체가 이 배포에 없다. 우리가 고칠 일이다. */
  | "unconfigured"
  /** 키가 거절됐다(만료·회수·권한 축소). 우리가 고칠 일이다. */
  | "credential"
  /** 보내는 주소의 도메인이 제공자에 등록·검증돼 있지 않다. 우리가 고칠 일이다. */
  | "sender_domain"
  /** 받는 주소를 제공자가 거절했다. 그 사람이 고칠 수 있는 유일한 경우다. */
  | "recipient"
  /** 한도에 걸렸다. 시간이 지나면 풀린다. */
  | "rate_limit"
  /** 제공자가 흔들렸거나 원인을 모른다. 다시 시도해 볼 만하다. */
  | "provider";

export interface EmailDeliveryFailure {
  kind: EmailDeliveryFailureKind;
  /** 화면에 그대로 나가는 한국어 한 문장. 내부 오류 원문은 담지 않는다. */
  message: string;
  /** 문의와 로그를 맞춰 보기 위한 코드. 응답에 함께 싣는다. */
  code: string;
  status: number;
  /** 같은 요청을 그대로 다시 보내서 될 수 있는가. 문구가 이 값과 어긋나면 거짓말이다. */
  retryable: boolean;
}

/**
 * 우리 쪽 설정이 원인일 때 쓰는 하나의 문장.
 *
 * 세 종류(`unconfigured`·`credential`·`sender_domain`)를 밖에서 구분해 주지 않는다.
 * 사용자가 할 수 있는 일이 셋 다 같고, 어느 자격이 어떻게 깨졌는지는 공격자에게
 * 알려 줄 이유가 없는 운영 정보다. 구분은 `code` 와 서버 로그가 들고 있다.
 */
function operatorFaultMessage(code: string): string {
  return `지금은 인증 메일을 보낼 수 없어요. 서비스 설정 문제라서 다시 시도해도 같은 결과예요. 저희가 확인하고 고치는 중이니, 다른 방법으로 로그인하시거나 잠시 뒤에 다시 찾아와 주세요. (오류 코드: ${code})`;
}

const FAILURES: Record<EmailDeliveryFailureKind, EmailDeliveryFailure> = {
  unconfigured: {
    kind: "unconfigured",
    code: "EMAIL_DELIVERY_UNCONFIGURED",
    message: operatorFaultMessage("EMAIL_DELIVERY_UNCONFIGURED"),
    status: 503,
    retryable: false,
  },
  credential: {
    kind: "credential",
    code: "EMAIL_DELIVERY_CREDENTIAL",
    message: operatorFaultMessage("EMAIL_DELIVERY_CREDENTIAL"),
    status: 503,
    retryable: false,
  },
  sender_domain: {
    kind: "sender_domain",
    code: "EMAIL_DELIVERY_SENDER_DOMAIN",
    message: operatorFaultMessage("EMAIL_DELIVERY_SENDER_DOMAIN"),
    status: 503,
    retryable: false,
  },
  recipient: {
    kind: "recipient",
    code: "EMAIL_DELIVERY_RECIPIENT_REJECTED",
    message:
      "이 이메일 주소로는 인증 메일을 보낼 수 없었어요. 주소에 오타가 없는지 확인해 주시고, 그래도 안 되면 다른 주소로 시도해 주세요.",
    status: 400,
    retryable: false,
  },
  rate_limit: {
    kind: "rate_limit",
    code: "EMAIL_DELIVERY_RATE_LIMITED",
    message: "지금 메일 발송 요청이 몰려 있어요. 잠시 후 다시 시도해 주세요.",
    status: 429,
    retryable: true,
  },
  provider: {
    kind: "provider",
    code: "EMAIL_DELIVERY_PROVIDER_ERROR",
    // 원래 문장은 여기서만 참이다 — 정말로 잠시 후에 될 수 있는 경우.
    message: "인증 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.",
    status: 502,
    retryable: true,
  },
};

/**
 * 실제로 제공자에 보낼 자격 문자열.
 *
 * ## 왜 다듬어서 쓰는가
 *
 * SDK 는 값을 **검사하지도 다듬지도 않는다.** 직접 실행해 확인했다
 * (2026-09-02, resend 6.10.0):
 *
 *     new Resend(undefined)   → throws "Missing API key..."
 *     new Resend("")          → throws
 *     new Resend("   ")       → **던지지 않는다.** key="   " 를 그대로 들고 간다
 *     new Resend("not-a-key") → 던지지 않는다
 *
 * 값이 있기만 하면 그대로 `Authorization: Bearer <값>` 이 된다. 그런데 그 뒤에
 * Node 의 `Headers` 가 한 번 더 손을 대므로, 어떤 지저분함이 실제로 요청을 망가뜨리는지
 * 는 직관과 다르다. 로컬 서버로 **제공자가 받는 헤더를 직접 관측**한 결과
 * (`__tests__/apiKeyReachesProvider.test.ts` 가 이 표를 고정한다):
 *
 *     "re_x"        → "Bearer re_x"     그대로
 *     "re_x\n"      → "Bearer re_x"     Node 가 뒤쪽 공백을 지운다 — 무해하다
 *     "re_x\r\n"    → "Bearer re_x"     무해하다
 *     "re_x "       → "Bearer re_x"     무해하다
 *     "  re_x"      → "Bearer   re_x"   **망가진다** (가운데 공백이 남는다)
 *     "re_ x"       → "Bearer re_ x"    **망가진다**
 *     "\"re_x\""    → "Bearer \"re_x\"" **망가진다**
 *     "re_\nx"      → Headers.append 가 **던진다**
 *
 * 즉 위험한 것은 **앞쪽** 공백과 값 안쪽의 이물질이다. 뒤쪽 공백은 이미 무해하다.
 * 그래서 이 함수는 앞뒤를 다듬어 **앞쪽 공백 사고를 실제로 고치고**, 안쪽 이물질은
 * 아래 `isUnusableApiKey` 가 보내기 전에 잡는다.
 */
export function readEmailDeliveryApiKey(): string | null {
  const raw = process.env.RESEND_API_KEY;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 다듬어도 자격으로 쓸 수 없는 값인가.
 *
 * 앞뒤를 정리한 **뒤에도** 공백·제어문자가 남아 있거나 따옴표로 싸여 있으면 그것은
 * 설정이 상한 것이다 — 어떤 형식의 API 키도 그런 문자를 품지 않는다. 그대로 보내면
 * 제공자가 거절하고(`"Bearer re_ x"`), 줄바꿈이면 `Headers.append` 가 던져 사용자에게
 * "회원가입 처리 중 오류"라는 엉뚱한 500 이 간다. 어느 쪽이든 그 전에 이미 계정이
 * 만들어져 있다 — 인증할 수단이 없는 계정만 남는다.
 *
 * **접두사(`re_`)로는 판정하지 않는다.** 제공자가 키 형식을 바꾸면 이 검사가 유효한
 * 키를 막아 가입을 통째로 세우게 된다 — 고치려던 것보다 큰 사고를 우리가 만드는 셈이다.
 * 그래서 "무엇이어도 될 수 없는 것"만 막는다.
 */
function isUnusableApiKey(key: string): boolean {
  return /[\s\u0000-\u001f\u007f]/u.test(key)
    || /^["'].*["']$/u.test(key);
}

/**
 * 이 배포가 메일을 보낼 자격을 갖고 있는가. 아무것도 만들기 전에 본다.
 *
 * 키가 아예 없으면 `new Resend(undefined)` 가 **생성자에서** 던지는데, 가입
 * 라우트에서는 그 시점이 이미 계정을 만든 뒤다. 사용자는 "회원가입 처리 중 오류"를
 * 보고 인증할 수 없는 계정만 남았다.
 */
export function findEmailDeliveryConfigFailure(): EmailDeliveryFailure | null {
  const apiKey = readEmailDeliveryApiKey();
  if (apiKey === null) return FAILURES.unconfigured;
  if (isUnusableApiKey(apiKey)) return FAILURES.credential;
  return null;
}

interface ProviderErrorShape {
  name: string;
  message: string;
  statusCode: number | null;
}

/**
 * 제공자 오류에서 판정에 쓸 세 조각만 꺼낸다.
 *
 * Resend 는 실패를 예외가 아니라 `{ name, message }` 반환값으로 준다. SDK 판마다
 * 필드가 늘고 줄기 때문에 타입에 기대지 않고 있는 것만 읽는다 — 없으면 빈 값이고,
 * 그 경우 아래 판정은 `provider` 로 떨어진다.
 */
function readProviderError(error: unknown): ProviderErrorShape {
  if (error === null || typeof error !== "object") {
    return {
      name: "",
      message: typeof error === "string" ? error : "",
      statusCode: null,
    };
  }

  const record = error as Record<string, unknown>;
  const rawStatus = record.statusCode ?? record.status;
  return {
    name: typeof record.name === "string" ? record.name : "",
    message: typeof record.message === "string" ? record.message : "",
    statusCode: typeof rawStatus === "number" ? rawStatus : null,
  };
}

/**
 * 제공자 오류를 사용자가 취할 행동으로 옮긴다.
 *
 * 이름(`name`)과 문장(`message`)을 함께 본다. Resend 는 서로 다른 사고를 같은
 * `validation_error` 이름으로 묶어 보내기 때문에 — 도메인 미검증도, 받는 주소
 * 거절도 같은 이름이다 — 이름만으로는 갈라지지 않는다. 그래서 더 좁은 판정을
 * 먼저 놓고, 아무것도 맞지 않으면 "다시 시도해 볼 만하다"로 끝낸다.
 */
export function classifyEmailDeliveryFailure(error: unknown): EmailDeliveryFailure {
  const { name, message, statusCode } = readProviderError(error);
  const haystack = `${name} ${message}`.toLowerCase();

  if (
    statusCode === 429
    || /rate.?limit|too many requests|quota/.test(haystack)
  ) {
    return FAILURES.rate_limit;
  }

  // 도메인 판정이 자격 판정보다 앞에 온다. "domain is not verified" 는 403 이고,
  // 403 을 먼저 잡으면 전부 credential 로 뭉개진다.
  if (
    /domain is not verified|domain_not_verified|invalid_from_address|not verified/.test(haystack)
    // 검증된 도메인이 하나도 없는 계정은 본인 주소 외 발송을 이 문장으로 막는다.
    || /you can only send testing emails/.test(haystack)
  ) {
    return FAILURES.sender_domain;
  }

  if (
    statusCode === 401
    || /api.?key|missing_api_key|invalid_api_key|restricted_api_key|unauthorized|security_error/.test(haystack)
  ) {
    return FAILURES.credential;
  }

  // 받는 주소 거절. 위의 좁은 판정들이 모두 빗나간 뒤에만 본다.
  if (
    statusCode === 422
    || /invalid[^.]{0,20}`?to`?|recipient|invalid email|invalid_parameter|missing_required_field/.test(haystack)
  ) {
    return FAILURES.recipient;
  }

  if (statusCode === 403) {
    // 403 인데 도메인·주소 어느 쪽도 아니면 이 배포의 자격 문제로 본다.
    return FAILURES.credential;
  }

  return FAILURES.provider;
}

/**
 * 제공자가 응답은 줬지만 메시지 id 가 없는 경우.
 *
 * 발송됐다는 증거가 없으므로 성공으로 셀 수 없다. 원인은 알 수 없으니
 * 다시 시도해 볼 만한 쪽으로 둔다.
 */
export function emailDeliveryMissingReceiptFailure(): EmailDeliveryFailure {
  return FAILURES.provider;
}

/**
 * 운영자가 읽을 한 줄. `log.error` 의 첫 인자는 Sentry tag 가 되므로 짧고
 * 개인정보가 없어야 한다 — 여기에는 고정 어휘(kind·name·status)만 넣는다.
 */
export function emailDeliveryLogLine(
  scope: string,
  failure: EmailDeliveryFailure,
  error?: unknown,
): string {
  const { name, statusCode } = readProviderError(error);
  const parts = [`kind=${failure.kind}`, `code=${failure.code}`];
  if (name) parts.push(`provider=${name}`);
  if (statusCode !== null) parts.push(`providerStatus=${statusCode}`);
  return `${scope}: email delivery failed (${parts.join(", ")})`;
}

/**
 * 제공자 문장을 서버 콘솔(Vercel 런타임 로그)에 남기기 전에 식별자를 지운다.
 * 받는 주소를 그대로 인용해 돌려주는 오류가 있어, 그대로 두면 로그가 주소록이 된다.
 */
export function redactProviderDetail(error: unknown): string {
  const { name, message, statusCode } = readProviderError(error);
  const detail = redactSentryText(message) ?? "";
  return [name || "unknown", statusCode === null ? "" : `(${statusCode})`, detail]
    .filter(Boolean)
    .join(" ");
}
