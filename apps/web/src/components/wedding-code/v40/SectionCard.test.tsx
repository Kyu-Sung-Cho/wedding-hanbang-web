import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionBar } from "./SectionCard";
import { createHarness, type Harness } from "./inputTestKit";

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
  document.documentElement.style.scrollPaddingBottom = "";
});
afterEach(async () => {
  await harness.unmount();
  document.documentElement.style.scrollPaddingBottom = "";
});

/**
 * 붙어 있는 단추 줄은 화면 아래를 덮는다. 키보드 초점이 아래쪽 컨트롤로 가면 브라우저가 그 컨트롤을 화면 아래 끝에 맞추므로,
 * 문서에 아래쪽 스크롤 여백이 없으면 컨트롤이 단추 줄 밑에 깔려 초점을 받고도 보이지 않는다(작은 휴대폰에서 405곳 중 54곳이 그랬다).
 */
describe("ActionBar: 초점이 단추 줄 밑에 깔리지 않게 하는 스크롤 여백", () => {
  it("단추 줄이 있는 동안 문서에 아래쪽 스크롤 여백이 있고 사라지면 원래 값으로 돌아간다", async () => {
    document.documentElement.style.scrollPaddingBottom = "1px";
    await harness.render(
      <ActionBar>
        <button type="button">다음</button>
      </ActionBar>,
    );
    expect(document.documentElement.style.scrollPaddingBottom).toBe("calc(7rem + env(safe-area-inset-bottom))");
    await harness.render(<p>단추 줄 없음</p>);
    expect(document.documentElement.style.scrollPaddingBottom).toBe("1px");
  });

  it("라운지 안(embedded)은 하단 탭이 더 덮으므로 여백이 더 크다", async () => {
    await harness.render(
      <ActionBar embedded>
        <button type="button">다음</button>
      </ActionBar>,
    );
    expect(document.documentElement.style.scrollPaddingBottom).toBe("calc(12rem + env(safe-area-inset-bottom))");
  });

  it("단추 줄이 있는 화면에서 다른 단추 줄 화면으로 바뀌어도 여백이 그대로 남는다(정리가 먼저, 설정이 나중)", async () => {
    await harness.render(
      <div key="a">
        <ActionBar>
          <button type="button">이전 화면</button>
        </ActionBar>
      </div>,
    );
    await harness.render(
      <div key="b">
        <ActionBar>
          <button type="button">다음 화면</button>
        </ActionBar>
      </div>,
    );
    expect(document.documentElement.style.scrollPaddingBottom).toBe("calc(7rem + env(safe-area-inset-bottom))");
  });
});

describe("ActionBar: 바탕색", () => {
  it("독립 페이지에서는 뒤 화면(body)과 같은 바탕색, 라운지 안에서는 앱 셸의 페이지 바탕색이다(다르면 짧은 화면 아래에 띠가 생긴다)", async () => {
    await harness.render(
      <ActionBar>
        <button type="button">다음</button>
      </ActionBar>,
    );
    const bar = harness.container.querySelector<HTMLElement>("[data-action-bar]")!;
    expect(bar.className).toContain("bg-[var(--ivory-50)]");
    expect(bar.className).not.toContain("--hb-surface-page");
    await harness.render(
      <ActionBar embedded>
        <button type="button">다음</button>
      </ActionBar>,
    );
    const embeddedBar = harness.container.querySelector<HTMLElement>("[data-action-bar]")!;
    expect(embeddedBar.className).toContain("bg-[var(--hb-surface-page)]");
    expect(embeddedBar.className).not.toContain("--ivory-50");
  });
});
