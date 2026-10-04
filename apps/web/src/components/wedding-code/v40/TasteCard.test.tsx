import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { click, createHarness, labelledByText, type Harness } from "./inputTestKit";
import { TasteCard } from "./TasteCard";

/**
 * 공용 Button 은 안쪽 주소를 next/link 로 그린다. 운영 빌드의 next/link 는 화면에 들어오면 그 쪽을 미리 요청하므로
 * 「v4 화면은 서버 요청이 없다」는 약속을 지키려면 미리 불러오기를 꺼야 한다. 대역이 받은 속성을 그대로 적어 두고 본다.
 */
const seen = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));

vi.mock("next/link", () => ({
  default: ({ prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean | null }) => {
    seen.props.push({ prefetch, ...props });
    return <a {...props} />;
  },
}));

let harness: Harness;
beforeEach(() => {
  seen.props.length = 0;
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
});

describe("TasteCard 링크", () => {
  it("next/link 의 미리 불러오기를 끈다(화면에 들어오기만 해도 서버에 요청하지 않는다)", async () => {
    await harness.render(<TasteCard onOpen={vi.fn()} href="/wedding-code/taste" />);
    expect(seen.props).toHaveLength(1);
    expect(seen.props[0]?.prefetch).toBe(false);
  });

  it("새 탭에서 열어 지금 보던 결과 화면이 사라지지 않고, 새 탭이라는 말은 낭독기에만 읽힌다", async () => {
    await harness.render(<TasteCard onOpen={vi.fn()} href="/wedding-code/taste" />);
    const link = harness.container.querySelector("a")!;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    const hint = [...link.querySelectorAll("span")].find((span) => (span.textContent ?? "").includes(V40_COPY.taste.newTabHint));
    expect(hint?.className).toContain("sr-only");
    expect(link.textContent).toContain(V40_COPY.taste.button);
  });

  it("주소가 없으면 링크가 아니라 단추이고 next/link 를 쓰지 않는다", async () => {
    await harness.render(<TasteCard onOpen={vi.fn()} />);
    expect(seen.props).toHaveLength(0);
    expect(harness.container.querySelector("a")).toBeNull();
    expect(harness.container.querySelector("button")).not.toBeNull();
  });

  it("링크 주소는 받은 주소 그대로다(취향을 코드나 링크에 섞지 않는다)", async () => {
    await harness.render(<TasteCard onOpen={vi.fn()} href="/wedding-code/taste" />);
    expect(harness.container.querySelector("a")?.getAttribute("href")).toBe("/wedding-code/taste");
    expect(seen.props[0]?.href).toBe("/wedding-code/taste");
  });
});

describe("TasteCard 누르기", () => {
  it("링크로 그려도 누르면 눌렀다는 사실을 한 번 알리고 이동은 막지 않는다", async () => {
    const onOpen = vi.fn();
    await harness.render(<TasteCard onOpen={onOpen} href="/wedding-code/taste" />);
    // 문서까지 올라온 클릭을 보고 막힌 적이 있는지 적은 뒤에야 막는다(막지 않으면 대역 링크가 이동을 흉내 내려 한다).
    let preventedBeforeDocument: boolean | null = null;
    const observe = (event: Event) => {
      preventedBeforeDocument = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", observe);
    try {
      await click(harness.container.querySelector("a"));
    } finally {
      document.removeEventListener("click", observe);
    }
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(preventedBeforeDocument).toBe(false);
  });

  it("주소가 없는 단추를 누르면 눌렀다는 사실을 한 번 알린다", async () => {
    const onOpen = vi.fn();
    await harness.render(<TasteCard onOpen={onOpen} />);
    const button = harness.container.querySelector("button");
    expect(button?.textContent?.trim()).toBe(V40_COPY.taste.button);
    await click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("TasteCard 구역", () => {
  it("선택이고 코드와는 따로라는 제목과 본문을 그린다", async () => {
    await harness.render(<TasteCard onOpen={vi.fn()} />);
    const section = harness.container.querySelector('section[data-result-section="taste"]');
    expect(section).not.toBeNull();
    const text = section?.textContent ?? "";
    expect(text).toContain(V40_COPY.taste.title);
    expect(text).toContain(V40_COPY.taste.body);
    expect(text).toContain("(선택)");
    expect(text).toContain("코드와는 따로");
    expect(text).toContain("안 해도 코드는 그대로예요");
    // 식을 올리지 않는 사람에게 이 카드가 권하지 않는다(최종 점검 Q3).
    expect(text).toContain("식을 올리지 않는다면 건너뛰어도 돼요");
  });

  it("구역 이름은 제목이고 접두어를 주면 그 접두어의 제목을 가리킨다", async () => {
    await harness.render(<TasteCard onOpen={vi.fn()} />);
    const section = harness.container.querySelector('section[data-result-section="taste"]')!;
    expect(section.getAttribute("aria-labelledby")).toBe("wc40-taste-title");
    expect(labelledByText(section)).toBe(V40_COPY.taste.title);
    await harness.render(<TasteCard onOpen={vi.fn()} idPrefix="other" />);
    const other = harness.container.querySelector('section[data-result-section="taste"]')!;
    expect(other.getAttribute("aria-labelledby")).toBe("other-title");
    expect(labelledByText(other)).toBe(V40_COPY.taste.title);
  });
});
