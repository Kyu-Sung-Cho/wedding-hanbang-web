import type { ChatVisibility } from "@/lib/ai/chatMessagePersistence";

/** 저장 노트의 출처가 될 수 있는 canonical 메시지의 최소 형태. */
export interface SavedNoteSourceMessage {
  couple_id: string | null;
  visibility: ChatVisibility | string | null;
  content: string | null;
}

export type SavedNoteSourceRefusal =
  | "source_not_found"
  | "private_source_needs_declassification"
  | "source_empty";

export type SavedNoteSourceDecision =
  | { ok: true; content: string }
  | { ok: false; reason: SavedNoteSourceRefusal };

interface EvaluateSavedNoteSourceInput {
  /** 서버가 canonical 테이블에서 읽은 행. 없으면 null. */
  message: SavedNoteSourceMessage | null;
  /** 요청한 사용자의 현재 커플. */
  requestCoupleId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 저장 노트는 커플 전체가 읽는다. 따라서 그 본문은 클라이언트가 보낸 문자열이 아니라
 * **서버가 canonical source에서 읽은 원문**이어야 하고, 원본보다 넓은 범위로 나갈 수
 * 없다(목표 아키텍처 §6 불변식 5·6).
 *
 * 개인 상담을 공유 범위로 넓히는 유일한 정당한 경로는 exact-preview declassification인데
 * 아직 구현되지 않았다. 그러므로 여기서는 조용히 넓히지 않고 거부한다.
 */
export function evaluateSavedNoteSource({
  message,
  requestCoupleId,
}: EvaluateSavedNoteSourceInput): SavedNoteSourceDecision {
  if (!isRecord(message)) return { ok: false, reason: "source_not_found" };

  const sourceCoupleId = typeof message.couple_id === "string" ? message.couple_id : null;
  // 다른 커플의 메시지는 존재 여부조차 알려주지 않는다.
  if (!sourceCoupleId || sourceCoupleId !== requestCoupleId) {
    return { ok: false, reason: "source_not_found" };
  }

  // 아는 공개 범위만 통과시킨다. 모르는 값을 shared로 추정하지 않는다.
  if (message.visibility !== "shared") {
    return { ok: false, reason: "private_source_needs_declassification" };
  }

  const content = typeof message.content === "string" ? message.content.trim() : "";
  if (!content) return { ok: false, reason: "source_empty" };

  return { ok: true, content };
}
