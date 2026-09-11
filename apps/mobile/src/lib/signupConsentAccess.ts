import type { SignupConsentAccess } from "@hanbang/shared";
import { apiFetchForExpectedUser } from "./api";
import { supabase } from "./supabase";

const CONSENT_READ_TIMEOUT_MS = 12_000;

/** 서버 판정 전체(본문 읽기 포함)에 기한을 두며, 중간에 바뀐 주체의 응답은 버린다. */
export async function readMobileSignupConsentAccess(userId: string, signal?: AbortSignal): Promise<SignupConsentAccess> {
  if (signal?.aborted) throw signal.reason ?? new Error("SIGNUP_CONSENT_ABORTED");
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason ?? new Error("SIGNUP_CONSENT_ABORTED"));
  let unsubscribe = () => {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stopAbortListener = () => {};
  // 네트워크 구현이 abort를 무시해도 화면에는 유한 시간 안에 실패를 돌려준다.
  const interrupted = new Promise<never>((_resolve, reject) => {
    const rejectAbort = () => reject(controller.signal.reason ?? new Error("SIGNUP_CONSENT_ABORTED"));
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
    stopAbortListener = () => controller.signal.removeEventListener("abort", rejectAbort);
  });

  try {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== userId) controller.abort(new Error("SIGNUP_CONSENT_SESSION_CHANGED"));
    });
    unsubscribe = () => subscription.unsubscribe();
    timeout = setTimeout(() => controller.abort(new Error("SIGNUP_CONSENT_TIMEOUT")), CONSENT_READ_TIMEOUT_MS);
    const read = async (): Promise<SignupConsentAccess> => {
      if (controller.signal.aborted) throw controller.signal.reason;
      const response = await apiFetchForExpectedUser(userId, "/api/auth/me?consent_only=1", { signal: controller.signal });
      if (!response.ok) throw new Error("SIGNUP_CONSENT_READ_FAILED");
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !("user" in body) || !("capabilities" in body)) throw new Error("SIGNUP_CONSENT_READ_FAILED");
      const user = body.user;
      const capabilities = body.capabilities;
      if (!user || typeof user !== "object" || !("id" in user) || user.id !== userId
        || !capabilities || typeof capabilities !== "object" || !("signupConsentAccess" in capabilities)) throw new Error("SIGNUP_CONSENT_READ_FAILED");
      const access = capabilities.signupConsentAccess;
      if (access !== "server_verified" && access !== "legacy_unverified" && access !== "required") throw new Error("SIGNUP_CONSENT_READ_FAILED");
      return access;
    };
    return await Promise.race([interrupted, read()]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
    stopAbortListener();
    unsubscribe();
  }
}
