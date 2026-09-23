export type AmoraDecisionReceipt = {
  id: string;
  title: string;
  status: "exploring" | "considering" | "decided";
  memo: string | null;
  category_key: string;
  created_at: string;
};

export const AMORA_DECISION_STATUS_LABELS = {
  exploring: "미정",
  considering: "논의 중",
  decided: "확정",
} as const;

export const AMORA_DECISION_BOARD_PATH = "/wedding/chat/board?view=decisions";
export const AMORA_DECISION_SCOPE_NOTICE = "함께 보는 기록이에요. 두 사람의 합의를 뜻하지 않아요.";

// 승인 저장 RPC가 받는 분야만 허용한다. 앱 일정 입력의 더 넓은 분야 목록과는 다르다.
const DECISION_CATEGORIES: ReadonlySet<string> = new Set([
  "general", "meeting", "venue", "studio", "dress", "makeup", "ring", "hanbok", "yedan", "honeymoon",
  "houseware", "housing", "invitation", "snap", "shoes", "bouquet", "gift", "mc", "ham", "pyebaek",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 인증된 서버 도구 결과의 모양만 검증한다. verified 자체는 권한·DB 저장의 증명이 아니다. */
export function readAmoraDecisionReceipt(output: unknown): AmoraDecisionReceipt | null {
  if (!isRecord(output) || output.verified !== true || !isRecord(output.decision)) return null;
  const row = output.decision;
  if (
    typeof row.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(row.id)
    || typeof row.title !== "string" || !row.title.trim() || row.title.length > 160
    || (row.status !== "exploring" && row.status !== "considering" && row.status !== "decided")
    || (row.memo !== null && (typeof row.memo !== "string" || row.memo.length > 1_000))
    || typeof row.category_key !== "string" || !DECISION_CATEGORIES.has(row.category_key)
    || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))
  ) return null;
  return { id: row.id, title: row.title, status: row.status, memo: row.memo, category_key: row.category_key, created_at: row.created_at };
}
