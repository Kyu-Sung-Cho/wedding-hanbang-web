import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_GUESS_COPY } from "@/lib/weddingCode/v40/guess/guessCopy";
import { click, createHarness, labelProblemsIn, type Harness } from "../inputTestKit";
import { GuessEntryCard, type GuessEntryCardProps } from "./GuessEntryCard";

const copy = V40_GUESS_COPY.entry;

describe("GuessEntryCard", () => {
  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await harness.unmount();
  });

  function handlers() {
    return { onStart: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn(), onDismiss: vi.fn() };
  }
  async function mount(props: Partial<GuessEntryCardProps> = {}) {
    const fns = handlers();
    await harness.render(<GuessEntryCard state="idle" {...fns} {...props} />);
    return fns;
  }
  const button = (name: string) => harness.container.querySelector<HTMLButtonElement>(`[data-entry="${name}"]`);
  const buttonTexts = () => [...harness.container.querySelectorAll("button")].map((el) => el.textContent?.trim());
  const status = () => harness.container.querySelector<HTMLElement>("[data-entry-status]") as HTMLElement;

  describe("처음 모양(idle)", () => {
    it("제목과 본문과 단추 둘을 그린다: 해 볼게요, 지금은 안 할게요", async () => {
      await mount();
      expect(harness.container.querySelector("h2")?.textContent).toBe(copy.title);
      expect(harness.container.textContent).toContain(copy.body);
      expect(buttonTexts()).toEqual([copy.startButton, copy.dismissButton]);
      expect(harness.container.textContent).not.toContain(copy.doneNote);
    });

    it("본문은 링크에 무엇이 들어가는지, 읽을 수 있는 사람, 상대도 했을 때, 이 브라우저에 저장하지 않는다는 것을 말한다", async () => {
      await mount();
      const text = harness.container.textContent ?? "";
      expect(text).toContain("파트너와 비교하기");
      expect(text).toContain("링크를 가진 사람은 읽을 수 있고");
      // 나란히 놓이는 것은 짐작이 다른 장면뿐이다(결정하는 자리에서 모든 장면이 놓인다고 말하지 않는다).
      expect(text).toContain("두 사람 결과에 짐작이 다른 장면이 나란히 놓여요");
      expect(text).toContain("이 브라우저에는 저장하지 않아요");
    });

    it("해 볼게요는 onStart 를 부르고 카드는 그대로 남는다(부모가 다음 화면을 정한다)", async () => {
      const fns = await mount();
      await click(button("start"));
      expect(fns.onStart).toHaveBeenCalledTimes(1);
      expect(fns.onDismiss).not.toHaveBeenCalled();
      expect(harness.container.querySelector("[data-section-card]")).not.toBeNull();
    });

    it("지금은 안 할게요는 부모에게 알리고 카드가 사라진다", async () => {
      const fns = await mount();
      await click(button("dismiss"));
      expect(fns.onDismiss).toHaveBeenCalledTimes(1);
      expect(fns.onStart).not.toHaveBeenCalled();
      expect(harness.container.textContent).toBe("");
    });
  });

  describe("끝낸 뒤 모양(done)", () => {
    it("「내 답과 함께 보내기」를 고르면 들어가고 「질문만 보내기」를 고르면 들어가지 않는다고 사실대로 말하고 고치기와 빼기가 있다", async () => {
      await mount({ state: "done" });
      expect(harness.container.textContent).toContain(copy.doneNote);
      expect(harness.container.textContent).not.toContain(copy.body);
      expect(buttonTexts()).toEqual([copy.editButton, copy.removeButton]);
      expect(button("start")).toBeNull();
      expect(button("dismiss")).toBeNull();
    });

    it("고치기와 빼기는 각자의 콜백을 부른다", async () => {
      const fns = await mount({ state: "done" });
      await click(button("edit"));
      expect(fns.onEdit).toHaveBeenCalledTimes(1);
      expect(fns.onRemove).not.toHaveBeenCalled();
      await click(button("remove"));
      expect(fns.onRemove).toHaveBeenCalledTimes(1);
    });
  });

  describe("뺀 뒤", () => {
    it("처음 모양에서 removed 이면 뺐다는 한 줄을 알림 영역에 말하고 초점이 그 줄로 간다", async () => {
      const fns = handlers();
      await harness.render(<GuessEntryCard state="done" {...fns} />);
      await click(button("remove"));
      await harness.render(<GuessEntryCard state="idle" removed {...fns} />);
      expect(status().textContent).toBe(copy.removedNote);
      expect(status().getAttribute("role")).toBe("status");
      expect(status().getAttribute("aria-live")).toBe("polite");
      expect(document.activeElement).toBe(status());
      expect(buttonTexts()).toEqual([copy.startButton, copy.dismissButton]);
    });

    it("뺐다는 한 줄은 이미 보낸 링크는 그대로 남는다고 사실대로 말한다", () => {
      expect(copy.removedNote).toContain("이미 보낸 링크는 그대로 남아요");
      expect(copy.removedNote).toContain("이제부터 만드는 링크에서 짐작을 뺐어요");
    });

    it("알림 영역은 처음부터 문서에 있고(낭독기가 바뀐 글을 읽는다) 비어 있을 때는 화면에서 보이지 않는다", async () => {
      await mount();
      expect(status().textContent).toBe("");
      expect(status().className).toContain("sr-only");
      await harness.render(<GuessEntryCard state="idle" removed {...handlers()} />);
      expect(status().className).not.toContain("sr-only");
    });

    it("끝낸 모양에서는 removed 가 와도 말하지 않는다", async () => {
      await mount({ state: "done", removed: true });
      expect(status().textContent).toBe("");
    });
  });

  describe("틀", () => {
    it("제목 수준은 기본 2 이고 3 을 줄 수 있다. 영역 이름은 제목이다", async () => {
      await mount();
      const section = harness.container.querySelector("section") as HTMLElement;
      expect(harness.container.querySelector("h2")).not.toBeNull();
      expect(section.getAttribute("aria-labelledby")).toBe(harness.container.querySelector("h2")?.id);
      await harness.render(<GuessEntryCard state="idle" headingLevel={3} {...handlers()} />);
      expect(harness.container.querySelector("h3")?.textContent).toBe(copy.title);
      expect(harness.container.querySelector("h2")).toBeNull();
    });

    it("번호, n/N, A/B 라벨이 없다", async () => {
      await mount();
      expect(labelProblemsIn(harness.container)).toEqual([]);
      await harness.render(<GuessEntryCard state="done" {...handlers()} />);
      expect(labelProblemsIn(harness.container)).toEqual([]);
    });

    it("저장소, 주소, 네트워크를 만지지 않는다", async () => {
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const replace = vi.spyOn(window.history, "replaceState");
      await mount();
      await click(button("start"));
      await click(button("dismiss"));
      expect(setItem).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});
