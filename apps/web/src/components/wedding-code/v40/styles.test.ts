import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TOUCH_TARGET_PX,
  buttonFocusFix,
  card,
  cardSelected,
  cx,
  focusRing,
  itemIds,
  nextRadioIndex,
  noticeBox,
  noticeText,
  srOnly,
  stemText,
  touchTarget,
} from "./styles";

describe("cx", () => {
  it("거짓 값과 빈 문자열을 버리고 나머지를 공백으로 잇는다", () => {
    expect(cx("a", false, null, undefined, "", "b")).toBe("a b");
    expect(cx()).toBe("");
  });
});

describe("nextRadioIndex", () => {
  it("오른쪽과 아래는 다음, 왼쪽과 위는 이전이다", () => {
    expect(nextRadioIndex("ArrowRight", 1, 6)).toBe(2);
    expect(nextRadioIndex("ArrowDown", 1, 6)).toBe(2);
    expect(nextRadioIndex("ArrowLeft", 1, 6)).toBe(0);
    expect(nextRadioIndex("ArrowUp", 1, 6)).toBe(0);
  });

  it("끝에서 반대쪽 끝으로 돈다", () => {
    expect(nextRadioIndex("ArrowRight", 5, 6)).toBe(0);
    expect(nextRadioIndex("ArrowDown", 4, 5)).toBe(0);
    expect(nextRadioIndex("ArrowLeft", 0, 6)).toBe(5);
    expect(nextRadioIndex("ArrowUp", 0, 4)).toBe(3);
  });

  it("방향키가 아니거나 움직일 곳이 없으면 null 이다", () => {
    for (const key of ["Tab", "Enter", " ", "Home", "End", "a", ""]) expect(nextRadioIndex(key, 1, 6)).toBeNull();
    expect(nextRadioIndex("ArrowRight", 0, 1)).toBeNull();
    expect(nextRadioIndex("ArrowRight", 0, 0)).toBeNull();
    expect(nextRadioIndex("ArrowRight", -1, 6)).toBeNull();
    expect(nextRadioIndex("ArrowRight", 6, 6)).toBeNull();
    expect(nextRadioIndex("ArrowRight", 1.5, 6)).toBeNull();
  });
});

describe("itemIds", () => {
  it("접두어마다 서로 다른 id 를 만들고 한 접두어 안에서도 겹치지 않는다", () => {
    const first = Object.values(itemIds("a"));
    const second = Object.values(itemIds("b"));
    expect(new Set(first).size).toBe(first.length);
    expect(first.filter((id) => second.includes(id))).toEqual([]);
    expect(itemIds("q1").stem).toBe("q1-stem");
  });
});

describe("itemIds 의 새 자리", () => {
  it("인용문, 두 카드 글, 덜 채움 안내의 id 가 접두어를 따른다", () => {
    const ids = itemIds("q7");
    expect(ids.quote).toBe("q7-quote");
    expect(ids.card0).toBe("q7-card-0");
    expect(ids.card1).toBe("q7-card-1");
    expect(ids.incomplete).toBe("q7-incomplete");
  });
});

describe("초점 링과 안내 상자", () => {
  it("초점 링은 윤곽선을 없애지 않고 숨긴다: 고대비에서 투명 윤곽선이 되살아난다", () => {
    expect(focusRing).toContain("focus-visible:outline-hidden");
    expect(focusRing).not.toContain("outline-none");
    expect(focusRing).toContain("focus-visible:ring-2");
    // 공용 Button 위에 얹는 조각은 중요 표시로 Button 의 윤곽선 없애기를 이긴다.
    expect(buttonFocusFix).toBe("focus-visible:outline-hidden!");
  });

  it("앞말은 줄 길이를 고르게 맞춘다(마지막 줄에 낱말 하나만 남지 않게)", () => {
    expect(stemText).toMatch(/text-balance/);
  });

  it("안내 상자는 바탕과 안쪽 여백만 준다(글 모양은 noticeText 가 맡고 색만으로 알리지 않는다)", () => {
    expect(noticeBox).toMatch(/rounded/);
    expect(noticeBox).toMatch(/px-3/);
    expect(noticeBox).toMatch(/py-2/);
    // 같은 바탕색의 인용 상자와 가르는 왼쪽 선
    expect(noticeBox).toMatch(/border-l-4/);
    expect(noticeText).toMatch(/font-medium/);
  });
});

describe("공유 상수", () => {
  it("터치 목표는 44픽셀 이상의 클래스를 가리킨다", () => {
    expect(TOUCH_TARGET_PX).toBeGreaterThanOrEqual(44);
    expect(touchTarget).toMatch(/min-h-11/);
    expect(touchTarget).toMatch(/min-w-11/);
  });

  it("고른 카드는 중요 표시로 바탕 모양을 이긴다(합쳐 써도 순서에 기대지 않는다)", () => {
    expect(card).toMatch(/border-paper-outline/);
    for (const token of cardSelected.split(" ").filter((item) => item.startsWith("border-") || item.startsWith("bg-"))) {
      expect(token.endsWith("!")).toBe(true);
    }
    expect(srOnly).toBe("sr-only");
  });
});

/**
 * 이 폴더의 소스 위생. 한국어는 직접 입력하고(유니코드 이스케이프 금지), 줄바꿈은 LF 이며, 화면에 나갈 수 있는 글에 줄표가 없다.
 * 줄표는 긴 줄표와 짧은 줄표(엔 대시)다. 클래스 이름 안의 하이픈은 줄표가 아니다.
 */
describe("소스 위생", () => {
  const dir = __dirname;
  const files = [
    "ItemFrame.tsx",
    "PairInput.tsx",
    "ReactInput.tsx",
    "ChoiceInput.tsx",
    "BestWorstInput.tsx",
    "SplitInput.tsx",
    "styles.ts",
    "radioGroup.ts",
    "localCopy.ts",
  ];

  it.each(files)("%s 에 유니코드 이스케이프, 캐리지 리턴, 줄표가 없다", (file) => {
    const source = readFileSync(path.join(dir, file), "utf8");
    expect(source).not.toMatch(/\\u[0-9a-fA-F]{4}/);
    expect(source).not.toContain("\r");
    expect(source).not.toMatch(/[–—]/);
  });
});
