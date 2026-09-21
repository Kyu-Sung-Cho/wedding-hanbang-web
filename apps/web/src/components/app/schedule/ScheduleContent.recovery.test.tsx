import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ScheduleContent from "./ScheduleContent";
import { useAuthStore } from "@/stores/authStore";
import type { WeddingJourney } from "@/types/database.types";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => ({ get: () => null }), usePathname: () => "/schedule" }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const USER = "11111111-1111-4111-8111-111111111111";
const COUPLE_A = "22222222-2222-4222-8222-222222222222";
const COUPLE_B = "33333333-3333-4333-8333-333333333333";
const timestamp = "2026-09-20T00:00:00.000Z";
let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();

function bind(coupleId = COUPLE_A, progress: WeddingJourney["progress"] = {}, revision = 0) {
  useAuthStore.setState({ user: { id: USER, email: "synthetic@example.invalid" }, profile: { id: USER, name: "합성 사용자", role: "bride", couple_id: coupleId, avatar_url: null, onboarding_completed: true, onboarding_step: 5, is_admin: false, created_at: timestamp, updated_at: timestamp }, couple: { id: coupleId, bride_id: USER, groom_id: null, invite_code: null, membership_sealed_at: null, created_at: timestamp, updated_at: timestamp }, partner: null, isDemo: false, isLoading: false, isInitialized: true, journey: { id: coupleId, couple_id: coupleId, wedding_date: null, venue: null, total_budget: 10000000, progress, state_revision: revision, created_at: timestamp, updated_at: timestamp } });
}
function button(text: string) {
  const scope = text === "추가" ? host.querySelector('[role="dialog"]') ?? host : host;
  const found = [...scope.querySelectorAll("button")].find(el => el.textContent?.trim() === text);
  if (!found) throw new Error(`button missing: ${text}`);
  return found;
}
async function setInput(id: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(`#${id}`);
    if (!input) throw new Error(`input missing: ${id}`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function openForm() {
  await act(async () => root.render(<ScheduleContent />));
  await act(async () => button("일정 추가").click());
  await setInput("schedule-title", "이전 준비 공간의 일정 초안");
  await setInput("schedule-date", "2027-05-20");
}
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); useAuthStore.getState().reset(); bind();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

it("retries an unknown schedule creation with exactly the original event and revision after refresh", async () => {
  await openForm();
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await act(async () => button("추가").click());
  const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
  const saved = { ...useAuthStore.getState().journey!, progress: firstBody.progress_patch, state_revision: 1 };
  fetchMock.mockResolvedValueOnce(Response.json({ ...useAuthStore.getState(), journey: saved }));
  await act(async () => { await useAuthStore.getState().refreshJourney(USER); });
  expect(host.querySelector<HTMLInputElement>("#schedule-title")?.matches(":disabled")).toBe(true);
  fetchMock.mockResolvedValueOnce(Response.json({ status: "applied", requestId: "44444444-4444-4444-8444-444444444444", journey: saved }));
  await act(async () => button("저장 결과 다시 확인").click());
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual(firstBody);
  expect(host.querySelector("#schedule-title")).toBeNull();
  expect((useAuthStore.getState().journey?.progress as Record<string, unknown>).__events).toHaveLength(1);
});

it("allows closing an unknown save and never submits a reopened draft before resolving it", async () => {
  await openForm();
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await act(async () => button("추가").click());
  const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="일정 창 닫기"]')!.click());
  expect(host.querySelector("#schedule-title")).toBeNull();
  expect(host.textContent).toContain("이미 저장됐을 수 있어요");
  await act(async () => button("일정 추가").click());
  await setInput("schedule-title", "새로운 두 번째 초안"); await setInput("schedule-date", "2027-05-21");
  fetchMock.mockResolvedValueOnce(Response.json({ status: "applied", requestId: "44444444-4444-4444-8444-444444444444", journey: { ...useAuthStore.getState().journey, progress: firstBody.progress_patch, state_revision: 1 } }));
  await act(async () => button("추가").click());
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(firstBody);
  expect(host.textContent).toContain("이번에 입력한 변경은 아직 보내지 않았어요");
  expect(host.querySelector<HTMLInputElement>("#schedule-title")?.value).toBe("새로운 두 번째 초안");
});

it("purges an A-to-B-to-A draft even when React renders only after both transitions", async () => {
  await openForm();
  await act(async () => { bind(COUPLE_B); bind(COUPLE_A); });
  expect(host.querySelector("#schedule-title")).toBeNull();
});

it("keeps the normal current-owner save and prevents synchronous double-submit", async () => {
  await openForm();
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  await act(async () => { const submit = button("추가"); submit.click(); submit.click(); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  await act(async () => finish(Response.json({ status: "applied", requestId: "44444444-4444-4444-8444-444444444444", journey: { ...useAuthStore.getState().journey, progress: body.progress_patch, state_revision: 1 } })));
  expect(host.querySelector("#schedule-title")).toBeNull();
});

it("cannot close a new form with a response from an unmounted schedule screen", async () => {
  await openForm();
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  await act(async () => button("추가").click());
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  await act(async () => root.render(null));
  await openForm();
  await setInput("schedule-title", "새 화면의 전송하지 않은 초안");
  await act(async () => finish(Response.json({ status: "applied", requestId: "44444444-4444-4444-8444-444444444444", journey: { ...useAuthStore.getState().journey, progress: body.progress_patch, state_revision: 1 } })));
  expect(host.querySelector<HTMLInputElement>("#schedule-title")?.value).toBe("새 화면의 전송하지 않은 초안");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("describes a demo edit as local-only instead of claiming a real save", async () => {
  useAuthStore.setState({ isDemo: true });
  await openForm();
  await act(async () => button("추가").click());
  expect(host.textContent).toContain("체험 화면에 반영했어요. 실제로 저장되지는 않아요.");
  expect(host.textContent).not.toContain("일정 변경을 저장했어요.");
  expect(fetchMock).not.toHaveBeenCalled();
});
afterEach(async () => {
  await act(async () => root.unmount()); document.body.replaceChildren();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("discards an open schedule draft when a canonical refresh changes the same user's couple", async () => {
  await openForm();
  const original = useAuthStore.getState();
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ user: original.user,
    profile: { ...original.profile, couple_id: COUPLE_B }, couple: { ...original.couple, id: COUPLE_B }, partner: null,
    journey: { ...original.journey, id: COUPLE_B, couple_id: COUPLE_B } })));
  await act(async () => { expect(await useAuthStore.getState().refreshJourney(USER)).toBe(true); });
  expect(host.querySelector("#schedule-title")).toBeNull();
  await act(async () => button("일정 추가").click());
  expect(host.querySelector<HTMLInputElement>("#schedule-title")?.value).toBe("");
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/journey")).toHaveLength(0);
});
