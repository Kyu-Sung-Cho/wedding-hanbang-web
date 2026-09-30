import { StrictMode, act } from "react";
import { click, createHarness, type Harness } from "@/components/wedding-code/v40/inputTestKit";
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { fixtureByName } from "@/lib/weddingCode/v40/fixtures";
import { fromStored } from "@/lib/weddingCode/v40/present";
import { readProgress, writeProgress } from "@/lib/weddingCode/v40/storage";
import type {
  DecodedCode,
  FormBit,
  ItemId,
  ProgressSnapshot,
  StorageLike,
  V40Fixture,
  ViewAnswer,
  WeddingCodeV40ClientProps,
} from "@/lib/weddingCode/v40/types";
import { WeddingCodeV40ClientWithDeps, type WeddingCodeV40ClientDeps } from "./WeddingCodeV40Client";

/**
 * 웨딩코드 4.0 클라이언트 시험이 함께 쓰는 도구(시험 파일이 아니다).
 * 소스 가드가 훑는 파일이라 주장으로 쓰지 않는 낱말 목록과 저장 키 이름을 두지 않는다(그런 것은 *.test.tsx 안에만 둔다).
 * 질문은 문항 문구에 기대지 않고 고정 표본의 저장값을 화면 답으로 바꿔 실제 화면의 입력을 눌러 답한다.
 */

export const bank = WEDDING_CODE_V40_BANK;
export const NOW = Date.UTC(2026, 8, 30, 3, 0, 0);
export const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 가짜 저장소
// ---------------------------------------------------------------------------

/** 던지지 않는 가짜 저장소. 읽기와 쓰기, 지우기를 순서대로 기록하고, 켜 두면 던진다. */
export class FakeStorage implements StorageLike {
  readonly data = new Map<string, string>();
  readonly log: string[] = [];
  failSet = false;
  failGet = false;
  failRemove = false;

  getItem(key: string): string | null {
    if (this.failGet) throw new Error("blocked");
    this.log.push(`get:${key}`);
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error("full");
    this.log.push(`set:${key}`);
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    if (this.failRemove) throw new Error("blocked");
    this.log.push(`remove:${key}`);
    this.data.delete(key);
  }

  /** 쓰거나 지운 기록만. */
  writes(): string[] {
    return this.log.filter((entry) => !entry.startsWith("get:"));
  }
}

// ---------------------------------------------------------------------------
// 고정 표본
// ---------------------------------------------------------------------------

export function fixture(name: string): V40Fixture {
  const found = fixtureByName(name);
  if (found === undefined) throw new Error(`고정 표본이 없어요: ${name}`);
  return found;
}

export function decodedOf(sample: V40Fixture): DecodedCode {
  return { formBit: sample.formBit, responses: sample.responses };
}

/** 표본의 폼 비트가 그대로 나오게 하는 난수(0.5 보다 작으면 폼 비트 0). */
export function randomFor(sample: V40Fixture): () => number {
  return () => (sample.formBit === 1 ? 0.9 : 0.1);
}

/** 68개를 모두 답한 채 결과 화면에서 저장한 것처럼 만든 진행 저장 스냅샷. */
export function resultSnapshotOf(sample: V40Fixture): ProgressSnapshot {
  return { formBit: sample.formBit, responses: sample.responses, screen: "result", cursor: 0, skippedReviewDone: true };
}

/** 처음 질문 화면 screens 개를 답하고 다음 화면에서 멈춘 진행 저장 스냅샷. */
export function partialSnapshotOf(sample: V40Fixture, screens: number): ProgressSnapshot {
  const answered: Record<ItemId, string> = {};
  for (const ids of bank.screens.slice(0, screens)) for (const id of ids) answered[id] = sample.responses[id];
  const nextId = bank.screens[screens]?.[0];
  const cursor = nextId === undefined ? 0 : (bank.codeIndexById.get(nextId) ?? 0);
  return { formBit: sample.formBit, responses: answered, screen: "questions", cursor, skippedReviewDone: false };
}

/** 진행 저장을 storage.ts 의 쓰기 함수로 심는다(저장 키 이름을 여기서 부르지 않는다). */
export function seedProgress(storage: StorageLike, snapshot: ProgressSnapshot, at: number = NOW): void {
  const written = writeProgress(storage, bank, snapshot, null, at);
  if (written.status !== "saved") throw new Error(`진행 저장을 심지 못했어요: ${written.status}`);
}

/** 다른 창이 이미 있는 진행 저장을 새 진행으로 바꿔 쓴 것을 흉내 낸다(지금 저장된 원문을 기대값으로 삼아 쓴다). */
export function overwriteProgress(storage: StorageLike, snapshot: ProgressSnapshot, at: number = NOW): void {
  const current = readProgress(storage, bank, at);
  const written = writeProgress(storage, bank, snapshot, current.raw, at);
  if (written.status !== "saved") throw new Error(`진행 저장을 바꿔 쓰지 못했어요: ${written.status}`);
}

// ---------------------------------------------------------------------------
// 그리기와 조작
// ---------------------------------------------------------------------------

export type ClientOverrides = Partial<WeddingCodeV40ClientProps> & {
  readonly deps?: WeddingCodeV40ClientDeps;
  /** 개발 서버처럼 React StrictMode 로 감싸 그린다(효과를 두 번씩 돌려 본다). */
  readonly strict?: boolean;
};

/**
 * 기본 출처는 같은 사이트 상대 주소(빈 문자열)다. 이 파일은 소스 가드가 훑어서 외부 주소를 적지 못한다.
 * 절대 주소가 필요한 시험은 shareOrigin 을 직접 준다.
 */
export function clientProps(overrides: ClientOverrides = {}) {
  const { strict, deps, ...props } = overrides;
  void strict;
  return {
    shareOrigin: "",
    initial: { partner: null, both: null },
    resolved: true,
    ...props,
    // 시험은 화면을 순식간에 넘기므로 두 번 눌림 방지 시간(기본 400밀리초)을 끈다. 그 시간을 시험하는 시험만 turnGuardMs 를 직접 준다.
    deps: { turnGuardMs: 0, ...deps },
  } satisfies Omit<ClientOverrides, "strict">;
}

function clientElement(overrides: ClientOverrides) {
  const element = <WeddingCodeV40ClientWithDeps {...clientProps(overrides)} />;
  return overrides.strict === true ? <StrictMode>{element}</StrictMode> : element;
}

export interface Mounted {
  readonly harness: Harness;
  readonly container: HTMLElement;
  rerender(overrides: ClientOverrides): Promise<void>;
  unmount(): Promise<void>;
}

/** 클라이언트를 그리고 부팅(저장소 읽기)이 끝날 때까지 기다린다. */
export async function mountClient(overrides: ClientOverrides = {}): Promise<Mounted> {
  const harness = createHarness();
  await harness.render(clientElement(overrides));
  await settle(0);
  return {
    harness,
    container: harness.container,
    async rerender(next) {
      await harness.render(clientElement({ ...overrides, ...next }));
      await settle(0);
    },
    unmount: () => harness.unmount(),
  };
}

/** 짧은 시간제한과 이어진 갱신이 끝나게 기다린다. */
export async function settle(ms: number = 120): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });
}

/** 지금 보이는 화면 이름(data-screen). 불러오는 중이면 loading. */
export function screenName(container: ParentNode): string {
  if (container.querySelector("[data-v40-loading]") !== null) return "loading";
  return container.querySelector("[data-screen]")?.getAttribute("data-screen") ?? "none";
}

export function textOf(root: { textContent: string | null }): string {
  return (root.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function buttonWithText(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => textOf(button) === label);
  if (found === undefined) throw new Error(`단추가 없어요: ${label}`);
  return found;
}

export function hasButtonWithText(root: ParentNode, label: string): boolean {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].some((button) => textOf(button) === label);
}

export async function pressText(root: ParentNode, label: string): Promise<void> {
  await click(buttonWithText(root, label));
}

/** 결과 화면 코드 줄의 글자 네 개를 이은 것. */
export function shownCode(container: ParentNode): string {
  return [...container.querySelectorAll<HTMLElement>("[data-code-letter]")].map((element) => element.getAttribute("data-code-letter") ?? "").join("");
}

/** 지금 질문 화면의 문항 id 들(화면 순서). */
export function itemsOnScreen(container: ParentNode): ItemId[] {
  return [...container.querySelectorAll<HTMLElement>("[data-item]")].map((element) => element.getAttribute("data-item") ?? "");
}

function radiosIn(scope: ParentNode): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>('[role="radio"]')];
}

/** 문항 하나의 화면 답을 실제 입력을 눌러 낸다. */
export async function answerInDom(container: ParentNode, id: ItemId, answer: ViewAnswer): Promise<void> {
  const scope = container.querySelector<HTMLElement>(`[data-item="${id}"]`);
  if (scope === null) throw new Error(`화면에 문항이 없어요: ${id}`);
  switch (answer.fmt) {
    case "escape": {
      const buttons = [...scope.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
      await click(buttons[answer.which === "unsure" ? 0 : 1]);
      return;
    }
    case "pair":
    case "self":
    case "react":
      await click(radiosIn(scope)[answer.cell]);
      return;
    case "recall":
    case "instant":
      await click(radiosIn(scope)[answer.option]);
      return;
    case "bestworst": {
      const best = scope.querySelectorAll<HTMLInputElement>('[data-group="best"] input')[answer.best ?? -1];
      const worst = scope.querySelectorAll<HTMLInputElement>('[data-group="worst"] input')[answer.worst ?? -1];
      await click(best);
      await click(worst);
      return;
    }
    case "split": {
      const adders = [...scope.querySelectorAll<HTMLButtonElement>('[data-step="add"]')];
      for (let entry = 0; entry < answer.counts.length; entry += 1) {
        for (let chunk = 0; chunk < answer.counts[entry]; chunk += 1) await click(adders[entry]);
      }
      return;
    }
  }
}

/** 표본이 정한 답으로 지금 질문 화면의 문항을 모두 답한다. formBit 은 클라이언트가 고른 폼 비트(표본과 같게 맞춰 두었다). */
export async function answerScreenLikeFixture(container: ParentNode, sample: V40Fixture, screenFormBit: FormBit = sample.formBit): Promise<void> {
  for (const id of itemsOnScreen(container)) {
    const item = bank.byId.get(id);
    if (item === undefined) throw new Error(`은행에 없는 문항: ${id}`);
    const answer = fromStored(item, screenFormBit, sample.responses[id]);
    if (answer === null) throw new Error(`화면 답으로 바꾸지 못했어요: ${id}`);
    await answerInDom(container, id, answer);
  }
}

export interface DriveLog {
  /** 지나간 화면 이름을 순서대로. */
  readonly screens: string[];
  /** 마지막 화면 이름. */
  readonly last: string;
}

/**
 * 시작 화면에서 시작하기를 눌러 표본으로 끝까지 간다. 쉬는 카드와 마지막 정리 카드는 이어서 하기로 넘긴다.
 * 결과, 두 사람 결과, 비교 불가, 관문 같은 끝 화면(questions, rest, self-intro 가 아닌 화면)에서 멈춘다.
 */
export async function driveToEnd(
  container: HTMLElement,
  sample: V40Fixture,
  options: { readonly start?: boolean; readonly onScreen?: (name: string) => void } = {},
): Promise<DriveLog> {
  const screens: string[] = [];
  if (options.start !== false) {
    const startLabel = hasButtonWithText(container, V40_COPY.receive.answerButton) ? V40_COPY.receive.answerButton : V40_COPY.intro.startButton;
    await pressText(container, startLabel);
  }
  for (let step = 0; step < 220; step += 1) {
    const name = screenName(container);
    // 결과 전에 한 번 다시 보여 주는 넘어간 질문은 질문 화면과 다른 이름으로 적는다.
    const label = name === "questions" && container.querySelector('[data-edit-mode="skipped"]') !== null ? "skipped-review" : name;
    const previous = screens[screens.length - 1];
    if (label !== previous) screens.push(label);
    options.onScreen?.(name);
    if (name === "questions") {
      await answerScreenLikeFixture(container, sample);
      const next = container.querySelector<HTMLElement>('[data-nav="next"]');
      await click(next);
    } else if (name === "rest" || name === "self-intro") {
      await pressText(container, V40_COPY.rest.continueButton);
    } else {
      return { screens, last: name };
    }
  }
  throw new Error(`끝까지 가지 못했어요: ${screens.join(" > ")}`);
}
