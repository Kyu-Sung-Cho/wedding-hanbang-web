export const AMORA_TEXT_DRAFT_KEYS = {
  conversation: "hanbang:amora-text-drafts:v1:conversation",
  panel: "hanbang:amora-text-drafts:v1:panel",
} as const;

let recoveryEpoch = 0;

export function getAmoraTextDraftRecoveryEpoch() {
  return recoveryEpoch;
}

export function clearAmoraTextDraftRecovery() {
  recoveryEpoch += 1;
  if (typeof window === "undefined") return;
  for (const key of Object.values(AMORA_TEXT_DRAFT_KEYS)) {
    try { window.sessionStorage.removeItem(key); } catch { /* 차단된 저장소 때문에 로그아웃을 멈추지 않는다. */ }
  }
}
