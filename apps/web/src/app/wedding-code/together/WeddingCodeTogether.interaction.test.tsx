// @vitest-environment jsdom

import { act, useEffect, useState, type MouseEventHandler, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEDDING_CODE_V31_TASTES, type V31Draft } from "@/constants/weddingCodeV31";
import { createV31Draft, encodeV31 } from "@/lib/weddingCode/v31";
import { requestPairSession, type PairSessionResult, type PairSessionSnapshot } from "@/lib/weddingCode/pairSessionContract";
import { LATE_RELOAD_HINT_TEXT, LATE_RELOAD_LINK_TEXT, NO_SCRIPT_HINT_TEXT } from "@/lib/browserStorageFallback";
import { PAIR_SESSION_LOCAL_KEY, parsePairSessionHash, readPairSessionRecovery, readSavedPairSession } from "@/lib/weddingCode/pairSessionClient";
import { writeV31LocalProgress } from "@/lib/weddingCode/v31LocalProgress";
import type WeddingCodeV31Client from "../WeddingCodeV31Client";
import type WeddingCodeV31Results from "../WeddingCodeV31Results";
import { PairSessionLink as PairSessionAnchor } from "../WeddingCodeV31Connection";
import WeddingCodeTogether from "./WeddingCodeTogether";

type ClientProps = Parameters<typeof WeddingCodeV31Client>[0];
type ResultsProps = Parameters<typeof WeddingCodeV31Results>[0];
const observed = vi.hoisted(() => ({ client: vi.fn<(props: ClientProps) => void>(), results: vi.fn<(props: ResultsProps) => void>(), unmount: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: observed.push }) }));
// 실제 Next 의 Link 는 같은 경로에서 # 뒤만 바뀌는 이동을 history.pushState 로만 처리해서 hashchange·popstate 를 내지 않는다. 그 동작을 그대로 흉내 낸다
// (클릭 핸들러가 기본 동작을 막지 않았을 때만 가로챈다). jsdom 의 기본 링크 이동은 # 이동에 hashchange 를 내서 이 결함을 가려 버린다.
vi.mock("next/link", () => ({ default: function Link({ href, onClick, className, children }: { href: string; onClick?: MouseEventHandler<HTMLAnchorElement>; className?: string; children?: ReactNode }) {
  return <a href={href} className={className} onClick={event => { onClick?.(event); if (event.defaultPrevented) return; event.preventDefault(); window.history.pushState(null, "", href); }}>{children}</a>;
} }));
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
    <button onClick={() => setCompleted(true)}>내 결과 보기</button>{completed ? props.renderResultActions?.(completeDraft(answers > 0 ? 5 : 2)) : null}
    {completed ? <button onClick={() => setCompleted(false)}>내 답 수정하기</button> : null}
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
    vi.restoreAllMocks();
    window.localStorage.clear(); window.sessionStorage.clear();
    vi.useRealTimers();
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
    // 상대 답은 넘기지 않되, 초대로 답한다는 사실은 넘겨서 통계 값(상대 링크 여부)을 사실대로 낸다.
    expect(props.pairInvite).toBe(true);
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
    // 볼 수 있는 기한은 월 일 시 분까지만 적고(연도·초를 쓰지 않는다), 다시 비교하는 길은 연결된 뒤에만 안내한다.
    const manage = container.querySelector('[aria-label="두 사람 연결 관리"]');
    expect(manage).not.toBeNull();
    expect(manage!.textContent).toMatch(/공유한 시점의 답이에요\. \d{1,2}월 \d{1,2}일 (오전|오후) \d{1,2}시( \d{1,2}분)?까지 볼 수 있어요\. 답을 바꿔 다시 비교하려면 이 연결을 끝내고 새로 초대해 주세요\./);
    expect(manage!.textContent).not.toMatch(/\d{4}\.|:\d{2}:\d{2}/);
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
    expect(container.textContent).not.toContain("함께 보기가 끝났어요");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result()).toBeNull(); expect(quiz()).toBeNull();
    expect(container.textContent).toContain("함께 보기가 끝났어요");
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
    expect(container.textContent).toContain("함께 보기가 끝났어요"); expect(result()).toBeNull();
    await act(async () => oldRead.resolve({ ok: true, snapshot: ready() }));
    expect(container.textContent).toContain("함께 보기가 끝났어요"); expect(result()).toBeNull();
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
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("만 14세 이상 확인과 공유 동의, 두 칸에 먼저 체크해 주세요.");
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
    const recovery = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(link => link.textContent === "이미 연결됐는지 내 결과 확인하기")!;
    expect(new URLSearchParams(new URL(recovery.href).hash.slice(1)).get("access")).toBe(firstJoin.participantToken);
    await click("동의하고 두 사람 결과 보기");
    expect(requestPairSession).toHaveBeenCalledTimes(3);
    expect(vi.mocked(requestPairSession).mock.calls[2][0]).toEqual(firstJoin);
    expect(window.location.hash).toBe(originalHash);
    expect(observed.unmount).not.toHaveBeenCalled();
  });

  it("참여 요청 뒤 답을 수정하면 늦은 성공과 이전·후속 조회가 수정 화면을 바꾸지 않고 복구 주소를 남긴다", async () => {
    const oldRead = deferred(); const join = deferred();
    vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: waiting() })
      .mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(join.promise)
      .mockResolvedValue({ ok: true, snapshot: ready("participant") });
    await render("invite", INVITE); await click("내 결과 보기"); await poll();
    for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await act(async () => checkbox.click());
    await click("동의하고 두 사람 결과 보기");
    const input = vi.mocked(requestPairSession).mock.calls[2][0];
    if (input.action !== "join") throw new Error("참여 요청이 필요해요.");
    const originalHash = window.location.hash;
    await click("내 답 수정하기"); await click("문항 답하기");
    const editing = quiz();
    await act(async () => oldRead.resolve({ ok: true, snapshot: { ...waiting(), state: "ready" } }));
    expect(quiz()).toBe(editing);
    await act(async () => join.resolve({ ok: true, snapshot: ready("participant") }));
    expect(readSavedPairSession()).toBeNull();
    expect(readPairSessionRecovery(ROOM)?.token).toBe(input.participantToken);
    await poll();
    expect(requestPairSession).toHaveBeenCalledTimes(3);
    expect(quiz()).toBe(editing); expect(quiz()?.textContent).toContain("작성한 답 1개");
    expect(observed.unmount).not.toHaveBeenCalled();
    expect(result()).toBeNull(); expect(window.location.hash).toBe(originalHash);
    expect(container.textContent).toContain("이 탭에서 요청한 함께 보기 확인");
    expect(container.textContent).toContain("연결이 잘 됐는지 열어서 확인해 주세요");
  });

  it.each([false, true])("참여 실패 뒤 답을 수정해도 최초 동의한 답과 접근 키로만 다시 시도한다 (탭 저장 차단 %s)", async blocked => {
    if (blocked) vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: waiting() })
      // 확정 거절(NOT_FOUND 등)은 요청이 처리되지 않았다는 뜻이라 이전 요청을 다시 보내는 길을 닫는다(아래 확정 거절 시험).
      // 이 시험은 처리 여부를 모르는 실패에서 같은 요청만 다시 보내는 규칙을 지키므로, 저장 차단 쪽도 불확실 실패(UNAVAILABLE)를 쓴다.
      .mockResolvedValue({ ok: false, code: blocked ? "UNAVAILABLE" : "NETWORK_ERROR", error: "참여 결과를 확인하지 못했어요." });
    await render("invite", INVITE); await click("내 결과 보기");
    for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await act(async () => checkbox.click());
    await click("동의하고 두 사람 결과 보기");
    const input = vi.mocked(requestPairSession).mock.calls[1][0];
    if (input.action !== "join") throw new Error("참여 요청이 필요해요.");
    await click("내 답 수정하기"); await click("문항 답하기"); await click("내 결과 보기");
    expect(container.textContent).toContain("답을 고쳤더라도 이전 요청에는 고친 내용이 들어가지 않아요");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(requestPairSession).toHaveBeenCalledTimes(2);
    const recovery = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(link => link.textContent === "이전에 보낸 요청이 연결됐는지 확인")!;
    expect(recovery).toBeTruthy();
    expect(new URLSearchParams(new URL(recovery.href).hash.slice(1)).get("access")).toBe(input.participantToken);
    await click("처음 동의했던 답으로 다시 보내기");
    expect(requestPairSession).toHaveBeenCalledTimes(3);
    expect(vi.mocked(requestPairSession).mock.calls[2][0]).toEqual(input);
    expect(input.answerCode).not.toBe(encodeV31(completeDraft(5)));
    expect(readSavedPairSession()).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("참여 결과를 확인하지 못했어요");
    if (!blocked) expect(readPairSessionRecovery(ROOM)?.token).toBe(input.participantToken);
  });

  describe("이미 그려진 방은 한 번의 확인 실패로 사라지지 않는다", () => {
    const fail = (code: string): PairSessionResult => ({ ok: false, code, error: "서버가 준 오류 문장이에요." });
    function notice() { return container.querySelector('[role="status"]')?.textContent ?? ""; }

    it.each([["owner", OWNER], ["participant", OTHER]] as const)("%s 화면은 일시적 실패(연결 끊김, 시간 초과, 서버 불안정, 요청 몰림)에도 결과를 그대로 두고 안내 한 줄만 더한다", async (role, token) => {
      vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: ready(role) })
        .mockResolvedValueOnce(fail("NETWORK_ERROR")).mockResolvedValueOnce(fail("TIMEOUT")).mockResolvedValueOnce(fail("UNAVAILABLE")).mockResolvedValueOnce(fail("RATE_LIMITED"))
        .mockResolvedValue({ ok: true, snapshot: ready(role) });
      await render("access", token);
      const shown = result(); expect(shown).not.toBeNull();
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await poll();
        expect(result()).toBe(shown);
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(container.textContent).not.toContain("함께 보기 결과를 확인하지 못했어요");
        // 방 주인과 참여자에게는 쓰던 답이 아니라 이미 본 결과가 남는다.
        expect(notice()).toContain("지금 보이는 결과는 그대로 두고");
        expect(notice()).not.toContain("작성한 답");
      }
      await poll();
      expect(result()).toBe(shown); expect(notice()).toBe("");
    });

    it("받아 둔 상태가 한 번이라도 그려졌으면 초대받은 사람도 같은 방식으로 지킨다", async () => {
      vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: waiting() }).mockResolvedValueOnce(fail("UNAVAILABLE"));
      await render("invite", INVITE); await poll();
      expect(quiz()).not.toBeNull(); expect(notice()).toContain("작성한 답은 이 화면에 그대로 있고");
    });

    // INVALID_RESPONSE 는 200 인데 해석할 수 없는 본문일 때만 여기까지 온다. 서버가 5xx 와 함께 보낸 것은 클라이언트가 UNAVAILABLE 로 바꾼다(pairSessionContract 시험).
    it.each(["NOT_FOUND", "CLOSED", "INVALID_RESPONSE"])("%s 같은 확정 오류는 안내가 아니라 기존처럼 오류 화면으로 바꾼다", async code => {
      vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: ready() }).mockResolvedValueOnce(fail(code));
      await render("access", OWNER); expect(result()).not.toBeNull();
      await poll();
      expect(result()).toBeNull();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("함께 보기 결과를 확인하지 못했어요");
      expect(container.textContent).toContain("서버가 준 오류 문장이에요.");
      expect(notice()).toBe("");
    });

    it("처음 열 때의 실패는 그릴 방이 없으므로 기존 오류 화면이다", async () => {
      vi.mocked(requestPairSession).mockResolvedValue(fail("NETWORK_ERROR"));
      await render("access", OWNER);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("함께 보기 결과를 확인하지 못했어요");
      expect(container.textContent).toContain("다시 시도하기");
    });

    it("연속 실패가 5번 쌓이면 오류 화면으로 넘어가고, 중간에 성공하면 횟수를 처음부터 센다", async () => {
      const mocked = vi.mocked(requestPairSession);
      mocked.mockResolvedValueOnce({ ok: true, snapshot: ready() });
      for (let i = 0; i < 4; i += 1) mocked.mockResolvedValueOnce(fail("UNAVAILABLE"));
      mocked.mockResolvedValueOnce({ ok: true, snapshot: ready() });
      for (let i = 0; i < 5; i += 1) mocked.mockResolvedValueOnce(fail("NETWORK_ERROR"));
      mocked.mockResolvedValue({ ok: true, snapshot: ready() });
      await render("access", OWNER);
      for (let i = 0; i < 4; i += 1) { await poll(); expect(result()).not.toBeNull(); expect(notice()).toContain("지금 보이는 결과는 그대로 두고"); }
      await poll(); expect(notice()).toBe(""); expect(result()).not.toBeNull();
      for (let i = 0; i < 4; i += 1) { await poll(); expect(result()).not.toBeNull(); }
      await poll();
      expect(result()).toBeNull();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("함께 보기 결과를 확인하지 못했어요");
      expect(notice()).toBe("");
      await click("다시 시도하기");
      expect(result()).not.toBeNull(); expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it("초대받은 사람이 답을 쓰는 중이면 연속 실패가 몇 번 쌓여도 쓰던 답 화면을 두고 안내만 유지하며, 회복하면 안내가 사라진다", async () => {
      const mocked = vi.mocked(requestPairSession);
      mocked.mockResolvedValueOnce({ ok: true, snapshot: waiting() });
      for (let i = 0; i < 8; i += 1) mocked.mockResolvedValueOnce(fail(i % 2 ? "TIMEOUT" : "NETWORK_ERROR"));
      mocked.mockResolvedValue({ ok: true, snapshot: waiting() });
      await render("invite", INVITE); await click("문항 답하기");
      const answering = quiz();
      for (let i = 0; i < 8; i += 1) {
        await poll();
        expect(quiz()).toBe(answering); expect(quiz()?.textContent).toContain("작성한 답 1개");
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(container.textContent).not.toContain("함께 보기 결과를 확인하지 못했어요");
        expect(notice()).toContain("작성한 답은 이 화면에 그대로 있고");
      }
      expect(observed.unmount).not.toHaveBeenCalled();
      await poll();
      expect(quiz()).toBe(answering); expect(notice()).toBe("");
    });

    it("방 주인에게는 상한이 그대로여서, 5번째 연속 실패에서 오류 화면이 된다", async () => {
      const mocked = vi.mocked(requestPairSession);
      mocked.mockResolvedValueOnce({ ok: true, snapshot: ready() });
      for (let i = 0; i < 5; i += 1) mocked.mockResolvedValueOnce(fail("TIMEOUT"));
      await render("access", OWNER);
      for (let i = 0; i < 4; i += 1) { await poll(); expect(result()).not.toBeNull(); }
      await poll(); expect(result()).toBeNull();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("함께 보기 결과를 확인하지 못했어요");
    });

    it("짧은 시간에 겹친 focus·탭 복귀 실패는 한 번으로 세어서, 앱을 여러 번 오가도 오류 화면이 되지 않는다", async () => {
      const mocked = vi.mocked(requestPairSession);
      mocked.mockResolvedValueOnce({ ok: true, snapshot: ready() }).mockResolvedValue(fail("NETWORK_ERROR"));
      await render("access", OWNER);
      const shown = result();
      for (let i = 0; i < 8; i += 1) await act(async () => { window.dispatchEvent(new Event("focus")); });
      expect(mocked.mock.calls.length).toBeGreaterThan(5);
      expect(result()).toBe(shown); expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(notice()).toContain("지금 보이는 결과는 그대로 두고");
      // 시간을 두고 난 실패는 그대로 센다. 겹친 실패는 1번으로 셌으니 주기마다 난 3번 더 쌓여도 안내이고, 4번째에 오류 화면이다.
      for (let i = 0; i < 3; i += 1) { await poll(); expect(result()).toBe(shown); }
      await poll(); expect(result()).toBeNull();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("함께 보기 결과를 확인하지 못했어요");
    });

    it("이미 참여한 초대 화면에는 보이는 결과가 없어서 지금 보이는 결과 말을 쓰지 않는다", async () => {
      vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: { ...waiting(), state: "ready" } }).mockResolvedValueOnce(fail("UNAVAILABLE"));
      await render("invite", INVITE); await poll();
      expect(container.textContent).toContain("이미 참여한 초대예요");
      expect(notice()).toContain("연결 상태를 새로 확인하지 못했어요");
      expect(notice()).not.toContain("지금 보이는 결과");
      expect(notice()).not.toContain("작성한 답");
    });

    it("안내는 늘 있는 접근성 live 영역 안에 있고, 내용 위에 겹치지 않는 흐름 안의 sticky 줄이다(맨 위 제목과 단추를 가리지 않는다)", async () => {
      const frameHeight = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(80);
      vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: ready() }).mockResolvedValueOnce(fail("NETWORK_ERROR")).mockResolvedValue({ ok: true, snapshot: ready() });
      await render("access", OWNER);
      const region = container.querySelector<HTMLElement>('main > [role="status"]')!;
      expect(region.getAttribute("aria-live")).toBe("polite");
      expect(region.textContent).toBe("");
      // 안내가 없을 때는 자리를 차지하지 않는다.
      expect(region.className).not.toContain("sticky");
      await poll();
      expect(container.querySelector('main > [role="status"]')).toBe(region);
      expect(region.textContent).toContain("연결 상태를 새로 확인하지 못했어요");
      // 안내가 있을 때: 스크롤해도 위에 남고(sticky top-0 z-20), 배경이 있고, 높이 0 틀 안에 절대 위치로 얹히지 않는다.
      for (const token of ["sticky", "top-0", "z-20", "bg-[var(--color-ivory-50)]"]) expect(region.className, token).toContain(token);
      expect(region.className).not.toMatch(/(^|\s)h-0(\s|$)/u);
      const box = region.querySelector("p")!;
      expect(box.className).not.toMatch(/(^|\s)(absolute|fixed)(\s|$)/u);
      expect(box.className).not.toContain("inset-x-0");
      // 안내가 떠 있는 동안: 스크롤 고정을 끄고(스크롤한 채로 안내가 끼어들어도 보던 내용이 안내 밑에 깔리지 않고 밀려 내려간다),
      // 안내 높이만큼 스크롤 여백을 둔다(문항을 넘길 때의 scrollIntoView 가 새 문항의 맨 위를 안내 밑에 두지 않는다).
      expect(container.querySelector("main")!.className).toContain("[overflow-anchor:none]");
      expect(document.documentElement.style.scrollPaddingTop).toBe("80px");
      await poll();
      expect(container.querySelector('main > [role="status"]')).toBe(region); expect(region.textContent).toBe("");
      expect(region.className).not.toContain("sticky");
      expect(container.querySelector("main")!.className).not.toContain("overflow-anchor");
      expect(document.documentElement.style.scrollPaddingTop).toBe("");
      frameHeight.mockRestore();
    });
  });

  describe("연결 끝내기 요청이 실패했을 때", () => {
    const fail = (code: string, error = "서버가 준 오류 문장이에요."): PairSessionResult => ({ ok: false, code, error });
    const closedSnapshot = (): PairSessionSnapshot => ({ roomId: ROOM, state: "closed", role: "owner", expiresAt });
    const shownAlerts = () => [...container.querySelectorAll('[role="alert"]')].map(item => item.textContent);

    it.each(["NETWORK_ERROR", "TIMEOUT", "UNAVAILABLE", "RATE_LIMITED", "INVALID_RESPONSE"])("%s 로 끊겨도 방 본문을 그대로 두고 그 자리에서 다시 시도하게 하며, 다시 시도가 되면 끝난 화면이 된다", async code => {
      vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: ready() }).mockResolvedValueOnce(fail(code))
        .mockResolvedValueOnce({ ok: true, snapshot: closedSnapshot() });
      await render("access", OWNER);
      const shown = result();
      await click("연결 끝내기"); await click("공유 답 지우고 연결 끝내기");
      expect(vi.mocked(requestPairSession).mock.calls.at(-1)![0]).toEqual({ action: "revoke", roomId: ROOM, token: OWNER });
      expect(result()).toBe(shown);
      expect(container.querySelector('[aria-label="두 사람 연결 관리"]')).not.toBeNull();
      expect(container.textContent).not.toContain("함께 보기 결과를 확인하지 못했어요");
      expect(shownAlerts()).toEqual(["연결 끝내기에 실패했어요. 다시 눌러 주세요."]);
      expect([...container.querySelectorAll("button")].some(button => button.textContent === "공유 답 지우고 연결 끝내기")).toBe(false);
      await click("연결 끝내기 다시 시도");
      expect(vi.mocked(requestPairSession).mock.calls.at(-1)![0]).toEqual({ action: "revoke", roomId: ROOM, token: OWNER });
      expect(container.textContent).toContain("함께 보기가 끝났어요"); expect(result()).toBeNull(); expect(shownAlerts()).toEqual([]);
    });

    it("실패한 뒤 닫았다 다시 열면 이전 실패 문구는 남지 않고, 방은 계속 확인된다", async () => {
      vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: ready() }).mockResolvedValueOnce(fail("NETWORK_ERROR")).mockResolvedValue({ ok: true, snapshot: ready() });
      await render("access", OWNER);
      await click("연결 끝내기"); await click("공유 답 지우고 연결 끝내기");
      expect(shownAlerts()).toHaveLength(1);
      await click("계속 함께 보기"); await click("연결 끝내기");
      expect(shownAlerts()).toEqual([]);
      expect([...container.querySelectorAll("button")].some(button => button.textContent === "공유 답 지우고 연결 끝내기")).toBe(true);
      await poll(); expect(result()).not.toBeNull();
    });

    it.each(["CLOSED", "NOT_FOUND"])("%s 같은 확정 오류는 기존처럼 오류 화면이다", async code => {
      vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: ready() }).mockResolvedValueOnce(fail(code));
      await render("access", OWNER);
      await click("연결 끝내기"); await click("공유 답 지우고 연결 끝내기");
      expect(result()).toBeNull();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("함께 보기 결과를 확인하지 못했어요");
      expect(container.textContent).toContain("서버가 준 오류 문장이에요.");
    });
  });

  describe("만든 지 7일이 지난 방 주소", () => {
    function roomAt(ms: number): string {
      const stamp = ms.toString(16).padStart(12, "0");
      return `${stamp.slice(0, 8)}-${stamp.slice(8)}-4111-8111-111111111111`;
    }
    async function openRoom(room: string, mode: "access" | "invite", token: string) {
      await act(async () => { window.history.replaceState(null, "", `/wedding-code/together#room=${room}&${mode}=${token}`); window.dispatchEvent(new Event("hashchange")); });
      await act(async () => root.render(<WeddingCodeTogether />));
    }

    it.each([["access", OWNER], ["invite", INVITE]] as const)("%s 주소는 서버에 묻기 전에 만료 안내를 보이고 재시도 단추를 숨긴다", async (mode, token) => {
      await openRoom(roomAt(Date.now() - 7 * 86_400_000 - 1), mode, token);
      expect(requestPairSession).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(mode === "invite" ? "만든 지 7일이 지나 끝났을 수 있어요. 초대한 분께 새 초대를 부탁해 주세요." : "만든 지 7일이 지나 끝났을 수 있어요. 새로 초대해 주세요.");
      expect([...container.querySelectorAll("button")].map(item => item.textContent)).not.toContain("다시 시도하기");
      expect(container.textContent).not.toContain("함께 보기 결과를 확인하지 못했어요");
      expect([...container.querySelectorAll("a")].some(link => link.getAttribute("href") === "/wedding-code" && link.textContent === "내 웨딩코드로 돌아가기")).toBe(true);
      await poll(); expect(requestPairSession).not.toHaveBeenCalled();
    });

    it("방 주인·참여자 주소는 새로 초대하라고, 초대 링크로 연 사람에게는 초대한 분께 부탁하라고 말하며, 입구 링크는 하나만 둔다", async () => {
      const homeLinks = () => [...container.querySelectorAll("a")].filter(link => link.getAttribute("href") === "/wedding-code");
      await openRoom(roomAt(Date.now() - 7 * 86_400_000 - 1), "access", OWNER);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("새로 초대해 주세요.");
      expect(homeLinks().map(link => link.textContent)).toEqual(["내 웨딩코드로 돌아가기"]);
      await openRoom(roomAt(Date.now() - 7 * 86_400_000 - 2), "invite", INVITE);
      const text = container.querySelector('[role="alert"]')?.textContent ?? "";
      expect(text).toContain("초대한 분께 새 초대를 부탁해 주세요.");
      expect(text).not.toContain("새로 초대해 주세요");
      expect(homeLinks().map(link => link.textContent)).toEqual(["내 웨딩코드로 돌아가기"]);
    });

    it("7일이 지나지 않은 주소는 평소처럼 서버에 확인한다", async () => {
      const room = roomAt(Date.now() - 7 * 86_400_000 + 60_000);
      vi.mocked(requestPairSession).mockResolvedValue({ ok: true, snapshot: { ...ready(), roomId: room } });
      await openRoom(room, "access", OWNER);
      expect(requestPairSession).toHaveBeenCalledTimes(1); expect(result()).not.toBeNull();
    });
  });

  describe("서버가 참여를 확실히 거절했을 때", () => {
    async function joinWith(rejected: PairSessionResult) {
      vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: waiting() }).mockResolvedValueOnce(rejected);
      await render("invite", INVITE); await click("내 결과 보기");
      for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await act(async () => checkbox.click());
      await click("동의하고 두 사람 결과 보기");
      return vi.mocked(requestPairSession).mock.calls[1][0];
    }
    const links = () => [...container.querySelectorAll<HTMLAnchorElement>("a")].map(link => link.textContent);

    it.each([["CONFLICT", "이미 다른 사람이 참여했어요."], ["CLOSED", "끝난 비교예요."], ["NOT_FOUND", "열 수 없는 비교예요."]])("%s 거절은 복구 링크를 숨기고 임시 확인 주소를 지우고 새 초대로 가는 길을 보여 준다", async (code, message) => {
      const input = await joinWith({ ok: false, code, error: message });
      if (input.action !== "join") throw new Error("참여 요청이 필요해요.");
      expect(readPairSessionRecovery(ROOM)).toBeNull();
      expect(links()).not.toContain("이미 연결됐는지 내 결과 확인하기");
      expect(links()).not.toContain("이 탭에서 요청한 함께 보기 확인");
      expect(container.textContent).not.toContain("확인하기");
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
      expect(container.textContent).toContain("내 웨딩코드로 가서 새 초대를 만들 수 있어요.");
      expect(container.textContent).toContain("내 답은 이 화면에 그대로 있어요.");
      const toStart = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(link => link.textContent === "내 웨딩코드로 가기");
      expect(toStart?.getAttribute("href")).toBe("/wedding-code");
      // 이 초대로는 더 참여할 수 없으니 되풀이할 수 없는 동의 단추는 치운다.
      expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
      expect([...container.querySelectorAll("button")].map(item => item.textContent)).not.toContain("동의하고 두 사람 결과 보기");
      expect(container.textContent).not.toContain("이전에 보낸 요청");
      await poll(); expect(requestPairSession).toHaveBeenCalledTimes(2);
      expect(readSavedPairSession()).toBeNull();
    });

    it("내 답이 이 브라우저에 저장돼 있으면 그대로 있다고 말한다", async () => {
      expect(writeV31LocalProgress(window.localStorage, { draft: completeDraft(2), flow: "core", index: 0, screen: "result", editing: false, needsPriorityReview: false }, null).status).toBe("saved");
      await joinWith({ ok: false, code: "CONFLICT", error: "이미 다른 사람이 참여했어요." });
      expect(container.textContent).toContain("내 답은 이 브라우저에 그대로 있어요.");
      expect(container.textContent).not.toContain("저장돼 있지 않아요");
    });

    it("저장이 없으면 화면을 나갈 때 사라질 수 있다고 숨기지 않고 알린다", async () => {
      await joinWith({ ok: false, code: "CLOSED", error: "끝난 비교예요." });
      expect(container.textContent).toContain("이 브라우저에는 저장돼 있지 않아서, 화면을 나가면 사라질 수 있어요.");
      expect(container.textContent).not.toContain("내 답은 이 브라우저에 그대로 있어요.");
    });

    it("INVALID_REQUEST 거절도 복구 링크를 숨기지만 고쳐서 다시 보낼 수 있게 동의 칸은 남기고, 다시 보낼 때는 새 접근 키를 쓴다", async () => {
      const first = await joinWith({ ok: false, code: "INVALID_REQUEST", error: "보낸 답이나 동의 항목에 문제가 있어요." });
      if (first.action !== "join") throw new Error("참여 요청이 필요해요.");
      expect(readPairSessionRecovery(ROOM)).toBeNull();
      expect(links()).not.toContain("이미 연결됐는지 내 결과 확인하기");
      expect(container.textContent).toContain("내 웨딩코드로 가서 새 초대를 만들 수 있어요.");
      expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
      vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: false, code: "NETWORK_ERROR", error: "연결이 끊겼어요." });
      await click("동의하고 두 사람 결과 보기");
      expect(requestPairSession).toHaveBeenCalledTimes(3);
      const second = vi.mocked(requestPairSession).mock.calls[2][0];
      if (second.action !== "join") throw new Error("참여 요청이 필요해요.");
      expect(second.participantToken).not.toBe(first.participantToken);
    });

    it("이전 요청을 다시 보내다 확정 거절을 받으면 그 요청을 버리고, 새로 보내려면 두 동의를 처음부터 다시 받는다", async () => {
      vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: waiting() })
        .mockResolvedValueOnce({ ok: false, code: "NETWORK_ERROR", error: "연결이 끊겼어요." })
        .mockResolvedValueOnce({ ok: false, code: "INVALID_REQUEST", error: "보낸 답이나 동의 항목에 문제가 있어요." });
      await render("invite", INVITE); await click("내 결과 보기");
      for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await act(async () => checkbox.click());
      await click("동의하고 두 사람 결과 보기");
      await click("내 답 수정하기"); await click("문항 답하기"); await click("내 결과 보기");
      expect(container.textContent).toContain("답을 고쳤더라도 이전 요청에는 고친 내용이 들어가지 않아요");
      await click("처음 동의했던 답으로 다시 보내기");
      expect(container.textContent).not.toContain("이전에 보낸 요청부터 확인해 주세요");
      expect(readPairSessionRecovery(ROOM)).toBeNull();
      const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      expect(boxes).toHaveLength(2); expect([...boxes].every(box => !box.checked)).toBe(true);
      await click("동의하고 두 사람 결과 보기");
      expect(requestPairSession).toHaveBeenCalledTimes(3);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("만 14세 이상 확인과 공유 동의, 두 칸에 먼저 체크해 주세요.");
    });

    it("처리 여부를 모르는 실패(시간 초과)는 지금처럼 복구 링크와 임시 확인 주소를 남긴다", async () => {
      const input = await joinWith({ ok: false, code: "TIMEOUT", error: "연결이 너무 오래 걸렸어요." });
      if (input.action !== "join") throw new Error("참여 요청이 필요해요.");
      expect(readPairSessionRecovery(ROOM)?.token).toBe(input.participantToken);
      expect(links()).toContain("이미 연결됐는지 내 결과 확인하기");
      expect(container.textContent).not.toContain("내 웨딩코드로 가기");
    });
  });

  describe("방 안의 안내 링크는 눌렀을 때 화면이 실제로 새 주소로 다시 열린다", () => {
    // jsdom 은 링크 이동과 hashchange 를 각각 타이머로 늦춰 낸다.
    async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(50); }); }
    function link(label: string) {
      const found = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(item => item.textContent === label);
      expect(found, label).toBeTruthy(); return found!;
    }
    async function press(label: string) { await act(async () => link(label).click()); await settle(); }
    // 이 탭에는 복구 기록(sessionStorage)이 없고 이 브라우저(localStorage)에만 저장된 주소가 있는 경우다. 복구 기록이 있으면 첫 조회부터 그 주소로 열린다.
    const plantSaved = (token: string) => window.localStorage.setItem(PAIR_SESSION_LOCAL_KEY, JSON.stringify({ roomId: ROOM, token, mode: "member", expiresAt }));

    it("이미 참여한 초대 화면의 「연결한 두 사람 결과 보기」", async () => {
      plantSaved(OTHER);
      vi.mocked(requestPairSession).mockImplementation(async input => input.action === "read" && input.token === INVITE
        ? { ok: true, snapshot: { ...waiting(), state: "ready" } } : { ok: true, snapshot: ready("participant") });
      await render("invite", INVITE);
      expect(container.textContent).toContain("이미 참여한 초대예요"); expect(result()).toBeNull();
      await press("연결한 두 사람 결과 보기");
      expect(window.location.hash).toBe(`#room=${ROOM}&access=${OTHER}`);
      expect(result()).not.toBeNull(); expect(container.textContent).not.toContain("이미 참여한 초대예요");
      expect(requestPairSession).toHaveBeenLastCalledWith({ action: "read", roomId: ROOM, token: OTHER });
    });

    it("참여 요청이 실패한 뒤의 「이미 연결됐는지 내 결과 확인하기」", async () => {
      vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: waiting() })
        .mockResolvedValueOnce({ ok: false, code: "NETWORK_ERROR", error: "연결이 끊겼어요." })
        .mockResolvedValue({ ok: true, snapshot: ready("participant") });
      await render("invite", INVITE); await click("내 결과 보기");
      for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await act(async () => checkbox.click());
      await click("동의하고 두 사람 결과 보기");
      const join = vi.mocked(requestPairSession).mock.calls[1][0];
      if (join.action !== "join") throw new Error("참여 요청이 필요해요.");
      expect(result()).toBeNull();
      await press("이미 연결됐는지 내 결과 확인하기");
      expect(parsePairSessionHash(window.location.hash)).toEqual({ roomId: ROOM, token: join.participantToken, mode: "member" });
      expect(result()).not.toBeNull(); expect(quiz()).toBeNull();
      expect(requestPairSession).toHaveBeenLastCalledWith({ action: "read", roomId: ROOM, token: join.participantToken });
    });

    it("답을 고친 뒤 나오는 「이전에 보낸 요청이 연결됐는지 확인」", async () => {
      vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: true, snapshot: waiting() })
        .mockResolvedValueOnce({ ok: false, code: "NETWORK_ERROR", error: "연결이 끊겼어요." })
        .mockResolvedValue({ ok: true, snapshot: ready("participant") });
      await render("invite", INVITE); await click("내 결과 보기");
      for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await act(async () => checkbox.click());
      await click("동의하고 두 사람 결과 보기");
      const join = vi.mocked(requestPairSession).mock.calls[1][0];
      if (join.action !== "join") throw new Error("참여 요청이 필요해요.");
      await click("내 답 수정하기"); await click("문항 답하기"); await click("내 결과 보기");
      expect(container.textContent).toContain("이전에 보낸 요청부터 확인해 주세요");
      await press("이전에 보낸 요청이 연결됐는지 확인");
      expect(parsePairSessionHash(window.location.hash)).toMatchObject({ token: join.participantToken, mode: "member" });
      expect(result()).not.toBeNull(); expect(container.textContent).not.toContain("이전에 보낸 요청부터 확인해 주세요");
    });

    it("보조 키를 누른 클릭은 가로채지 않는다", async () => {
      plantSaved(OTHER);
      vi.mocked(requestPairSession).mockResolvedValue({ ok: true, snapshot: { ...waiting(), state: "ready" } });
      await render("invite", INVITE);
      const before = window.location.hash;
      await act(async () => { link("연결한 두 사람 결과 보기").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })); });
      await settle();
      // 우리 핸들러가 손대지 않아서 Link 의 기본 이동(여기서는 흉내 낸 pushState)이 일어난다. 화면은 hashchange 가 없으므로 그대로다.
      expect(window.location.hash).not.toBe(before);
      expect(container.textContent).toContain("이미 참여한 초대예요");
    });

    it("다른 경로로 가는 링크(웨딩코드 입구에서 방으로)는 가로채지 않고 Link 의 이동에 맡긴다", async () => {
      window.history.replaceState(null, "", "/wedding-code#a=1");
      const target = `/wedding-code/together#room=${ROOM}&access=${OTHER}`;
      await act(async () => root.render(<PairSessionAnchor href={target}>방으로 가기</PairSessionAnchor>));
      const anchor = container.querySelector("a")!;
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      await act(async () => { anchor.dispatchEvent(event); });
      // 우리 핸들러가 가로챘다면 같은 경로의 # 만 바뀌어 주소가 /wedding-code#room=… 이 된다. 맡겼다면 흉내 낸 Link 가 방 경로로 옮긴다.
      expect(window.location.pathname).toBe("/wedding-code/together");
      expect(window.location.hash).toBe(`#room=${ROOM}&access=${OTHER}`);
    });
  });

  describe("내가 만든 초대 링크를 같은 브라우저에서 열었을 때", () => {
    // 이 브라우저(localStorage)에만 방 주인 기록이 있고 이 탭에는 복구 기록(sessionStorage)이 없는 경우다: 다른 탭이나 앱에서 자기 초대 링크를 연 상황.
    // 같은 탭에서 만든 직후라면 복구 기록으로 이미 방 주인 화면이 열린다.
    const seed = (record: Record<string, unknown>) => window.localStorage.setItem(PAIR_SESSION_LOCAL_KEY, JSON.stringify({ ...record, expiresAt }));
    const mine = () => seed({ roomId: ROOM, token: OWNER, mode: "member", invitation: INVITE });
    const notice = () => container.querySelector('[aria-label="내가 만든 초대"]');
    // jsdom 은 링크 이동과 hashchange 를 각각 타이머로 늦춰 낸다.
    async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(50); }); }
    function ownerAndInvite() {
      vi.mocked(requestPairSession).mockImplementation(async input => input.action === "read" && input.token === OWNER
        ? { ok: true, snapshot: { roomId: ROOM, state: "waiting", role: "owner", expiresAt, ownAnswerCode: encodeV31(own) } } : { ok: true, snapshot: waiting() });
    }

    it("참여 화면 대신 안내를 보이고, 참여 요청은 보내지 않는다", async () => {
      mine(); ownerAndInvite();
      await render("invite", INVITE);
      expect(notice()).not.toBeNull(); expect(quiz()).toBeNull(); expect(observed.client).not.toHaveBeenCalled();
      expect(notice()!.querySelector("h1")?.textContent).toBe("내가 만든 초대예요");
      expect(notice()!.textContent).toContain("이 초대는 내가 만든 거라 상대가 열어야 해요. 상대에게 링크를 보내 주세요.");
      expect(container.textContent).not.toContain("결혼 준비에 대한 각자의 생각을 나란히 보자는 초대가 왔어요");
      expect(container.textContent).not.toContain("동의하고 두 사람 결과 보기");
      expect(vi.mocked(requestPairSession).mock.calls.every(([input]) => input.action === "read")).toBe(true);
    });

    it("「내 비교 보기」는 방 주인 화면을 연다", async () => {
      mine(); ownerAndInvite();
      await render("invite", INVITE);
      const mineLink = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(item => item.textContent === "내 비교 보기")!;
      expect(parsePairSessionHash(new URL(mineLink.href).hash)).toEqual({ roomId: ROOM, token: OWNER, mode: "member", invitation: INVITE });
      await act(async () => mineLink.click()); await settle();
      expect(window.location.hash).toBe(new URL(mineLink.href).hash);
      expect(notice()).toBeNull();
      expect(container.querySelector('[aria-label="두 사람 연결 관리"]')).not.toBeNull();
      expect(result()).not.toBeNull();
    });

    it("보조 「그래도 이 링크로 참여하기」를 누르면 초대받은 사람 화면으로 간다", async () => {
      mine(); ownerAndInvite();
      await render("invite", INVITE);
      expect([...container.querySelectorAll("button")].map(item => item.textContent)).toEqual(["그래도 이 링크로 참여하기"]);
      await click("그래도 이 링크로 참여하기");
      expect(notice()).toBeNull(); expect(quiz()).not.toBeNull();
      expect(observed.client.mock.calls.at(-1)![0].pairInvite).toBe(true);
    });

    it.each([
      ["초대로 참여한 사람의 기록(초대 키 없음)", () => seed({ roomId: ROOM, token: OTHER, mode: "member" })],
      ["다른 방의 방 주인 기록", () => seed({ roomId: "22222222-2222-4222-8222-222222222222", token: OWNER, mode: "member", invitation: INVITE })],
      ["같은 방이지만 다른 초대 키", () => seed({ roomId: ROOM, token: OWNER, mode: "member", invitation: "d".repeat(64) })],
      ["기록 없음", () => undefined],
    ])("%s 이면 안내 없이 초대받은 사람 화면이 나온다", async (_name, plant) => {
      plant();
      vi.mocked(requestPairSession).mockResolvedValue({ ok: true, snapshot: waiting() });
      await render("invite", INVITE);
      expect(notice()).toBeNull(); expect(quiz()).not.toBeNull();
    });

    it("저장소를 읽을 수 없으면 기존처럼 초대받은 사람 화면이 나온다", async () => {
      mine();
      vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
      vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
      vi.mocked(requestPairSession).mockResolvedValue({ ok: true, snapshot: waiting() });
      await render("invite", INVITE);
      expect(notice()).toBeNull(); expect(quiz()).not.toBeNull();
    });

    it("상대가 이미 참여한 뒤에는 이미 참여한 초대 화면이 그대로 나온다", async () => {
      mine();
      vi.mocked(requestPairSession).mockResolvedValue({ ok: true, snapshot: { ...waiting(), state: "ready" } });
      await render("invite", INVITE);
      expect(notice()).toBeNull(); expect(container.textContent).toContain("이미 참여한 초대예요");
    });
  });

  describe("초대를 확인하지 못했을 때의 말", () => {
    it("초대받은 사람에게는 결과가 아니라 초대를 말하고, 단추 이름은 안내의 「다시 시도」와 같다", async () => {
      vi.mocked(requestPairSession).mockResolvedValueOnce({ ok: false, code: "NETWORK_ERROR", error: "연결이 끊겼어요. 같은 화면에서 다시 시도해 주세요." })
        .mockResolvedValue({ ok: true, snapshot: waiting() });
      await render("invite", INVITE);
      const alert = container.querySelector('[role="alert"]')!;
      expect(alert.querySelector("h1")?.textContent).toBe("초대를 확인하지 못했어요");
      expect(alert.textContent).not.toContain("결과를 확인하지 못했어요");
      expect(alert.textContent).toContain("다시 시도해 주세요");
      expect([...alert.querySelectorAll("button")].map(item => item.textContent)).toEqual(["다시 시도하기"]);
      await click("다시 시도하기");
      expect(quiz()).not.toBeNull(); expect(container.querySelector('[role="alert"]')).toBeNull();
    });
  });
});

describe("서버 HTML 의 대기 상태", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  beforeEach(() => {
    window.localStorage.clear(); window.sessionStorage.clear();
    window.history.replaceState(null, "", "/wedding-code/together");
    container = document.createElement("div"); document.body.appendChild(container);
  });
  afterEach(() => { act(() => root?.unmount()); root = null; container.remove(); vi.restoreAllMocks(); });

  it("스크립트가 멈추거나 꺼져도 보이도록 12초 새로고침 줄(다시 불러오기 링크)과 noscript 줄이 서버 HTML 에 있다", () => {
    const html = renderToString(<WeddingCodeTogether />);
    expect(html).toContain("두 사람 연결을 확인하고 있어요");
    expect(html).toContain('class="hb-late-hint');
    expect(html).toContain(LATE_RELOAD_HINT_TEXT);
    expect(html).toMatch(new RegExp(`<a href="" data-late-reload-link="" [^>]*>${LATE_RELOAD_LINK_TEXT}</a>`, "u"));
    expect(html).toMatch(/<noscript>[\s\S]*<\/noscript>/u);
    expect(html).toContain(NO_SCRIPT_HINT_TEXT);
  });

  it("서버 HTML 과 첫 클라이언트 그림이 같아 하이드레이션 경고가 없고, 주소를 읽은 뒤에는 안내가 사라진다", async () => {
    const element = <WeddingCodeTogether />;
    container.innerHTML = renderToString(element);
    expect(container.querySelector("[data-late-reload-hint]")?.textContent).toBe(`${LATE_RELOAD_HINT_TEXT} ${LATE_RELOAD_LINK_TEXT}`);
    expect(container.querySelector("noscript")).not.toBeNull();
    const onRecoverableError = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { root = hydrateRoot(container, element, { onRecoverableError }); });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(container.querySelector("[data-late-reload-hint]")).toBeNull();
    expect(container.querySelector("noscript")).toBeNull();
    expect(container.textContent).toContain("함께 보기 링크를 확인해 주세요");
  });
});
