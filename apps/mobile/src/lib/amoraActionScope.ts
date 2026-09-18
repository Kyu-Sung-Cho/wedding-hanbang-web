import { supabase } from "@/lib/supabase";
import {
  AMORA_ACTION_VISIBLE_LIMIT,
  parseAmoraActions,
  selectOpenAmoraActions,
} from "@/lib/amoraActions.mjs";
import { parseSharedActionList, type SharedAction } from "@hanbang/shared/amora-shared-actions";

/**
 * 공유 할 일을 읽고 고치는 두 화면(라운지 미리보기 `AmoraActionsCard`, 준비 기록 보드
 * `SharedTaskBoard`)이 같이 쓰는 계정·커플 경계와 응답 검사.
 *
 * `sameScope`·`currentVerifiedScope`·`actionSnapshot` 은 `AmoraActionsCard.tsx` 에 있던 것을
 * **그대로 옮겼다.** 두 화면이 서로 다른 경계를 쓰면 한쪽만 예전 계정의 할 일을 그린다.
 */

export type ActionRow = ReturnType<typeof parseAmoraActions>[number];
export type ActionStatus = "open" | "done" | "dismissed";

export type ViewState =
  | { kind: "quiet" }
  | { kind: "ready"; visible: ActionRow[]; hiddenCount: number; openCount: number; totalCount: number; truncated: boolean; nextCursor: string | null; status: ActionStatus };

export type ActionScope = { userId: string; coupleId: string | null; role: string | null };
export const sameScope = (left: ActionScope | null, right: ActionScope | null) =>
  left?.userId === right?.userId && left?.coupleId === right?.coupleId && left?.role === right?.role;

export function actionSnapshot(payload: unknown, status: ActionStatus, board: boolean): ViewState {
  if (!payload || typeof payload !== "object" || !("actions" in payload) || !Array.isArray(payload.actions)
    || !("open_count" in payload) || !Number.isSafeInteger(payload.open_count)
    || typeof payload.open_count !== "number" || payload.open_count < 0
    || !("count" in payload) || typeof payload.count !== "number" || !Number.isSafeInteger(payload.count) || payload.count < 0
    || (status === "open" && payload.count !== payload.open_count)
    || ("truncated" in payload && typeof payload.truncated !== "boolean")) throw new Error("INVALID_ACTION_SNAPSHOT");
  const parsed = parseAmoraActions(payload);
  if (parsed.length !== payload.actions.length || payload.actions.some(action => !action || typeof action !== "object" || action.status !== status)
    || payload.count < parsed.length || new Set(parsed.map(action => action.id)).size !== parsed.length
    || ("next_cursor" in payload && payload.next_cursor !== null && (typeof payload.next_cursor !== "string" || !payload.next_cursor))) {
    throw new Error("INVALID_ACTION_SNAPSHOT");
  }
  const visible = board ? parsed : selectOpenAmoraActions(parsed, AMORA_ACTION_VISIBLE_LIMIT).visible;
  return {
    kind: "ready", visible, openCount: payload.open_count, totalCount: payload.count, status,
    hiddenCount: payload.count - visible.length, truncated: board ? payload.count > visible.length : "truncated" in payload && payload.truncated === true,
    nextCursor: "next_cursor" in payload && typeof payload.next_cursor === "string" ? payload.next_cursor : null,
  };
}

async function currentVerifiedUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error("ACTION_SCOPE_UNAVAILABLE");
  return data.user?.id ?? null;
}

export async function currentVerifiedScope(): Promise<ActionScope | null> {
  const userId = await currentVerifiedUserId();
  if (!userId) return null;
  const { data, error } = await supabase.from("profiles").select("couple_id, role").eq("id", userId).single();
  if (error || !data || (data.couple_id !== null && typeof data.couple_id !== "string")
    || (data.role !== null && typeof data.role !== "string")) throw new Error("ACTION_SCOPE_UNAVAILABLE");
  if (await currentVerifiedUserId() !== userId) return null;
  return { userId, coupleId: data.couple_id, role: data.role };
}

export type SharedTaskSnapshot = {
  kind: "ready"; visible: SharedAction[]; openCount: number; totalCount: number;
  truncated: boolean; nextCursor: string | null; status: ActionStatus;
};

/**
 * 준비 기록 보드용 한 페이지. 응답 검사는 `actionSnapshot` 과 **같은 검사**를 그대로 쓰고
 * (개수·상태·중복 id·커서), 항목만 설명·예정일 원문·분야·출처까지 담은 공용 해석 결과로 돌려준다.
 */
export function sharedTaskSnapshot(payload: unknown, status: ActionStatus): SharedTaskSnapshot {
  const checked = actionSnapshot(payload, status, true);
  const visible = parseSharedActionList(payload);
  if (checked.kind !== "ready" || visible.length !== checked.visible.length
    || visible.some((action, index) => action.id !== checked.visible[index]?.id)) throw new Error("INVALID_ACTION_SNAPSHOT");
  return {
    kind: "ready", visible, openCount: checked.openCount, totalCount: checked.totalCount,
    truncated: checked.truncated, nextCursor: checked.nextCursor, status,
  };
}
