import { StrictMode, act, useState, type ReactElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_COUNTS } from "@/constants/weddingCodeV40";
import {
  V40_COPY,
  autosaveTurnOffWarning,
  introBullets,
  introStorage,
  savedOnLine,
  storageExpiredNote,
} from "@/lib/weddingCode/v40/copy";
import { IntroScreen, type AutosavePreference, type IntroScreenProps } from "./IntroScreen";
import { PreviousVersionCard } from "./PreviousVersionCard";
import { click, createHarness, describedByText, isBefore, labelledByText, type Harness } from "./inputTestKit";
import { allowedNumberPhrases, hasDash, notValidatedCount, visibleLabelProblems } from "./startFlowTestKit";

/** 자동 저장 선호를 부모가 쥐고 있는 것처럼 흉내 낸다. */
function Host({
  initial = "on",
  onChange,
  ...rest
}: { readonly initial?: AutosavePreference; readonly onChange?: (next: AutosavePreference) => void } & Omit<
  IntroScreenProps,
  "autosave" | "onAutosaveChange" | "onStart"
> & { readonly onStart?: () => void }) {
  const [autosave, setAutosave] = useState<AutosavePreference>(initial);
  return (
    <IntroScreen
      {...rest}
      autosave={autosave}
      onAutosaveChange={(next) => {
        onChange?.(next);
        setAutosave(next);
      }}
      onStart={rest.onStart ?? (() => undefined)}
    />
  );
}

describe("IntroScreen", () => {
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

  it("제목, 첫 문단, 네 줄, 고지, 저장 문단, 범위 문단이 copy.ts 의 문구 그대로 순서대로 나온다", async () => {
    await harness.render(<Host />);
    const copy = V40_COPY.intro;
    const bullets = introBullets("on", V40_COUNTS.items);
    const storage = introStorage("on");
    const order = [copy.brandLabel, copy.title, copy.lede, ...bullets, copy.notice, storage.before, storage.after, copy.scope];
    let cursor = -1;
    for (const piece of order) {
      const at = text().indexOf(piece);
      expect(at, piece).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("제목은 h1 하나이고 화면(영역)의 이름이다", async () => {
    await harness.render(<Host />);
    const headings = harness.container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe(V40_COPY.intro.title);
    const section = harness.container.querySelector("section")!;
    expect(labelledByText(section)).toBe(V40_COPY.intro.title);
  });

  it("질문 수는 상수에서 읽고 소요 시간은 적지 않는다", async () => {
    await harness.render(<Host />);
    expect(text()).toContain(`질문은 모두 ${V40_COUNTS.items}개예요`);
    expect(text()).not.toMatch(/\d+\s*(분|시간|초)/);
    expect(text()).not.toMatch(/약\s*\d/);
  });

  it("저장 문단의 처리방침 글자는 링크이고 새 창으로 열린다", async () => {
    await harness.render(<Host />);
    const link = harness.container.querySelector<HTMLAnchorElement>('a[href="/privacy"]');
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe(introStorage("on").linkLabel);
    expect(link!.getAttribute("rel")).toContain("noopener");
    expect(link!.closest("p")?.textContent).toBe(introStorage("on").plain);
    // 글 속 링크는 글자 높이가 15픽셀뿐이라 손가락으로 맞추기 어렵다: 위아래 안쪽 여백으로 눌리는 면을 넓힌다.
    expect(link!.className).toContain("py-2");
  });

  describe("저장 문구는 저장 상태를 따른다(꺼져 있거나 막혔는데 저장돼요라고 하지 않는다)", () => {
    const storageText = () => harness.container.querySelector("[data-intro-storage]")?.textContent ?? "";
    const bulletsText = () => [...harness.container.querySelectorAll("li")].map((item) => item.textContent).join("\n");

    it("켜져 있으면 브라우저에 저장된다는 것과, 앱 안 브라우저에서 열었다면 같은 곳에서 다시 열어야 한다는 것을 말한다", async () => {
      await harness.render(<Host initial="on" />);
      expect(storageText()).toContain("이 브라우저에만");
      expect(storageText()).toContain("카카오톡 같은 앱 안에서 열었다면 다음에도 같은 곳에서 열어야 이어서 할 수 있어요");
      expect(bulletsText()).toContain("멈춰도 이 브라우저에 저장돼요");
    });

    it("자동 저장이 꺼져 있으면 저장된다는 말이 어디에도 없고, 저장되지 않는다고 말한다", async () => {
      await harness.render(<Host initial="off" />);
      expect(bulletsText()).not.toContain("저장돼요");
      expect(storageText()).toContain("자동 저장이 꺼져 있어서 답은 저장되지 않고");
      expect(storageText()).not.toMatch(/일 동안 저장돼요|최근 .* 남아요/u);
      expect(storageText()).toContain("이용 통계를 기록하지 않아요");
      // 단추를 눌러 켜면 저장 문구가 도로 켜진 상태의 문구가 된다.
      await click(buttonNamed(V40_COPY.autosave.turnOnButton)!);
      expect(storageText()).toContain("이 브라우저에만");
      expect(bulletsText()).toContain("멈춰도 이 브라우저에 저장돼요");
    });

    it("브라우저가 저장을 막았으면 저장된다는 말이 없고 답을 보내지 않는다는 말만 남긴다", async () => {
      await harness.render(<Host initial="on" storageIssue="unavailable" />);
      expect(bulletsText()).not.toContain("저장돼요");
      expect(storageText()).not.toMatch(/일 동안|저장돼요|최근 .* 남아요/u);
      expect(storageText()).toContain("답은 웨딩한방에 보내지 않아요");
      expect(storageText()).toContain("이용 통계를 기록하지 않아요");
      expect(harness.container.querySelector('a[href="/privacy"]')).not.toBeNull();
    });

    it("세 갈래 모두 질문 수 줄과 처리방침 링크가 있고 고지는 한 번이다", async () => {
      for (const [initial, storageIssue] of [["on", null], ["off", null], ["on", "unavailable"]] as const) {
        await harness.render(<Host key={`${initial}-${storageIssue}`} initial={initial} storageIssue={storageIssue} />);
        expect(bulletsText()).toContain(`질문은 모두 ${V40_COUNTS.items}개예요`);
        expect(harness.container.querySelector('a[href="/privacy"]')).not.toBeNull();
        expect(notValidatedCount(harness.container)).toBe(1);
      }
    });
  });

  it("「검증을 마친 심리검사가 아니」 고지가 정확히 한 번 있다", async () => {
    await harness.render(<Host />);
    expect(notValidatedCount(harness.container)).toBe(1);
  });

  it("시작하기 단추는 주 단추 하나이고 누르면 onStart 를 부른다", async () => {
    const onStart = vi.fn();
    await harness.render(<Host onStart={onStart} />);
    const start = buttonNamed(V40_COPY.intro.startButton)!;
    expect(start.type).toBe("button");
    expect(start.disabled).toBe(false);
    expect(start.getAttribute("aria-disabled")).toBeNull();
    await click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("시작하기 단추는 화면 맨 아래 줄에 붙고 자동 저장 단추 뒤에 있다", async () => {
    await harness.render(<Host />);
    const bar = harness.container.querySelector("[data-action-bar]")!;
    expect(bar.contains(buttonNamed(V40_COPY.intro.startButton)!)).toBe(true);
    expect(isBefore(buttonNamed(V40_COPY.autosave.turnOffButton)!, buttonNamed(V40_COPY.intro.startButton)!)).toBe(true);
  });

  describe("시작 단추 줄은 소개가 짧든 길든 화면 아래에 붙는다(풀리는 순간 단추가 움직이지 않는다)", () => {
    const pinned = () => {
      const root = harness.container.querySelector<HTMLElement>('[data-screen="intro"]')!;
      const spacer = harness.container.querySelector<HTMLElement>("[data-pin-bar-spacer]");
      const bar = harness.container.querySelector<HTMLElement>("[data-action-bar]");
      return { root, spacer, bar };
    };

    it.each([
      ["저장소를 읽기 전(pending)", true],
      ["저장소를 읽은 뒤", false],
    ] as const)("%s: 뿌리가 화면 높이만큼 늘어나고 단추 줄 바로 앞에 남는 높이를 먹는 빈틈이 있다", async (_label, pending) => {
      await harness.render(<Host pending={pending} />);
      const { root, spacer, bar } = pinned();
      expect(root.className).toContain("min-h-dvh");
      expect(root.className).toContain("flex-col");
      expect(spacer, "단추 줄 앞 빈틈").not.toBeNull();
      expect(spacer!.nextElementSibling, "빈틈은 단추 줄 바로 앞이다").toBe(bar);
    });

    it("대기를 거둬도 같은 뿌리에서 빈틈과 단추 줄이 그대로 이어진다", async () => {
      await harness.render(<Host pending />);
      const before = pinned();
      await harness.render(<Host />);
      const after = pinned();
      expect(after.root).toBe(before.root);
      expect(after.spacer).toBe(before.spacer);
      expect(after.bar).toBe(before.bar);
    });

    it("라운지 안(embedded)은 바깥 화면이 높이를 정하므로 늘리지도 빈틈을 두지도 않는다", async () => {
      await harness.render(<Host embedded />);
      const { root, spacer, bar } = pinned();
      expect(root.className).not.toContain("min-h-dvh");
      expect(spacer).toBeNull();
      expect(bar).not.toBeNull();
    });

    it("하던 답 카드가 있으면 단추 줄이 없으니 빈틈도 없다", async () => {
      await harness.render(<Host resume={{ savedAt: null, onResume: () => undefined, onStartOver: () => undefined }} />);
      const { spacer, bar } = pinned();
      expect(bar).toBeNull();
      expect(spacer).toBeNull();
    });
  });

  it("번호, n/N, A/B 가 없고 숫자는 질문 수와 저장 기간뿐이다", async () => {
    await harness.render(<Host />);
    expect(visibleLabelProblems(harness.container, allowedNumberPhrases())).toEqual([]);
  });

  it("줄표가 없다(주장으로 쓰지 않는 말은 startFlowScreens.hygiene.test.tsx 가 화면 전체에서 본다)", async () => {
    await harness.render(<Host legacy={{ savedAt: null }} />);
    expect(hasDash(text())).toBe(false);
  });

  describe("자동 저장", () => {
    it("켜져 있으면 끄기 단추와 켜진 상태 한 줄, 꺼져 있으면 켜기 단추와 꺼진 상태 한 줄이다", async () => {
      await harness.render(<Host initial="on" />);
      expect(buttonNamed(V40_COPY.autosave.turnOffButton)).toBeDefined();
      expect(buttonNamed(V40_COPY.autosave.turnOnButton)).toBeUndefined();
      expect(text()).toContain(V40_COPY.autosave.statusOn);
      await harness.render(<Host key="off" initial="off" />);
      expect(buttonNamed(V40_COPY.autosave.turnOnButton)).toBeDefined();
      expect(text()).toContain(V40_COPY.autosave.statusOff);
      expect(text()).not.toContain(V40_COPY.autosave.statusOn);
    });

    it("누르면 반대 값을 알리고 단추 이름과 상태 줄이 바뀐다", async () => {
      const onChange = vi.fn();
      await harness.render(<Host initial="on" onChange={onChange} />);
      await click(buttonNamed(V40_COPY.autosave.turnOffButton));
      expect(onChange).toHaveBeenLastCalledWith("off");
      expect(buttonNamed(V40_COPY.autosave.turnOnButton)).toBeDefined();
      expect(text()).toContain(V40_COPY.autosave.statusOff);
      await click(buttonNamed(V40_COPY.autosave.turnOnButton));
      expect(onChange).toHaveBeenLastCalledWith("on");
    });

    it("상태 줄은 바뀔 때 읽히는 aria-live 영역 안에 있다", async () => {
      await harness.render(<Host />);
      const status = harness.container.querySelector("[data-autosave-status]")!;
      expect(status.closest('[aria-live="polite"]')).not.toBeNull();
      expect(status.closest('[role="status"]')).not.toBeNull();
    });

    it("방금 켜고 끈 결과 안내는 클라이언트가 준 값대로 보인다", async () => {
      await harness.render(<Host key="a" autosaveNote="turnedOff" initial="off" />);
      expect(text()).toContain(V40_COPY.autosave.turnedOffNote);
      await harness.render(<Host key="b" autosaveNote="turnedOn" initial="on" />);
      expect(text()).toContain(V40_COPY.autosave.turnedOnNote);
      await harness.render(<Host key="c" autosaveNote={null} initial="on" />);
      expect(text()).not.toContain(V40_COPY.autosave.turnedOnNote);
      expect(text()).not.toContain(V40_COPY.autosave.turnedOffNote);
    });

    it("저장된 답이 없어도 끄기 경고는 늘 있다(지난번 비교용 기록이 혼자 남아 있을 수 있고, 끄면 그것도 지워진다)", async () => {
      await harness.render(<Host />);
      const warning = autosaveTurnOffWarning({ saved: false, legacy: false });
      expect(warning).toContain("지난번 비교용 기록");
      expect(harness.container.querySelector("[data-autosave-warning]")?.textContent).toBe(warning);
    });

    it("이미 꺼져 있으면 끄기 경고는 없다", async () => {
      await harness.render(<Host initial="off" />);
      expect(harness.container.querySelector("[data-autosave-warning]")).toBeNull();
    });

    it("이전 웨딩코드 답이 있으면 끄기 전에 함께 지워진다고 알리고 단추의 설명으로 읽힌다", async () => {
      await harness.render(<Host legacy={{ savedAt: null }} />);
      const warning = autosaveTurnOffWarning({ saved: false, legacy: true })!;
      expect(harness.container.querySelector("[data-autosave-warning]")?.textContent).toBe(warning);
      expect(describedByText(buttonNamed(V40_COPY.autosave.turnOffButton)!)).toBe(warning);
    });

    it("하던 답이 있으면 그 답과 기록이 지워진다고, 둘 다 있으면 둘 다 알린다", async () => {
      const resume = { savedAt: null, onResume: vi.fn(), onStartOver: vi.fn() };
      await harness.render(<Host resume={resume} />);
      expect(harness.container.querySelector("[data-autosave-warning]")?.textContent).toBe(
        autosaveTurnOffWarning({ saved: true, legacy: false }),
      );
      await harness.render(<Host resume={resume} legacy={{ savedAt: null }} />);
      expect(harness.container.querySelector("[data-autosave-warning]")?.textContent).toBe(
        autosaveTurnOffWarning({ saved: true, legacy: true }),
      );
    });

    it("이미 꺼져 있으면 경고를 다시 보이지 않는다", async () => {
      await harness.render(<Host initial="off" legacy={{ savedAt: null }} />);
      expect(harness.container.querySelector("[data-autosave-warning]")).toBeNull();
    });

    it("저장할 수 없는 브라우저에서는 저장 단추와 저장 상태 말을 그리지 않고 저장 불가를 알린다", async () => {
      await harness.render(<Host storageIssue="unavailable" />);
      expect(buttonNamed(V40_COPY.autosave.turnOffButton)).toBeUndefined();
      expect(buttonNamed(V40_COPY.autosave.turnOnButton)).toBeUndefined();
      expect(text()).not.toContain(V40_COPY.autosave.statusOn);
      expect(text()).toContain(V40_COPY.storageNotice.unavailable);
      // 시작하기는 저장 없이도 할 수 있다.
      expect(buttonNamed(V40_COPY.intro.startButton)).toBeDefined();
    });
  });

  describe("이전 웨딩코드(v3.1) 카드", () => {
    it("저장이 없으면 카드가 없다", async () => {
      await harness.render(<Host />);
      expect(harness.container.querySelector('[data-section-card="legacy"]')).toBeNull();
      expect(text()).not.toContain(V40_COPY.intro.legacy.title);
    });

    it("저장이 있으면 시작 화면 맨 위에 읽기만 하는 카드가 나온다", async () => {
      await harness.render(<Host legacy={{ savedAt: null }} />);
      const card = harness.container.querySelector<HTMLElement>('[data-section-card="legacy"]')!;
      expect(card).not.toBeNull();
      expect(card.textContent).toContain(V40_COPY.intro.legacy.title);
      expect(card.textContent).toContain(V40_COPY.intro.legacy.body);
      expect(labelledByText(card)).toBe(V40_COPY.intro.legacy.title);
      expect(isBefore(card, harness.container.querySelector("h1")!)).toBe(true);
    });

    it("카드 안에는 단추도 링크도 없다(자동 이전 없음)", async () => {
      await harness.render(<Host legacy={{ savedAt: Date.UTC(2026, 8, 29, 3) }} />);
      const card = harness.container.querySelector<HTMLElement>('[data-section-card="legacy"]')!;
      expect(card.querySelectorAll("button, a, input, select, textarea, [role='button']")).toHaveLength(0);
    });

    it("저장 시각을 알면 날짜 한 줄을 보인다", async () => {
      const at = Date.UTC(2026, 8, 29, 3);
      await harness.render(<Host legacy={{ savedAt: at }} />);
      expect(harness.container.querySelector('[data-section-card="legacy"]')!.textContent).toContain(savedOnLine(at)!);
      await harness.render(<Host legacy={{ savedAt: null }} />);
      expect(harness.container.querySelector('[data-section-card="legacy"]')!.textContent).not.toMatch(/저장했어요/);
    });

    it("PreviousVersionCard 는 혼자서도 같은 문구를 그린다", async () => {
      await harness.render(<PreviousVersionCard savedAt={null} />);
      expect(harness.container.textContent).toContain(V40_COPY.intro.legacy.title);
      expect(harness.container.textContent).toContain(V40_COPY.intro.legacy.body);
      expect(harness.container.querySelectorAll("button, a")).toHaveLength(0);
    });
  });

  describe("하던 답이 있을 때", () => {
    it("하던 답 카드에 이어서 하기와 처음부터 다시 하기가 있고 시작하기는 없다", async () => {
      const onResume = vi.fn();
      const onStartOver = vi.fn();
      await harness.render(<Host resume={{ savedAt: Date.UTC(2026, 8, 28, 3), onResume, onStartOver }} />);
      const card = harness.container.querySelector<HTMLElement>('[data-section-card="resume"]')!;
      expect(card.textContent).toContain(V40_COPY.intro.resume.title);
      expect(card.textContent).toContain(V40_COPY.intro.resume.body);
      expect(card.textContent).toContain(savedOnLine(Date.UTC(2026, 8, 28, 3))!);
      expect(buttonNamed(V40_COPY.intro.startButton)).toBeUndefined();
      expect(harness.container.querySelector("[data-action-bar]")).toBeNull();

      await click(buttonNamed(V40_COPY.intro.resume.continueButton));
      expect(onResume).toHaveBeenCalledTimes(1);
      expect(onStartOver).not.toHaveBeenCalled();
      await click(buttonNamed(V40_COPY.intro.resume.restartButton));
      expect(onStartOver).toHaveBeenCalledTimes(1);
    });

    it("처음부터 다시 하면 저장된 답이 지워진다는 것을 누르기 전에 카드에서 말한다", async () => {
      await harness.render(<Host resume={{ savedAt: null, onResume: vi.fn(), onStartOver: vi.fn() }} />);
      const card = harness.container.querySelector<HTMLElement>('[data-section-card="resume"]')!;
      expect(card.textContent).toMatch(/처음부터 다시 하면 저장된 답은 지워져요/);
      expect(isBefore(card.querySelector("p")!, buttonNamed(V40_COPY.intro.resume.restartButton)!)).toBe(true);
    });

    it("하던 답 카드가 있어도 고지는 한 번이다", async () => {
      await harness.render(<Host resume={{ savedAt: null, onResume: vi.fn(), onStartOver: vi.fn() }} legacy={{ savedAt: null }} />);
      expect(notValidatedCount(harness.container)).toBe(1);
    });
  });

  describe("저장 문제와 위에 붙는 안내", () => {
    it("저장된 답을 읽지 못했으면 그 사실을 알린다", async () => {
      await harness.render(<Host storageIssue="invalid" />);
      expect(text()).toContain(V40_COPY.storageNotice.invalid);
    });

    it("기간이 지나 지웠으면 그 사실을 알린다", async () => {
      await harness.render(<Host storageIssue="expired" />);
      expect(text()).toContain(storageExpiredNote());
    });

    it("화면 위 안내(예: 링크를 읽지 못했어요)는 한 번 보이고 status 로 읽힌다", async () => {
      await harness.render(<Host notice={V40_COPY.error.brokenLink.notice} />);
      const notice = harness.container.querySelector<HTMLElement>("[data-intro-notice]")!;
      expect(notice.textContent).toBe(V40_COPY.error.brokenLink.notice);
      expect(notice.getAttribute("role")).toBe("status");
      await harness.render(<Host notice={null} />);
      expect(harness.container.querySelector("[data-intro-notice]")).toBeNull();
    });
  });

  describe("라운지 안(embedded)", () => {
    it("로그인해도 계정에 저장되지 않는다는 한 줄이 있고 단추 줄이 하단 탭 위로 올라간다", async () => {
      await harness.render(<Host embedded />);
      expect(harness.container.querySelector("[data-embedded-note]")?.textContent).toBe(V40_COPY.intro.embeddedNote);
      const bar = harness.container.querySelector<HTMLElement>("[data-action-bar]")!;
      expect(bar.className).toContain("max-md:bottom-[calc(75px+env(safe-area-inset-bottom))]");
      expect(bar.hasAttribute("data-embedded")).toBe(true);
    });

    it("바깥에서는 한 줄도 하단 탭 여백도 없다", async () => {
      await harness.render(<Host />);
      expect(harness.container.querySelector("[data-embedded-note]")).toBeNull();
      const bar = harness.container.querySelector<HTMLElement>("[data-action-bar]")!;
      expect(bar.className).not.toContain("75px");
      expect(bar.className).toContain("env(safe-area-inset-bottom)");
    });
  });

  it("화면이 뜨면 화면 뿌리로 초점이 간다(낭독기가 화면 이름을 읽는다)", async () => {
    await harness.render(<Host />);
    expect(document.activeElement).toBe(harness.container.querySelector("section"));
  });

  describe("저장 상태를 읽기 전(pending): 서버가 그리는 화면", () => {
    const storageText = () => harness.container.querySelector("[data-intro-storage]")?.textContent ?? "";
    const bulletsText = () => [...harness.container.querySelectorAll("li")].map((item) => item.textContent);
    const root = () => harness.container.querySelector<HTMLElement>('[data-screen="intro"]')!;

    it("시작 단추는 글자 그대로인데 누를 수 없고(disabled, aria-busy), 눌러도 onStart 를 부르지 않는다", async () => {
      const onStart = vi.fn();
      await harness.render(<Host pending onStart={onStart} />);
      const start = buttonNamed(V40_COPY.intro.startButton)!;
      expect(start.disabled).toBe(true);
      expect(start.getAttribute("aria-busy")).toBe("true");
      await click(start);
      expect(onStart).not.toHaveBeenCalled();
      expect(root().hasAttribute("data-pending")).toBe(true);
    });

    it("단추 바로 위에 불러오는 중이라는 안내가 status 로 있다(단추 아래가 아니다: 사라질 때 단추가 내려가지 않는다)", async () => {
      await harness.render(<Host pending />);
      const note = harness.container.querySelector<HTMLElement>("[data-intro-pending]")!;
      expect(note.textContent).toBe(V40_COPY.common.loadingLabel);
      expect(note.getAttribute("role")).toBe("status");
      const bar = harness.container.querySelector("[data-action-bar]")!;
      expect(bar.contains(note)).toBe(true);
      expect(isBefore(note, buttonNamed(V40_COPY.intro.startButton)!)).toBe(true);
    });

    it("제목은 h1 하나이고 소개 글 전체가 있다", async () => {
      await harness.render(<Host pending />);
      expect(harness.container.querySelectorAll("h1")).toHaveLength(1);
      expect(harness.container.querySelector("h1")?.textContent).toBe(V40_COPY.intro.title);
      for (const piece of [V40_COPY.intro.brandLabel, V40_COPY.intro.lede, ...introBullets("blocked", V40_COUNTS.items), V40_COPY.intro.notice, V40_COPY.intro.scope]) {
        expect(text(), piece).toContain(piece);
      }
    });

    it("자동 저장 켜기와 끄기 단추와 상태 줄은 그리지 않는다(실제 선호를 아직 모른다)", async () => {
      await harness.render(<Host pending initial="off" />);
      expect(harness.container.querySelector("[data-autosave-toggle]")).toBeNull();
      expect(buttonNamed(V40_COPY.autosave.turnOffButton)).toBeUndefined();
      expect(buttonNamed(V40_COPY.autosave.turnOnButton)).toBeUndefined();
      expect(text()).not.toContain(V40_COPY.autosave.statusOn);
      expect(text()).not.toContain(V40_COPY.autosave.statusOff);
      expect(harness.container.querySelector("[data-autosave-warning]")).toBeNull();
    });

    it("저장 문구는 켜짐, 꺼짐, 막힘 어느 쪽이어도 참인 갈래(blocked)와 같은 글이고 저장한다는 말이 없다", async () => {
      for (const initial of ["on", "off"] as const) {
        await harness.render(<Host key={initial} pending initial={initial} />);
        expect(storageText()).toBe(introStorage("blocked").plain);
        expect(bulletsText()).toEqual([...introBullets("blocked", V40_COUNTS.items)]);
        expect(text()).not.toContain("저장돼요");
        expect(text()).not.toContain("이 브라우저에만");
        expect(text()).not.toMatch(/일 동안|공용 기기/u);
        expect(storageText()).toContain("답은 웨딩한방에 보내지 않아요");
        expect(storageText()).toContain("이용 통계를 기록하지 않아요");
      }
    });

    it("처리방침 링크가 하나, 고지가 한 번이고 줄표와 번호가 없다", async () => {
      await harness.render(<Host pending />);
      const links = harness.container.querySelectorAll<HTMLAnchorElement>('a[href="/privacy"]');
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute("rel")).toContain("noopener");
      expect(notValidatedCount(harness.container)).toBe(1);
      expect(hasDash(text())).toBe(false);
      expect(visibleLabelProblems(harness.container, allowedNumberPhrases())).toEqual([]);
    });

    it("대기를 거두면 같은 화면이 이어진다: 단추가 풀리고 안내가 사라지며 자동 저장 단추가 생기고 저장 문구가 켜진 상태의 글이 된다", async () => {
      await harness.render(<Host pending />);
      const before = root();
      await harness.render(<Host />);
      expect(root()).toBe(before);
      expect(root().hasAttribute("data-pending")).toBe(false);
      expect(harness.container.querySelector("[data-intro-pending]")).toBeNull();
      const start = buttonNamed(V40_COPY.intro.startButton)!;
      expect(start.disabled).toBe(false);
      expect(start.getAttribute("aria-busy")).toBeNull();
      expect(buttonNamed(V40_COPY.autosave.turnOffButton)).toBeDefined();
      expect(storageText()).toBe(introStorage("on").plain);
    });

    it("pending 을 주지 않으면(기본) 대기 표시가 어디에도 없고 단추는 풀려 있다", async () => {
      await harness.render(<Host />);
      expect(root().hasAttribute("data-pending")).toBe(false);
      expect(harness.container.querySelector("[data-intro-pending]")).toBeNull();
      expect(buttonNamed(V40_COPY.intro.startButton)!.disabled).toBe(false);
    });

    it("브라우저에서 새로 만든 대기 화면(다시 시작 등)은 화면 뿌리로 초점이 간다", async () => {
      await harness.render(<Host pending />);
      expect(document.activeElement).toBe(root());
    });
  });

  describe("서버가 그린 대기 화면을 이어받을 때(하이드레이션)", () => {
    let container: HTMLDivElement;
    let root: Root | undefined;
    let scrollIntoView: ReturnType<typeof vi.fn>;
    let consoleError: ReturnType<typeof vi.spyOn>;
    const hadScrollIntoView = "scrollIntoView" in Element.prototype;
    const noop = () => undefined;
    const intro = (props: Partial<IntroScreenProps> = {}) => <IntroScreen pending autosave="on" onAutosaveChange={noop} onStart={noop} {...props} />;

    beforeEach(() => {
      // jsdom 에는 scrollIntoView 가 없다. 화면이 스크롤을 시도하는지 보려고 심는다.
      scrollIntoView = vi.fn();
      Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scrollIntoView });
      consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      container = document.createElement("div");
      document.body.appendChild(container);
    });
    afterEach(async () => {
      await act(async () => root?.unmount());
      root = undefined;
      container.remove();
      consoleError.mockRestore();
      if (!hadScrollIntoView) delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    async function hydrate(html: string, element: ReactElement, onRecoverableError: (error: unknown) => void): Promise<void> {
      container.innerHTML = html;
      await act(async () => {
        root = hydrateRoot(container, element, { onRecoverableError });
      });
    }

    it("서버 HTML 의 시작 단추는 disabled 이고, 하이드레이션은 불일치 없이 같은 노드를 이어받으며 초점도 스크롤도 옮기지 않는다", async () => {
      const html = renderToString(intro());
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>시작하기<\/button>/u);
      expect(html).not.toContain("data-autosave-toggle");
      const onRecoverableError = vi.fn();
      await hydrate(html, intro(), onRecoverableError);
      const heading = container.querySelector("h1");
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(document.body);
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);

      // 저장소를 읽고 대기가 풀려도 같은 화면은 읽던 자리를 옮기지 않는다.
      await act(async () => root?.render(intro({ pending: false })));
      expect(container.querySelector("h1")).toBe(heading);
      expect(container.querySelector("[data-intro-pending]")).toBeNull();
      expect(container.querySelector<HTMLButtonElement>("[data-action-bar] button")!.disabled).toBe(false);
      expect(container.querySelector("[data-autosave-toggle]")).not.toBeNull();
      expect(document.activeElement).toBe(document.body);
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    });

    it("서버 화면이 문서에 있는 채 하이드레이션 없이 새로 그려도(입구의 늦게 불러오는 경계가 이어받기를 포기하는 실제 경우) 초점과 스크롤을 옮기지 않는다", async () => {
      container.innerHTML = renderToString(intro());
      const serverHeading = container.querySelector("h1");
      const client = createRoot(container);
      root = client;
      await act(async () => client.render(intro()));
      // 서버 노드를 이어받지 않고 새 노드로 바뀌었다.
      expect(container.querySelector("h1")).not.toBe(serverHeading);
      expect(container.querySelector("h1")?.textContent).toBe(V40_COPY.intro.title);
      expect(document.activeElement).toBe(document.body);
      expect(scrollIntoView).not.toHaveBeenCalled();
      // 대기가 풀려도 같다.
      await act(async () => client.render(intro({ pending: false })));
      expect(container.querySelector<HTMLButtonElement>("[data-action-bar] button")!.disabled).toBe(false);
      expect(document.activeElement).toBe(document.body);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("문서에 있는 서버 화면이 대기 화면이 아니면(이미 풀린 시작 화면을 새로 그릴 때) 새 화면은 초점을 받는다", async () => {
      container.innerHTML = renderToString(intro({ pending: false }));
      const client = createRoot(container);
      root = client;
      await act(async () => client.render(intro()));
      expect(document.activeElement).toBe(container.querySelector("section"));
      expect(scrollIntoView).toHaveBeenCalled();
    });

    it("StrictMode 로 감싸도 불일치가 없고 초점과 스크롤을 옮기지 않는다", async () => {
      const html = renderToString(intro());
      const onRecoverableError = vi.fn();
      await hydrate(html, <StrictMode>{intro()}</StrictMode>, onRecoverableError);
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(document.body);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });

  it("키보드만으로 모든 단추에 닿을 수 있다(tabindex 를 죽인 단추가 없다)", async () => {
    await harness.render(<Host legacy={{ savedAt: null }} />);
    for (const button of buttons()) {
      expect(button.tabIndex).toBeGreaterThanOrEqual(0);
      expect(button.disabled).toBe(false);
    }
    for (const link of harness.container.querySelectorAll<HTMLAnchorElement>("a")) expect(link.tabIndex).toBeGreaterThanOrEqual(0);
  });
});
