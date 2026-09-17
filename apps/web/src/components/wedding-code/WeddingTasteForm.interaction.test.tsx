import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WeddingTasteForm from "./WeddingTasteForm";
import { createEmptyWeddingTasteDraft } from "@/lib/weddingCode/taste";

let host: HTMLDivElement; let root: Root;
// 그림 칸은 라벨 아래에 설명 줄을 함께 담는다. 그래서 칸은 버튼 전체 글자가 아니라 라벨 요소로 찾는다.
const buttonLabel = (item: Element) => (item.querySelector("[data-choice-label]") ?? item).textContent?.trim();
function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(item => buttonLabel(item) === text);
  expect(button, text).toBeDefined();
  act(() => button?.click());
}
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe("직접 취향 질문", () => {
  it("기본 답 없이 시작하고 고르지 않은 주제는 질문하지 않는다", () => {
    const done = vi.fn(); act(() => root.render(<WeddingTasteForm onComplete={done} />));
    expect(host.querySelector('[aria-pressed="true"]')).toBeNull();
    click("사진"); click("다음"); click("간결한 분위기"); click("다음");
    expect(host.textContent).toContain("사진에는 어떤 모습을");
    click("자연스러운 순간"); click("다음");
    expect(host.textContent).toContain("꼭 피하고 싶은 게 있나요?");
    click("특별히 피하고 싶은 것은 없어요"); click("다음");
    click("다른 안도 함께 볼 수 있어요"); click("내 선택 보기");
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0][0]).toMatchObject({ details: { photo: { status: "answered", values: ["candid"] } }, negotiability: { photo: "open_to_options" } });
    expect(done.mock.calls[0][0].details).not.toHaveProperty("meal");
  });
  it("주제를 해제하면 그 주제의 세부 답과 협의 의사도 남기지 않는다", () => {
    const done = vi.fn();
    const initial = createEmptyWeddingTasteDraft(); initial.priorityDomains = { status: "answered", values: ["photo"] }; initial.details.photo = { status: "answered", values: ["candid"] }; initial.negotiability.photo = "prefer_keep";
    act(() => root.render(<WeddingTasteForm initialDraft={initial} onComplete={done} />));
    click("사진"); click("다음"); click("다음"); click("내 선택 보기");
    expect(done.mock.calls[0][0].details).toEqual({});
    expect(done.mock.calls[0][0].negotiability).toEqual({});
  });
  it("두 주제만 고를 수 있고 뒤로 돌아가도 답이 보존되며 세부 답 변경은 기존 협의 의사를 지운다", () => {
    const done = vi.fn();
    const initial = createEmptyWeddingTasteDraft(); initial.priorityDomains = { status: "answered", values: ["photo", "venue"] };
    initial.details.photo = { status: "answered", values: ["candid"] }; initial.details.venue = { status: "answered", values: ["indoor"] };
    initial.negotiability.photo = "prefer_keep"; initial.negotiability.venue = "open_to_options";
    act(() => root.render(<WeddingTasteForm initialDraft={initial} onComplete={done} />));
    expect([...host.querySelectorAll("button")].find(item => item.textContent === "식사")?.disabled).toBe(true);
    expect(host.textContent).toContain("질문 1 · 최대 6개");
    click("다음"); click("다음");
    expect([...host.querySelectorAll("button")].find(item => item.textContent === "자연스러운 순간")?.getAttribute("aria-pressed")).toBe("true");
    click("이전"); click("다음"); click("준비한 포즈와 장면"); click("다음"); click("다음"); click("다음"); click("내 선택 보기");
    expect(done.mock.calls[0][0].details.photo).toEqual({ status: "answered", values: ["directed"] });
    expect(done.mock.calls[0][0].negotiability).toEqual({ venue: "open_to_options" });
  });
  it("미정으로 바꾸면 기존 값을 남기지 않고 해당 주제의 협의 질문도 만들지 않는다", () => {
    const done = vi.fn();
    act(() => root.render(<WeddingTasteForm onComplete={done} />));
    click("사진"); click("다음"); click("간결한 분위기"); click("아직 모르겠어요"); click("다음");
    click("자연스러운 순간"); click("이번 계획에는 없어요"); click("다음"); click("내 선택 보기");
    expect(done.mock.calls[0][0].mood).toEqual({ status: "undecided" });
    expect(done.mock.calls[0][0].details.photo).toEqual({ status: "not_applicable" });
    expect(done.mock.calls[0][0].negotiability).toEqual({});
  });
  it("모든 질문을 건너뛰어도 취향이나 협의 의사를 만들지 않는다", () => {
    const done = vi.fn(); act(() => root.render(<WeddingTasteForm onComplete={done} />));
    click("다음"); click("다음"); click("내 선택 보기");
    expect(done.mock.calls[0][0]).toEqual(createEmptyWeddingTasteDraft());
  });
});
