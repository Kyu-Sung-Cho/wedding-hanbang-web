import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileWeddingRoleEditor from "./ProfileWeddingRoleEditor";
import { useAuthStore } from "@/stores/authStore";
import type { Profile } from "@/types/database.types";
const OWNER = "11111111-1111-4111-8111-111111111111";
const REV = "33333333-3333-4333-8333-333333333333";
const profile: Profile = { id: OWNER, name: "테스트", role: "bride", confirmed_role: null, couple_id: null, avatar_url: "🌷",
  onboarding_completed: true, onboarding_step: 5, is_admin: false, created_at: "", updated_at: "" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
describe("explicit wedding role editor", () => {
  let root: Root; let container: HTMLDivElement; let original: ReturnType<typeof useAuthStore.getState>;
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); original = useAuthStore.getState();
    useAuthStore.setState({ user: { id: OWNER, email: "test@example.invalid" }, profile: { ...profile }, isDemo: false });
    fetchMock.mockReset().mockImplementation(async (_input, init) => response({ user_id: OWNER, confirmed_role: init?.method === "PUT" ? "groom" : null, revision: init?.method === "PUT" ? REV : null }));
    vi.stubGlobal("fetch", fetchMock); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); useAuthStore.setState(original); vi.unstubAllGlobals(); });
  function button(label: string) { const result = [...container.querySelectorAll("button")].find(node => node.textContent === label); if (!result) throw new Error(label); return result; }
  async function click(label: string) { await act(async () => { button(label).click(); }); }
  async function render() { await act(async () => root.render(<ProfileWeddingRoleEditor />)); }
  const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
  it("never infers confirmed role from the old bride slot and does not save selection or cancellation", async () => {
    await render(); expect(button("미선택").getAttribute("aria-pressed")).toBe("true");
    await click("신랑"); await click("취소"); expect(writes()).toHaveLength(0);
    expect(useAuthStore.getState().profile?.confirmed_role).toBeNull();
  });
  it("saves only explicit role and preserves concurrent avatar/name and old authorization slot", async () => {
    await render(); await click("신랑");
    await act(async () => useAuthStore.setState({ profile: { ...profile, name: "새 이름", avatar_url: "🌸" } }));
    await click("역할 저장");
    expect(JSON.parse(writes()[0][1]?.body as string)).toEqual({ confirmed_role: "groom", expected_revision: null, expected_user_id: OWNER });
    expect(useAuthStore.getState().profile).toMatchObject({ confirmed_role: "groom", role: "bride", avatar_url: "🌸", name: "새 이름" });
    expect(container.textContent).toContain("역할을 저장했어요.");
  });
  it("recovers a verified persisted role after optional authentication projection was unavailable", async () => {
    useAuthStore.setState({ profile: { ...profile, confirmed_role: undefined } });
    fetchMock.mockResolvedValue(response({ user_id: OWNER, confirmed_role: "groom", revision: REV }));
    await render();
    expect(useAuthStore.getState().profile).toMatchObject({ confirmed_role: "groom", role: "bride", avatar_url: "🌷" });
    expect(button("신랑").getAttribute("aria-pressed")).toBe("true"); expect(writes()).toHaveLength(0);
  });
  it.each([{ user_id: OWNER, confirmed_role: "bride" }, { user_id: "other", confirmed_role: "groom" }, {}])("rejects malformed or different successful responses: %j", async payload => {
    fetchMock.mockImplementation(async (_input, init) => response(init?.method === "PUT" ? payload : { user_id: OWNER, confirmed_role: null, revision: null }));
    await render(); await click("신랑"); await click("역할 저장");
    expect(useAuthStore.getState().profile?.confirmed_role).toBeNull(); expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("ignores a delayed response after account switch and sends only one pending save", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementation(async (_input, init) => init?.method === "PUT" ? new Promise(resolve => { finish = resolve; }) : response({ user_id: OWNER, confirmed_role: null, revision: null }));
    await render(); await click("신랑"); await click("역할 저장"); await click("저장 중…"); expect(writes()).toHaveLength(1);
    const other = { ...profile, id: "other", confirmed_role: "bride" as const };
    await act(async () => useAuthStore.setState({ user: { id: "other", email: "other@example.invalid" }, profile: other }));
    await act(async () => finish(response({ user_id: OWNER, confirmed_role: "groom", revision: REV })));
    expect(useAuthStore.getState().profile).toEqual(other); expect(container.textContent).not.toContain("역할을 저장했어요.");
  });
  it("blocks writes after lookup failure and makes demo choices only in local state", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: "unavailable" }, 503)); await render();
    expect(container.querySelector('[aria-label="나의 역할 선택"]')).toBeNull(); expect(writes()).toHaveLength(0);
    await act(async () => useAuthStore.setState({ isDemo: true })); await click("신랑"); await click("역할 저장");
    expect(writes()).toHaveLength(0); expect(container.textContent).toContain("체험 화면에 적용했어요.");
  });
  it("sends the displayed baseline revision and requires reload after another tab changed it", async () => {
    fetchMock.mockImplementation(async (_input,init)=> init?.method==="PUT" ? response({code:"PROFILE_ROLE_CONFLICT"},409) : response({user_id:OWNER,confirmed_role:"bride",revision:REV}));
    await render(); await click("신랑"); await click("역할 저장");
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({confirmed_role:"groom",expected_revision:REV,expected_user_id:OWNER});
    expect(container.querySelector('[aria-label="나의 역할 선택"]')).toBeNull();
    expect(useAuthStore.getState().profile?.confirmed_role).toBe("bride"); expect(writes()).toHaveLength(1);
    fetchMock.mockResolvedValue(response({user_id:OWNER,confirmed_role:"groom",revision:"44444444-4444-4444-8444-444444444444"}));
    await click("역할 다시 불러오기"); expect(button("신랑").getAttribute("aria-pressed")).toBe("true"); expect(writes()).toHaveLength(1);
  });
  it("does not overwrite a newer confirmed choice with a delayed successful PUT",async()=>{
    let finish!:(value:Response)=>void;
    fetchMock.mockImplementation(async (_input,init)=>init?.method==="PUT"?new Promise(resolve=>{finish=resolve;}):response({user_id:OWNER,confirmed_role:null,revision:null}));
    await render(); await click("신랑"); await click("역할 저장");
    const newer={...profile,confirmed_role:"bride" as const,confirmed_role_revision:"44444444-4444-4444-8444-444444444444"};
    await act(async()=>useAuthStore.setState({profile:newer}));
    await act(async()=>finish(response({user_id:OWNER,confirmed_role:"groom",revision:REV})));
    expect(useAuthStore.getState().profile).toEqual(newer); expect(container.textContent).not.toContain("역할을 저장했어요.");
  });
  it("ignores the cancelled StrictMode lookup without sending or restoring its older value",async()=>{
    let finish!:(value:Response)=>void;
    fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(response({user_id:OWNER,confirmed_role:"groom",revision:REV}));
    await act(async()=>root.render(<StrictMode><ProfileWeddingRoleEditor/></StrictMode>));
    await act(async()=>finish(response({user_id:OWNER,confirmed_role:null,revision:null})));
    expect(button("신랑").getAttribute("aria-pressed")).toBe("true");expect(useAuthStore.getState().profile?.confirmed_role_revision).toBe(REV);expect(writes()).toHaveLength(0);
  });
});
