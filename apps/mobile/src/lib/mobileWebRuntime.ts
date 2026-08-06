import { buildMobileSiteUrl } from "./siteUrl.mjs";
import { validateMobileWebRuntimeContract } from "@hanbang/shared";

const RUNTIME_CONTRACT_MAX_BYTES = 8 * 1024;
const RUNTIME_CONTRACT_TIMEOUT_MS = 5_000;

let verifiedRuntimeKey: string | null = null;

function utf8ByteLength(value: string): number {
  let length = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;

    if (codePoint <= 0x7f) length += 1;
    else if (codePoint <= 0x7ff) length += 2;
    else if (codePoint <= 0xffff) length += 3;
    else length += 4;
  }

  return length;
}

/**
 * 검증 결과. 두 실패를 구분하는 것이 이 타입의 존재 이유다.
 *
 *   unreachable — 물어볼 수 없었다(신호 없음, 시간 초과, 서버 오류).
 *                 위험하지 않다. 앱과 웹이 어긋났다는 증거가 아니다.
 *   mismatch    — 물어봤고, 답이 우리가 기대한 것과 달랐다.
 *                 위험하다. 세션이나 딥링크가 엉뚱한 프로젝트를 건드릴 수 있다.
 *
 * 예전에는 둘 다 예외를 던졌고 호출부가 하나로 묶어 처리했다. 그래서 지하철에서 앱을
 * 열면 예산도 일정도 대화도 못 보고 "로그인 상태를 확인하지 못했어요"만 남았다.
 */
export type MobileWebRuntimeVerification =
  | { ok: true }
  | { ok: false; reason: "unreachable" | "mismatch"; detail: string };

export async function verifyMobileWebRuntime({
  siteOrigin,
  supabaseUrl,
  fetchImpl = fetch,
}: {
  siteOrigin: string;
  supabaseUrl: string | null | undefined;
  fetchImpl?: typeof fetch;
}): Promise<MobileWebRuntimeVerification> {
  const runtimeKey = `${siteOrigin}|${supabaseUrl ?? ""}`;
  if (verifiedRuntimeKey === runtimeKey) return { ok: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUNTIME_CONTRACT_TIMEOUT_MS);

  try {
    let raw: string;
    try {
      const response = await fetchImpl(
        buildMobileSiteUrl("/api/mobile/runtime-contract", siteOrigin),
        {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );
      // 서버가 응답하지 않거나 오류를 내면 "물어볼 수 없었다"이지 "어긋났다"가 아니다.
      if (!response.ok) {
        return { ok: false, reason: "unreachable", detail: `status_${response.status}` };
      }

      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > RUNTIME_CONTRACT_MAX_BYTES) {
        return { ok: false, reason: "unreachable", detail: "oversized" };
      }

      raw = await response.text();
    } catch {
      // 신호 없음, 시간 초과, DNS 실패 — 전부 여기로 온다.
      return { ok: false, reason: "unreachable", detail: "network" };
    }

    if (utf8ByteLength(raw) > RUNTIME_CONTRACT_MAX_BYTES) {
      return { ok: false, reason: "unreachable", detail: "oversized" };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "unreachable", detail: "unparseable" };
    }

    // 여기서부터는 답을 받았다. 답이 기대와 다르면 그것은 증거이고, 막아야 한다.
    const validation = validateMobileWebRuntimeContract(payload, supabaseUrl);
    if (!validation.ok) {
      return { ok: false, reason: "mismatch", detail: validation.reason };
    }

    verifiedRuntimeKey = runtimeKey;
    return { ok: true };
  } finally {
    clearTimeout(timeout);
  }
}

export function resetMobileWebRuntimeVerificationForTests(): void {
  verifiedRuntimeKey = null;
}
