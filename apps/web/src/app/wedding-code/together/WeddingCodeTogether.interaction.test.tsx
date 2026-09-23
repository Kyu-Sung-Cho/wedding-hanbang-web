// @vitest-environment jsdom

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEDDING_CODE_V31_TASTES, type V31Draft } from "@/constants/weddingCodeV31";
import { createV31Draft, encodeV31 } from "@/lib/weddingCode/v31";
import { requestPairSession, type PairSessionResult, type PairSessionSnapshot } from "@/lib/weddingCode/pairSessionContract";
import type WeddingCodeV31Client from "../WeddingCodeV31Client";
import type WeddingCodeV31Results from "../WeddingCodeV31Results";
import WeddingCodeTogether from "./WeddingCodeTogether";

type ClientProps = Parameters<typeof WeddingCodeV31Client>[0];
type ResultsProps = Parameters<typeof WeddingCodeV31Results>[0];
const observed = vi.hoisted(() => ({ client: vi.fn<(props: ClientProps) => void>(), results: vi.fn<(props: ResultsProps) => void>(), unmount: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: observed.push }) }));
vi.mock("@/lib/weddingCode/pairSessionContract", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/weddingCode/pairSessionContract")>(),
  requestPairSession: vi.fn(),
}));
vi.mock("../WeddingCodeV31Client", () => ({ default: function Client(props: ClientProps) {
  const [answers, setAnswers] = useState(0);
  const [completed, setCompleted] = useState(false);
  useEffect(() => () => { observed.unmount(); }, []);
  observed.client(props);
  return <section aria-label="작성 중인 내 질문"><p>작성한 답 {answers}개</p><button onClick={() => setAnswers(count => count + 1)}>문항 답하기</button>
    <button onClick={() => setCompleted(true)}>내 결과 보기</button>{completed ? props.renderResultActions?.(completeDraft(2)) : null}
  </section>;
} }));
vi.mock("../WeddingCodeV31Results", () => ({ default: function Results(props: ResultsProps) {
  observed.results(props);
  return <section aria-label="확인된 두 사람 결과" data-own-answer={encodeV31(props.draft)} data-partner-answer={props.first ? encodeV31(props.first) : undefined}>{props.sharingContent}</section>;
} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOM = "11111111-1111-4111-8111-111111111111";
const OWNER = "a".repeat(64);
const OTHER = "b".repeat(64);
const INVITE = "c".repeat(64);

function completeDraft(value: 2 | 5): V31Draft {
  const draft = createV31Draft();
  draft.answers = { G1: value, G3: value, R4: value, B1: value, B3: value, D1: value, T1: value, T2: value, T3: value, F1: value, F2: value, F4: value, H1: value, H2: value, H4: value };
  for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status: "answered", values: [taste.options[0].value] };
  draft.avoidances = { status: "no_preference" }; draft.spending = { status: "no_preference" };
  return draft;
}
function deferred() {
  let resolve!: (value: PairSessionResult) => void;
  const promise = new Promise<PairSessionResult>(done => { resolve = done; });
  return { promise, resolve };
}

describe("두 사람 연결의 접근 권한과 늦게 도착한 응답", () => {
  let container: HTMLDivElement;
  let root: Root;
  let expiresAt: string;
  let own: V31Draft;
  let partner: V31Draft;

  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-23T12:00:00Z")); vi.clearAllMocks();
    vi.mocked(requestPairSession).mockReset();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    window.localStorage.clear(); window.sessionStorage.clear();
    window.history.replaceState(null, "", "/wedding-code/together");
    expiresAt = new Date(Date.now() + 86400000).toISOString();
    own = completeDraft(2); partner = completeDraft(5);
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); document.body.replaceChildren();
    window.localStorage.clear(); window.sessionStorage.clear();
    vi.restoreAllMocks(); vi.useRealTimers();
  });

  function ready(role: "owner" | "participant" = "owner"): PairSessionSnapshot {
    return { roomId: ROOM, state: "ready", role, expiresAt, ownAnswerCode: encodeV31(own), partnerAnswerCode: encodeV31(partner) };
  }
  function waiting(): PairSessionSnapshot { return { roomId: ROOM, state: "waiting", role: "invite", expiresAt }; }
  async function hash(mode: "access" | "invite", token: string) {
    await act(async () => { window.history.replaceState(null, "", `/wedding-code/together#room=${ROOM}&${mode}=${token}`); window.dispatchEvent(new Event("hashchange")); });
  }
  async function render(mode: "access" | "invite", token: string) { await hash(mode, token); await act(async () => root.render(<WeddingCodeTogether />)); }
  async function click(label: string) {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === label);
    expect(button).toBeTruthy(); await act(async () => button!.click());
  }
  async function poll() { await act(async () => { await vi.advanceTimersByTimeAsync(15_000); }); }
  function result() { return container.querySelector('[aria-label="확인된 두 사람 결과"]'); }
  function quiz() { return container.querySelector('[aria-label="작성 중인 내 질문"]'); }

  it("초대 확인 후 상대 답을 전달하지 않고 독립된 내 질문을 보여준다", async () => {
    vi.mocked(requestPairSession).mockResolvedValue({ ok: true, snapshot: waiting() });
    await render("invite", INVITE);
    expect(requestPairSession).toHaveBeenCalledExactlyOnceWith({ action: "read", roomId: ROOM, token: INVITE });
    expect(quiz()).not.toBeNull(); expect(result()).toBeNull();
    expect(observed.client).toHaveBeenCalled();
    const props = observed.client.mock.calls.at(-1)![0];
    expect(props.embedded).toBe(true);
    expect(props.partnerDraft ?? null).toBeNull();
    expect(props.bothDrafts ?? null).toBeNull();
    expect(typeof props.renderResultActions).toBe("function");
    expect(observed.results).not.toHaveBeenCalled();
    await click("문항 답하기");
    expect(requestPairSession).toHaveBeenCalledTimes(1);
    expect(quiz()?.textContent).toContain("작성한 답 1개");
  });

  it.each(["owner", "participant"] as const)("%s 접근에서는 서버가 확인한 본인·상대 답을 정확히 전달하고 읽기 전용으로 표시한다", async role => {
    vi.mocked(requestPairSession).mockResolvedValue({ ok: true, snapshot: ready(role) });
    await render("access", role === "owner" ? OWNER : OTHER);
    expect(quiz()).toBeNull(); expect(result()).not.toBeNull();
    const props = observed.results.mock.calls.at(-1)![0];
    expect(props.draft).toEqual(own); expect(props.first).toEqual(partner);
    expect(props.readOnly).toBe(true); expect(props.received).toBe(false);
    expect(props.sharingContent).toBeTruthy();
    expect(result()?.getAttribute("data-own-answer")).toBe(encodeV31(own));
    expect(result()?.getAttribute("data-partner-answer")).toBe(encodeV31(partner));
    expect(requestPairSession).toHaveBeenCalledExactlyOnceWith({ action: "read", roomId: ROOM, token: role === "owner" ? OWNER : OTHER });
    await act(async () => props.onRestart());
    expect(observed.push).toHaveBeenCalledExactlyOnceWith("/wedding-code");
    expect(requestPairSession).toHaveBeenCalledTimes(1);
  });

  it.each(["access", "invite"] as const)("%s 화면은 만료 직전까지 보이고 만료 시각에는 새 조회 없이 답과 입력을 숨긴다", async mode => {
    expiresAt = new Date(Date.now() + 1000).toISOString();
    vi.mocked(requestPairSession).mockResolvedValue({ ok: true, snapshot: mode === "access" ? ready() : waiting() });
    await render(mode, mode === "access" ? OWNER : INVITE);
    const content = mode === "access" ? result() : quiz();
    expect(content).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(mode === "access" ? result() : quiz()).toBe(content);
    expect(container.textContent).not.toContain("이 비교는 끝났어요");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result()).toBeNull(); expect(quiz()).toBeNull();
    expect(container.textContent).toContain("이 비교는 끝났어요");
    expect(container.querySelector('[aria-label="두 사람 연결 관리"]')).toBeNull();
    expect(requestPairSession).toHaveBeenCalledTimes(1);
  });

  it("같은 방의 다른 접근 주소로 바뀌면 이전 결과를 즉시 숨기고 이전 조회 응답도 버린다", async () => {
    const oldRead = deferred(); const newRead = deferred();
    vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: ready() }).mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    await render("access", OWNER); expect(result()).not.toBeNull();
    await poll();
    await hash("access", OTHER);
    expect(result()).toBeNull(); expect(quiz()).toBeNull();
    expect(container.textContent).toContain("두 사람 연결을 확인하고 있어요");
    expect(requestPairSession).toHaveBeenLastCalledWith({ action: "read", roomId: ROOM, token: OTHER });
    await act(async () => oldRead.resolve({ ok: true, snapshot: ready() }));
    expect(result()).toBeNull();
    await act(async () => newRead.resolve({ ok: false, code: "NOT_FOUND", error: "접근 권한이 없는 주소예요." }));
    expect(result()).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("접근 권한이 없는 주소예요.");
  });

  it("연결 종료 뒤 도착한 과거 조회가 답을 다시 표시하거나 종료를 되돌리지 않는다", async () => {
    const oldRead = deferred();
    vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: ready() }).mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce({ ok: true, snapshot: { roomId: ROOM, state: "closed", role: "owner", expiresAt } });
    await render("access", OWNER); await poll();
    await click("연결 끝내기"); await click("공유 답 지우고 연결 끝내기");
    expect(requestPairSession).toHaveBeenLastCalledWith({ action: "revoke", roomId: ROOM, token: OWNER });
    expect(container.textContent).toContain("이 비교는 끝났어요"); expect(result()).toBeNull();
    await act(async () => oldRead.resolve({ ok: true, snapshot: ready() }));
    expect(container.textContent).toContain("이 비교는 끝났어요"); expect(result()).toBeNull();
    await poll();
    expect(requestPairSession).toHaveBeenCalledTimes(3);
  });

  it("초대 질문을 작성하는 중 일시적 조회 실패가 발생해도 작성 화면과 답을 보존하고 다음 조회에서 회복한다", async () => {
    vi.mocked(requestPairSession).mockResolvedValue({ ok: true, snapshot: waiting() })
      .mockResolvedValueOnce({ ok: true, snapshot: waiting() })
      .mockResolvedValueOnce({ ok: false, code: "NETWORK_ERROR", error: "연결이 끊겼어요." });
    await render("invite", INVITE); await click("문항 답하기");
    const originalQuiz = quiz();
    await poll();
    expect(quiz()).toBe(originalQuiz); expect(quiz()?.textContent).toContain("작성한 답 1개");
    expect(observed.unmount).not.toHaveBeenCalled();
    expect(container.textContent).toContain("작성한 답은 이 화면에 그대로 있고");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await poll();
    expect(quiz()).toBe(originalQuiz); expect(quiz()?.textContent).toContain("작성한 답 1개");
    expect(observed.unmount).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("작성한 답은 이 화면에 그대로 있고");
    expect(vi.mocked(requestPairSession).mock.calls.map(([input]) => input.action)).toEqual(["read", "read", "read"]);
  });

  it("내 결과에서 동의 두 항목을 확인해야 참여 요청을 보내고, 실패 재시도는 같은 접근 키를 사용한다", async () => {
    const pendingJoin = deferred();
    vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: waiting() }).mockReturnValueOnce(pendingJoin.promise)
      .mockResolvedValueOnce({ ok: false, code: "NETWORK_ERROR", error: "아직 응답을 확인하지 못했어요." });
    await render("invite", INVITE); await click("내 결과 보기");
    const originalHash = window.location.hash;
    expect(container.querySelector('[aria-label="내 답 공유하고 함께 보기"]')).not.toBeNull();
    await click("동의하고 두 사람 결과 보기");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("공유할 내용과 나이 확인 항목을 먼저 확인해 주세요.");
    expect(requestPairSession).toHaveBeenCalledTimes(1);
    const age = [...container.querySelectorAll("label")].find(label => label.textContent?.includes("만 14세 이상이에요."))!.querySelector<HTMLInputElement>("input")!;
    const consent = [...container.querySelectorAll("label")].find(label => label.textContent?.includes("초대로 연결된 상대에게 보여주는 데 동의해요."))!.querySelector<HTMLInputElement>("input")!;
    await act(async () => age.click()); await click("동의하고 두 사람 결과 보기");
    expect(requestPairSession).toHaveBeenCalledTimes(1);
    await act(async () => consent.click()); await click("동의하고 두 사람 결과 보기");
    const pendingButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "함께 볼 결과를 연결하고 있어요…")!;
    expect(pendingButton.disabled).toBe(true);
    expect(age.disabled).toBe(true); expect(consent.disabled).toBe(true);
    await act(async () => pendingButton.click());
    expect(requestPairSession).toHaveBeenCalledTimes(2);
    const firstJoin = vi.mocked(requestPairSession).mock.calls[1][0];
    expect(firstJoin).toMatchObject({ action: "join", roomId: ROOM, inviteToken: INVITE, answerCode: encodeV31(completeDraft(2)), consent: true, ageConfirmed: true });
    expect(firstJoin.action).toBe("join");
    if (firstJoin.action !== "join") throw new Error("참여 요청이 필요해요.");
    expect(firstJoin.participantToken).not.toBe(INVITE);
    await act(async () => pendingJoin.resolve({ ok: false, code: "NETWORK_ERROR", error: "연결이 끊겼어요." }));
    expect(window.location.hash).toBe(originalHash);
    const recovery = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(link => link.textContent === "이미 처리됐는지 내 결과 확인하기")!;
    expect(new URLSearchParams(new URL(recovery.href).hash.slice(1)).get("access")).toBe(firstJoin.participantToken);
    await click("동의하고 두 사람 결과 보기");
    expect(requestPairSession).toHaveBeenCalledTimes(3);
    expect(vi.mocked(requestPairSession).mock.calls[2][0]).toEqual(firstJoin);
    expect(window.location.hash).toBe(originalHash);
    expect(observed.unmount).not.toHaveBeenCalled();
  });
});
