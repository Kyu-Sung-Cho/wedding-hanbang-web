import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_COUNTS, V40_LETTERS } from "@/constants/weddingCodeV40";
import { V40_COPY, receiveStorage, savedOnLine } from "@/lib/weddingCode/v40/copy";
import { click, createHarness, isBefore, labelledByText, type Harness } from "./inputTestKit";
import { ReceiverScreen, type ReceiverScreenProps } from "./ReceiverScreen";
import { allowedNumberPhrases, hasDash, notValidatedCount, visibleLabelProblems } from "./startFlowTestKit";

function Host(props: Partial<ReceiverScreenProps> & { readonly initial?: "on" | "off" }) {
  const [autosave, setAutosave] = useState<"on" | "off">(props.initial ?? "on");
  return (
    <ReceiverScreen
      {...props}
      autosave={autosave}
      onAutosaveChange={(next) => setAutosave(next)}
      onStart={props.onStart ?? (() => undefined)}
    />
  );
}

describe("ReceiverScreen", () => {
  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(async () => {
    await harness.unmount();
  });

  const text = () => harness.container.textContent ?? "";
  const buttons = () => [...harness.container.querySelectorAll<HTMLButtonElement>("button")];
  const buttonNamed = (name: string) => buttons().find((button) => button.textContent?.trim() === name);

  it("제목과 안내가 copy.ts 의 문구 그대로 순서대로 나온다", async () => {
    await harness.render(<Host />);
    const copy = V40_COPY.receive;
    const order = [copy.title, copy.lead, V40_COPY.receive.ownAnswersNote, copy.returnStepNote, copy.notice, receiveStorage("on", V40_COUNTS.items), copy.scope, copy.reloadNote];
    let cursor = -1;
    for (const piece of order) {
      const at = text().indexOf(piece);
      expect(at, piece).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("내 답을 마친 뒤 두 사람 결과 링크를 상대에게 다시 보내야 상대도 볼 수 있다는 것을 답하기 전에 말한다", async () => {
    await harness.render(<Host />);
    const note = harness.container.querySelector("[data-receive-return-step]");
    expect(note?.textContent).toBe(V40_COPY.receive.returnStepNote);
    // 답하기 단추보다 앞에 있고, 고지는 여전히 한 번이다
    expect(isBefore(note!, buttonNamed(V40_COPY.receive.answerButton)!)).toBe(true);
    expect(notValidatedCount(harness.container)).toBe(1);
  });

  it("제목은 h1 하나이고 화면의 이름이다", async () => {
    await harness.render(<Host />);
    const headings = harness.container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe("상대가 웨딩코드를 보냈어요");
    expect(labelledByText(harness.container.querySelector("section")!)).toBe(V40_COPY.receive.title);
  });

  it("상대의 답은 링크 안에 있고 마치기 전에는 화면에 나오지 않는다고 말한다", async () => {
    await harness.render(<Host />);
    expect(text()).toContain("링크 안에는 상대의 답이 들어 있어요");
    expect(text()).toContain("내가 마치기 전에는 화면에 나오지 않게 해 뒀어요");
  });

  it("상대의 글자, 세기, 답은 어디에도 없다(이 화면은 상대의 답을 받지 않는다)", async () => {
    await harness.render(<Host />);
    for (const letter of V40_LETTERS) {
      expect(text(), letter.name).not.toContain(letter.name);
      expect(text(), letter.letter).not.toContain(letter.mnemonic);
    }
    expect(text()).not.toContain(V40_COPY.legend.title);
    expect(harness.container.querySelectorAll("table, [role='table']")).toHaveLength(0);
  });

  it("질문 수와 저장 기간, 상대 답은 이 기기에 저장하지 않는다는 것, 이용 통계를 기록하지 않는다는 것을 말한다", async () => {
    await harness.render(<Host />);
    const storage = harness.container.querySelector("[data-receive-storage]")!.textContent!;
    expect(storage).toBe(receiveStorage("on", V40_COUNTS.items));
    expect(storage).toContain(`${V40_COUNTS.items}개`);
    expect(storage).toContain("상대의 답을 이 브라우저에 저장하지 않아요");
    expect(storage).toContain("이용 통계를 기록하지 않아요");
    // 앱 안 브라우저(카카오톡 등)는 저장소가 따로라서 다음에도 같은 곳에서 열어야 이어 할 수 있다.
    expect(storage).toContain("카카오톡 같은 앱 안에서 열었다면 다음에도 같은 곳에서 열어야 이어서 할 수 있어요");
  });

  it("내 답이 링크를 보내기 전에는 상대에게 가지 않는다고 미리 말한다", async () => {
    await harness.render(<Host />);
    expect(harness.container.querySelector("[data-receive-own-note]")?.textContent).toBe(V40_COPY.receive.ownAnswersNote);
  });

  describe("저장 문구는 저장 상태를 따른다(꺼져 있거나 막혔는데 저장돼요라고 하지 않는다)", () => {
    const storageText = () => harness.container.querySelector("[data-receive-storage]")!.textContent!;

    it("자동 저장이 꺼져 있으면 내 답은 저장되지 않는다고 말하고 상대 답과 이용 통계 이야기는 그대로 있다", async () => {
      await harness.render(<Host initial="off" />);
      expect(storageText()).toBe(receiveStorage("off", V40_COUNTS.items));
      expect(storageText()).toContain("자동 저장이 꺼져 있어서 내 답은 저장되지 않고");
      expect(storageText()).not.toMatch(/일 동안 저장돼요/u);
      expect(storageText()).toContain("상대의 답을 이 브라우저에 저장하지 않아요");
      expect(storageText()).toContain("이용 통계를 기록하지 않아요");
      await click(buttonNamed(V40_COPY.autosave.turnOnButton));
      expect(storageText()).toBe(receiveStorage("on", V40_COUNTS.items));
    });

    it("브라우저가 저장을 막았으면 저장 기간을 말하지 않는다", async () => {
      await harness.render(<Host storageIssue="unavailable" />);
      expect(storageText()).toBe(receiveStorage("blocked", V40_COUNTS.items));
      expect(storageText()).not.toMatch(/일 동안|내 답은 저장돼요/u);
      expect(storageText()).toContain("내 답은 웨딩한방에 보내지 않아요");
      expect(storageText()).toContain("상대의 답을 이 브라우저에 저장하지 않아요");
    });
  });

  it("「검증을 마친 심리검사가 아니」 고지가 정확히 한 번 있다", async () => {
    await harness.render(<Host />);
    expect(notValidatedCount(harness.container)).toBe(1);
    await harness.render(<Host key="saved" saved={{ savedAt: null, onKeepMine: vi.fn(), onUseLink: vi.fn() }} />);
    expect(notValidatedCount(harness.container)).toBe(1);
  });

  it("나도 답해 보기 단추가 onStart 를 부르고 꺼져 있지 않다", async () => {
    const onStart = vi.fn();
    await harness.render(<Host onStart={onStart} />);
    const start = buttonNamed(V40_COPY.receive.answerButton)!;
    expect(start.disabled).toBe(false);
    expect(start.getAttribute("aria-disabled")).toBeNull();
    await click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("단추 줄은 화면 아래에 붙고 자동 저장 단추 뒤에 있다", async () => {
    await harness.render(<Host />);
    const bar = harness.container.querySelector("[data-action-bar]")!;
    expect(bar.contains(buttonNamed(V40_COPY.receive.answerButton)!)).toBe(true);
    expect(isBefore(buttonNamed(V40_COPY.autosave.turnOffButton)!, buttonNamed(V40_COPY.receive.answerButton)!)).toBe(true);
  });

  it("번호, n/N, A/B 가 없고 숫자는 질문 수와 저장 기간뿐이다", async () => {
    await harness.render(<Host />);
    expect(visibleLabelProblems(harness.container, allowedNumberPhrases())).toEqual([]);
  });

  it("줄표가 없다(주장으로 쓰지 않는 말은 startFlowScreens.hygiene.test.tsx 가 화면 전체에서 본다)", async () => {
    await harness.render(<Host />);
    expect(hasDash(text())).toBe(false);
  });

  it("새로고침하면 상대의 답이 화면에서 사라진다는 안내가 있다", async () => {
    await harness.render(<Host />);
    expect(harness.container.querySelector("[data-receive-reload]")?.textContent).toBe(V40_COPY.receive.reloadNote);
  });

  describe("자동 저장", () => {
    it("켜기와 끄기가 바뀌고 상태 줄이 따라 바뀐다", async () => {
      await harness.render(<Host />);
      expect(text()).toContain(V40_COPY.autosave.statusOn);
      await click(buttonNamed(V40_COPY.autosave.turnOffButton));
      expect(text()).toContain(V40_COPY.autosave.statusOff);
      expect(buttonNamed(V40_COPY.autosave.turnOnButton)).toBeDefined();
    });

    it("저장할 수 없으면 단추 없이 저장 불가를 알린다", async () => {
      await harness.render(<Host storageIssue="unavailable" />);
      expect(buttonNamed(V40_COPY.autosave.turnOffButton)).toBeUndefined();
      expect(text()).toContain(V40_COPY.storageNotice.unavailable);
    });
  });

  describe("이 기기에 하던 답이 있을 때(초대 링크 충돌)", () => {
    it("나도 답해 보기 대신 어느 쪽을 이어 할지 묻는 카드가 나온다", async () => {
      const onKeepMine = vi.fn();
      const onUseLink = vi.fn();
      const at = Date.UTC(2026, 8, 28, 3);
      await harness.render(<Host saved={{ savedAt: at, onKeepMine, onUseLink }} />);
      const card = harness.container.querySelector<HTMLElement>('[data-section-card="invite-conflict"]')!;
      expect(card.textContent).toContain(V40_COPY.intro.inviteConflict.title);
      expect(card.textContent).toContain(V40_COPY.intro.inviteConflict.body);
      expect(card.textContent).toContain(savedOnLine(at)!);
      expect(buttonNamed(V40_COPY.receive.answerButton)).toBeUndefined();
      expect(harness.container.querySelector("[data-action-bar]")).toBeNull();

      await click(buttonNamed(V40_COPY.intro.inviteConflict.keepMineButton));
      expect(onKeepMine).toHaveBeenCalledTimes(1);
      await click(buttonNamed(V40_COPY.intro.inviteConflict.useLinkButton));
      expect(onUseLink).toHaveBeenCalledTimes(1);
    });

    it("받은 링크로 처음부터 하면 하던 답이 지워진다는 것을 누르기 전에 말한다", async () => {
      await harness.render(<Host saved={{ savedAt: null, onKeepMine: vi.fn(), onUseLink: vi.fn() }} />);
      const card = harness.container.querySelector<HTMLElement>('[data-section-card="invite-conflict"]')!;
      expect(card.textContent).toContain("받은 링크로 처음부터 하면 하던 답은 지워져요");
      expect(card.textContent).toContain("이어서 해도 상대가 보낸 링크의 답은 그대로 쓰여요");
    });
  });

  describe("라운지 안(embedded)", () => {
    it("계정에 저장되지 않는다는 한 줄과 하단 탭 위 단추 줄이 있다", async () => {
      await harness.render(<Host embedded />);
      expect(harness.container.querySelector("[data-embedded-note]")?.textContent).toBe(V40_COPY.intro.embeddedNote);
      expect(harness.container.querySelector<HTMLElement>("[data-action-bar]")!.className).toContain(
        "max-md:bottom-[calc(75px+env(safe-area-inset-bottom))]",
      );
    });
  });

  it("화면이 뜨면 화면 뿌리로 초점이 간다", async () => {
    await harness.render(<Host />);
    expect(document.activeElement).toBe(harness.container.querySelector("section"));
  });
});

describe("ReceiverScreen: 상대가 서로 짐작해 보기도 해 두었다는 한 줄 guessNote(4.1 단계 2)", () => {
  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(async () => {
    await harness.unmount();
  });

  const text = () => harness.container.textContent ?? "";
  const NOTE = "상대가 해 둔 것이 링크에 들어 있다는 시험용 한 줄이에요.";

  it("한 줄을 주면 마치기 전에 읽히는 자리(안내 뒤, 고지 앞)에 한 번 그리고 내용은 받지 않는다", async () => {
    await harness.render(<Host guessNote={NOTE} />);
    const note = harness.container.querySelector("[data-receive-guess-note]");
    expect(note?.textContent).toBe(NOTE);
    expect(text().split(NOTE).length - 1).toBe(1);
    const returnStep = harness.container.querySelector("[data-receive-return-step]")!;
    const honesty = harness.container.querySelector("[data-receive-honesty]")!;
    expect(isBefore(returnStep, note!)).toBe(true);
    expect(isBefore(note!, honesty)).toBe(true);
    // 고지는 여전히 한 번이다.
    expect(notValidatedCount(harness.container)).toBe(1);
  });

  it("한 줄을 주지 않으면 그 줄이 없고 나머지 글은 그대로다", async () => {
    await harness.render(<Host />);
    expect(harness.container.querySelector("[data-receive-guess-note]")).toBeNull();
    const plain = harness.container.innerHTML;
    await harness.render(<Host guessNote={undefined} />);
    expect(harness.container.innerHTML).toBe(plain);
  });

  it("빈 글을 주면 빈 줄을 그리지 않는다", async () => {
    await harness.render(<Host guessNote="" />);
    expect(harness.container.querySelector("[data-receive-guess-note]")).toBeNull();
  });
});
