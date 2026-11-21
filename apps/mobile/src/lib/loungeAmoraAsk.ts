/**
 * 라운지 할 일에서 아모라에게 묻기.
 *
 * 2026-11-13 파운더 결정: 메인은 웨딩 라운지와 아모라 둘이고 나머지 기능은 아모라 뒤로 간다.
 * 라운지가 보여 주는 할 일은 아모라에게 바로 넘길 수 있다. 누르면 질문을 아모라 입력칸에
 * 넣어 둘 뿐 보내지 않는다. 보내는 것은 사람이다(웹 라운지의 「아모라에게 묻기」와 같다).
 *
 * ## 왜 주소에 문장을 싣지 않는가
 *
 * 일정 이름은 사람이 직접 적은 글이다. 주소에 실으면 화면 이동 기록(오류 보고에 붙는 이동
 * 흔적까지)에 그대로 남는다. 주소에는 번호만 싣고 문장은 앱 안에서 한 번 건넨다. 앱이 꺼져
 * 건넬 문장이 사라졌으면 대화는 평소처럼 빈 입력칸으로 열린다.
 *
 * ## 왜 진입구 표(`amoraChatEntry.ts`)와 따로 두는가
 *
 * 진입구 초안은 고정 문구이고 대화 화면이 한 번 열릴 때 한 번만 놓는다. 할 일 질문은 누를
 * 때마다 다른 질문이라 번호가 바뀔 때마다 받아야 한다.
 */
import { AMORA_CHAT_TASK_ENTRY } from "./amoraChatEntry";

/** 라운지가 아모라에게 넘기는 할 일. 웹 라운지의 할 일 두 종류(체크리스트 분야·일정)와 같다. */
export type LoungeAmoraTask =
  | { kind: "checklist"; categoryLabel: string }
  | { kind: "event"; title: string };

/** 대화 화면이 질문 번호를 읽는 쿼리 이름. */
export const LOUNGE_AMORA_ASK_PARAM = "ask" as const;

/** 웹 `AMORA_PREFILL_MAX_LENGTH`(apps/web/src/components/app/amora/amoraDock.ts)와 같은 상한. */
export const LOUNGE_AMORA_ASK_MAX_LENGTH = 2_000;

/**
 * 입력칸에 넣는 질문. 웹 `loungeAmoraPrompt`(apps/web/src/app/(app)/lounge/LoungeHubSections.tsx)와
 * 글자까지 같다. 같은 사람이 웹과 앱에서 같은 할 일에 다른 질문을 받지 않게
 * (`loungeAmoraAsk.test.mjs` 가 웹 함수를 그대로 꺼내 대조한다). 사람이 보낼 말이라 사람 말투다.
 */
export function buildLoungeAmoraPrompt(task: LoungeAmoraTask): string {
  if (task.kind === "checklist") return `${task.categoryLabel} 준비, 지금 뭐부터 하면 될까?`;
  return `${task.title} 앞두고 뭘 챙기면 될까?`;
}

function taskName(task: LoungeAmoraTask): string {
  return task.kind === "checklist" ? task.categoryLabel : task.title;
}

interface PendingLoungeAsk {
  id: number;
  ownerId: string;
  text: string;
}

// 건넬 질문은 한 칸이다. 연달아 누르면 마지막 것만 남는다.
let pending: PendingLoungeAsk | null = null;
let sequence = 0;

/**
 * 질문을 건넬 준비를 하고 번호를 돌려준다. 누가 눌렀는지 모르거나 할 일 이름이 비었으면
 * 아무것도 남기지 않고 null 이다.
 */
export function stageLoungeAmoraAsk(input: { ownerId: string; task: LoungeAmoraTask }): number | null {
  if (typeof input.ownerId !== "string" || !input.ownerId) return null;
  if (!taskName(input.task).trim()) return null;
  const text = buildLoungeAmoraPrompt(input.task).trim().slice(0, LOUNGE_AMORA_ASK_MAX_LENGTH);
  sequence += 1;
  pending = { id: sequence, ownerId: input.ownerId, text };
  return sequence;
}

/**
 * 정해진 글을 고치지 않고 그대로 건넬 준비를 한다(2026-11-20, 아모라가 맡은 일 결과 화면의 「다음에 할 일」).
 * 할 일 질문과 같은 한 칸·같은 번호를 쓰므로 대화 화면은 같은 문(`entry=lounge_task&ask=`)으로 받아 입력칸에
 * 넣기만 하고 보내지 않는다. 누가 눌렀는지 모르거나 글이 비었으면 아무것도 남기지 않고 null 이다.
 */
export function stageLoungeAmoraAskText(input: { ownerId: string; text: string }): number | null {
  if (typeof input.ownerId !== "string" || !input.ownerId) return null;
  if (typeof input.text !== "string") return null;
  const text = input.text.trim().slice(0, LOUNGE_AMORA_ASK_MAX_LENGTH);
  if (!text) return null;
  sequence += 1;
  pending = { id: sequence, ownerId: input.ownerId, text };
  return sequence;
}

/**
 * 그 번호의 질문을 한 번 받는다. 다른 사람이 열었으면 질문을 버리고 null 이다(계정이 바뀐
 * 사이에 남은 질문이 다른 사람의 입력칸에 들어가지 않게).
 */
export function takeLoungeAmoraAsk(input: { ownerId: string; id: number }): string | null {
  const current = pending;
  if (!current || current.id !== input.id) return null;
  pending = null;
  return current.ownerId === input.ownerId ? current.text : null;
}

/** 주소에서 온 번호. 1 이상의 정수 문자열만 받는다. expo-router 가 배열을 주면 첫 값만 본다. */
export function readLoungeAmoraAskId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^[1-9]\d{0,8}$/u.test(raw)) return null;
  return Number(raw);
}

/** 대화 화면으로 가는 주소. 번호와 진입구 이름만 싣는다. */
export function buildLoungeAmoraAskHref(id: number): string {
  return `/(tabs)/chat?entry=${AMORA_CHAT_TASK_ENTRY}&${LOUNGE_AMORA_ASK_PARAM}=${id}`;
}
