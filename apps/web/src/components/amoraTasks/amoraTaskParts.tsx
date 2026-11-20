import type { ReactNode } from "react";
import { AMORA_TASK_STAGE_LABELS, type AmoraTaskStage } from "@hanbang/shared/amora-tasks";

import { cx } from "@/components/invitation/invitationScreen";

/**
 * 아모라가 맡은 일(D-84, 25장 갈래 4) 웹 화면 셋이 같이 쓰는 조각.
 * 홈 카드(`AmoraTasksNotice`), 대화 카드(`AmoraTaskOfferCard`), 결과 화면(`AmoraTaskDetailView`)이 쓴다.
 *
 * - 서버는 같은 출처로만 부르고 쿠키를 싣고 캐시하지 않는다. 쓰기(POST)는 서버가 출처를 다시 본다
 *   (같은 출처 요청이면 브라우저가 Origin 과 Sec-Fetch-Site 를 싣는다).
 * - 응답 모양은 계약(`@hanbang/shared/amora-tasks`)의 읽는 함수가 확인한다. 여기서는 받았는지와 상태 번호만 넘긴다.
 * - 화면 문장은 계약의 `AMORA_TASK_COPY` 만 쓴다.
 *
 * 상태 한 줄은 `LiveParts` 의 `LiveNotice` 와 같은 값이지만 거기서 가져오지 않는다. `LiveParts` 는 대화 칸
 * (`ChatSidePanel`)을 불러오고, 대화 카드는 그 대화 칸 안(`ActionCard`)에서 그려져 불러오기가 돌고 돈다.
 */

export const AMORA_TASKS_API_PATH = "/api/amora/tasks";

export type AmoraTaskAction = "start" | "cancel" | "resume";

export type AmoraTasksReply =
  /** 응답을 받았다. `payload` 는 JSON 이 아니면 null 이다. */
  | { received: true; ok: boolean; status: number; payload: unknown }
  /** 연결이 끊겼거나 화면이 요청을 멈췄다. */
  | { received: false; aborted: boolean };

/** 맡은 일 하나의 API 주소(`/api/amora/tasks/<id>`). id 는 계약의 읽는 함수가 이미 확인한 값이다. */
export function amoraTaskApiPath(taskId: string): string {
  return `${AMORA_TASKS_API_PATH}/${encodeURIComponent(taskId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

/** 한 번 부른다. `action` 이 있으면 그 일을 POST 로 보내고, 없으면 GET 으로 읽는다. */
export async function requestAmoraTasks(
  path: string,
  options: { action?: AmoraTaskAction; signal?: AbortSignal } = {},
): Promise<AmoraTasksReply> {
  const { action, signal } = options;
  let response: Response;
  try {
    response = await fetch(path, {
      method: action ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: action ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" },
      body: action ? JSON.stringify({ action }) : undefined,
      signal,
    });
  } catch {
    return { received: false, aborted: signal?.aborted === true };
  }
  const payload = await readJson(response);
  if (signal?.aborted) return { received: false, aborted: true };
  return { received: true, ok: response.ok, status: response.status, payload };
}

/**
 * 스위치가 꺼졌거나(`enabled:false`) 표가 아직 없다(`available:false`). 그때 화면은 아무것도 그리지 않는다
 * (앱과 웹이 DB 보다 먼저 나가도 홈이 깨지지 않는다).
 */
export function isAmoraTasksOff(reply: AmoraTasksReply): boolean {
  return reply.received
    && isRecord(reply.payload)
    && (reply.payload.enabled === false || reply.payload.available === false);
}

/** 쓰기 응답의 결과 코드(`daily_task_limit` 같은). 없으면 null. */
export function amoraTaskReplyCode(reply: AmoraTasksReply): string | null {
  return reply.received && isRecord(reply.payload) && typeof reply.payload.code === "string" ? reply.payload.code : null;
}

/** 쓰기를 서버가 받아들였다(`{ ok: true }`). 이미 시작한 일을 다시 눌러도 받아들인다(`already_started`). */
export function isAmoraTaskReplyAccepted(reply: AmoraTasksReply): boolean {
  return reply.received && reply.ok && isRecord(reply.payload) && reply.payload.ok === true;
}

/** 홈의 네 단계 알약(찾는 중, 정리 중, 확인해 주세요, 끝남). 확인해 주세요만 눈에 띄는 바탕이다. */
export function AmoraTaskStagePill({ stage }: { stage: AmoraTaskStage }) {
  return (
    <span
      className={cx(
        "shrink-0 rounded-full px-2.5 py-[5px] text-[12px] text-inv-ink",
        stage === "needs_review" ? "bg-inv-blush" : "bg-inv-stone",
      )}
      data-amora-task-stage={stage}
    >
      {AMORA_TASK_STAGE_LABELS[stage]}
    </span>
  );
}

/** 상태 한 줄. 실패는 경고색으로 바로 읽어 주고, 나머지는 조용히 알린다. */
export function AmoraTaskLine({ tone = "status", children }: { tone?: "status" | "error"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cx("text-[13px] leading-[1.6]", tone === "error" ? "text-inv-warn" : "text-inv-body")}
      data-amora-task-line={tone}
    >
      {children}
    </p>
  );
}
