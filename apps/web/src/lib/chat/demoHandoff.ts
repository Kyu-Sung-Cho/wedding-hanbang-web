export const DEMO_AMORA_PREFILL_STORAGE_KEY = "hanbang:demo-amora-prefill";
export const DEMO_AMORA_PREFILL_CREATED_AT_STORAGE_KEY =
  "hanbang:demo-amora-prefill-created-at";
export const DEMO_AMORA_PREFILL_HANDOFF_STORAGE_KEY =
  "hanbang:demo-amora-prefill-handoff";
export const START_HERE_HANDOFF_QUERY_PARAM = "startHereHandoff";

const MAX_PREFILL_LENGTH = 600;
const PREFILL_TTL_MS = 30 * 60 * 1000;
const HANDOFF_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StartHerePrefillInput {
  weddingDate: string;
  preparationStyle: "standard" | "small";
  focusLabels: string[];
}

type DemoHandoffStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface DemoAmoraPrefillEnvelope {
  version: 1;
  purpose: "direct_demo" | "start_here_signup";
  value: string;
  createdAt: number;
  handoffId: string | null;
}

function normalizeHandoffId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return HANDOFF_ID_PATTERN.test(normalized) ? normalized : null;
}

export function createDemoAmoraHandoffId(): string | null {
  try {
    return normalizeHandoffId(globalThis.crypto?.randomUUID?.());
  } catch {
    // 안전한 난수를 만들 수 없으면 개인 초안을 브라우저 공용 저장소에 남기지 않는다.
    return null;
  }
}

export function buildStartHereSignupHref(handoffId?: string | null): string {
  const safeHandoffId = normalizeHandoffId(handoffId);
  const chatSearch = safeHandoffId
    ? `?${new URLSearchParams({ [START_HERE_HANDOFF_QUERY_PARAM]: safeHandoffId })}`
    : "";
  const params = new URLSearchParams({
    mode: "signup",
    redirect: `/wedding/chat${chatSearch}`,
    source: "start-here",
  });
  return `/login?${params}`;
}

export function getStartHereHandoffIdFromRedirect(
  redirect: string | null | undefined,
): string | null {
  if (!redirect?.startsWith("/") || redirect.startsWith("//")) return null;
  try {
    const destination = new URL(redirect, "https://handoff.invalid");
    if (destination.origin !== "https://handoff.invalid") return null;
    if (destination.pathname !== "/wedding/chat") return null;
    return normalizeHandoffId(
      destination.searchParams.get(START_HERE_HANDOFF_QUERY_PARAM),
    );
  } catch {
    return null;
  }
}

export function buildStartHereAmoraPrefill({
  weddingDate,
  preparationStyle,
  focusLabels,
}: StartHerePrefillInput): string {
  const styleSentence = preparationStyle === "small"
    ? "결혼식은 작게 준비하려고 해요."
    : "필요한 준비 항목은 넓게 살펴보고 싶어요.";
  const focusCopy = focusLabels.length > 0
    ? ` 준비 순서에서는 ${focusLabels.slice(0, 3).join("·")} 항목이 먼저 보였어요.`
    : "";

  return (
    `결혼식 날짜는 ${weddingDate}예요. ${styleSentence}${focusCopy} `
    + "부담되지 않게 이번 주에 할 한 가지만 먼저 골라주세요. 바뀌는 내용은 저장하기 전에 보여주세요."
  ).slice(0, MAX_PREFILL_LENGTH);
}

export function rememberDemoAmoraPrefill(
  storage: DemoHandoffStorage,
  value: string | null | undefined,
  handoffId?: string | null,
): void {
  const normalized = value?.trim().slice(0, MAX_PREFILL_LENGTH) ?? "";
  const safeHandoffId = normalizeHandoffId(handoffId);
  const requestedBoundHandoff = handoffId !== undefined && handoffId !== null;

  try {
    if (!normalized || (requestedBoundHandoff && !safeHandoffId)) {
      forgetDemoAmoraPrefill(storage);
      return;
    }
    const envelope: DemoAmoraPrefillEnvelope = {
      version: 1,
      purpose: safeHandoffId ? "start_here_signup" : "direct_demo",
      value: normalized,
      createdAt: Date.now(),
      handoffId: safeHandoffId,
    };
    // 값·목적·만료 시각·nonce를 한 번에 기록해 부분 저장 상태를 만들지 않는다.
    storage.setItem(DEMO_AMORA_PREFILL_STORAGE_KEY, JSON.stringify(envelope));
    storage.removeItem(DEMO_AMORA_PREFILL_CREATED_AT_STORAGE_KEY);
    storage.removeItem(DEMO_AMORA_PREFILL_HANDOFF_STORAGE_KEY);
  } catch {
    // 사생활 보호 모드 등에서 sessionStorage를 막아도 체험 진입은 계속한다.
  }
}

export function readDemoAmoraPrefill(
  storage: DemoHandoffStorage,
  expectedHandoffId?: string | null,
): string | null {
  try {
    const rawEnvelope = storage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY);
    const envelope: unknown = rawEnvelope ? JSON.parse(rawEnvelope) : null;
    const safeExpectedHandoffId = normalizeHandoffId(expectedHandoffId);
    const expectedBoundHandoff = expectedHandoffId !== undefined;
    if (
      !envelope
      || typeof envelope !== "object"
      || !("version" in envelope)
      || envelope.version !== 1
      || !("purpose" in envelope)
      || (envelope.purpose !== "direct_demo" && envelope.purpose !== "start_here_signup")
      || !("value" in envelope)
      || typeof envelope.value !== "string"
      || !("createdAt" in envelope)
      || typeof envelope.createdAt !== "number"
      || !("handoffId" in envelope)
      || (envelope.handoffId !== null && typeof envelope.handoffId !== "string")
    ) {
      forgetDemoAmoraPrefill(storage);
      return null;
    }
    const normalized = envelope.value.trim().slice(0, MAX_PREFILL_LENGTH);
    const now = Date.now();
    const expired = !Number.isFinite(envelope.createdAt)
      || envelope.createdAt <= 0
      || envelope.createdAt > now + 60_000
      || now - envelope.createdAt > PREFILL_TTL_MS;
    const handoffMismatch = expectedBoundHandoff
      ? envelope.purpose !== "start_here_signup"
        || !safeExpectedHandoffId
        || envelope.handoffId !== safeExpectedHandoffId
      : envelope.purpose !== "direct_demo" || envelope.handoffId !== null;
    if (!normalized || expired || handoffMismatch) {
      forgetDemoAmoraPrefill(storage);
      return null;
    }
    return normalized || null;
  } catch {
    forgetDemoAmoraPrefill(storage);
    return null;
  }
}

export function consumeDemoAmoraPrefill(
  storage: DemoHandoffStorage,
  expectedHandoffId?: string | null,
): string | null {
  const value = readDemoAmoraPrefill(storage, expectedHandoffId);
  if (value) forgetDemoAmoraPrefill(storage);
  return value;
}

export function forgetDemoAmoraPrefill(storage: DemoHandoffStorage): void {
  try {
    storage.removeItem(DEMO_AMORA_PREFILL_STORAGE_KEY);
    storage.removeItem(DEMO_AMORA_PREFILL_CREATED_AT_STORAGE_KEY);
    storage.removeItem(DEMO_AMORA_PREFILL_HANDOFF_STORAGE_KEY);
  } catch {
    // 사생활 보호 모드 등에서 sessionStorage를 막아도 채팅은 계속한다.
  }
}
