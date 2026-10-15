import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmission, presentComparison, type Submission } from "@/lib/weddingCode36";
import { FALLBACK_NAME } from "@/constants/weddingCode36";
import Result36Client from "../result/Result36Client";

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const responseId = "00000000-0000-4000-8000-000000001036";
const accessToken = "00000000-0000-4000-8000-000000002036";
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json; charset=utf-8" } });
const fallbackCases: { label: string; submission: Submission }[] = [1, 2, 3, 4, 5].map(value => ({ label: `all ${value}`, submission: createSubmission(value) }));
fallbackCases.push({ label: "all missing", submission: createSubmission() });
const oneMissing = createSubmission(3); oneMissing.answers.B1 = null;
fallbackCases.push({ label: "one missing", submission: oneMissing });
const tied = createSubmission(3);
for (const id of ["B1", "B2", "B3", "M1", "M2", "M3", "P1", "P2", "P3"]) tied.answers[id] = 5;
fallbackCases.push({ label: "adjective tie", submission: tied });
const partial = createSubmission(3);
for (const id of ["B1", "B2", "B3"]) partial.answers[id] = 5;
fallbackCases.push({ label: "only one component supported", submission: partial });

function supported() {
  const value = createSubmission(3, { comparison: true, shareAlias: true });
  for (const id of ["B1", "B2", "B3", "P1", "P2", "P3"]) value.answers[id] = 5;
  return value;
}

let container: HTMLDivElement;
let root: Root | null;
function storeWithStaleCode(submission: Submission) {
  // 현재 답과 함께 오래된 표시 필드가 있어도 그 문자열을 결과로 재사용하지 않는다.
  window.localStorage.setItem(`wc36:result:${responseId}`, JSON.stringify({
    id: responseId, accessToken, submission, pairingStatus: "unpaired", coupleToken: null,
    savedAt: "2100-01-01T00:00:00.000Z", code: "VT?H", typeCode: "????", name: "??",
  }));
}
async function mount() {
  await act(async () => { root = createRoot(container); root.render(<Result36Client />); });
}

describe("36-question result never uses unresolved legacy letters as a name", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(json({ status: "unpaired" })));
    window.localStorage.clear(); window.sessionStorage.clear();
    window.history.replaceState(null, "", `/wedding-code/result?v=36&rid=${responseId}`);
    container = document.createElement("div"); document.body.appendChild(container); root = null;
  });
  afterEach(async () => { await act(async () => { root?.unmount(); }); container.remove(); vi.unstubAllGlobals(); });

  it.each(fallbackCases)("shows the guide name for $label and ignores stale question-mark code fields", async ({ submission }) => {
    storeWithStaleCode(submission);
    await mount();
    expect(container.querySelector("h1")?.textContent).toBe(FALLBACK_NAME);
    expect(container.querySelector('[data-testid="wc36-result-name"]')).toBe(container.querySelector("h1"));
    expect(container.textContent).not.toContain("VT?H");
    expect(container.textContent).not.toContain("????");
    expect(container.querySelector("h1")?.textContent).not.toMatch(/[?·\uFFFD]/);
  });

  it("recomputes the supported adjective and animal name from current answers instead of a saved code", async () => {
    storeWithStaleCode(supported());
    await mount();
    expect(container.querySelector("h1")?.textContent).toBe("단단한 비버");
    expect(container.textContent).not.toContain("VT?H");
    expect(container.textContent).not.toContain("????");
  });

  it("rejects malformed partner names while keeping the viewer's own valid name", async () => {
    const own = supported(); storeWithStaleCode(own);
    const report = presentComparison(own, supported());
    if (!report.names) throw new Error("Expected two explicitly shared names");
    report.names.b.name = "????";
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(json({ status: "ready", viewer: "a", report })));
    await mount();
    expect(container.querySelector("h1")?.textContent).toBe("단단한 비버");
    expect(container.querySelector('[data-testid="wc36-couple-result"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("형식을 확인하지 못했어요");
    expect(container.textContent).not.toContain("????");
  });
});
