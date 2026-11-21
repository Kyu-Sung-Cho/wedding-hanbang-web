import {
  parseCarePreferencePayload,
  type CarePreferencePayload,
  type CarePreferenceUpdate,
} from "@/lib/care/carePreferences";

export type CarePreferenceResult =
  | { ok: true; preference: CarePreferencePayload }
  | { ok: false; message: string };

const LOAD_FAILED = "알림 설정을 불러오지 못했어요.";
const SAVE_FAILED = "설정을 저장하지 못했어요. 기존 설정은 그대로예요.";

function serverMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const message = (payload as Record<string, unknown>).error;
    if (typeof message === "string" && message.length > 0 && message.length <= 200) {
      return message;
    }
  }
  return fallback;
}

export async function fetchCarePreference(): Promise<CarePreferenceResult> {
  try {
    const response = await fetch("/api/amora/care-preferences", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => null);
    const preference = response.ok ? parseCarePreferencePayload(payload) : null;
    return preference
      ? { ok: true, preference }
      : { ok: false, message: serverMessage(payload, LOAD_FAILED) };
  } catch {
    return { ok: false, message: LOAD_FAILED };
  }
}

export async function saveCarePreference(
  update: CarePreferenceUpdate,
): Promise<CarePreferenceResult> {
  try {
    const response = await fetch("/api/amora/care-preferences", {
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(update),
    });
    const payload = await response.json().catch(() => null);
    const preference = response.ok ? parseCarePreferencePayload(payload) : null;
    return preference
      ? { ok: true, preference }
      : { ok: false, message: serverMessage(payload, SAVE_FAILED) };
  } catch {
    return { ok: false, message: SAVE_FAILED };
  }
}
