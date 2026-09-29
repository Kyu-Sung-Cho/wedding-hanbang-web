// @vitest-environment jsdom

import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProviderParticipationQueue from "./ProviderParticipationQueue";
import type { ProviderAdminPage } from "@/lib/providers/contracts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a {...props} href={href}>{children}</a>
  ),
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const APPLICATION_ID = "22222222-2222-4222-8222-222222222222";
const OFFERING_ID = "33333333-3333-4333-8333-333333333333";
const INQUIRY_ID = "44444444-4444-4444-8444-444444444444";
const timestamp = "2026-09-28T12:00:00.000Z";

function workspace(): ProviderAdminPage {
  return {
    next_cursor: null,
    profiles: [{
      id: PROFILE_ID, kind: "team", name: "작은 촬영팀", categories: ["photography"], regions: ["서울"],
      introduction: "두 사람이 기록합니다.", website: null, instagram: null,
      approval_status: "approved", publication_status: "draft", version: 3,
      created_at: timestamp, updated_at: timestamp,
    }],
    applications: [{
      id: APPLICATION_ID, provider_id: PROFILE_ID, kind: "team", name: "작은 촬영팀", categories: ["photography"],
      regions: ["서울"], contact_name: "담당 작가", contact_email: "team@example.test",
      application_note: "가족 식사 촬영을 합니다.", status: "pending", review_reason: null,
      version: 2, created_at: timestamp, updated_at: timestamp,
    }],
    offerings: [{
      id: OFFERING_ID, provider_id: PROFILE_ID, name: "가족 식사 촬영", category: "photography",
      description: "식사 전후 두 시간 촬영", base_price_krw: 400000, price_unit: "2시간", includes: ["원본", "보정 10장"],
      is_active: true, extra_charges: "서울 외 출장비 별도", conditions: "일정은 문의로 확인합니다.", review_status: "pending",
      recommendation_status: "unreviewed", review_reason: null, version: 4, created_at: timestamp, updated_at: timestamp,
    }],
    media: [],
    business_inquiries: [{
      id: INQUIRY_ID, kind: "collaboration", subject: "전시 공간 협업 문의", message: "가족 전시를 함께 준비하고 싶습니다.",
      contact_name: "공간 담당자", contact_email: "space@example.test", status: "received", reply: null,
      version: 1, created_at: timestamp, updated_at: timestamp,
    }],
  };
}

function findButton(container: HTMLElement, text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === text);
}

function changeTextarea(textarea: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ProviderParticipationQueue", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  async function renderQueue() {
    await act(async () => root.render(<ProviderParticipationQueue />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("does not load participation data before admin authorization succeeds", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(
      async () => jsonResponse({ isAdmin: false }, 401),
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/auth");
    expect(container.textContent).toContain("관리자 로그인이 필요합니다");
    expect(container.querySelector('a[href="/admin/login"]')).not.toBeNull();
    expect(container.querySelector('a[href="/provider"]')).toBeNull();
  });

  it("offers consent recovery after a provider 403 and rechecks admin access before reloading", async () => {
    let consentRecorded = false;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      if (String(input) === "/api/admin/auth") return jsonResponse({ isAdmin: true });
      return consentRecorded ? jsonResponse(workspace()) : jsonResponse({ code: "CONSENT_REQUIRED" }, 403);
    }));
    await renderQueue();
    const recovery = container.querySelector<HTMLAnchorElement>('a[href="/provider"]');
    expect(recovery?.target).toBe("_blank"); expect(recovery?.rel).toContain("noopener");
    expect(container.textContent).toContain("새 탭에서 계정 동의를 확인한 뒤");
    expect(container.querySelector('[aria-label="접수 목록"]')).toBeNull();
    consentRecorded = true;
    await act(async () => findButton(container, "권한·목록 다시 확인")?.click());
    expect(calls).toEqual(["/api/admin/auth", "/api/admin/providers?kind=inquiries&status=all", "/api/admin/auth", "/api/admin/providers?kind=inquiries&status=all"]);
    expect(container.querySelector('a[href="/provider"]')).toBeNull();
    expect(container.textContent).toContain("전시 공간 협업 문의");
  });

  function mockWorkspace(data = workspace(), patchResponse = jsonResponse({ success: true })) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/admin/auth") return jsonResponse({ isAdmin: true });
      if (init?.method === "PATCH") return patchResponse;
      return jsonResponse(data);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function selectDetail(tab: string, rowLabel: string) {
    await act(async () => findButton(container, tab)?.click());
    const row = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="접수 목록"] button')]
      .find((button) => button.textContent?.includes(rowLabel));
    await act(async () => row?.click());
  }

  async function writeReason() {
    const textarea = container.querySelector<HTMLTextAreaElement>("#provider-review-reason");
    expect(textarea).not.toBeNull();
    await act(async () => {
      if (textarea) changeTextarea(textarea, "책임 주체와 제출 조건을 직접 확인했습니다.");
    });
  }

  it("keeps inquiry, application, publication and recommendation states distinct", async () => {
    mockWorkspace();
    await renderQueue();

    expect(container.textContent).toContain("전체 접수 기록에서 찾습니다");
    await selectDetail("비즈니스 문의", "전시 공간 협업 문의");
    expect(container.textContent).toContain("가족 전시를 함께 준비하고 싶습니다.");

    await selectDetail("등록 심사", "작은 촬영팀");
    expect(container.textContent).toContain("소개·사진 관리 권한만 부여");
    expect(container.textContent).toContain("공개 시작은 제공자가 선택");
    expect(container.textContent).toContain("비공개");

    await selectDetail("서비스 검토", "가족 식사 촬영");
    expect(container.textContent).toContain("제공자 공개 가격");
    expect(container.textContent).toContain("400,000원 / 2시간");
    expect(container.textContent).toContain("서울 외 출장비 별도");
    expect(container.textContent).toContain("미검토");
  });

  it("requires a reason and final confirmation before approving the reviewed application version", async () => {
    const fetchMock = mockWorkspace();
    await renderQueue();
    await selectDetail("등록 심사", "작은 촬영팀");

    await act(async () => findButton(container, "등록 승인")?.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("3자 이상");
    expect(findButton(container, "등록 승인 확정")).toBeUndefined();

    await writeReason();
    await act(async () => findButton(container, "등록 승인")?.click());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
    await act(async () => findButton(container, "등록 승인 확정")?.click());

    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patch?.[0]).toBe(`/api/admin/providers/${APPLICATION_ID}`);
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      kind: "application", action: "approve", expected_version: 2,
      reason: "책임 주체와 제출 조건을 직접 확인했습니다.",
    });
    expect(container.querySelector('[role="status"]')?.textContent)
      .toContain("공개 시작과 서비스·추천 자격 승인은 별도");
    expect(fetchMock.mock.calls.filter(([input]) => input === "/api/admin/providers?kind=applications&status=all")).toHaveLength(2);
  });

  it("leaves recommendation unreviewed when only approving a service", async () => {
    const fetchMock = mockWorkspace();
    await renderQueue();
    await selectDetail("서비스 검토", "가족 식사 촬영");
    await writeReason();
    await act(async () => findButton(container, "서비스 승인")?.click());
    await act(async () => findButton(container, "서비스 승인 확정")?.click());

    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({
      kind: "offering", action: "approve", expected_version: 4, recommendation_status: "unreviewed",
    });
  });

  it("requires an explicit recommendation review selection for eligibility", async () => {
    const fetchMock = mockWorkspace();
    await renderQueue();
    await selectDetail("서비스 검토", "가족 식사 촬영");
    await writeReason();
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => checkbox?.click());
    await act(async () => findButton(container, "서비스 승인")?.click());
    await act(async () => findButton(container, "서비스 승인 확정")?.click());

    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({ recommendation_status: "eligible" });
  });

  it("blocks stale review retries until refreshing after a version conflict", async () => {
    const fetchMock = mockWorkspace(workspace(), jsonResponse({ error: "changed", code: "version_conflict" }, 409));
    await renderQueue();
    await selectDetail("등록 심사", "작은 촬영팀");
    await writeReason();
    await act(async () => findButton(container, "등록 반려")?.click());
    await act(async () => findButton(container, "등록 반려 확정")?.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("최신 내용을 다시 검토");
    expect(findButton(container, "등록 승인")?.disabled).toBe(true);
    expect(findButton(container, "등록 반려")?.disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    await act(async () => findButton(container, "목록 새로고침")?.click());
    expect(findButton(container, "등록 승인")?.disabled).toBe(false);
  });

  it("does not show success for an unverified mutation response", async () => {
    mockWorkspace(workspace(), jsonResponse({ ok: true }));
    await renderQueue();
    await selectDetail("등록 심사", "작은 촬영팀");
    await writeReason();
    await act(async () => findButton(container, "등록 승인")?.click());
    await act(async () => findButton(container, "등록 승인 확정")?.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("처리 결과를 확인하지 못했습니다");
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(findButton(container, "등록 승인")?.disabled).toBe(true);
  });

  it("records an inquiry reply in the applicant center without claiming email delivery", async () => {
    const fetchMock = mockWorkspace();
    await renderQueue();
    await selectDetail("비즈니스 문의", "전시 공간 협업 문의");
    const textarea = container.querySelector<HTMLTextAreaElement>("#provider-inquiry-reply");
    await act(async () => {
      if (textarea) changeTextarea(textarea, "외부 촬영과 식사 허용 조건을 알려 주세요.");
    });
    await act(async () => findButton(container, "답변 등록")?.click());
    await act(async () => findButton(container, "답변 등록 확정")?.click());

    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      kind: "inquiry", action: "responded", expected_version: 1, reply: "외부 촬영과 식사 허용 조건을 알려 주세요.",
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("신청자 센터에 등록");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("이메일 발송을 뜻하지 않습니다");
  });

  it("restores a suspended provider separately from application approval", async () => {
    const data = workspace();
    data.profiles[0].approval_status = "suspended";
    const fetchMock = mockWorkspace(data);
    await renderQueue();
    await selectDetail("등록 심사", "작은 촬영팀");
    expect(findButton(container, "등록 승인")?.disabled).toBe(true);
    expect(container.textContent).toContain("복구해도 자동 게시되지 않습니다");
    await writeReason();
    await act(async () => findButton(container, "제공자 복구")?.click());
    await act(async () => findButton(container, "제공자 복구 확정")?.click());

    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patch?.[0]).toBe(`/api/admin/providers/${PROFILE_ID}`);
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({ kind: "profile", action: "restore", expected_version: 3 });
  });

  it("fails closed on a malformed workspace", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => (
      String(input) === "/api/admin/auth" ? jsonResponse({ isAdmin: true }) : jsonResponse({ applications: [] })
    )));
    await renderQueue();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("안전하게 확인하지 못했습니다");
    expect(container.querySelector('[aria-label="접수 목록"]')).toBeNull();
  });

  it("loads older queue pages, retains the first page after a failure, and resets the cursor for another status", async () => {
    const first = workspace(); first.next_cursor = INQUIRY_ID;
    const second = workspace(); second.business_inquiries = [{ ...second.business_inquiries[0], id: APPLICATION_ID, subject: "이전 접수 문의" }];
    let failed = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/admin/auth") return jsonResponse({ isAdmin: true });
      if (path.includes("after=")) { if (!failed) { failed = true; return jsonResponse({}, 503); } return jsonResponse(second); }
      return jsonResponse(first);
    });
    vi.stubGlobal("fetch", fetchMock);
    await renderQueue();
    await act(async () => findButton(container, "접수 더 보기")?.click());
    expect(container.textContent).toContain("전시 공간 협업 문의");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => findButton(container, "다시 불러오기")?.click());
    expect(container.textContent).toContain("이전 접수 문의");
    expect(container.querySelectorAll('[aria-label="접수 목록"] li')).toHaveLength(2);
    const filter = container.querySelector("select");
    await act(async () => { if (filter) { filter.value = "received"; filter.dispatchEvent(new Event("change", { bubbles: true })); } });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/admin/providers?kind=inquiries&status=received");
    expect(container.textContent).not.toContain("이전 접수 문의");
  });

  it("keeps withdrawn offerings out of administrative approval actions", async () => {
    const data = workspace(); data.offerings[0].is_active = false;
    mockWorkspace(data);
    await renderQueue(); await selectDetail("서비스 검토", "가족 식사 촬영");
    expect(container.textContent).toContain("재제출 전까지 검토·승인할 수 없으며");
    expect(findButton(container, "서비스 승인")).toBeUndefined();
    expect(findButton(container, "서비스 반려")).toBeUndefined();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("does not interpret an authorization network error as an empty queue", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network failed");
    }));

    await renderQueue();

    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("관리자 권한을 확인하지 못했습니다");
    expect(container.textContent).not.toContain("접수된 문의가 없습니다");
  });
});
