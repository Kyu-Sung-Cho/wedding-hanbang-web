import { describe, expect, it, vi } from "vitest";
import {
  AMORA_DOCK_RATIO_DEFAULT,
  AMORA_DOCK_RATIO_MAX,
  AMORA_DOCK_RATIO_MIN,
  AMORA_DOCK_RATIO_STORAGE_KEY,
  AMORA_PREFILL_MAX_LENGTH,
  amoraDockRatioFromPointer,
  clampAmoraDockRatio,
  isWideAmoraDockRatio,
  nextAmoraDockToggleRatio,
  normalizeAmoraPrefill,
  openAmoraInsteadOfLink,
  readAmoraDockRatio,
  snapAmoraDockRatio,
  writeAmoraDockRatio,
  type AmoraDockApi,
  type AmoraLinkClick,
} from "./amoraDock";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

// 2026-11-13 파운더 결정: 아모라는 라운지 옆자리를 "반정도 … 혹은 뭐 1/3정도" 차지한다.
describe("아모라 옆자리 너비", () => {
  it("1/3 에서 1/2 사이로만 둔다. 숫자가 아니면 기본값(1/2)이다", () => {
    expect(AMORA_DOCK_RATIO_DEFAULT).toBe(1 / 2);
    expect(clampAmoraDockRatio(0.1)).toBe(AMORA_DOCK_RATIO_MIN);
    expect(clampAmoraDockRatio(0.9)).toBe(AMORA_DOCK_RATIO_MAX);
    expect(clampAmoraDockRatio(0.4)).toBe(0.4);
    expect(clampAmoraDockRatio(Number.NaN)).toBe(AMORA_DOCK_RATIO_DEFAULT);
    expect(clampAmoraDockRatio(Number.POSITIVE_INFINITY)).toBe(AMORA_DOCK_RATIO_DEFAULT);
  });

  it("1/3·1/2 근처에서 손을 떼면 그 값에 붙이고, 가운데는 그대로 둔다", () => {
    expect(snapAmoraDockRatio(0.35)).toBe(AMORA_DOCK_RATIO_MIN);
    expect(snapAmoraDockRatio(0.48)).toBe(AMORA_DOCK_RATIO_MAX);
    expect(snapAmoraDockRatio(0.42)).toBe(0.42);
    expect(snapAmoraDockRatio(0.2)).toBe(AMORA_DOCK_RATIO_MIN);
  });

  it("넓게·좁게 버튼은 1/2 쪽이면 1/3 으로, 1/3 쪽이면 1/2 로 간다", () => {
    expect(nextAmoraDockToggleRatio(AMORA_DOCK_RATIO_MAX)).toBe(AMORA_DOCK_RATIO_MIN);
    expect(nextAmoraDockToggleRatio(AMORA_DOCK_RATIO_MIN)).toBe(AMORA_DOCK_RATIO_MAX);
    expect(nextAmoraDockToggleRatio(0.42)).toBe(AMORA_DOCK_RATIO_MIN);
    expect(nextAmoraDockToggleRatio(0.4)).toBe(AMORA_DOCK_RATIO_MAX);
    expect(isWideAmoraDockRatio(AMORA_DOCK_RATIO_MAX)).toBe(true);
    expect(isWideAmoraDockRatio(AMORA_DOCK_RATIO_MIN)).toBe(false);
  });

  it("손잡이 자리에서 아모라 몫을 잰다(아모라는 줄의 오른쪽 끝)", () => {
    const row = { rowLeft: 220, rowWidth: 1200 };
    expect(amoraDockRatioFromPointer({ ...row, clientX: 820 })).toBe(0.5);
    expect(amoraDockRatioFromPointer({ ...row, clientX: 1000 })).toBeCloseTo(0.35, 10);
    // 줄 밖으로 끌어도 범위를 벗어나지 않는다.
    expect(amoraDockRatioFromPointer({ ...row, clientX: 1400 })).toBe(AMORA_DOCK_RATIO_MIN);
    expect(amoraDockRatioFromPointer({ ...row, clientX: 0 })).toBe(AMORA_DOCK_RATIO_MAX);
    // 줄 너비를 못 재면 기본값이다(0 으로 나누지 않는다).
    expect(amoraDockRatioFromPointer({ rowLeft: 0, rowWidth: 0, clientX: 10 })).toBe(AMORA_DOCK_RATIO_DEFAULT);
  });
});

describe("고른 너비 기억", () => {
  it("이 브라우저에 범위 안의 값으로 적고 다시 읽는다", () => {
    const storage = memoryStorage();
    writeAmoraDockRatio(0.4, storage);
    expect(storage.values.get(AMORA_DOCK_RATIO_STORAGE_KEY)).toBe("0.4");
    expect(readAmoraDockRatio(storage)).toBe(0.4);

    writeAmoraDockRatio(5, storage);
    expect(readAmoraDockRatio(storage)).toBe(AMORA_DOCK_RATIO_MAX);
  });

  it("없거나 이상한 값, 막힌 저장소에서는 기본값으로 연다", () => {
    expect(readAmoraDockRatio(memoryStorage())).toBe(AMORA_DOCK_RATIO_DEFAULT);
    expect(readAmoraDockRatio(memoryStorage({ [AMORA_DOCK_RATIO_STORAGE_KEY]: "넓게" }))).toBe(AMORA_DOCK_RATIO_DEFAULT);
    expect(readAmoraDockRatio(memoryStorage({ [AMORA_DOCK_RATIO_STORAGE_KEY]: "0.1" }))).toBe(AMORA_DOCK_RATIO_MIN);
    expect(readAmoraDockRatio(throwingStorage)).toBe(AMORA_DOCK_RATIO_DEFAULT);
    expect(readAmoraDockRatio(null)).toBe(AMORA_DOCK_RATIO_DEFAULT);
    expect(() => writeAmoraDockRatio(0.4, throwingStorage)).not.toThrow();
    expect(() => writeAmoraDockRatio(0.4, null)).not.toThrow();
  });
});

describe("들고 가는 질문", () => {
  it("앞뒤 빈칸을 걷고, 비었으면 넘기지 않는다", () => {
    expect(normalizeAmoraPrefill("  드레스 준비, 지금 뭐부터 하면 될까?  ")).toBe("드레스 준비, 지금 뭐부터 하면 될까?");
    expect(normalizeAmoraPrefill("")).toBeNull();
    expect(normalizeAmoraPrefill("   ")).toBeNull();
    expect(normalizeAmoraPrefill(undefined)).toBeNull();
    expect(normalizeAmoraPrefill(null)).toBeNull();
  });

  it("너무 긴 질문은 상한에서 자른다", () => {
    const long = "가".repeat(AMORA_PREFILL_MAX_LENGTH + 50);
    expect(normalizeAmoraPrefill(long)).toHaveLength(AMORA_PREFILL_MAX_LENGTH);
  });
});

describe("아모라로 가는 링크", () => {
  function linkClick(overrides: Partial<AmoraLinkClick> = {}) {
    return {
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      ...overrides,
    };
  }

  function dockApi() {
    return { isOpen: false, docked: true, open: vi.fn(), close: vi.fn(), toggle: vi.fn() } satisfies AmoraDockApi;
  }

  it("그냥 누르면 이동하지 않고 그 자리에서 아모라를 연다", () => {
    const click = linkClick();
    const dock = dockApi();

    expect(openAmoraInsteadOfLink(click, dock, { prefill: "예산부터 볼까?" })).toBe(true);
    expect(click.preventDefault).toHaveBeenCalledTimes(1);
    expect(dock.open).toHaveBeenCalledWith({ prefill: "예산부터 볼까?" });
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
    ["가운데 단추", { button: 1 }],
  ] as const)("%s 클릭은 사람이 새 탭을 고른 것이라 링크대로 둔다", (_name, overrides) => {
    const click = linkClick(overrides);
    const dock = dockApi();

    expect(openAmoraInsteadOfLink(click, dock)).toBe(false);
    expect(click.preventDefault).not.toHaveBeenCalled();
    expect(dock.open).not.toHaveBeenCalled();
  });

  it("옆에 열 자리가 없는 화면에서는 링크대로 대화 화면으로 간다", () => {
    const click = linkClick();

    expect(openAmoraInsteadOfLink(click, null)).toBe(false);
    expect(click.preventDefault).not.toHaveBeenCalled();
  });

  it("앞선 처리가 이미 이동을 막았으면 아모라를 열지 않는다", () => {
    const click = linkClick({ defaultPrevented: true });
    const dock = dockApi();

    expect(openAmoraInsteadOfLink(click, dock)).toBe(false);
    expect(dock.open).not.toHaveBeenCalled();
  });
});
