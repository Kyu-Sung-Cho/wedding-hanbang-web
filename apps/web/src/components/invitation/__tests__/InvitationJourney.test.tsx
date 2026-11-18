import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_JOURNEY, JOURNEY_COPY, type JourneyModel } from "@hanbang/shared/invitation";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import InvitationJourney from "../InvitationJourney";
import { allButtons, buttonNamed, cleanup, click, linkNamed, render, testRoute, text } from "./dom";

const noop = () => undefined;

function renderJourney(model: JourneyModel = EXAMPLE_JOURNEY, overrides: Partial<React.ComponentProps<typeof InvitationJourney>> = {}) {
  return render(
    <InvitationJourney model={model} resolveRoute={testRoute} onToggleStage={noop} onToggleAddOn={noop} {...overrides} />,
  );
}

function withOff(key: string): JourneyModel {
  return { ...EXAMPLE_JOURNEY, rows: EXAMPLE_JOURNEY.rows.map((row) => (row.key === key ? { ...row, off: true } : row)) };
}

/** 준비 순서(`Journey.dc`). 아홉 단계의 상태와 넣고 빼기를 본다. */
describe("InvitationJourney", () => {
  afterEach(cleanup);

  it("제목과 안내, 아홉 단계를 순서대로 그린다", async () => {
    const { container } = await renderJourney();

    expect(text(container.querySelector("h1"))).toBe(JOURNEY_COPY.title);
    expect(container.textContent).toContain(JOURNEY_COPY.intro);
    const rows = Array.from(container.querySelectorAll("li[data-step]"));
    expect(rows.map((row) => row.getAttribute("data-step"))).toEqual(EXAMPLE_JOURNEY.rows.map((row) => row.key));
    expect(rows.map((row) => text(row.querySelector("span")))).toEqual(
      ["01", "02", "03", "04", "05", "06", "07", "08", "09"],
    );
  });

  it("끝난 단계에는 완료 표시가 있고, 지금 단계만 분홍 면을 깐다", async () => {
    const { container } = await renderJourney();

    const states = Array.from(container.querySelectorAll("li[data-step]")).map((row) => row.getAttribute("data-state"));
    expect(states).toEqual(["done", "done", "now", "next", "next", "next", "next", "next", "next"]);

    const done = Array.from(container.querySelectorAll('li[data-state="done"]'));
    for (const row of done) {
      const check = row.querySelector('svg[role="img"]');
      expect(check?.getAttribute("aria-label")).toBe(JOURNEY_COPY.done);
    }
    const now = container.querySelector('li[data-state="now"]');
    expect(now?.className).toContain("bg-inv-step-now");
    expect(now?.className).toContain("-mx-4");
    expect(text(now)).toContain("지금 하고 있어요. 후보 3곳");
    for (const row of Array.from(container.querySelectorAll('li[data-state="next"]'))) {
      expect(row.className).toContain("border-b");
      expect(row.className).not.toContain("bg-inv-step-now");
    }
  });

  it("넣고 뺄 수 있는 단계에만 빼기 단추가 있고, 단추는 단계 이름으로 설명된다", async () => {
    const { container } = await renderJourney();

    const removes = allButtons(container).filter((button) => text(button) === JOURNEY_COPY.remove);
    expect(removes).toHaveLength(2);
    expect(removes.map((button) => text(document.getElementById(button.getAttribute("aria-describedby") ?? "")))).toEqual([
      "첫인사와 상견례",
      "신혼여행",
    ]);
  });

  it("빼기를 누르면 그 단계 이름을 알린다", async () => {
    const onToggleStage = vi.fn();
    const { container } = await renderJourney(EXAMPLE_JOURNEY, { onToggleStage });

    const families = container.querySelector('li[data-step="families"]');
    await click(families?.querySelector("button"));
    expect(onToggleStage).toHaveBeenCalledExactlyOnceWith("families");
  });

  it("뺀 단계는 다시 넣기·뺐다는 설명·그은 글자로 바뀐다", async () => {
    const { container } = await renderJourney(withOff("honeymoon"));

    const honeymoon = container.querySelector('li[data-step="honeymoon"]');
    expect(text(honeymoon?.querySelector("button"))).toBe(JOURNEY_COPY.restore);
    expect(text(honeymoon)).toContain(JOURNEY_COPY.removedSub);
    expect(text(honeymoon)).not.toContain("본식과 따로 준비해도 돼요");
    const title = honeymoon?.querySelector('[id]');
    expect(title?.className).toContain("line-through");
    expect(title?.className).toContain("text-inv-off-text");
  });

  it("넣기 단추: 누르면 알리고, 넣은 것은 눌림으로 보인다", async () => {
    const onToggleAddOn = vi.fn();
    const { container } = await renderJourney(EXAMPLE_JOURNEY, { onToggleAddOn });

    const rings = buttonNamed(container, "반지와 예물 넣기");
    expect(rings.getAttribute("aria-pressed")).toBe("false");
    expect(rings.className).toContain("border-dashed");
    await click(rings);
    expect(onToggleAddOn).toHaveBeenCalledExactlyOnceWith("rings");

    await cleanup();
    const added: JourneyModel = {
      ...EXAMPLE_JOURNEY,
      addOns: EXAMPLE_JOURNEY.addOns.map((addOn) => ({ ...addOn, added: addOn.key === "home" })),
    };
    const second = await renderJourney(added);
    expect(buttonNamed(second.container, "신혼집 준비 넣기").getAttribute("aria-pressed")).toBe("true");
  });

  it("이 순서로 할게요: 기본은 홈 링크, 넘겨주면 그 일을 한다", async () => {
    const { container } = await renderJourney();
    expect(linkNamed(container, JOURNEY_COPY.confirm).getAttribute("href")).toBe("/test/home");
    expect(linkNamed(container, JOURNEY_COPY.back).getAttribute("href")).toBe("/test/home");

    await cleanup();
    const onConfirm = vi.fn();
    const second = await renderJourney(EXAMPLE_JOURNEY, { onConfirm });
    await click(buttonNamed(second.container, JOURNEY_COPY.confirm));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
