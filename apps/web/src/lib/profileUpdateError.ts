export const PROFILE_UPDATE_MESSAGES = {
  PROFILE_UPDATE_OUTCOME_UNKNOWN: "저장 결과를 아직 확인하지 못했어요. 잠시 후 다시 확인해 주세요. 확인 전에는 추가 저장하지 않아요.",
  PROFILE_UPDATE_IN_FLIGHT: "앞선 저장 결과를 확인하고 있어요. 잠시 후 다시 확인해 주세요.",
  PROFILE_UPDATE_REVIEW_REQUIRED: "현재 저장된 프로필을 다시 불러왔어요. 내용을 확인한 뒤 다시 저장해 주세요.",
} as const;

export class ProfileUpdateError extends Error {
  constructor(readonly code: keyof typeof PROFILE_UPDATE_MESSAGES) {
    super(PROFILE_UPDATE_MESSAGES[code]);
    this.name = "ProfileUpdateError";
  }
}

/** 알려진 코드의 고정 문구만 노출한다. 서버/네트워크 원문을 사용자에게 전달하지 않는다. */
export function profileUpdateErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = error.code;
  if (code === "PROFILE_UPDATE_OUTCOME_UNKNOWN" || code === "PROFILE_UPDATE_IN_FLIGHT" || code === "PROFILE_UPDATE_REVIEW_REQUIRED") {
    return PROFILE_UPDATE_MESSAGES[code];
  }
  return null;
}
