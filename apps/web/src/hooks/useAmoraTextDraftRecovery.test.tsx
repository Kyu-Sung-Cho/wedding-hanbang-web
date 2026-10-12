import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAmoraTextDraftRecovery } from "./useAmoraTextDraftRecovery";
import { clearAmoraTextDraftRecovery } from "@/lib/chat/textDraftRecoveryStorage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const KEY = "hanbang:amora-text-drafts:v1:conversation";
const UUID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
type Draft = { input: string; attachments: unknown[]; retryClientRequestId: string | null; preparation?: unknown };
function Harness({ owner = "actor:couple:bride", partnerId = "partner", files = false, retry = false, prepared = false }: { owner?: string | null; partnerId?: string | null; files?: boolean; retry?: boolean; prepared?: boolean }) {
  const empty = (): Draft => ({ input: "", attachments: files ? ["file-bytes"] : [], retryClientRequestId: retry ? UUID : null, preparation: prepared ? { source: "public-source" } : null });
  const [drafts, setDrafts] = useState({ shared_ai: empty(), shared_partner: empty(), private_ai: empty() });
  useAmoraTextDraftRecovery({ surface: "conversation", owner, partnerId, enabled: true, drafts, setDrafts });
  return <>{(["shared_ai", "shared_partner", "private_ai"] as const).map(lane => <textarea key={lane} aria-label={lane} value={drafts[lane].input} onChange={event => setDrafts(current => ({ ...current, [lane]: { ...current[lane], input: event.target.value } }))} />)}<output>{drafts.private_ai.retryClientRequestId}</output></>;
}
describe("tab-local text recovery privacy and retries", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => { sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
  const mount = async (props: React.ComponentProps<typeof Harness> = {}) => act(async () => root.render(<Harness {...props} />));
  const type = async (text: string, lane = "private_ai") => act(async () => {
    const input = host.querySelector(`textarea[aria-label="${lane}"]`);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, text);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const remount = async (props: React.ComponentProps<typeof Harness> = {}) => { await act(async () => root.unmount()); root = createRoot(host); await mount(props); };
  it("restores text-only unknown retry with the same key and never creates a request", async () => {
    await mount({ retry: true }); await type("결과를 다시 확인할 글"); await remount();
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="private_ai"]')?.value).toBe("결과를 다시 확인할 글");
    expect(host.querySelector("output")?.textContent).toBe(UUID);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  it.each([{ owner: "other:couple:bride" }, { owner: "actor:other-couple:bride" }, { owner: "actor:couple:groom" }])("does not recover another identity or revive it after returning: %j", async props => {
    await mount(); await type("다른 계정에는 없는 글"); await remount(props); await remount();
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="private_ai"]')?.value).toBe("");
  });
  it("does not recover a message for a changed partner", async () => {
    await mount(); await type("이전 상대에게", "shared_partner"); await remount({ partnerId: "new-partner" });
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="shared_partner"]')?.value).toBe("");
  });
  it.each([{ files: true }, { prepared: true }])("never serializes a partial attachment or preparation request: %j", async props => {
    await mount(props); await type("첨부와 함께 보내려던 글");
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
  it.each([
    "결혼식 준비하다가 신랑이 저한테 발길질을 했어요.",
    "신랑이 나한테 발길질을 했는데 도와줘.",
    "신랑이 제 손목을 잡아서 못 나가게 했어요.",
    "신랑이 저를 죽여버린대요 너무 무서워요.",
  ])("does not persist or restore a safety hold source: %s", async input => {
    await mount(); await type(input);
    expect(sessionStorage.getItem(KEY)).toBeNull();
    await remount();
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="private_ai"]')?.value).toBe("");
  });
  it.each(["expired", "future", "corrupt"])('rejects %s data', async kind => {
    await mount(); await type("복구 대상");
    const value = JSON.parse(sessionStorage.getItem(KEY)!);
    value.savedAt = kind === "future" ? Date.now() + 60000 : Date.now() - 31 * 60000;
    sessionStorage.setItem(KEY, kind === "corrupt" ? "{" : JSON.stringify(value));
    await remount();
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="private_ai"]')?.value).toBe("");
  });
  it("deletes the recovery copy when the text is cleared", async () => {
    await mount(); await type("미전송 글"); await type(""); await remount();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
  it("does not extend an idle draft's recovery lifetime just because the page is hidden", async () => {
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);
    await mount(); await type("작성한 뒤 그대로인 글");
    vi.mocked(Date.now).mockReturnValue(start + 31 * 60000);
    window.dispatchEvent(new Event("pagehide"));
    await remount();
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="private_ai"]')?.value).toBe("");
  });
  it("cannot resurrect a cleared account's copy before React cleans up its pagehide listener", async () => {
    await mount(); await type("로그아웃 전에 쓰던 글");
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
    clearAmoraTextDraftRecovery();
    window.dispatchEvent(new Event("pagehide"));
    expect(sessionStorage.getItem(KEY)).toBeNull();
    await type("아직 정리되지 않은 이전 화면");
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
  it("cannot re-arm an old account writer through a partner dependency change after clear", async () => {
    await mount(); await type("계정 종료 전에 쓰던 글");
    clearAmoraTextDraftRecovery();
    await mount({ partnerId: "new-partner" });
    window.dispatchEvent(new Event("pagehide"));
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
  it("does not renew a private draft's lifetime when another lane changes", async () => {
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);
    await mount(); await type("이전 개인 초안");
    vi.mocked(Date.now).mockReturnValue(start + 29 * 60000);
    await type("새 공유 초안", "shared_ai");
    vi.mocked(Date.now).mockReturnValue(start + 31 * 60000);
    await remount();
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="private_ai"]')?.value).toBe("");
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="shared_ai"]')?.value).toBe("새 공유 초안");
  });
  it("continues editing when browser storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disabled"); });
    await mount(); await type("저장소가 막혀도 작성 가능");
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="private_ai"]')?.value).toBe("저장소가 막혀도 작성 가능");
  });
});
