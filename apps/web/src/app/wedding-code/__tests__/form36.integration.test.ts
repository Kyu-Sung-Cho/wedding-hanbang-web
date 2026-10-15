import { act, createElement, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ITEMS } from "@/constants/weddingCode36";
import { createSubmission, type Submission } from "@/lib/weddingCode36";
import WeddingCodeClient from "../WeddingCodeClient";
import { clearDraft36, clearPending36, clearResult36, readDraft36, readPending36, readResult36, storeDraft36, storeResult36, type PairingStatus36 } from "../storage36";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));
const id = (value: number) => `10000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let container: HTMLDivElement;
let root: Root | null;
async function mount() {
  await act(async () => { root = createRoot(container); root.render(createElement(WeddingCodeClient)); });
}
async function unmount() {
  await act(async () => { root?.unmount(); root = null; });
}
function button(text: string) {
  const element = [...container.querySelectorAll("button")].find(value => value.textContent?.includes(text));
  if (!element) throw new Error("Missing button: " + text);
  return element;
}
function checkbox(text: string) {
  const label = [...container.querySelectorAll("label")].find(value => value.textContent?.includes(text));
  const input = label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!input) throw new Error("Missing checkbox: " + text);
  return input;
}
function radio(value: number) {
  const input = container.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  if (!input) throw new Error("Missing rating: " + value);
  return input;
}
function review(submission: Submission = createSubmission(2, { comparison: true, shareAlias: true })) {
  storeDraft36(null, { answers: submission.answers, missingReasons: submission.missing_reasons, index: 35, step: "review", compare: submission.allow_couple_comparison, shareAlias: submission.share_alias, shareNotes: submission.share_item_ids.filter(value => value.startsWith("N")) });
}
function success(body: Record<string, unknown>) {
  const { answers, missing_reasons, allow_couple_comparison, share_alias, share_item_ids, questionnaire_version, questionnaire_fingerprint } = body;
  return { success: true, id: id(9001), submission: { answers, missing_reasons, allow_couple_comparison, share_alias, share_item_ids, questionnaire_version, questionnaire_fingerprint }, pairingStatus: "unpaired", coupleToken: null, recovered: true };
}
function posted(fetcher: ReturnType<typeof vi.fn<typeof fetch>>) {
  const call = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
  if (!call || typeof call[1]?.body !== "string") throw new Error("Missing submitted body");
  return JSON.parse(call[1].body) as Record<string, unknown>;
}

describe("36문항 실제 양식의 입력·복구·저장 경계", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.localStorage.clear(); window.sessionStorage.clear();
    clearDraft36(null); clearPending36(null); clearDraft36(id(99)); clearPending36(id(99));
    clearResult36(id(701));
    navigation.push.mockReset(); navigation.replace.mockReset();
    window.history.replaceState(null, "", "/wedding-code");
    container = document.createElement("div"); document.body.appendChild(container); root = null;
  });
  afterEach(async () => { await unmount(); container.remove(); vi.unstubAllGlobals(); });

  it("restores progress after remount and preserves both chosen and skipped answers", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());
    await mount();
    await act(async () => { button("36문항 시작하기").click(); });
    expect(container.textContent).toContain(ITEMS[0].context);
    expect(container.querySelector("h2")?.textContent).toContain(ITEMS[0].statement);
    expect(button("다음").disabled).toBe(true);
    await act(async () => { radio(2).click(); });
    await act(async () => { button("다음").click(); });
    const skip = [...container.querySelectorAll("label")].find(label => label.textContent?.includes("나에게 해당하지 않아요"))?.querySelector<HTMLInputElement>("input");
    expect(skip).toBeDefined();
    await act(async () => { skip!.click(); });
    await act(async () => { button("다음").click(); });
    expect(readDraft36(null)).toMatchObject({ index: 2, step: "questions", answers: { [ITEMS[0].id]: 2, [ITEMS[1].id]: null }, missingReasons: { [ITEMS[1].id]: "not_applicable" } });
    await unmount(); await mount();
    expect(container.querySelector("h2")?.textContent).toContain(ITEMS[2].statement);
    await act(async () => { button("이전").click(); });
    expect(container.querySelector<HTMLInputElement>('input[name^="skip-"]:checked')).not.toBeNull();
    await act(async () => { radio(4).click(); });
    expect(readDraft36(null)?.answers[ITEMS[1].id]).toBe(4);
    expect(readDraft36(null)?.missingReasons[ITEMS[1].id]).toBeUndefined();
    await act(async () => { button("이전").click(); });
    expect(radio(2).checked).toBe(true);
  });

  it("keeps skip separate from 3 points and requires storage consent before sending", async () => {
    const submission = createSubmission(5, { comparison: false });
    submission.answers.B1 = null; submission.missing_reasons.B1 = "cannot_imagine";
    review(submission);
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => Promise.resolve(json(success(JSON.parse(String(init?.body))))));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    expect(button("내 결과 보기").disabled).toBe(true);
    expect(container.textContent).toContain("답한 문항 35개 · 건너뛴 문항 1개");
    await act(async () => { checkbox("만 14세 이상이며").click(); });
    await act(async () => { button("내 결과 보기").click(); });
    const body = posted(fetcher);
    expect(body).toMatchObject({ consent: true, answers: { B1: null }, missing_reasons: { B1: "cannot_imagine" }, allow_couple_comparison: false });
    expect(navigation.replace).toHaveBeenCalledWith(`/wedding-code/result?v=36&rid=${id(9001)}`);
    expect(readResult36(id(9001))?.submission.answers.B1).toBeNull();
    expect(readPending36(null)).toBeNull(); expect(readDraft36(null)).toBeNull();
  });

  it("sends once for a double click and retries the same frozen answers and private key after reload", async () => {
    review();
    let fail!: (reason: Error) => void;
    const first = new Promise<Response>((_resolve, reject) => { fail = reject; });
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => first).mockImplementation((_url, init) => Promise.resolve(json(success(JSON.parse(String(init?.body))))));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    await act(async () => { checkbox("만 14세 이상이며").click(); });
    const submit = button("내 결과 보기");
    await act(async () => { submit.click(); submit.click(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const firstBody = posted(fetcher);
    const snapshot = readPending36(null);
    expect(snapshot).not.toBeNull();
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    expect([...container.querySelectorAll("button")].some(value => value.textContent?.includes("답 다시 보기"))).toBe(false);
    await act(async () => { fail(new Error("네트워크 연결이 끊겼어요.")); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("네트워크 연결이 끊겼어요");
    expect(readPending36(null)).toEqual(snapshot);
    await unmount(); await mount();
    expect(container.textContent).toContain("저장 여부를 확인할 답이 있어요");
    expect(checkbox("만 14세 이상이며").checked).toBe(false);
    expect(button("저장 결과 다시 확인").disabled).toBe(true);
    await act(async () => { checkbox("만 14세 이상이며").click(); });
    await act(async () => { button("저장 결과 다시 확인").click(); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const retry = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(retry).toEqual(firstBody);
    expect(retry.submission_id).toBe(snapshot!.submissionId);
    expect(retry.access_token).toBe(snapshot!.accessToken);
    expect(navigation.replace).toHaveBeenCalledTimes(1);
  });

  it("blocks a malformed invite without a request and allows an explicit personal test", async () => {
    window.history.replaceState(null, "", "/wedding-code?ct=not-a-valid-invite");
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher);
    await mount();
    expect(button("36문항 시작하기").disabled).toBe(true);
    expect(container.textContent).toContain("사용할 수 있는 36문항 초대가 아니에요");
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => { button("개인 테스트로 진행").click(); });
    expect(window.location.search).toBe("");
    expect(button("36문항 시작하기").disabled).toBe(false);
    await act(async () => { button("36문항 시작하기").click(); });
    expect(container.querySelector("h2")?.textContent).toContain(ITEMS[0].statement);
  });

  it.each(["full", "not_found", "error"] as const)("handles %s invite lookup without silently starting a coupled test", async status => {
    window.history.replaceState(null, "", `/wedding-code?ct=${id(99)}`);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(status === "error" ? json({ error: "잠시 후 다시" }, 503) : json({ status }));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    expect(button("36문항 시작하기").disabled).toBe(true);
    await act(async () => { button("개인 테스트로 진행").click(); });
    expect(button("36문항 시작하기").disabled).toBe(false);
    expect(window.location.search).toBe("");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps the start button blocked while invite validation is pending", async () => {
    window.history.replaceState(null, "", `/wedding-code?ct=${id(99)}`);
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(done => { resolve = done; })));
    await mount();
    expect(button("36문항 시작하기").disabled).toBe(true);
    expect(container.textContent).toContain("초대 링크를 확인하고 있어요");
    await act(async () => { resolve(json({ status: "waiting" })); });
    expect(button("36문항 시작하기").disabled).toBe(false);
    expect(container.textContent).toContain("파트너가 보낸 초대예요");
  });

  it.each(["missing_submission", "wrong_fingerprint", "bad_id", "bad_pair_status"] as const)("keeps retry recoverable when a successful HTTP response contains %s", async invalid => {
    review();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      const valid = success(JSON.parse(String(init?.body)));
      if (invalid === "missing_submission") Object.assign(valid, { submission: undefined });
      if (invalid === "wrong_fingerprint") Object.assign(valid.submission, { questionnaire_fingerprint: "old" });
      if (invalid === "bad_id") valid.id = "invalid";
      if (invalid === "bad_pair_status") valid.pairingStatus = "made-up";
      return Promise.resolve(json(valid));
    });
    vi.stubGlobal("fetch", fetcher);
    await mount();
    await act(async () => { checkbox("만 14세 이상이며").click(); });
    await act(async () => { button("내 결과 보기").click(); });
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("저장 결과를 확인하지 못했어요");
    expect(readPending36(null)).not.toBeNull();
    expect(button("저장 결과 다시 확인").disabled).toBe(false);
  });

  it.each(["unpaired", "waiting", "full"] as PairingStatus36[])("connects a previous %s result to the exact received invite", async status => {
    const target = id(702); const ownId = id(701); const key = id(703);
    const original = createSubmission(2, { comparison: true, shareAlias: true });
    storeResult36({ id: ownId, accessToken: key, submission: original, pairingStatus: status, coupleToken: status === "waiting" ? id(704) : null, savedAt: "2026-10-15T00:00:00.000Z" });
    window.history.replaceState(null, "", `/wedding-code?ct=${target}`);
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => Promise.resolve(init?.method === "POST" ? json({ success: true, id: ownId, pairingStatus: "paired", coupleToken: target }) : json({ status: "waiting" })));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    await act(async () => { button("이전에 답한 결과로 연결").click(); });
    expect(posted(fetcher)).toEqual({ response_id: ownId, access_token: key, invite_token: target });
    expect(readResult36(ownId)).toMatchObject({ pairingStatus: "paired", coupleToken: target, submission: original });
    expect(navigation.push).toHaveBeenCalledWith(`/wedding-code/result?v=36&rid=${ownId}`);
  });

  it.each([
    { pairingStatus: "waiting", coupleToken: id(704) },
    { pairingStatus: "paired", coupleToken: id(704) },
    { pairingStatus: "waiting", coupleToken: id(702) },
  ])("does not present another canonical pair as joining the requested invite: %j", async returned => {
    const target = id(702); const ownId = id(701); const key = id(703);
    storeResult36({ id: ownId, accessToken: key, submission: createSubmission(3), pairingStatus: "waiting", coupleToken: id(704), savedAt: "2026-10-15T00:00:00.000Z" });
    window.history.replaceState(null, "", `/wedding-code?ct=${target}`);
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => Promise.resolve(init?.method === "POST" ? json({ success: true, id: ownId, ...returned }) : json({ status: "waiting" })));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    await act(async () => { button("이전에 답한 결과로 연결").click(); });
    expect(navigation.push).not.toHaveBeenCalled();
    expect(readResult36(ownId)).toMatchObject({ pairingStatus: "waiting", coupleToken: id(704) });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("초대에 연결하지 못했어요");
  });
});
