import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmission, presentComparison, type Submission } from "@/lib/weddingCode36";
import { clearResult36, readResult36, storeResult36 } from "../storage36";
import Result36Client from "../result/Result36Client";

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const id = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function preferences(): Submission {
  const value = createSubmission(3, { comparison: true, shareAlias: true });
  for (const item of ["B1", "B2", "B3", "P1", "P2", "P3"]) value.answers[item] = 5;
  return value;
}
function ready() {
  return { status: "ready", viewer: "a", report: presentComparison(preferences(), createSubmission(3, { comparison: true, shareAlias: true })) };
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
let container: HTMLDivElement;
let root: Root | null;
async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<Result36Client />);
  });
}
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(element => element.textContent?.includes(label));
  if (!found) throw new Error("Missing button: " + label);
  return found;
}
function savePersonal() {
  storeResult36({ id: id(1), accessToken: id(101), submission: preferences(), pairingStatus: "unpaired", coupleToken: null, savedAt: "2026-10-15T00:00:00.000Z" });
}

describe("36-question result client asynchronous and privacy boundaries", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.localStorage.clear(); window.sessionStorage.clear();
    clearResult36(id(1)); clearResult36(id(2));
    window.history.replaceState(null, "", `/wedding-code/result?v=36&rid=${id(1)}`);
    container = document.createElement("div"); document.body.appendChild(container); root = null;
    savePersonal();
  });
  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it("renders the adjective and animal name before explanatory material and preserves own result access privately", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ status: "unpaired" }));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    expect(container.querySelector("h1")?.textContent).toBe("단단한 비버");
    expect(container.querySelector('[data-testid="wc36-result-name"]')).toBe(container.querySelector("h1"));
    expect(container.textContent).toContain("내 준비 기준 자세히 보기");
    expect(window.location.search).not.toContain(id(101));
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ "x-wedding-code-access-token": id(101) });
  });

  it("rejects a deeply invalid ready payload instead of rendering invented evidence", async () => {
    const payload = ready();
    payload.report.body.core_cards[0].evidence[0].a = 99;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(json(payload)));
    await mount();
    expect(container.querySelector('[data-testid="wc36-couple-result"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("확인하지 못했어요");
    expect(container.textContent).not.toContain("99점");
    expect(container.querySelector("h1")?.textContent).toBe("단단한 비버");
  });

  it("ignores an old pending refresh and leaves retry usable when a sharing update fails", async () => {
    const oldRefresh = deferred();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (init?.method === "PATCH") return Promise.resolve(json({ error: "공유 설정을 저장하지 못했어요. 다시 시도해 주세요." }, 503));
      return oldRefresh.promise;
    });
    vi.stubGlobal("fetch", fetcher);
    await mount();
    expect(button("상태 다시 확인").disabled).toBe(true);
    await act(async () => { button("공유 설정 저장").click(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("공유 설정을 저장하지 못했어요");
    expect(button("상태 다시 확인").disabled).toBe(false);
    await act(async () => { oldRefresh.resolve(json(ready())); });
    expect(container.querySelector('[data-testid="wc36-couple-result"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("공유 설정을 저장하지 못했어요");
    expect(button("공유 설정 저장").disabled).toBe(false);
  });

  it("does not let an old response restore shared evidence after consent withdrawal", async () => {
    const oldRefresh = deferred();
    let reads = 0;
    const withdrawn = { ...preferences(), allow_couple_comparison: false };
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (init?.method === "PATCH") return Promise.resolve(json({ success: true, submission: withdrawn }));
      reads++;
      return reads === 1 ? oldRefresh.promise : Promise.resolve(json({ status: "ready", viewer: "a", report: presentComparison(withdrawn, createSubmission(3, { comparison: true, shareAlias: true })) }));
    });
    vi.stubGlobal("fetch", fetcher);
    await mount();
    const allow = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(allow?.checked).toBe(true);
    await act(async () => { allow?.click(); });
    await act(async () => { button("공유 설정 저장").click(); });
    expect(container.querySelector('[data-testid="wc36-couple-result"]')?.textContent).not.toContain("파트너 답");
    await act(async () => { oldRefresh.resolve(json(ready())); });
    expect(container.querySelector('[data-testid="wc36-couple-result"]')?.textContent).not.toContain("파트너 답");
    expect(container.querySelector('[data-testid="wc36-couple-result"]')?.textContent).not.toContain("단단한 비버");
    expect(container.querySelector("h1")?.textContent).toBe("단단한 비버");
  });

  it("serializes invite creation and sharing mutation even when both clicks happen before a render", async () => {
    const pairing = deferred();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input, init) => {
      if (String(input).endsWith("/pair") && init?.method === "POST") return pairing.promise;
      if (init?.method === "PATCH") return Promise.resolve(json({ success: true, submission: preferences() }));
      return Promise.resolve(json({ status: "unpaired" }));
    });
    vi.stubGlobal("fetch", fetcher);
    await mount();
    const inviteButton = button("파트너 초대 링크 만들기");
    const shareButton = button("공유 설정 저장");
    await act(async () => { inviteButton.click(); shareButton.click(); });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
    await act(async () => { pairing.resolve(json({ success: true, id: id(1), pairingStatus: "waiting", coupleToken: id(999) })); });
    expect(container.querySelector<HTMLInputElement>("#invite-link-36")?.value).toContain(id(999));
    expect(container.querySelector<HTMLInputElement>("#invite-link-36")?.value).not.toContain(id(101));
  });

  it("requires explicit confirmation and preserves the result when deletion fails", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => Promise.resolve(init?.method === "DELETE" ? json({ error: "결과를 삭제하지 못했어요. 다시 시도해 주세요." }, 503) : json({ status: "unpaired" })));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    await act(async () => { button("내 결과 삭제하기").click(); });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    await act(async () => { button("취소").click(); });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    await act(async () => { button("내 결과 삭제하기").click(); });
    await act(async () => { button("삭제하고 연결 끝내기").click(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("결과를 삭제하지 못했어요");
    expect(readResult36(id(1))?.submission).toEqual(preferences());
    expect(container.querySelector("h1")?.textContent).toBe("단단한 비버");
    expect(button("삭제하고 연결 끝내기").disabled).toBe(false);
    const deletion = fetcher.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(JSON.parse(String(deletion?.[1]?.body))).toEqual({ response_id: id(1), access_token: id(101) });
  });

  it("clears the deleted result from memory and disk without removing another result", async () => {
    const other = createSubmission(4);
    storeResult36({ id: id(2), accessToken: id(102), submission: other, pairingStatus: "unpaired", coupleToken: null, savedAt: "2026-10-15T00:00:00.000Z" });
    savePersonal();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => Promise.resolve(init?.method === "DELETE" ? json({ success: true, deleted: true }) : json({ status: "unpaired" })));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    await act(async () => { button("내 결과 삭제하기").click(); });
    await act(async () => { button("삭제하고 연결 끝내기").click(); });
    expect(readResult36(id(1))).toBeNull();
    expect(window.localStorage.getItem(`wc36:result:${id(1)}`)).toBeNull();
    expect(window.sessionStorage.getItem(`wc36:result:${id(1)}`)).toBeNull();
    expect(readResult36(id(2))?.submission).toEqual(other);
    expect(container.querySelector('[data-testid="wc36-result-name"]')).toBeNull();
    expect(container.querySelector('[data-testid="wc36-couple-result"]')).toBeNull();
  });

  it("blocks refreshes during deletion and ignores an earlier comparison response afterward", async () => {
    const oldRefresh = deferred(); const deletion = deferred();
    let reads = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (init?.method === "DELETE") return deletion.promise;
      reads++;
      return reads === 1 ? oldRefresh.promise : Promise.resolve(json(ready()));
    });
    vi.stubGlobal("fetch", fetcher);
    await mount();
    await act(async () => { button("내 결과 삭제하기").click(); });
    await act(async () => { button("삭제하고 연결 끝내기").click(); });
    await act(async () => {
      button("상태 다시 확인").click();
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(reads).toBe(1);
    await act(async () => { deletion.resolve(json({ success: true, deleted: true })); });
    await act(async () => { oldRefresh.resolve(json(ready())); });
    expect(readResult36(id(1))).toBeNull();
    expect(container.querySelector('[data-testid="wc36-result-name"]')).toBeNull();
    expect(container.querySelector('[data-testid="wc36-couple-result"]')).toBeNull();
  });
});
