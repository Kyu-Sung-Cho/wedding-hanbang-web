import { createHash } from "node:crypto";
import type { AmoraActionItem } from "./actions";
import { amoraActionUpdatesToPayload } from "./actionRepository";
import { isRecord } from "@/utils/requestValidation";

export function parseManualActionRequestId(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : null;
}

export function manualActionIdForRequest(actorId: string, coupleId: string, requestId: string): string {
  return `amora_manual_${createHash("sha256").update(JSON.stringify(["manual-action-v1", actorId, coupleId, requestId])).digest("hex")}`;
}

/** 현재의 같은 소유 행과 정규화된 생성 값이 모두 같을 때만 재전송 영수증으로 쓴다. */
export function matchesManualActionCreateRow(row: unknown, action: AmoraActionItem, actorId: string, coupleId: string): boolean {
  if (!isRecord(row) || row.id !== action.id || row.couple_id !== coupleId || row.created_by !== actorId
    || typeof row.created_at !== "string" || typeof row.updated_at !== "string"
    || (row.completed_at !== null && typeof row.completed_at !== "string")) return false;
  const expected = amoraActionUpdatesToPayload(action);
  return ["title", "description", "due_date", "category_key", "priority", "status", "source", "href"]
    .every(key => row[key] === (expected[key] ?? null));
}
