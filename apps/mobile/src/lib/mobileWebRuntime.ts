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

export async function verifyMobileWebRuntime({
  siteOrigin,
  supabaseUrl,
  fetchImpl = fetch,
}: {
  siteOrigin: string;
  supabaseUrl: string | null | undefined;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const runtimeKey = `${siteOrigin}|${supabaseUrl ?? ""}`;
  if (verifiedRuntimeKey === runtimeKey) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUNTIME_CONTRACT_TIMEOUT_MS);

  try {
    const response = await fetchImpl(
      buildMobileSiteUrl("/api/mobile/runtime-contract", siteOrigin),
      {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error("MOBILE_WEB_RUNTIME_UNAVAILABLE");

    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > RUNTIME_CONTRACT_MAX_BYTES) {
      throw new Error("MOBILE_WEB_RUNTIME_INVALID");
    }

    const raw = await response.text();
    if (utf8ByteLength(raw) > RUNTIME_CONTRACT_MAX_BYTES) {
      throw new Error("MOBILE_WEB_RUNTIME_INVALID");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("MOBILE_WEB_RUNTIME_INVALID");
    }

    const validation = validateMobileWebRuntimeContract(payload, supabaseUrl);
    if (!validation.ok) {
      throw new Error(`MOBILE_WEB_RUNTIME_${validation.reason.toUpperCase()}`);
    }

    verifiedRuntimeKey = runtimeKey;
  } finally {
    clearTimeout(timeout);
  }
}

export function resetMobileWebRuntimeVerificationForTests(): void {
  verifiedRuntimeKey = null;
}
