// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEDDING_CODE_V31_TASTES } from "@/constants/weddingCodeV31";
import { createV31Draft, encodeV31 } from "@/lib/weddingCode/v31";
import { V31_CORE_RATING_IDS } from "@/lib/weddingCode/v31Flow";
import { getPairSessionIssuedAt, parsePairSessionRequest, type PairSessionRequest } from "@/lib/weddingCode/pairSessionContract";
import { parsePairSessionHash, readPairSessionRecovery, readSavedPairSession } from "@/lib/weddingCode/pairSessionClient";
import WeddingCodeV31Connection from "./WeddingCodeV31Connection";

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
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("공유할 내용과 나이 확인 항목을 먼저 확인");
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
    await button("초대 만들기 다시 시도");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(request(1)).toEqual(first);
    expect(readSavedPairSession()).toBeNull();
  });

  it("서버가 생성 유효기간 종료를 확인한 뒤에만 새 방과 새 권한으로 시도한다", async () => {
    await render(); await consent(); await button("동의하고 초대 만들기");
    const first = request(0);
    vi.mocked(Date.now).mockReturnValue(now + 6 * 60_000);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: "CREATE_EXPIRED", error: "새 초대를 만들어 주세요." }), { status: 410 }));
    await button("초대 만들기 다시 시도");
    expect(request(1)).toEqual(first);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("새 초대를 만들어 주세요");
    await button("초대 만들기 다시 시도");
    const next = request(2);
    expect(next.roomId).not.toBe(first.roomId);
    expect(next.ownerToken).not.toBe(first.ownerToken);
    expect(next.inviteToken).not.toBe(first.inviteToken);
    expect(next.issuedAt).toBe(now + 6 * 60_000);
    expect(getPairSessionIssuedAt(next.roomId)).toBe(next.issuedAt);
    expect(next.answerCode).toBe(first.answerCode);
    expect(readSavedPairSession()).toBeNull();
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
    await button("초대 만들기 다시 시도"); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(request(1)).toEqual(request(0));
  });
});
