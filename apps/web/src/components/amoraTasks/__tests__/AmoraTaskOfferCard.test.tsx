import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AMORA_TASK_COPY } from "@hanbang/shared/amora-tasks";

import ActionCard from "@/components/app/chat/ActionCard";
import {
  apiError,
  buttonNamed,
  cleanup,
  click,
  flush,
  json,
  linkTo,
  mockApi,
  render,
  text,
} from "@/components/invitation/live/__tests__/liveTestKit";
import type { ToolExecutionResult } from "@/types/database.types";

import AmoraTaskOfferCard from "../AmoraTaskOfferCard";

/**
 * 대화의 시작 카드 "이 일을 맡을게요". 맡은 일은 사람이 맡기기를 눌러야 시작하고, 서버가 받아들였을 때만 맡았다고
 * 말한다. 처음 그릴 때 지금 상태를 한 번 읽어 이미 맡긴 카드나 닫힌 카드에 단추를 되살리지 않는다.
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

const TASK = "b0000000-0000-4000-8000-000000000001";
const TASK_PATH = `/api/amora/tasks/${TASK}`;
const DETAIL = `GET ${TASK_PATH}`;
const START = `POST ${TASK_PATH}`;
const PROGRESS = `/wedding/amora-tasks/${TASK}`;

function offerResult(overrides: Partial<ToolExecutionResult> = {}): ToolExecutionResult {
  return {
    toolName: "offer_amora_task",
    toolInput: { kind: "hall_candidates", region: "강남" },
    toolOutput: {
      offer_kind: "amora_task_offer_v1",
      task_id: TASK,
      kind: "hall_candidates",
      title: "강남 웨딩홀 후보 찾기",
      plan: ["조건에 맞는 웨딩홀을 찾아요", "같은 기준으로 표를 만들어요"],
      status: "offered",
      offer_expires_at: "2026-11-21T01:00:00.000Z",
      started: false,
    },
    success: true,
    displayMessage: "카드를 만들었어요. 사람이 카드를 눌러야 시작해요.",
    ...overrides,
  };
}

function detail(status: string) {
  return json({
    enabled: true,
    available: true,
    task: {
      id: TASK,
      kind: "hall_candidates",
      title: "강남 웨딩홀 후보 찾기",
      status,
      reviewReason: status === "needs_review" ? "daily_search_limit" : null,
      createdAt: "2026-11-20T01:00:00.000Z",
      startedAt: status === "offered" ? null : "2026-11-20T01:01:00.000Z",
      finishedAt: null,
      updatedAt: "2026-11-20T01:01:00.000Z",
      offerExpiresAt: "2026-11-21T01:00:00.000Z",
      steps: [],
      result: null,
    },
  });
}

function hasStartButton(container: ParentNode): boolean {
  return Array.from(container.querySelectorAll("button")).some((button) => text(button) === AMORA_TASK_COPY.offerStart);
}

const GATE_SENTENCE = "결혼 준비와 관련된 일만 맡을 수 있어요. 결혼 준비 이야기라면 언제든 불러 주세요.";
// 보이지 않거나 줄·글 방향을 바꾸는 문자. 소스에 그대로 적지 않고 번호로 만든다.
const NEWLINE = String.fromCodePoint(0x0a); // Cc
const NUL = String.fromCodePoint(0x00); // Cc
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b); // Cf
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e); // Cf
const LINE_SEPARATOR = String.fromCodePoint(0x2028); // Zl
const PARAGRAPH_SEPARATOR = String.fromCodePoint(0x2029); // Zp

/**
 * 맡기기를 눌렀더니 문지기가 막았다(409 `gate_blocked`). `reply` 가 undefined 면 본문에 그 칸을 두지 않는다.
 * 맡지 않았고 단추가 없는 것까지 보고, 카드에 남은 한 줄의 글을 다듬지 않은 채 돌려준다.
 */
async function lineAfterGateBlocked(reply: unknown): Promise<string | null> {
  const body = reply === undefined ? { ok: false, code: "gate_blocked" } : { ok: false, code: "gate_blocked", reply };
  const api = mockApi({ [DETAIL]: detail("offered"), [START]: json(body, 409) });
  const { container } = await render(<AmoraTaskOfferCard result={offerResult()} />);
  await click(buttonNamed(container, AMORA_TASK_COPY.offerStart));
  expect(api.count("POST", TASK_PATH)).toBe(1);
  expect(container.querySelector("[data-amora-task-offer]")?.getAttribute("data-amora-task-offer")).toBe("unavailable");
  expect(container.textContent).not.toContain(AMORA_TASK_COPY.offerStarted);
  expect(hasStartButton(container)).toBe(false);
  const lines = container.querySelectorAll('[role="status"]');
  expect(lines).toHaveLength(1);
  return lines[0].textContent;
}

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe("대화의 시작 카드(offer_amora_task)", () => {
  it("맡기기를 누르면 서버가 받아들인 뒤에만 맡았다고 말하고 진행 보기를 둔다", async () => {
    let resolveStart!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveStart = resolve;
    });
    const api = mockApi({ [DETAIL]: detail("offered"), [START]: () => pending });
    const { container } = await render(<AmoraTaskOfferCard result={offerResult()} />);

    expect(container.querySelector("h3")?.textContent).toBe(AMORA_TASK_COPY.offerTitle);
    expect(container.textContent).toContain("강남 웨딩홀 후보 찾기");
    expect(Array.from(container.querySelectorAll("li")).map((item) => item.textContent)).toEqual([
      "조건에 맞는 웨딩홀을 찾아요",
      "같은 기준으로 표를 만들어요",
    ]);
    expect(container.textContent).toContain(AMORA_TASK_COPY.offerBody);

    await click(buttonNamed(container, AMORA_TASK_COPY.offerStart));
    const busy = buttonNamed(container, AMORA_TASK_COPY.offerStarting);
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).not.toContain(AMORA_TASK_COPY.offerStarted);

    resolveStart(json({ ok: true, code: "started", status: "queued" }));
    await flush();
    expect(container.textContent).toContain(AMORA_TASK_COPY.offerStarted);
    expect(linkTo(container, PROGRESS)?.textContent).toBe(AMORA_TASK_COPY.offerOpen);
    expect(hasStartButton(container)).toBe(false);
    expect(api.count("POST", TASK_PATH)).toBe(1);
    expect(api.last("POST", TASK_PATH)?.body).toEqual({ action: "start" });
    expect(api.count("GET", TASK_PATH)).toBe(1);
  });

  it("오늘 맡길 수 있는 일을 다 맡겼으면 그렇다고 말하고 단추를 거둔다", async () => {
    mockApi({ [DETAIL]: detail("offered"), [START]: json({ ok: false, code: "daily_task_limit", status: null }, 429) });
    const { container } = await render(<AmoraTaskOfferCard result={offerResult()} />);
    await click(buttonNamed(container, AMORA_TASK_COPY.offerStart));
    expect(container.textContent).toContain(AMORA_TASK_COPY.dailyTaskLimit);
    expect(container.textContent).not.toContain(AMORA_TASK_COPY.offerStarted);
    expect(hasStartButton(container)).toBe(false);
  });

  it.each([
    ["offer_expired", "expired"],
    ["offer_closed", "cancelled"],
  ])("누른 카드가 이미 닫혔으면(%s) 닫혔다고 말한다", async (code, status) => {
    mockApi({ [DETAIL]: detail("offered"), [START]: json({ ok: false, code, status }, 409) });
    const { container } = await render(<AmoraTaskOfferCard result={offerResult()} />);
    await click(buttonNamed(container, AMORA_TASK_COPY.offerStart));
    expect(container.textContent).toContain(AMORA_TASK_COPY.offerExpired);
    expect(hasStartButton(container)).toBe(false);
  });

  it.each(["expired", "cancelled"])("처음 읽은 상태가 %s 이면 단추 없이 닫혔다고 말한다", async (status) => {
    const api = mockApi({ [DETAIL]: detail(status) });
    const { container } = await render(<AmoraTaskOfferCard result={offerResult()} />);
    expect(container.textContent).toContain(AMORA_TASK_COPY.offerExpired);
    expect(hasStartButton(container)).toBe(false);
    expect(api.count("POST", TASK_PATH)).toBe(0);
  });

  it.each(["queued", "searching", "organizing", "needs_review", "done"])(
    "이미 맡긴 일(%s)이면 처음 읽을 때 단추 없이 진행 보기를 둔다",
    async (status) => {
      const api = mockApi({ [DETAIL]: detail(status) });
      const { container } = await render(<AmoraTaskOfferCard result={offerResult()} />);
      expect(container.textContent).toContain(AMORA_TASK_COPY.offerStarted);
      expect(linkTo(container, PROGRESS)).not.toBeNull();
      expect(hasStartButton(container)).toBe(false);
      expect(api.count("GET", TASK_PATH)).toBe(1);
      expect(api.count("POST", TASK_PATH)).toBe(0);
    },
  );

  // 문지기 담당 규칙: verdict 가 allow 가 아니면 맡은 일을 만들지 않고 reply 를 그대로 보인다.
  it.each([
    ["문지기가 쓴 문장", GATE_SENTENCE],
    ["앞뒤에 빈칸이 있는 문장(다듬지 않는다)", `  ${GATE_SENTENCE}  `],
    ["딱 300자인 문장", "가".repeat(300)],
  ])("문지기가 막으면 그 문장을 고치지 않고 그대로 보인다: %s", async (_name, reply) => {
    expect(await lineAfterGateBlocked(reply)).toBe(reply);
  });

  it.each([
    ["null", null],
    ["칸이 없음", undefined],
    ["빈 문장", ""],
    ["빈칸뿐", "   "],
    ["숫자", 42],
    ["객체", { text: GATE_SENTENCE }],
  ])("문지기가 막았는데 쓸 문장이 없으면(%s) 맡을 수 없다는 계약 문장으로 말한다", async (_name, reply) => {
    expect(await lineAfterGateBlocked(reply)).toBe(AMORA_TASK_COPY.offerUnavailable);
  });

  it.each([
    ["300자를 넘는 문장", "가".repeat(301)],
    ["줄바꿈이 든 문장(제어 문자)", `${GATE_SENTENCE}${NEWLINE}${GATE_SENTENCE}`],
    ["널 문자가 든 문장(제어 문자)", `${GATE_SENTENCE}${NUL}`],
    ["폭 없는 공백이 든 문장(서식 문자)", `결혼${ZERO_WIDTH_SPACE}준비 밖의 일이에요.`],
    ["글 방향을 뒤집는 문장(서식 문자)", `${RIGHT_TO_LEFT_OVERRIDE}${GATE_SENTENCE}`],
    ["줄 구분 문자가 든 문장", `${GATE_SENTENCE}${LINE_SEPARATOR}`],
    ["문단 구분 문자가 든 문장", `${GATE_SENTENCE}${PARAGRAPH_SEPARATOR}`],
  ])("문지기 문장이 %s 이면 쓰지 않고 계약 문장으로 말한다", async (_name, reply) => {
    expect(await lineAfterGateBlocked(reply)).toBe(AMORA_TASK_COPY.offerUnavailable);
  });

  it("서버가 답하지 못하면 실패라고 말하고 다시 누를 단추를 남긴다", async () => {
    const api = mockApi({
      [DETAIL]: detail("offered"),
      [START]: [
        apiError(503, "AMORA_TASK_ACTION_FAILED", "지금은 처리하지 못했어요. 잠시 뒤에 다시 눌러 주세요."),
        json({ ok: true, code: "started", status: "queued" }),
      ],
    });
    const { container } = await render(<AmoraTaskOfferCard result={offerResult()} />);
    await click(buttonNamed(container, AMORA_TASK_COPY.offerStart));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(AMORA_TASK_COPY.startFailed);
    expect(container.textContent).not.toContain(AMORA_TASK_COPY.offerStarted);

    await click(buttonNamed(container, AMORA_TASK_COPY.offerStart));
    expect(container.textContent).toContain(AMORA_TASK_COPY.offerStarted);
    expect(api.count("POST", TASK_PATH)).toBe(2);
  });

  it("처음 읽기가 실패해도 단추를 두고, 눌렀을 때 서버가 판단한다", async () => {
    mockApi({ [DETAIL]: () => Promise.reject(new TypeError("Failed to fetch")), [START]: json({ ok: true, code: "already_started", status: "searching" }) });
    const { container } = await render(<AmoraTaskOfferCard result={offerResult()} />);
    await click(buttonNamed(container, AMORA_TASK_COPY.offerStart));
    expect(container.textContent).toContain(AMORA_TASK_COPY.offerStarted);
  });

  it.each([
    ["스위치가 꺼졌으면", json({ enabled: false, available: false, tasks: [] })],
    ["표가 아직 없으면", json({ enabled: true, available: false, tasks: [] })],
  ])("%s 카드를 그리지 않는다", async (_name, reply) => {
    mockApi({ [DETAIL]: reply });
    const { container } = await render(<AmoraTaskOfferCard result={offerResult()} />);
    expect(container.innerHTML).toBe("");
  });

  it("읽을 수 없는 도구 결과(실패한 결과 포함)는 아무것도 그리지 않고 서버를 부르지 않는다", async () => {
    const api = mockApi({});
    const failed = await render(
      <AmoraTaskOfferCard
        result={offerResult({ success: false, toolOutput: { error_code: "task_offer_too_many_offers" }, displayMessage: "열려 있는 카드가 많아요." })}
      />,
    );
    expect(failed.container.innerHTML).toBe("");
    const malformed = await render(<AmoraTaskOfferCard result={offerResult({ toolOutput: { offer_kind: "amora_task_offer_v1", task_id: "not-a-task" } })} />);
    expect(malformed.container.innerHTML).toBe("");
    expect(api.calls).toHaveLength(0);
  });

  it("ActionCard 는 offer_amora_task 결과를 이 카드로 그린다(일반 작업 카드가 아니다)", async () => {
    mockApi({ [DETAIL]: detail("offered") });
    const { container } = await render(<ActionCard result={offerResult()} />);
    expect(container.querySelector("[data-amora-task-offer]")).not.toBeNull();
    expect(container.textContent).not.toContain("작업 완료");
    expect(container.textContent).not.toContain("카드를 만들었어요");
    expect(hasStartButton(container)).toBe(true);
  });
});
