// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/authStore";
import type { Profile } from "@/types/database.types";
import { CURRENT_WEDDING_CODE_SCENE_CONFIG as config } from "@/lib/weddingCode/scene/config";
import { encodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import type { PreparationStyleSnapshot, PreparationStyleSavedResponse } from "@/lib/weddingCode/preparationStyle";
import { WEDDING_CODE_V12_VERSION } from "@/constants/weddingCodeV12";
import PreparationStyleHub from "./PreparationStyleHub";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const owner = "11111111-1111-4111-8111-111111111111";
const partnerId = "22222222-2222-4222-8222-222222222222";
const coupleId = "33333333-3333-4333-8333-333333333333";
const now = "2026-09-20T01:00:00.000Z";
const answers = Object.fromEntries(config.questions.map(question => [question.key, question.options[0].value])) as WeddingCodeV06Answers;
const response: PreparationStyleSavedResponse = { sceneVersion: WEDDING_CODE_V12_VERSION, answerCode: encodeWeddingCodeV06(answers, config.questions), revision: 1, savedAt: now };
function profile(id = owner): Profile {
  return { id, name: "나", role: null, couple_id: coupleId, avatar_url: null, onboarding_completed: true, onboarding_step: 5, is_admin: false, created_at: now, updated_at: now };
}
function snapshot(overrides: Partial<PreparationStyleSnapshot> = {}): PreparationStyleSnapshot {
  return { ownerUserId: owner, coupleId, partnerUserId: partnerId, stateRevision: overrides.own?.revision ?? null, own: null, sharing: null, partner: null, ...overrides };
}
const result = (state = snapshot()) => new Response(JSON.stringify({ snapshot: state }), { status: 200 });

describe("준비 스타일의 개인 저장과 두 사람 공유", () => {
  let root: Root;
  let container: HTMLDivElement;
  let fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    useAuthStore.setState({ user: { id: owner, email: "test@example.com" }, profile: profile(), couple: { id: coupleId, invite_code: null, bride_id: owner, groom_id: partnerId, membership_sealed_at: now, created_at: now, updated_at: now }, partner: { id: partnerId, name: "지은", role: null, couple_id: coupleId }, isInitialized: true, isDemo: false });
    fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => result());
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.history.replaceState(null, "", "/preparation-style");
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useAuthStore.setState({ user: null, profile: null, couple: null, partner: null, isInitialized: false, isDemo: false });
  });
  const render = async () => { await act(async () => root.render(<PreparationStyleHub />)); };
  const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!;
  const click = async (text: string) => { expect(button(text), text).toBeDefined(); await act(async () => button(text).click()); };
  async function answerAll(startLabel = "내 답 고르기") {
    await click(startLabel);
    for (let index = 0; index < config.questions.length; index++) {
      await act(async () => container.querySelector<HTMLButtonElement>("[data-option]")!.click());
      await click(index === config.questions.length - 1 ? "내 답 확인하기" : "다음 문항");
    }
  }

  it("문항 완료는 저장하지 않고, 명시적 저장만 본인 응답을 보내며 공유는 따로 한다", async () => {
    await render();
    await answerAll();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("이 답을 저장할까요?");
    fetchMock.mockResolvedValueOnce(result(snapshot({ own: response })));
    await click("동의하고 내 계정에 저장");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, request] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/wedding-code/preparation-style");
    expect(request?.method).toBe("PUT");
    expect(JSON.parse(String(request?.body))).toEqual({ expectedOwnerUserId: owner, expectedRevision: null, sceneVersion: config.version, answerCode: response.answerCode, saveConsentVersion: "2026-09-20" });
    expect(container.textContent).toContain("내 답을 저장했어요. 상대에게는 아직 공유하지 않았어요.");
    expect(container.querySelector("[data-personal-style]")).not.toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/share"))).toBe(false);
  });

  it("공개 비교 링크의 응답을 본인이나 파트너의 계정 답으로 가져오지 않는다", async () => {
    window.history.replaceState(null, "", `/preparation-style#v=${config.version}&a=${response.answerCode}&b=${response.answerCode}`);
    await render();
    expect(container.querySelector("[data-personal-style]")).toBeNull();
    expect(container.querySelector("[data-couple-style]")).toBeNull();
    expect(container.textContent).toContain("먼저 내 생각부터 골라 보세요");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("저장 오류 때 초안을 남기고 성공 안내나 저장한 결과를 만들지 않는다", async () => {
    await render(); await answerAll();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await click("동의하고 내 계정에 저장");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("지금은");
    expect(container.textContent).not.toContain("내 답을 저장했어요.");
    expect(container.textContent).toContain("이 답을 저장할까요?");
    expect(button("동의하고 내 계정에 저장").disabled).toBe(true);
  });

  it("정상 HTTP여도 요청한 답이 돌아오지 않으면 저장 성공으로 표시하지 않는다", async () => {
    await render(); await answerAll();
    await click("동의하고 내 계정에 저장");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("변경된 내용을 확인하지 못했어요");
    expect(container.textContent).not.toContain("내 답을 저장했어요.");
  });

  it("같은 답을 다시 저장하면 기존 공유 상태를 사실대로 표시한다", async () => {
    const shared = snapshot({ own: response, sharing: { responseRevision: 1, sharedAt: now }, partner: response });
    fetchMock.mockResolvedValueOnce(result(shared));
    await render(); await answerAll("새로 답하기");
    fetchMock.mockResolvedValueOnce(result(shared));
    await click("동의하고 내 계정에 저장");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("지은님과의 공유 승인도 유지하고 있어요");
    expect(container.textContent).not.toContain("상대에게는 아직 공유하지 않았어요");
  });

  it("충돌 뒤 초안을 보존하고 최신 답을 확인한 명시적 선택으로만 바꾼다", async () => {
    fetchMock.mockResolvedValueOnce(result(snapshot({ own: response })));
    await render(); await answerAll("새로 답하기");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 409 }));
    await click("동의하고 내 계정에 저장");
    fetchMock.mockResolvedValueOnce(result(snapshot({ own: { ...response, revision: 2 } })));
    await click("다시 불러오기");
    expect(container.textContent).toContain("지금 계정에 저장된 답 보기");
    expect(button("동의하고 내 계정에 저장").disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockResolvedValueOnce(result(snapshot({ own: { ...response, revision: 3 } })));
    await click("확인하고 이 초안으로 바꾸기");
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body)).expectedRevision).toBe(2);
    expect(container.textContent).toContain("내 답을 저장했어요");
  });

  it("다른 탭의 공유 상태를 다시 읽은 뒤 이전 미공유 성공 안내를 남기지 않는다", async () => {
    await render(); await answerAll();
    fetchMock.mockResolvedValueOnce(result(snapshot({ own: response })));
    await click("동의하고 내 계정에 저장");
    expect(container.textContent).toContain("내 답을 저장했어요. 상대에게는 아직 공유하지 않았어요.");
    fetchMock.mockResolvedValueOnce(result(snapshot({ own: { ...response, revision: 2 }, sharing: { responseRevision: 2, sharedAt: now }, partner: response })));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).not.toContain("상대에게는 아직 공유하지 않았어요.");
    expect(container.textContent).toContain("지은님과 공유하도록 승인했어요");
  });

  it("공유 확인 중 답이 바뀌면 이전 확인으로 새 답을 공유하지 않는다", async () => {
    fetchMock.mockResolvedValueOnce(result(snapshot({ own: response })));
    await render(); await click("내 답 공유하기");
    fetchMock.mockResolvedValueOnce(result(snapshot({ own: { ...response, revision: 2 } })));
    await act(async () => window.dispatchEvent(new Event("focus")));
    await click("동의하고 이 상대와 공유");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("확인하는 동안 내 답이 바뀌었어요");
  });

  it("상대 이름과 공유 내용을 확인한 뒤에만 현재 상대와 공유한다", async () => {
    fetchMock.mockResolvedValueOnce(result(snapshot({ own: response })));
    await render();
    await click("내 답 공유하기");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("지은님과 내 답을 공유할까요?");
    fetchMock.mockResolvedValueOnce(result(snapshot({ own: { ...response, revision: 2 }, sharing: { responseRevision: 2, sharedAt: now }, partner: response })));
    await click("동의하고 이 상대와 공유");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ expectedOwnerUserId: owner, expectedRevision: 1, expectedCoupleId: coupleId, expectedPartnerUserId: partnerId, shareConsentVersion: "2026-09-20" });
    await click("둘이 함께 보기");
    expect(container.querySelector("[data-couple-style]")).not.toBeNull();
    expect(container.textContent).toContain("같은 답 5 · 다른 답 0");
  });

  it("저장한 역할 답의 나와 상대를 구분하고 같은 보기와 실제 담당 주체를 따로 설명한다", async () => {
    const own = { ...response, answerCode: encodeWeddingCodeV06({ B1: "B", B2: "C" }, config.questions) };
    const partner = { ...response, answerCode: encodeWeddingCodeV06({ B1: "B", B2: "D" }, config.questions) };
    fetchMock.mockResolvedValueOnce(result(snapshot({ own, sharing: { responseRevision: own.revision, sharedAt: now }, partner })));
    await render();
    await click("둘이 함께 보기");
    const roles = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="비교할 주제"] button')]
      .find(item => item.textContent?.includes("역할 나누기"));
    expect(roles).toBeDefined();
    await act(async () => roles!.click());
    const comparison = container.querySelector('section[aria-label="역할 나누기"]');
    expect(comparison?.textContent).toContain("함께 답한 2장면 중 1곳은 같은 답, 1곳은 다른 답을 골랐어요.");
    const sameSummary = [...comparison!.querySelectorAll<HTMLElement>("summary")]
      .find(item => item.textContent === "같은 답을 고른 1장면도 보기");
    expect(sameSummary).toBeDefined();
    await act(async () => sameSummary!.click());
    expect(sameSummary!.closest("details")?.open).toBe(true);

    const expectedScenes = [
      { key: "B1", own: "표를 보고 세 곳은 내가 혼자 고른다", partner: "표를 보고 세 곳은 내가 혼자 고른다", explanation: "둘 다 직접 고르겠다고 답했어요." },
      { key: "B2", own: "두 상담 모두 내가 혼자 다녀온다", partner: "두 상담 모두 상대가 혼자 다녀온다", explanation: "한 사람은 두 상담을 혼자 다녀오겠다고, 다른 한 사람은 그 사람에게 맡기겠다고 답했어요." },
    ];
    for (const expected of expectedScenes) {
      const scene = comparison!.querySelector(`[data-compared-scene="${expected.key}"]`);
      expect(scene).not.toBeNull();
      const lines = [...scene!.querySelectorAll("p")].map(item => item.textContent);
      const ownIndex = lines.indexOf("나");
      const partnerIndex = lines.indexOf("지은");
      expect(ownIndex).toBeGreaterThanOrEqual(0);
      expect(partnerIndex).toBeGreaterThan(ownIndex);
      expect(lines[ownIndex + 1]).toBe(`“${expected.own}”`);
      expect(lines[partnerIndex + 1]).toBe(`“${expected.partner}”`);
      expect(lines.indexOf(expected.explanation)).toBeGreaterThan(partnerIndex + 1);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("다른 계정의 응답을 정상 결과로 렌더하지 않는다", async () => {
    fetchMock.mockResolvedValueOnce(result(snapshot({ ownerUserId: "44444444-4444-4444-8444-444444444444", own: response })));
    await render();
    expect(container.querySelector("[data-personal-style]")).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("연결 정보가 바뀌었어요");
  });

  it("계정 전환 후 늦게 도착한 이전 결과를 버린다", async () => {
    let finish: ((value: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render();
    fetchMock.mockResolvedValueOnce(result(snapshot({ ownerUserId: partnerId, partnerUserId: owner })));
    await act(async () => useAuthStore.setState({ user: { id: partnerId, email: "next@example.com" }, profile: profile(partnerId), partner: { id: owner, name: "다른 사람", role: null, couple_id: coupleId } }));
    await act(async () => finish!(result(snapshot({ own: response }))));
    expect(container.querySelector("[data-personal-style]")).toBeNull();
    expect(container.textContent).toContain("먼저 내 생각부터 골라 보세요");
  });

  it("전부 건너뛰어도 빠져나올 수 있고 빈 답을 저장하지 않는다", async () => {
    await render(); await click("내 답 고르기");
    for (let index = 0; index < config.questions.length; index++) await click("이 장면은 건너뛸게요");
    expect(container.textContent).toContain("모든 장면을 건너뛰었어요");
    expect(button("동의하고 내 계정에 저장").disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("결과를 지운 뒤 새로 답할 때 삭제 후 확인번호를 보내 이전 요청과 구분한다", async () => {
    fetchMock.mockResolvedValueOnce(result(snapshot({ stateRevision: 5 })));
    await render(); await answerAll();
    fetchMock.mockResolvedValueOnce(result(snapshot({ own: { ...response, revision: 6 } })));
    await click("동의하고 내 계정에 저장");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).expectedRevision).toBe(5);
    expect(container.textContent).toContain("내 답을 저장했어요");
  });

  it("체험에서는 서버에 쓰지 않고 가상의 상대임을 밝힌다", async () => {
    useAuthStore.setState({ isDemo: true });
    await render(); await answerAll(); await click("이 답으로 체험하기");
    await click("둘이 함께 보기"); await click("가상의 상대 답으로 비교해 보기");
    expect(container.querySelector("[data-couple-style]")).not.toBeNull();
    expect(container.textContent).toContain("상대 예시");
    expect(container.textContent).toContain("계정에 저장하거나 실제 상대에게 공유하지 않아요");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("삭제는 확인 후 호출하고 서버가 비웠을 때만 결과를 닫는다", async () => {
    fetchMock.mockResolvedValueOnce(result(snapshot({ own: response })));
    await render(); await click("저장한 답 지우기");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("저장한 답을 지울까요?");
    fetchMock.mockResolvedValueOnce(result(snapshot({ stateRevision: 2 })));
    await click("답과 공유 허가 삭제");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("DELETE");
    expect(container.querySelector("[data-personal-style]")).toBeNull();
    expect(container.textContent).toContain("저장한 답과 공유 허가를 지웠어요");
  });
});
