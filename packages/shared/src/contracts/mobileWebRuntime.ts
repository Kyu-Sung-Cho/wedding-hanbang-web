export const MOBILE_WEB_RUNTIME_CONTRACT_VERSION = 1 as const;

export const MOBILE_WEB_REQUIRED_CAPABILITIES = [
  "shared-supabase-auth-v1",
  "wedding-journey-realtime-v1",
  "mobile-web-bearer-v1",
] as const;

export interface MobileWebRuntimeContract {
  version: typeof MOBILE_WEB_RUNTIME_CONTRACT_VERSION;
  supabaseProjectRef: string;
  capabilities: string[];
}

export type MobileWebRuntimeContractValidation =
  | { ok: true; contract: MobileWebRuntimeContract }
  | {
      ok: false;
      reason: "invalid" | "version" | "destination" | "capability";
    };

const SUPABASE_PROJECT_HOST = /^([a-z0-9]{20})\.supabase\.co$/;

export function getSupabaseProjectRef(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const match = SUPABASE_PROJECT_HOST.exec(url.hostname.toLowerCase());
    if (match) return match[1];

    if (
      url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
    ) {
      return `local:${url.port || "80"}`;
    }
  } catch {
    return null;
  }

  return null;
}

export function buildMobileWebRuntimeContract(
  supabaseUrl: string | null | undefined,
): MobileWebRuntimeContract | null {
  const supabaseProjectRef = getSupabaseProjectRef(supabaseUrl);
  if (!supabaseProjectRef) return null;

  return {
    version: MOBILE_WEB_RUNTIME_CONTRACT_VERSION,
    supabaseProjectRef,
    capabilities: [...MOBILE_WEB_REQUIRED_CAPABILITIES],
  };
}

export function validateMobileWebRuntimeContract(
  value: unknown,
  expectedSupabaseUrl: string | null | undefined,
): MobileWebRuntimeContractValidation {
  const expectedProjectRef = getSupabaseProjectRef(expectedSupabaseUrl);
  if (!expectedProjectRef || typeof value !== "object" || value === null) {
    return { ok: false, reason: "invalid" };
  }

  const candidate = value as Partial<MobileWebRuntimeContract>;
  if (candidate.version !== MOBILE_WEB_RUNTIME_CONTRACT_VERSION) {
    return { ok: false, reason: "version" };
  }
  if (candidate.supabaseProjectRef !== expectedProjectRef) {
    return { ok: false, reason: "destination" };
  }
  if (
    !Array.isArray(candidate.capabilities)
    || !candidate.capabilities.every((item): item is string => typeof item === "string")
    || !MOBILE_WEB_REQUIRED_CAPABILITIES.every((item) => candidate.capabilities?.includes(item))
  ) {
    return { ok: false, reason: "capability" };
  }

  return {
    ok: true,
    contract: {
      version: MOBILE_WEB_RUNTIME_CONTRACT_VERSION,
      supabaseProjectRef: expectedProjectRef,
      capabilities: [...candidate.capabilities],
    },
  };
}
