import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AMORA_TASK_COPY, AMORA_TASK_STAGE_LABELS } from "@hanbang/shared/amora-tasks";

import { AmoraDockContext, type AmoraDockApi } from "@/components/app/amora/amoraDock";
import {
  apiError,
  buttonNamed,
  cleanup,
  click,
  flush,
  json,
  mockApi,
  render,
  text,
} from "@/components/invitation/live/__tests__/liveTestKit";

import AmoraTaskDetailView from "../AmoraTaskDetailView";

/**
 * 맡은 일의 결과 화면. 표의 값은 서버가 준 글 그대로이고, https 출처만 링크이며, 다음에 할 일은 대화 입력칸에
 * 글을 채울 뿐 보내지 않는다. 그만하기·이어서 하기는 할 수 있을 때만 보이고 누르면 서버의 지금 상태로 다시 그린다.
 */

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
  useAuthStore: (selector?: (state: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: "user-1" } };
    return selector ? selector(state) : state;
  },
}));

const TASK = "c0000000-0000-4000-8000-000000000001";
const TASK_PATH = `/api/amora/tasks/${TASK}`;
const DETAIL = `GET ${TASK_PATH}`;
const WRITE = `POST ${TASK_PATH}`;
const PROMPT = "가온 웨딩홀에 12월 상담 가능한 시간을 묻는 문의 편지 초안을 써 줘";

const RESULT = {
  summary: "조건에 맞는 웨딩홀 두 곳을 같은 기준으로 모았어요.",
  columns: ["웨딩홀", "식대", "확인한 곳"],
  rows: [
    { cells: ["가온 웨딩홀", "1인 65,000원", "gaon.example"], sourceIds: ["s1"] },
    { cells: ["라온 홀", "업체 확인 필요", "raon.example"], sourceIds: ["s1", "s2"] },
  ],
  sources: [
    { id: "s1", title: "가온 웨딩홀 안내", url: "https://gaon.example/hall", checkedOn: "2026-11-18" },
    { id: "s2", title: "라온 홀 소개", url: "http://raon.example/intro", checkedOn: "2026-11-19" },
  ],
  nextActions: [{ label: "가온 웨딩홀에 상담 시간 묻기", prompt: PROMPT }],
};

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK,
    kind: "hall_candidates",
    title: "강남 웨딩홀 후보 찾기",
    status: "done",
    reviewReason: null,
    createdAt: "2026-11-20T01:00:00.000Z",
    startedAt: "2026-11-20T01:01:00.000Z",
    finishedAt: "2026-11-20T01:30:00.000Z",
    updatedAt: "2026-11-20T01:30:00.000Z",
    offerExpiresAt: "2026-11-21T01:00:00.000Z",
    steps: [
      { label: "맡았어요", at: "2026-11-20T01:01:00.000Z" },
      { label: "웨딩홀 여섯 곳을 찾았어요", at: "2026-11-20T01:10:00.000Z" },
    ],
    result: RESULT,
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return json({ enabled: true, available: true, task: task(overrides) });
}

function buttonTexts(container: ParentNode): string[] {
  return Array.from(container.querySelectorAll("button")).map((button) => text(button));
}

function stage(container: ParentNode): string | null {
  return container.querySelector("[data-amora-task-stage]")?.textContent ?? null;
}

afterEach(async () => {
  await cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("맡은 일 결과 화면", () => {
  it("같은 기준으로 모은 표와 출처, 지금까지 한 일을 서버가 준 글 그대로 그린다", async () => {
    mockApi({ [DETAIL]: detail() });
    const { container } = await render(<AmoraTaskDetailView taskId={TASK} />);

    expect(container.querySelector("h1")?.textContent).toBe("강남 웨딩홀 후보 찾기");
    expect(stage(container)).toBe(AMORA_TASK_STAGE_LABELS.done);
    expect(container.querySelector('a[href="/wedding/lounge"]')?.textContent).toBe(AMORA_TASK_COPY.back);
    const headings = Array.from(container.querySelectorAll("h2")).map((heading) => heading.textContent);
    expect(headings).toEqual([
      AMORA_TASK_COPY.stepsTitle,
      AMORA_TASK_COPY.resultTableTitle,
      AMORA_TASK_COPY.resultSourcesTitle,
      AMORA_TASK_COPY.resultNextTitle,
    ]);
    expect(container.textContent).toContain("웨딩홀 여섯 곳을 찾았어요");
    expect(container.textContent).toContain(RESULT.summary);

    const table = container.querySelector("[data-amora-task-table] table");
    expect(Array.from(table?.querySelectorAll("thead th") ?? []).map((cell) => cell.textContent)).toEqual([
      "웨딩홀",
      "식대",
      "확인한 곳",
      AMORA_TASK_COPY.resultSourcesTitle,
    ]);
    const bodyRows = Array.from(table?.querySelectorAll("tbody tr") ?? []);
    expect(bodyRows.map((row) => Array.from(row.querySelectorAll("th, td")).slice(0, 3).map((cell) => cell.textContent))).toEqual([
      ["가온 웨딩홀", "1인 65,000원", "gaon.example"],
      ["라온 홀", "업체 확인 필요", "raon.example"],
    ]);
    const markers = bodyRows.map((row) =>
      Array.from(row.querySelectorAll("a[data-amora-task-marker]")).map((marker) => ({
        text: marker.textContent,
        href: marker.getAttribute("href"),
        label: marker.getAttribute("aria-label"),
      })),
    );
    expect(markers).toEqual([
      [{ text: "1", href: "#amora-task-source-s1", label: "가온 웨딩홀 안내" }],
      [
        { text: "1", href: "#amora-task-source-s1", label: "가온 웨딩홀 안내" },
        { text: "2", href: "#amora-task-source-s2", label: "라온 홀 소개" },
      ],
    ]);
    expect(container.textContent).toContain(AMORA_TASK_COPY.resultTableNote);

    const first = container.querySelector("#amora-task-source-s1");
    const link = first?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://gaon.example/hall");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")?.split(" ").sort()).toEqual(["noopener", "noreferrer"]);
    expect(first?.textContent).toContain(AMORA_TASK_COPY.resultCheckedOn("2026-11-18"));
  });

  it("https 가 아닌 출처는 링크가 아니라 글자로 둔다", async () => {
    mockApi({ [DETAIL]: detail() });
    const { container } = await render(<AmoraTaskDetailView taskId={TASK} />);
    const second = container.querySelector("#amora-task-source-s2");
    expect(second?.textContent).toContain("라온 홀 소개");
    expect(second?.textContent).toContain(AMORA_TASK_COPY.resultCheckedOn("2026-11-19"));
    expect(second?.querySelector("a")).toBeNull();
    expect(container.querySelector('a[href^="http:"]')).toBeNull();
  });

  it("다음에 할 일은 대화 입력칸에 글을 채우는 주소를 열 뿐 보내지 않는다", async () => {
    const api = mockApi({ [DETAIL]: detail() });
    const { container } = await render(<AmoraTaskDetailView taskId={TASK} />);
    expect(container.textContent).toContain(AMORA_TASK_COPY.resultNextNote);
    const next = container.querySelector("[data-amora-task-next] a");
    expect(text(next)).toBe(AMORA_TASK_COPY.resultNextButton);
    const url = new URL(next?.getAttribute("href") ?? "", "https://hanbang.ai");
    expect(url.pathname).toBe("/wedding/chat");
    expect(url.searchParams.get("prefill")).toBe(PROMPT);
    const describedBy = next?.getAttribute("aria-describedby") ?? "";
    expect(container.querySelector(`[id="${describedBy}"]`)?.textContent).toBe("가온 웨딩홀에 상담 시간 묻기");
    expect(api.calls.every((call) => call.method === "GET" && call.url === TASK_PATH)).toBe(true);
  });

  it("옆자리 아모라가 있으면 이동하지 않고 그 자리를 글을 채운 채로 연다(보내는 요청은 없다)", async () => {
    const dock: AmoraDockApi = { isOpen: false, docked: true, open: vi.fn(), close: vi.fn(), toggle: vi.fn() };
    const api = mockApi({ [DETAIL]: detail() });
    const { container } = await render(
      <AmoraDockContext.Provider value={dock}>
        <AmoraTaskDetailView taskId={TASK} />
      </AmoraDockContext.Provider>,
    );
    const next = container.querySelector("[data-amora-task-next] a");
    // React 는 뿌리에서 클릭을 받으므로 그 뒤(document)에서 이동이 막혔는지 본다.
    let prevented = false;
    const observe = (event: Event) => {
      prevented = event.defaultPrevented;
    };
    document.addEventListener("click", observe);
    await click(next);
    document.removeEventListener("click", observe);
    expect(dock.open).toHaveBeenCalledWith({ prefill: PROMPT });
    expect(prevented).toBe(true);
    expect(api.calls.some((call) => call.url.startsWith("/api/chat"))).toBe(false);
    expect(api.count("POST", TASK_PATH)).toBe(0);
  });

  it.each([
    ["searching", null, [AMORA_TASK_COPY.cancel]],
    ["organizing", null, [AMORA_TASK_COPY.cancel]],
    ["needs_review", "daily_search_limit", [AMORA_TASK_COPY.resume, AMORA_TASK_COPY.cancel]],
    ["needs_review", "gate_blocked", [AMORA_TASK_COPY.cancel]],
    ["done", null, []],
    ["cancelled", null, []],
    ["expired", null, []],
  ])("%s(%s)일 때 보이는 단추: %j", async (status, reviewReason, expected) => {
    mockApi({ [DETAIL]: detail({ status, reviewReason, result: null }) });
    const { container } = await render(<AmoraTaskDetailView taskId={TASK} />);
    expect(buttonTexts(container)).toEqual(expected);
  });

  it("멈춘 일은 멈춘 까닭을, 그만둔 일과 닫힌 일은 그렇다고 말한다", async () => {
    mockApi({
      [DETAIL]: [
        detail({ status: "needs_review", reviewReason: "source_unavailable", result: null }),
        detail({ status: "cancelled", result: null }),
        detail({ status: "expired", result: null, steps: [] }),
      ],
    });
    const review = await render(<AmoraTaskDetailView taskId={TASK} />);
    expect(stage(review.container)).toBe(AMORA_TASK_STAGE_LABELS.needs_review);
    expect(review.container.textContent).toContain(AMORA_TASK_COPY.reviewReasons.source_unavailable);
    await cleanup();

    const cancelled = await render(<AmoraTaskDetailView taskId={TASK} />);
    expect(stage(cancelled.container)).toBeNull();
    expect(cancelled.container.textContent).toContain(AMORA_TASK_COPY.cancelled);
    await cleanup();

    const expired = await render(<AmoraTaskDetailView taskId={TASK} />);
    expect(expired.container.textContent).toContain(AMORA_TASK_COPY.offerExpired);
  });

  it("그만하기를 누르면 서버에 보내고 다시 읽어 그만두었다고 말한다", async () => {
    const api = mockApi({
      [DETAIL]: [detail({ status: "searching", result: null }), detail({ status: "cancelled", result: null })],
      [WRITE]: json({ ok: true, code: "cancelled", status: "cancelled" }),
    });
    const { container } = await render(<AmoraTaskDetailView taskId={TASK} />);
    await click(buttonNamed(container, AMORA_TASK_COPY.cancel));
    expect(api.last("POST", TASK_PATH)?.body).toEqual({ action: "cancel" });
    expect(api.count("GET", TASK_PATH)).toBe(2);
    expect(container.textContent).toContain(AMORA_TASK_COPY.cancelled);
    expect(buttonTexts(container)).toEqual([]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("이어서 하기를 누르면 서버에 보내고 다시 읽어 찾는 중으로 돌아간다", async () => {
    const api = mockApi({
      [DETAIL]: [
        detail({ status: "needs_review", reviewReason: "daily_step_limit", result: null }),
        detail({ status: "queued", result: null }),
      ],
      [WRITE]: json({ ok: true, code: "resumed", status: "queued" }),
    });
    const { container } = await render(<AmoraTaskDetailView taskId={TASK} />);
    await click(buttonNamed(container, AMORA_TASK_COPY.resume));
    expect(api.last("POST", TASK_PATH)?.body).toEqual({ action: "resume" });
    expect(stage(container)).toBe(AMORA_TASK_STAGE_LABELS.searching);
    expect(buttonTexts(container)).toEqual([AMORA_TASK_COPY.cancel]);
  });

  it("쓰기가 실패하면 다시 읽은 상태 위에 실패를 알린다", async () => {
    mockApi({
      [DETAIL]: detail({ status: "searching", result: null }),
      [WRITE]: apiError(503, "AMORA_TASK_ACTION_FAILED", "지금은 처리하지 못했어요. 잠시 뒤에 다시 눌러 주세요."),
    });
    const { container } = await render(<AmoraTaskDetailView taskId={TASK} />);
    await click(buttonNamed(container, AMORA_TASK_COPY.cancel));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(buttonTexts(container)).toEqual([AMORA_TASK_COPY.cancel]);
  });

  it("그사이 상태가 바뀌어 이어서 할 수 없으면 실패라고 하지 않고 바뀐 상태를 보인다", async () => {
    mockApi({
      [DETAIL]: [
        detail({ status: "needs_review", reviewReason: "failed", result: null }),
        detail({ status: "searching", result: null }),
      ],
      [WRITE]: json({ ok: false, code: "not_resumable", status: "searching" }, 409),
    });
    const { container } = await render(<AmoraTaskDetailView taskId={TASK} />);
    await click(buttonNamed(container, AMORA_TASK_COPY.resume));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(stage(container)).toBe(AMORA_TASK_STAGE_LABELS.searching);
  });

  it.each([
    ["스위치가 꺼졌으면", json({ enabled: false, available: false, tasks: [] })],
    ["표가 아직 없으면", json({ enabled: true, available: false, tasks: [] })],
  ])("%s 아무것도 그리지 않는다", async (_name, reply) => {
    mockApi({ [DETAIL]: reply });
    const { container } = await render(<AmoraTaskDetailView taskId={TASK} />);
    expect(container.innerHTML).toBe("");
  });

  it("읽지 못하면 못 불러왔다고 말하고, 다시 불러오기로 다시 읽는다", async () => {
    const api = mockApi({
      [DETAIL]: [apiError(503, "AMORA_TASK_READ_FAILED", "맡은 일을 불러오지 못했어요."), detail()],
    });
    const { container } = await render(<AmoraTaskDetailView taskId={TASK} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(AMORA_TASK_COPY.loadFailed);
    expect(container.querySelector("h1")).toBeNull();
    await click(buttonNamed(container, AMORA_TASK_COPY.retry));
    expect(api.count("GET", TASK_PATH)).toBe(2);
    expect(container.querySelector("h1")?.textContent).toBe("강남 웨딩홀 후보 찾기");
  });

  it("찾는 중이면 15초마다 다시 읽고, 끝나면 멈춘다", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const api = mockApi({ [DETAIL]: [detail({ status: "searching", result: null }), detail()] });
    const { container } = await render(<AmoraTaskDetailView taskId={TASK} />);
    expect(stage(container)).toBe(AMORA_TASK_STAGE_LABELS.searching);

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(api.count("GET", TASK_PATH)).toBe(2);
    expect(stage(container)).toBe(AMORA_TASK_STAGE_LABELS.done);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();
    expect(api.count("GET", TASK_PATH)).toBe(2);
  });
});
