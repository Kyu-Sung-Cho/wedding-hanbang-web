import { act, type AnchorHTMLAttributes, type ImgHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRITERIA } from "@/constants/weddingCode36";
import { createSubmission, presentComparison, type Submission } from "@/lib/weddingCode36";
import reviewedCopy from "@/lib/weddingCode36/data/type-cards.json";
import { clearResult36, storeResult36 } from "../../storage36";
import Result36Client from "../Result36Client";

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/image", () => ({
  default: ({ src, alt = "", ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string | { src: string } }) =>
    // Next의 이미지 전달 방식만 치환하고 실제 컴포넌트가 고른 자산과 속성을 보존한다.
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={alt} src={typeof src === "string" ? src : src.src} />,
}));

const rid = "00000000-0000-4000-8000-000000000501";
const accessToken = "00000000-0000-4000-8000-000000000502";
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const expectedAnimals: Record<string, string> = { P: "beaver", J: "penguin", D: "cat", S: "peacock" };
let container: HTMLDivElement;
let root: Root | null;

function named(adjective = "B", animal = "P"): Submission {
  const submission = createSubmission(3, { comparison: true, shareAlias: true });
  for (const criterion of CRITERIA) if ([adjective, animal].includes(criterion.id)) {
    for (const id of criterion.item_ids) submission.answers[id] = 5;
  }
  return submission;
}
async function mount(submission: Submission, partner?: Submission) {
  storeResult36({ id: rid, accessToken, submission, savedAt: "2026-10-15T00:00:00.000Z", pairingStatus: "unpaired", coupleToken: null });
  if (partner) vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response({ status: "ready", viewer: "a", report: presentComparison(submission, partner) })));
  else vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response({ status: "unpaired" })));
  await act(async () => { root = createRoot(container); root.render(<Result36Client />); });
}
function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(element => element.textContent?.includes(label));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function profile(id: string): HTMLDetailsElement {
  const found = container.querySelector<HTMLDetailsElement>(`[data-testid="wc36-profile-${id}"]`);
  if (!found) throw new Error(`Missing profile: ${id}`);
  return found;
}

describe("36문항 결과 화면의 실제 응답과 캐릭터 표시", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.localStorage.clear(); window.sessionStorage.clear(); clearResult36(rid);
    window.history.replaceState(null, "", `/wedding-code/result?v=36&rid=${rid}`);
    container = document.createElement("div"); document.body.appendChild(container); root = null;
  });
  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    clearResult36(rid); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it.each(reviewedCopy.cards)("$name 결과에 해당 캐릭터와 검수된 제안을 표시한다", async card => {
    await mount(named(card.adjective_criterion, card.animal_criterion));
    expect(container.querySelector("h1")?.textContent).toBe(card.name);
    const character = container.querySelector(`[data-testid="wc36-character-${expectedAnimals[card.animal_criterion]}"] img`);
    expect(character?.getAttribute("src")).toContain(`/${expectedAnimals[card.animal_criterion]}.png`);
    expect(character?.getAttribute("alt")).toBe("");
    expect(character?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('[data-testid="wc36-next-action"]')?.textContent).toBe(card.action);
    expect(container.querySelector('[aria-label="답에서 드러난 준비 기준"]')?.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelectorAll('[data-testid^="wc36-profile-"]')).toHaveLength(9);
    expect(container.querySelector("h1")!.compareDocumentPosition(container.querySelector("#my-reading")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    [1, "제시된 준비 방식에는 동의하지 않았어요"],
    [2, "제시된 준비 방식에는 동의하지 않았어요"],
    [3, "모든 준비 기준에서 중간 응답을 골랐어요"],
    [4, "여러 준비 기준에 모두 동의했어요"],
    [5, "여러 준비 기준에 모두 동의했어요"],
  ] as const)("전부 %i인 실제 렌더에서도 선택한 답과 상태 설명을 유지한다", async (value, state) => {
    await mount(createSubmission(value));
    expect(container.querySelector("h1")?.textContent).toBe("아직 미정인 수달");
    expect(container.querySelector('[data-testid="wc36-response-state"]')?.textContent).toBe(state);
    expect(container.querySelector('[data-testid="wc36-character-otter"] img')?.getAttribute("src")).toContain("/otter.png");
    expect([...profile("B").querySelectorAll("summary span[aria-label]")].map(span => span.textContent)).toEqual([`1번 · ${value}점`, `13번 · ${value}점`, `25번 · ${value}점`]);
  });

  it("모두 중간인 답을 균형감이나 준비 능력으로 미화하지 않는다", async () => {
    await mount(createSubmission(3));
    expect(container.textContent).toContain("중간 응답만으로 균형 감각·유연함·차분한 성격을 판단하지 않아요");
    expect(container.querySelector('[aria-label="답에서 드러난 준비 기준"]')).toBeNull();
    expect(profile("B").querySelector("summary")?.textContent).toContain("세 장면 모두 중간 응답");
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.textContent).not.toMatch(/균형 잡힌|준비 능력은|궁합\s*\d/);
  });

  it("펼치기 전에도 각 문항의 1·3·5 응답을 보여주고 평균은 상세에 둔다", async () => {
    const submission = createSubmission(3);
    ["B1", "B2", "B3"].forEach((id, index) => { submission.answers[id] = [1, 3, 5][index]; });
    await mount(submission);
    const card = profile("B");
    expect(card.open).toBe(false);
    expect([...card.querySelectorAll("summary span[aria-label]")].map(span => span.getAttribute("aria-label"))).toEqual([
      "1번 1점 · 전혀 그렇지 않다", "13번 3점 · 동의도 반대도 하지 않는다", "25번 5점 · 매우 그렇다",
    ]);
    expect(card.querySelector("summary")?.textContent).toContain("장면에 따라 동의·비동의");
    expect(card.querySelector("summary")?.textContent).not.toContain("평균");
    card.open = true;
    expect(card.textContent).toContain("세 장면의 응답 평균 3.0 / 5");
    expect([...card.querySelectorAll("ol li")].map(item => item.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining("내 답 · 1점 · 전혀 그렇지 않다"),
      expect.stringContaining("내 답 · 3점 · 동의도 반대도 하지 않는다"),
      expect.stringContaining("내 답 · 5점 · 매우 그렇다"),
    ]));
  });

  it("건너뛴 문항을 3점처럼 그리지 않는다", async () => {
    const submission = createSubmission(3);
    submission.answers.B1 = null; submission.missing_reasons.B1 = "prefer_not_to_answer";
    await mount(submission);
    const card = profile("B");
    expect(card.querySelector("summary span[aria-label]")?.textContent).toBe("1번 · 건너뜀");
    expect(card.querySelector("summary span[aria-label]")?.getAttribute("aria-label")).toBe("1번 건너뜀");
    expect(card.textContent).toContain("빈 답이 있어 평균 보류");
    expect(card.querySelector("summary")?.textContent).not.toContain("1번 · 3점");
    expect(container.textContent).not.toContain("prefer_not_to_answer");
  });

  it("이름 공유를 철회하면 커플의 이름과 두 캐릭터를 함께 지우고 개인 캐릭터는 유지한다", async () => {
    const personal = named();
    const partner = named("M", "J");
    await mount(personal, partner);
    const couple = () => container.querySelector('[data-testid="wc36-couple-result"]');
    expect(couple()?.textContent).toContain("단단한 비버");
    expect(couple()?.textContent).toContain("뜻깊은 펭귄");
    expect([...couple()!.querySelectorAll("img")].map(img => img.getAttribute("src"))).toEqual(expect.arrayContaining([expect.stringContaining("/beaver.png"), expect.stringContaining("/penguin.png")]));

    const withdrawn = { ...personal, share_alias: false };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation((_input, init) => Promise.resolve(response(
      init?.method === "PATCH" ? { success: true, submission: withdrawn } : { status: "ready", viewer: "a", report: presentComparison(withdrawn, partner) },
    ))));
    const shareName = [...container.querySelectorAll("label")].find(label => label.textContent === "내 결과 이름 공유")?.querySelector<HTMLInputElement>("input");
    expect(shareName?.checked).toBe(true);
    await act(async () => { shareName?.click(); });
    await act(async () => { button("공유 설정 저장").click(); });
    expect(couple()?.querySelectorAll("img")).toHaveLength(0);
    expect(couple()?.textContent).not.toContain("단단한 비버");
    expect(couple()?.textContent).not.toContain("뜻깊은 펭귄");
    expect(couple()?.textContent).toContain("두 사람 모두 공유할 때만");
    expect(container.querySelector("h1")?.textContent).toBe("단단한 비버");
    expect(container.querySelector('[data-testid="wc36-character-beaver"] img')).not.toBeNull();
  });

  it.each(["P", "J", "D", "S"])("서로 이름을 공유한 커플의 %s 캐릭터도 해당 자산을 쓴다", async animal => {
    await mount(named(), named("M", animal));
    const images = container.querySelector('[data-testid="wc36-couple-result"]')?.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images?.[1].getAttribute("src")).toContain(`/${expectedAnimals[animal]}.png`);
  });

  it("중간 응답 파트너도 공유한 이름에 해당하는 수달만 표시한다", async () => {
    await mount(named(), createSubmission(3, { comparison: true, shareAlias: true }));
    const images = container.querySelector('[data-testid="wc36-couple-result"]')?.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images?.[1].getAttribute("src")).toContain("/otter.png");
  });
});
