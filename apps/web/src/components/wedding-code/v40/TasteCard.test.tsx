import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { createHarness, type Harness } from "./inputTestKit";
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
});
