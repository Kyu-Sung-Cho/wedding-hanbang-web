import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AMORA_TASK_COPY, AMORA_TASK_STAGE_LABELS } from "@hanbang/shared/amora-tasks";

import { apiError, cleanup, flush, json, mockApi, never, render } from "@/components/invitation/live/__tests__/liveTestKit";

import AmoraTasksNotice from "../AmoraTasksNotice";

/**
 * 홈의 "아모라가 맡은 일"(D-84). 스위치가 꺼졌거나 표가 없거나 서버가 답하지 못하면 홈이 깨지지 않게 숨고,
 * 카드만 나온 일·그만둔 일·닫힌 일은 그리지 않으며, 찾는 중·정리 중인 동안만 다시 읽는다.
 */

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: "user-1", email: "user@example.test" } as { id: string; email: string } | null,
    profile: { id: "user-1", couple_id: "couple-1" } as Record<string, unknown> | null,
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => {
    const attributes: Record<string, unknown> = { ...rest };
    delete attributes.prefetch;
    return (
      <a href={href} {...attributes}>
        {children}
      </a>
    );
  },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector?: (state: typeof mocks.auth) => unknown) => (selector ? selector(mocks.auth) : mocks.auth),
}));

const LIST = "GET /api/amora/tasks";

const taskId = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;

function task(n: number, status: string, title: string) {
  return {
    id: taskId(n),
    kind: "hall_candidates",
    title,
    status,
    reviewReason: status === "needs_review" ? "daily_search_limit" : null,
    createdAt: "2026-11-20T01:00:00.000Z",
    startedAt: status === "offered" ? null : "2026-11-20T01:01:00.000Z",
    finishedAt: null,
    updatedAt: "2026-11-20T01:05:00.000Z",
  };
}

function list(tasks: unknown[]) {
  return json({ enabled: true, available: true, tasks });
}

function rows(container: ParentNode) {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>("a[data-amora-task]")).map((row) => ({
    href: row.getAttribute("href"),
    title: row.querySelector("span")?.textContent ?? "",
    stage: row.querySelector("[data-amora-task-stage]")?.textContent ?? "",
  }));
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

beforeEach(() => {
  mocks.auth.user = { id: "user-1", email: "user@example.test" };
  mocks.auth.profile = { id: "user-1", couple_id: "couple-1" };
});

afterEach(async () => {
  await cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("홈의 아모라가 맡은 일", () => {
  it.each([
    ["스위치가 꺼졌을 때", () => json({ enabled: false, available: false, tasks: [] })],
    ["표가 아직 없을 때", () => json({ enabled: true, available: false, tasks: [] })],
    ["로그인이 풀렸을 때(401)", () => apiError(401, "AMORA_TASKS_AUTH_REQUIRED", "인증이 필요합니다.")],
    ["서버가 답하지 못할 때(503)", () => apiError(503, "AMORA_TASKS_LIST_FAILED", "맡은 일을 불러오지 못했어요.")],
    ["연결이 끊겼을 때", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["맡긴 일이 없을 때", () => list([])],
  ])("%s 아무것도 그리지 않는다", async (_name, reply) => {
    const api = mockApi({ [LIST]: reply });
    const { container } = await render(<AmoraTasksNotice />);
    expect(container.innerHTML).toBe("");
    expect(api.count("GET", "/api/amora/tasks")).toBe(1);
  });

  it("로그인한 사람이 없으면 서버를 부르지 않는다", async () => {
    mocks.auth.user = null;
    const api = mockApi({});
    const { container } = await render(<AmoraTasksNotice />);
    expect(container.innerHTML).toBe("");
    expect(api.calls).toHaveLength(0);
  });

  it("세 개까지 제목과 단계 알약, 결과 화면 링크로 보이고 카드만 나온 일·그만둔 일·닫힌 일은 그리지 않는다", async () => {
    mockApi({
      [LIST]: list([
        task(1, "offered", "카드만 나온 일"),
        task(2, "queued", "강남 웨딩홀 후보 찾기"),
        task(3, "cancelled", "그만둔 일"),
        task(4, "organizing", "받은 견적 비교"),
        task(5, "expired", "닫힌 일"),
        task(6, "needs_review", "스드메 후보 찾기"),
        task(7, "done", "할 일과 마감 정리"),
      ]),
    });
    const { container } = await render(<AmoraTasksNotice />);

    expect(container.querySelector("[data-amora-tasks] h2")?.textContent).toBe(AMORA_TASK_COPY.homeTitle);
    expect(rows(container)).toEqual([
      { href: `/wedding/amora-tasks/${taskId(2)}`, title: "강남 웨딩홀 후보 찾기", stage: AMORA_TASK_STAGE_LABELS.searching },
      { href: `/wedding/amora-tasks/${taskId(4)}`, title: "받은 견적 비교", stage: AMORA_TASK_STAGE_LABELS.organizing },
      { href: `/wedding/amora-tasks/${taskId(6)}`, title: "스드메 후보 찾기", stage: AMORA_TASK_STAGE_LABELS.needs_review },
    ]);
    for (const hidden of ["카드만 나온 일", "그만둔 일", "닫힌 일", "할 일과 마감 정리"]) {
      expect(container.textContent).not.toContain(hidden);
    }
  });

  it("끝난 일은 끝남 알약으로 남는다", async () => {
    mockApi({ [LIST]: list([task(7, "done", "할 일과 마감 정리"), task(1, "offered", "카드만 나온 일")]) });
    const { container } = await render(<AmoraTasksNotice />);
    expect(rows(container)).toEqual([
      { href: `/wedding/amora-tasks/${taskId(7)}`, title: "할 일과 마감 정리", stage: AMORA_TASK_STAGE_LABELS.done },
    ]);
  });

  it("찾는 중이거나 정리 중인 일이 있으면 30초마다 다시 읽고, 모두 끝나면 멈춘다", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const api = mockApi({
      [LIST]: [
        list([task(2, "searching", "강남 웨딩홀 후보 찾기")]),
        list([task(2, "organizing", "강남 웨딩홀 후보 찾기")]),
        list([task(2, "done", "강남 웨딩홀 후보 찾기")]),
      ],
    });
    const { container } = await render(<AmoraTasksNotice />);
    expect(rows(container)[0]?.stage).toBe(AMORA_TASK_STAGE_LABELS.searching);

    await advance(29_000);
    expect(api.count("GET", "/api/amora/tasks")).toBe(1);
    await advance(1_000);
    expect(api.count("GET", "/api/amora/tasks")).toBe(2);
    expect(rows(container)[0]?.stage).toBe(AMORA_TASK_STAGE_LABELS.organizing);

    await advance(30_000);
    expect(api.count("GET", "/api/amora/tasks")).toBe(3);
    expect(rows(container)[0]?.stage).toBe(AMORA_TASK_STAGE_LABELS.done);

    await advance(120_000);
    expect(api.count("GET", "/api/amora/tasks")).toBe(3);
  });

  it("확인을 기다리거나 끝난 일만 있으면 다시 읽지 않는다", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const api = mockApi({ [LIST]: list([task(6, "needs_review", "스드메 후보 찾기"), task(7, "done", "할 일과 마감 정리")]) });
    await render(<AmoraTasksNotice />);
    await advance(120_000);
    expect(api.count("GET", "/api/amora/tasks")).toBe(1);
  });

  it("화면을 떠나면 다시 읽기를 멈춘다", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const api = mockApi({ [LIST]: list([task(2, "searching", "강남 웨딩홀 후보 찾기")]) });
    const view = await render(<AmoraTasksNotice />);
    await view.unmount();
    await advance(120_000);
    expect(api.count("GET", "/api/amora/tasks")).toBe(1);
  });

  it("다시 읽다가 서버가 잠시 답하지 못하면 보이던 것을 그대로 둔다", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    mockApi({
      [LIST]: [list([task(2, "searching", "강남 웨딩홀 후보 찾기")]), apiError(503, "AMORA_TASKS_LIST_FAILED", "맡은 일을 불러오지 못했어요.")],
    });
    const { container } = await render(<AmoraTasksNotice />);
    await advance(30_000);
    expect(rows(container).map((row) => row.title)).toEqual(["강남 웨딩홀 후보 찾기"]);
  });

  it("계정이 바뀌면 앞 사람의 맡은 일을 곧바로 지우고 새로 읽는다", async () => {
    const api = mockApi({ [LIST]: [list([task(7, "done", "앞 사람의 웨딩홀 후보")]), never] });
    const view = await render(<AmoraTasksNotice />);
    expect(view.container.textContent).toContain("앞 사람의 웨딩홀 후보");

    mocks.auth.user = { id: "user-9", email: "next@example.test" };
    mocks.auth.profile = { id: "user-9", couple_id: "couple-9" };
    await view.rerender(<AmoraTasksNotice />);
    expect(view.container.textContent).not.toContain("앞 사람의 웨딩홀 후보");
    expect(api.count("GET", "/api/amora/tasks")).toBe(2);
  });
});
