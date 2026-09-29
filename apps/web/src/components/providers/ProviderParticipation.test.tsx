// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderOffering, ProviderProfile, ProviderWorkspace, PublicProvider } from "@/lib/providers/contracts";
import ProviderApplicationForm from "./ProviderApplicationForm";
import BusinessInquiryForm from "./BusinessInquiryForm";
import ProviderCenter from "./ProviderCenter";
import ProviderDiscovery from "./ProviderDiscovery";
import ProviderMediaManager from "./ProviderMediaManager";
import ProviderProfileEditor from "./ProviderProfileEditor";
import ProviderOfferingWithdrawal from "./ProviderOfferingWithdrawal";
import ProviderOfferingEditor from "./ProviderOfferingEditor";
import { safeProviderWebsite } from "./providerClient";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const providerId = "11111111-1111-4111-8111-111111111111";
const applicationId = "22222222-2222-4222-8222-222222222222";
const profile: ProviderProfile = {
  id: providerId, kind: "individual", name: "테스트 제공자", categories: ["photography"], regions: ["서울"],
  introduction: "활동 소개", website: null, instagram: null, approval_status: "approved", publication_status: "draft",
  version: 2, created_at: "2026-09-28T00:00:00Z", updated_at: "2026-09-28T00:00:00Z",
};
function workspace(current: ProviderProfile): ProviderWorkspace { return { profiles: [current], applications: [], offerings: [], media: [], business_inquiries: [] }; }
function publicProfile(id = providerId, name = "공개 촬영팀"): PublicProvider { return { id, name, kind: "team", categories: ["photography"], regions: ["서울"], introduction: "사진 소개", website: null, instagram: null, updated_at: profile.updated_at, offerings: [], media: [] }; }
function offering(): ProviderOffering { return { id: applicationId, provider_id: providerId, name: "가족 촬영", category: "photography", description: "가족 기록", base_price_krw: 100, price_unit: "1시간", includes: ["촬영"], extra_charges: "없음", conditions: "일정 확인", is_active: true, review_status: "approved", recommendation_status: "eligible", review_reason: null, version: 4, created_at: profile.created_at, updated_at: profile.updated_at }; }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((complete) => { resolve = complete; }); return { promise, resolve }; }

describe("provider participation boundaries", () => {
  let root: Root;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
  async function mount(node: ReactNode) { await act(async () => { root.render(node); await Promise.resolve(); }); }
  async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
  async function fill(selector: string, value: string) {
    const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (!input) throw new Error(`Missing input ${selector}`);
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  async function submit() { await act(async () => { container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }
  async function fillApplication() {
    await fill("#provider-name", "개인 사진가"); await fill("#provider-regions", "서울, 경기"); await fill("#provider-contact", "테스트 담당자"); await fill("#provider-note", "가족식 촬영 서비스 신청");
    await act(async () => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"][required]').forEach((input) => input.click());
    });
  }

  it.each(["pending", "rejected", "suspended"] as const)("does not expose editing or publication controls to %s profiles", async (approval_status) => {
    fetchMock.mockResolvedValue(response(workspace({ ...profile, approval_status })));
    await mount(<ProviderCenter />); await flush();
    expect(container.querySelector("#profile-introduction")).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).not.toContain("프로필 공개하기");
    expect(container.textContent).toContain(approval_status === "suspended" ? "수정하거나 게시할 수 없습니다" : "승인한 뒤");
  });

  it("keeps provider introduction editing separate from publication and passes the expected version", async () => {
    const changed = vi.fn().mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(response({ success: true }));
    await mount(<ProviderProfileEditor profile={profile} onChanged={changed} />);
    await fill("#profile-introduction", "수정한 소개"); await submit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ action: "save", expected_version: 2, introduction: "수정한 소개" });
    expect(body).not.toHaveProperty("publication_status");
    expect(changed).toHaveBeenCalledWith(expect.stringContaining("아직 프로필은 비공개"));
    expect(container.textContent).toContain("프로필 공개하기");
  });

  it("preserves a profile draft and does not claim success after a version conflict", async () => {
    const changed = vi.fn();
    fetchMock.mockResolvedValue(response({ error: "private database detail" }, 409));
    await mount(<ProviderProfileEditor profile={profile} onChanged={changed} />);
    await fill("#profile-introduction", "보존할 초안"); await submit();
    expect(container.querySelector<HTMLTextAreaElement>("#profile-introduction")?.value).toBe("보존할 초안");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("다른 변경");
    expect(container.textContent).not.toContain("private database detail");
    expect(changed).not.toHaveBeenCalled();
  });

  it("requires saving changed introduction before publishing but keeps withdrawal available", async () => {
    await mount(<ProviderProfileEditor profile={profile} onChanged={vi.fn()} />);
    await fill("#profile-introduction", "아직 저장하지 않은 소개");
    const publish = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "프로필 공개하기");
    expect(publish?.disabled).toBe(true);
    expect(container.textContent).toContain("먼저 소개글·링크를 저장");
    await mount(<ProviderProfileEditor key="published" profile={{ ...profile, publication_status: "published" }} onChanged={vi.fn()} />);
    await fill("#profile-introduction", "미저장 변경");
    expect(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "프로필 공개 중단")?.disabled).toBe(false);
  });

  it("lets suspended owners remove stored photos without exposing upload or photo bytes", async () => {
    const current = workspace({ ...profile, approval_status: "suspended", publication_status: "paused" });
    current.media = [{ id: applicationId, provider_id: providerId, caption: "철회할 작업 사진", alt_text: "작업 설명", sort_order: 0 }];
    fetchMock.mockResolvedValueOnce(response(current)).mockResolvedValueOnce(response({ success: true, cleanup_pending: true })).mockResolvedValueOnce(response({ ...current, media: [] }));
    await mount(<ProviderCenter />); await flush();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("철회할 작업 사진");
    const remove = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "사진 삭제");
    expect(remove).toBeDefined();
    await act(async () => { remove?.click(); }); await flush();
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/provider/profiles/${providerId}/media/${applicationId}`);
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
    expect(container.textContent).toContain("사진을 프로필에서 삭제했어요");
  });

  it("lets suspended owners withdraw a service without reopening editing or public access", async () => {
    const current = workspace({ ...profile, approval_status: "suspended", publication_status: "paused" });
    current.offerings = [offering()];
    const withdrawn = { ...offering(), is_active: false, recommendation_status: "blocked" as const, version: 5 };
    fetchMock.mockResolvedValueOnce(response(current)).mockResolvedValueOnce(response(withdrawn)).mockResolvedValueOnce(response({ ...current, offerings: [withdrawn] }));
    await mount(<ProviderCenter />); await flush();
    expect(container.textContent).toContain("등록 서비스 정리");
    expect(container.textContent).not.toContain("서비스 수정·재검토");
    expect(container.querySelector("#profile-introduction")).toBeNull();
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "이 서비스 제공 중단")?.click(); });
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "서비스 제공 중단 확인")?.click(); }); await flush();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: "withdraw", expected_version: 4 });
    expect(container.textContent).toContain("제공 중단 · 기록 보관");
    expect(container.textContent).not.toContain("이 서비스 제공 중단");
  });

  it("preserves an unsaved introduction when a photo removal refreshes the workspace", async () => {
    const current = workspace(profile);
    current.media = [{ id: applicationId, provider_id: providerId, caption: "작업 사진", alt_text: "작업 설명", sort_order: 0 }];
    const refreshed = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response(current)).mockResolvedValueOnce(response({ success: true })).mockReturnValueOnce(refreshed.promise);
    await mount(<ProviderCenter />); await flush();
    await fill("#profile-introduction", "사진 삭제 중에도 보존할 소개");
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "사진 삭제")?.click(); });
    expect(container.querySelector<HTMLTextAreaElement>("#profile-introduction")?.value).toBe("사진 삭제 중에도 보존할 소개");
    await act(async () => { refreshed.resolve(response({ ...current, media: [] })); }); await flush();
    expect(container.querySelector<HTMLTextAreaElement>("#profile-introduction")?.value).toBe("사진 삭제 중에도 보존할 소개");
  });

  it("submits individual applications once and reuses the request id after an uncertain failure", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response({ provider_id: providerId, application_id: applicationId, status: "pending" }));
    await mount(<ProviderApplicationForm />); await fillApplication();
    await submit(); await submit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(first).toMatchObject({ kind: "individual", categories: ["photography"], regions: ["서울", "경기"], consents: { privacy: true, price_transparency: true, extra_charges: true, standard_terms: true } });
    expect(first).not.toHaveProperty("contact_email");
    await act(async () => { pending.resolve(response({ error: "unavailable" }, 503)); });
    expect(container.textContent).not.toContain("참여 신청이 접수됐어요");
    await submit();
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.request_id).toBe(first.request_id);
    expect(container.textContent).toContain("참여 신청이 접수됐어요");
    expect(container.textContent).toContain("아직 공개되거나 추천되지는 않습니다");
  });

  it("does not treat a malformed success response as a completed application", async () => {
    fetchMock.mockResolvedValue(response({ status: "pending" }));
    await mount(<ProviderApplicationForm />); await fillApplication(); await submit();
    expect(container.querySelector("form")).not.toBeNull();
    expect(container.textContent).not.toContain("참여 신청이 접수됐어요");
  });

  it("keeps inquiry retries idempotent and never claims that inquiry submission publishes a profile", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: "unavailable" }, 503)).mockResolvedValueOnce(response({ inquiry_id: applicationId, status: "received" }));
    await mount(<BusinessInquiryForm />);
    await fill("#inquiry-subject", "공간 협업 제안"); await fill("#inquiry-contact", "담당자"); await fill("#inquiry-message", "비즈니스 문의 내용");
    await act(async () => { container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click(); });
    await submit();
    expect(container.querySelector<HTMLTextAreaElement>("#inquiry-message")?.value).toBe("비즈니스 문의 내용");
    await submit();
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(first.request_id).toBe(second.request_id);
    expect(first).not.toHaveProperty("contact_email");
    expect(container.textContent).toContain("비즈니스 문의가 접수됐어요");
    expect(container.textContent).toContain("문의가 공개 프로필로 등록되지는 않습니다");
  });

  it("does not upload a portfolio image without the provider's publication rights confirmation", async () => {
    const changed = vi.fn();
    await mount(<ProviderMediaManager providerId={providerId} media={[]} published={false} onChanged={changed} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("Missing file input");
    await act(async () => {
      Object.defineProperty(input, "files", { configurable: true, value: [new File(["image"], "photo.jpg", { type: "image/jpeg" })] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await fill("#provider-media-alt", "동의받은 사진 설명"); await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("공개 권한 확인");
    expect(changed).not.toHaveBeenCalled();
  });

  it("blocks oversized portfolio images before sending them", async () => {
    await mount(<ProviderMediaManager providerId={providerId} media={[]} published={false} onChanged={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("Missing file input");
    await act(async () => {
      Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "photo.jpg", { type: "image/jpeg" })] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    });
    await fill("#provider-media-alt", "사진 설명"); await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("5MB 이하");
  });

  it("offers an honest empty state without silently widening a category", async () => {
    const publicProfile: PublicProvider = { id: providerId, kind: "individual", name: "테스트 사진가", categories: ["photography"], regions: ["서울"], introduction: "사진 촬영", website: null, instagram: null, updated_at: profile.updated_at, media: [], offerings: [{ id: applicationId, provider_id: providerId, name: "촬영", category: "photography", description: "촬영", base_price_krw: 100, price_unit: "1시간", includes: ["원본"], extra_charges: "확인", conditions: "확인", is_active: true, review_status: "approved", recommendation_status: "unreviewed", updated_at: profile.updated_at }] };
    await mount(<ProviderDiscovery initialPage={{ providers: [publicProfile], next_cursor: null }} />);
    const select = container.querySelector<HTMLSelectElement>("#discovery-category");
    await act(async () => { if (select) { select.value = "venue"; select.dispatchEvent(new Event("change", { bubbles: true })); } });
    fetchMock.mockResolvedValue(response({ providers: [], next_cursor: null }));
    await submit();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/providers?category=venue");
    expect(container.textContent).toContain("지역이나 분야를 자동으로 넓히지 않았어요");
    expect(container.querySelector(`a[href="/providers/${providerId}"]`)).toBeNull();
  });

  it("loads later public profiles and preserves results when the next page fails", async () => {
    const first = publicProfile(); const second = publicProfile(applicationId, "다음 촬영팀");
    await mount(<ProviderDiscovery initialPage={{ providers: [first], next_cursor: providerId }} />);
    fetchMock.mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response({ providers: [first, second], next_cursor: null }));
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "프로필 더 보기")?.click(); });
    expect(container.querySelectorAll("article")).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "다시 불러오기")?.click(); });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([`/api/providers?after=${providerId}`, `/api/providers?after=${providerId}`]);
    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(container.textContent).toContain("다음 촬영팀");
    expect(container.textContent).not.toContain("프로필 더 보기");
  });

  it("searches the whole catalog with explicit conditions and ignores superseded responses", async () => {
    const stale = deferred<Response>();
    fetchMock.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(response({ providers: [publicProfile(applicationId, "최근 검색 결과")], next_cursor: null }));
    await mount(<ProviderDiscovery initialPage={{ providers: [publicProfile()], next_cursor: providerId }} />);
    await fill("#discovery-region", "수원"); await fill("#discovery-query", "오래된 조건"); await submit();
    await fill("#discovery-query", "새 조건"); await submit();
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/providers?${new URLSearchParams({ region: "수원", q: "새 조건" })}`);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { stale.resolve(response({ providers: [publicProfile(providerId, "옛 검색 결과")], next_cursor: null })); });
    expect(container.textContent).toContain("최근 검색 결과");
    expect(container.textContent).not.toContain("옛 검색 결과");
  });

  it("withdraws only the confirmed service version and does not claim malformed success", async () => {
    const changed = vi.fn(); const current = offering();
    fetchMock.mockResolvedValueOnce(response({ success: true })).mockResolvedValueOnce(response({ ...current, is_active: false, recommendation_status: "blocked", version: 5 }));
    await mount(<ProviderOfferingWithdrawal offering={current} onChanged={changed} />);
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "이 서비스 제공 중단")?.click(); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("다른 서비스와 프로필은 유지됩니다");
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "서비스 제공 중단 확인")?.click(); });
    expect(changed).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "서비스 제공 중단 확인")?.click(); });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: "withdraw", expected_version: 4 });
    expect(changed).toHaveBeenCalledWith(expect.stringContaining("공개·추천에서 제외"));
  });

  it("starts a hair-and-makeup-only provider in its approved category and offers no unapproved fields", async () => {
    fetchMock.mockResolvedValue(response(workspace({ ...profile, categories: ["hair_makeup"] })));
    await mount(<ProviderCenter />); await flush();
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "새 서비스 등록")?.click(); });
    const select = container.querySelector<HTMLSelectElement>("#offering-category");
    expect(select?.value).toBe("hair_makeup");
    expect(Array.from(select?.options ?? []).map((option) => option.value)).toEqual(["hair_makeup"]);
  });

  it("retains the approved existing category and requires explicit correction when outside approval scope", async () => {
    const current = { ...offering(), category: "hair_makeup" };
    await mount(<ProviderOfferingEditor providerId={providerId} approvedCategories={["photography", "hair_makeup"]} offering={current} onChanged={vi.fn()} onCancel={vi.fn()} />);
    expect(container.querySelector<HTMLSelectElement>("#offering-category")?.value).toBe("hair_makeup");
    await mount(<ProviderOfferingEditor key="invalid" providerId={providerId} approvedCategories={["photography"]} offering={current} onChanged={vi.fn()} onCancel={vi.fn()} />);
    expect(container.querySelector<HTMLSelectElement>("#offering-category")?.value).toBe("hair_makeup");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("승인된 분야");
  });
});

describe("public provider website boundary", () => {
  it("does not turn scripts or malformed addresses into public links", () => {
    expect(safeProviderWebsite("javascript:alert(1)")).toBeNull();
    expect(safeProviderWebsite("data:text/html,hello")).toBeNull();
    expect(safeProviderWebsite("not a URL")).toBeNull();
    expect(safeProviderWebsite("http://example.com/portfolio")).toBeNull();
    expect(safeProviderWebsite("https://account:secret@example.com/portfolio")).toBeNull();
    expect(safeProviderWebsite("https://example.com/portfolio")).toBe("https://example.com/portfolio");
  });
});
