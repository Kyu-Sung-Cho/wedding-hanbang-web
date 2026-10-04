// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEDDING_CODE_V31_TASTES } from "@/constants/weddingCodeV31";
import { createV31Draft, encodeV31 } from "@/lib/weddingCode/v31";
import { V31_CORE_RATING_IDS } from "@/lib/weddingCode/v31Flow";
import { getPairSessionIssuedAt, parsePairSessionRequest, type PairSessionRequest } from "@/lib/weddingCode/pairSessionContract";
import { parsePairSessionHash, readPairSessionRecovery, readSavedPairSession, savePairSessionLink, savePairSessionRecovery, forgetPairSession } from "@/lib/weddingCode/pairSessionClient";
import WeddingCodeV31Connection, { WeddingCodeComparisonResume } from "./WeddingCodeV31Connection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function completed() {
  const draft = createV31Draft();
  for (const id of V31_CORE_RATING_IDS) draft.answers[id] = 4;
  for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status: "undecided" };
  draft.avoidances = { status: "no_preference" }; draft.spending = { status: "no_preference" };
  return draft;
}

describe("본인 결과에서 두 사람 초대 만들기", () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetcher = vi.fn<typeof fetch>();
  const now = Date.parse("2026-09-23T10:00:00Z");
  beforeEach(() => {
    window.localStorage.clear(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/wedding-code");
    vi.spyOn(Date, "now").mockReturnValue(now);
    fetcher.mockReset(); fetcher.mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetcher);
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); document.body.replaceChildren();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear();
  });
  async function click(element: HTMLElement | null | undefined) { expect(element).toBeTruthy(); await act(async () => element!.click()); }
  async function button(label: string) { await click([...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === label)); }
  async function render() {
    await act(async () => root.render(<WeddingCodeV31Connection draft={completed()} />));
    await button("상대 초대하고 함께 보기");
  }
  async function consent() {
    for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await click(checkbox);
  }
  function request(index: number): Extract<PairSessionRequest, { action: "create" }> {
    const body = fetcher.mock.calls[index]?.[1]?.body;
    if (typeof body !== "string") throw new Error("초대 생성 JSON 요청이 없어요.");
    const parsed = parsePairSessionRequest(JSON.parse(body));
    if (parsed?.action !== "create") throw new Error("유효한 초대 생성 요청이 아니에요.");
    return parsed;
  }

  it.each([[false, false], [true, false], [false, true]])("나이 확인=%s·공유 동의=%s 중 하나라도 없으면 답을 전송하지 않는다", async (age, share) => {
    await render();
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);
    if (age) await click(checkboxes[0]);
    if (share) await click(checkboxes[1]);
    await button("동의하고 초대 만들기");
    expect(fetcher).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("두 칸에 모두 체크하면 초대를 만들 수 있어요");
    expect(container.querySelector('a[href*="/wedding-code/together"]')).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
    expect(readSavedPairSession()).toBeNull();
  });

  it("두 동의 후에만 본인 답을 보내며 네트워크 실패를 성공한 초대나 영구 저장으로 표시하지 않는다", async () => {
    await render(); await consent();
    expect(fetcher).not.toHaveBeenCalled();
    await button("동의하고 초대 만들기");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const input = request(0);
    expect(input.answerCode).toBe(encodeV31(completed()));
    expect(input.consent).toBe(true); expect(input.ageConfirmed).toBe(true);
    expect(getPairSessionIssuedAt(input.roomId)).toBe(now);
    expect(fetcher.mock.calls[0][0]).toBe("/api/wedding-code/session");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("연결이 끊겼어요");
    expect(container.textContent).not.toContain("초대를 만들었어요");
    expect(container.textContent).not.toContain("연결한 두 사람 결과 보기");
    expect(readSavedPairSession()).toBeNull();
    const recovery = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(item => item.textContent === "이미 만들어졌는지 내 초대 확인하기");
    expect(recovery).toBeTruthy();
    const url = new URL(recovery!.href);
    expect(url.search).toBe("");
    expect(parsePairSessionHash(url.hash)).toEqual({ roomId: input.roomId, token: input.ownerToken, mode: "member", invitation: input.inviteToken });
    expect(readPairSessionRecovery(input.roomId)?.token).toBe(input.ownerToken);
    expect(container.querySelector('a[href*="#room="][href*="&invite="]')).toBeNull();
  });

  it("실패 후 다시 시도할 때는 같은 방·권한·생성 시각·답으로 요청한다", async () => {
    await render(); await consent(); await button("동의하고 초대 만들기");
    const first = request(0);
    vi.mocked(Date.now).mockReturnValue(now + 60_000);
    await button("초대 다시 만들기");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(request(1)).toEqual(first);
    expect(readSavedPairSession()).toBeNull();
  });

  it("서버가 생성 유효기간 종료를 확인한 뒤에만 새 방과 새 권한으로 시도한다", async () => {
    await render(); await consent(); await button("동의하고 초대 만들기");
    const first = request(0);
    vi.mocked(Date.now).mockReturnValue(now + 6 * 60_000);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: "CREATE_EXPIRED", error: "새 초대를 만들어 주세요." }), { status: 410 }));
    await button("초대 다시 만들기");
    expect(request(1)).toEqual(first);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("새 초대를 만들어 주세요");
    await button("초대 다시 만들기");
    const next = request(2);
    expect(next.roomId).not.toBe(first.roomId);
    expect(next.ownerToken).not.toBe(first.ownerToken);
    expect(next.inviteToken).not.toBe(first.inviteToken);
    expect(next.issuedAt).toBe(now + 6 * 60_000);
    expect(getPairSessionIssuedAt(next.roomId)).toBe(next.issuedAt);
    expect(next.answerCode).toBe(first.answerCode);
    expect(readSavedPairSession()).toBeNull();
  });

  it("시각이 어긋나 거절되면 휴대폰 날짜와 시간을 확인하라고 말하고, 쓸모없는 복구 링크와 임시 확인 주소를 치운다", async () => {
    await render(); await consent(); await button("동의하고 초대 만들기");
    const first = request(0);
    expect(readPairSessionRecovery(first.roomId)).not.toBeNull();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: "CREATE_EXPIRED", error: "초대를 만든 시각이 실제 시각과 5분 넘게 달라서 만들지 못했어요. 휴대폰 날짜와 시간이 맞는지 확인해 주세요." }), { status: 400 }));
    await button("초대 다시 만들기");
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("휴대폰 날짜와 시간이 맞는지 확인해 주세요.");
    expect(alert.querySelector("a")).toBeNull();
    expect(container.textContent).not.toContain("이미 만들어졌는지");
    expect(readPairSessionRecovery(first.roomId)).toBeNull();
  });

  it("서버 문구에 시계 안내가 빠져 있어도 화면은 같은 안내를 한 번 붙인다", async () => {
    await render(); await consent();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: "CREATE_EXPIRED", error: "새 초대를 만들어 주세요." }), { status: 400 }));
    await button("동의하고 초대 만들기");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("새 초대를 만들어 주세요. 휴대폰 날짜와 시간이 맞는지 확인해 주세요.");
  });

  it("확정 거절(INVALID_REQUEST)도 복구 링크를 숨기고 다음에는 새 방 키로 시도한다. 처리 여부를 모르는 실패는 링크를 남긴다", async () => {
    await render(); await consent();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: "INVALID_REQUEST", error: "보낸 답이나 동의 항목에 문제가 있어요." }), { status: 400 }));
    await button("동의하고 초대 만들기");
    const first = request(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("보낸 답이나 동의 항목에 문제가 있어요.");
    expect(container.querySelector('[role="alert"] a')).toBeNull();
    expect(readPairSessionRecovery(first.roomId)).toBeNull();
    await button("초대 다시 만들기");
    const second = request(1);
    expect(second.roomId).not.toBe(first.roomId);
    expect(container.querySelector('[role="alert"] a')).not.toBeNull();
    expect(readPairSessionRecovery(second.roomId)?.token).toBe(second.ownerToken);
  });

  it.each([
    ["출처 확인 실패(403)", () => new Response(JSON.stringify({ code: "INVALID_ORIGIN", error: "요청을 확인하지 못했어요. 웨딩코드 화면에서 다시 시도해 주세요." }), { status: 403 }), "요청을 확인하지 못했어요"],
    ["요청 몰림(429, code 없음)", () => new Response(JSON.stringify({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }), { status: 429 }), "요청이 잠깐 몰렸어요"],
    ["너무 큰 요청(413)", () => new Response(JSON.stringify({ code: "TOO_LARGE", error: "보내려는 내용이 너무 커서 처리하지 못했어요." }), { status: 413 }), "너무 커서 처리하지 못했어요"],
  ])("서버가 방을 만들기 전에 막은 응답(%s)에는 복구 링크와 확인 주소 안내를 숨기고, 다시 만들 때는 새 방 키를 쓴다", async (_name, response, message) => {
    await render(); await consent();
    fetcher.mockResolvedValueOnce(response());
    await button("동의하고 초대 만들기");
    const first = request(0);
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain(message);
    // 방이 만들어지지 않았으니 「이미 만들어졌는지 확인하기」 링크도, 위쪽의 「요청을 확인하는 주소가 남아 있어요」 안내도 없다.
    expect(alert.querySelector("a")).toBeNull();
    expect(container.textContent).not.toContain("이미 만들어졌는지");
    expect(container.textContent).not.toContain("확인하는 주소가 남아 있어요");
    expect(readPairSessionRecovery(first.roomId)).toBeNull();
    expect([...container.querySelectorAll("button")].map(item => item.textContent)).toContain("초대 다시 만들기");
    await button("초대 다시 만들기");
    const second = request(1);
    expect(second.roomId).not.toBe(first.roomId);
    expect(second.ownerToken).not.toBe(first.ownerToken);
  });

  it("처리 여부를 모르는 실패(서버 불안정 503, 연결 끊김)에는 복구 링크와 확인 주소 안내를 남긴다", async () => {
    await render(); await consent();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: "UNAVAILABLE", error: "함께 보기를 처리하지 못했어요." }), { status: 503 }));
    await button("동의하고 초대 만들기");
    const input = request(0);
    expect(container.querySelector('[role="alert"] a')?.textContent).toBe("이미 만들어졌는지 내 초대 확인하기");
    expect(container.textContent).toContain("확인하는 주소가 남아 있어요");
    expect(readPairSessionRecovery(input.roomId)?.token).toBe(input.ownerToken);
  });

  it("요청 중에는 동의 변경과 중복 생성을 막고 실패하면 재시도를 다시 허용한다", async () => {
    let resolve: (value: Response) => void = () => { throw new Error("요청이 시작되지 않았어요."); };
    fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    await render(); await consent(); await button("동의하고 초대 만들기");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(item => item.disabled)).toBe(true);
    const pending = [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "초대를 만들고 있어요…")!;
    expect(pending.disabled).toBe(true); await click(pending); expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => resolve(new Response(JSON.stringify({ code: "UNAVAILABLE", error: "잠시 후 다시 시도해 주세요." }), { status: 503 })));
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(item => !item.disabled)).toBe(true);
    await button("초대 다시 만들기"); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(request(1)).toEqual(request(0));
  });

  it("생성 요청 뒤 화면을 떠나면 늦은 성공으로 현재 화면이나 영구 주소를 바꾸지 않고 확인 주소만 남긴다", async () => {
    let resolve!: (value: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    await render(); await consent(); await button("동의하고 초대 만들기");
    const input = request(0);
    const recovery = readPairSessionRecovery(input.roomId);
    await act(async () => root.render(<section>내 답 수정 화면</section>));
    await act(async () => resolve(new Response(JSON.stringify({ snapshot: {
      roomId: input.roomId, state: "waiting", role: "owner", ownAnswerCode: input.answerCode,
      expiresAt: new Date(now + 7 * 86400000).toISOString(),
    } }), { status: 200 })));
    expect(container.textContent).toBe("내 답 수정 화면");
    expect(readSavedPairSession()).toBeNull();
    expect(readPairSessionRecovery(input.roomId)).toEqual(recovery);
    await act(async () => root.render(<WeddingCodeComparisonResume />));
    expect(container.textContent).toContain("연결이 잘 됐는지 열어서 확인해 주세요");
    expect(container.textContent).not.toContain("연결한 두 사람 결과 보기");
    const link = container.querySelector<HTMLAnchorElement>("a")!;
    expect(parsePairSessionHash(new URL(link.href).hash)?.token).toBe(input.ownerToken);
  });

  it.each([false, true])("자동 저장 OFF=%s에서 응답 유실 후 같은 탭을 다시 열어도 요청 확인 주소를 복원한다", async off => {
    if (off) window.localStorage.setItem("hanbang.wedding-code.v31.autosave", "off");
    await render(); await consent(); await button("동의하고 초대 만들기");
    const input = request(0);
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => root.render(<WeddingCodeComparisonResume />));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("이 탭에서 요청한 함께 보기 확인");
    expect(container.textContent).not.toContain("연결한 두 사람 결과 보기");
    expect(parsePairSessionHash(new URL(container.querySelector<HTMLAnchorElement>("a")!.href).hash)).toMatchObject({ roomId: input.roomId, token: input.ownerToken });
    expect(readSavedPairSession()).toBeNull();
  });

  it("다른 방의 저장 결과와 미확인 요청은 각각 보여주고 같은 권한은 중복하지 않는다", async () => {
    const first = { roomId: "11111111-1111-4111-8111-111111111111", token: "a".repeat(64), mode: "member" as const, expiresAt: new Date(now + 86400000).toISOString() };
    const second = { ...first, roomId: "22222222-2222-4222-8222-222222222222", token: "b".repeat(64) };
    savePairSessionLink(first); savePairSessionRecovery(second);
    await act(async () => root.render(<WeddingCodeComparisonResume />));
    const links = [...container.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.map(item => item.textContent)).toEqual(["연결한 두 사람 결과 보기", "이 탭에서 요청한 함께 보기 확인"]);
    expect(links.map(item => parsePairSessionHash(new URL(item.href).hash)?.roomId)).toEqual([first.roomId, second.roomId]);
    await act(async () => savePairSessionLink(second));
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.textContent).not.toContain("이 탭에서 요청한 함께 보기 확인");
    await act(async () => forgetPairSession(second.roomId));
    expect(container.querySelector("a")).toBeNull();
  });
});
