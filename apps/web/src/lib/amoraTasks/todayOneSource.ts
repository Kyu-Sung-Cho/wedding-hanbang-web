import { createHash } from "node:crypto";
import type { AmoraTaskMemberRow } from "./taskStore";

/**
 * 오늘의 한 가지의 "끝난 맡은 일" 고르기(갈래 2 의 `TODAY_ONE_EXTRA_SOURCES` 자리).
 *
 * 갈래 2 가 종류 이름(`task_done`)을 공용 계약(`packages/shared/src/contracts/todayOneCare.ts`)과 DB 검사에 넣기 전에는
 * 오늘의 한 가지 파일·DB 함수·검사 제약을 건드리지 않는다(2026-11-20 부모 세션). 여기서는 고르기만 준비한다.
 * 갈래 2 가 병합되면 `TodayOneExtraSource.build` 가 이 함수의 결과를 `TodayOneCandidate`(kind `task_done`)로 옮긴다.
 *
 * 화면 문장은 D-12 승인 대기다.
 */

export const TODAY_ONE_TASK_DONE_COPY = Object.freeze({
  whyNow: "아모라가 맡은 일을 마쳤어요.",
  confirmedTitle: (title: string) => `맡은 일: ${title}`,
  unknown: "결과가 맞는지는 출처를 보고 확인해 주세요.",
  impact: "확인만 하며 할 일이나 일정은 바꾸지 않아요.",
});

export type FinishedAmoraTaskPick = {
  taskId: string;
  title: string;
  finishedAt: string;
  sourceKey: string;
  sourceStateDigest: string;
  whyNow: string;
  confirmed: string[];
  unknown: string[];
  impact: string;
};

const HOUR_MS = 60 * 60 * 1000;
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** 지난 사흘 안에 끝난 일 가운데 가장 최근 것부터 세 개까지. */
export function pickFinishedAmoraTasks(
  rows: readonly AmoraTaskMemberRow[],
  now: Date,
  options: { maxAgeHours?: number; limit?: number } = {},
): FinishedAmoraTaskPick[] {
  const maxAgeMs = (options.maxAgeHours ?? 72) * HOUR_MS;
  return rows
    .filter((row) => row.status === "done" && typeof row.finished_at === "string")
    .map((row) => ({ row, finishedMs: Date.parse(row.finished_at!) }))
    .filter(({ finishedMs }) => Number.isFinite(finishedMs) && finishedMs <= now.getTime() && now.getTime() - finishedMs <= maxAgeMs)
    .sort((a, b) => b.finishedMs - a.finishedMs)
    .slice(0, options.limit ?? 3)
    .map(({ row }) => ({
      taskId: row.id,
      title: row.title,
      finishedAt: row.finished_at!,
      sourceKey: `task_done:${sha256(row.id).slice(0, 24)}`,
      sourceStateDigest: sha256(JSON.stringify({ version: 1, id: row.id, finishedAt: row.finished_at })),
      whyNow: TODAY_ONE_TASK_DONE_COPY.whyNow,
      confirmed: [TODAY_ONE_TASK_DONE_COPY.confirmedTitle(row.title)],
      unknown: [TODAY_ONE_TASK_DONE_COPY.unknown],
      impact: TODAY_ONE_TASK_DONE_COPY.impact,
    }));
}
