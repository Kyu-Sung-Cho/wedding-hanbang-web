import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AxisBlock } from "./AxisBlock";
import { WeddingCodeResultEditionProvider, useWeddingCodeResultMetadata } from "./ResultEditionContext";
import { click, createHarness, type Harness } from "./inputTestKit";
import { resultCase, textOf } from "./resultTestKit";

let harness: Harness;
beforeEach(() => { harness = createHarness(); });
afterEach(async () => { await harness.unmount(); });

function FacetTalkProbe() {
  const { facetTalk } = useWeddingCodeResultMetadata();
  return <p>{facetTalk.form} {facetTalk.recover}</p>;
}

function SupportAppearanceProbe() {
  const { letterInfo } = useWeddingCodeResultMetadata();
  return <p>{[...letterInfo("H").appearances, ...letterInfo("A").appearances].join(" ")}</p>;
}

describe("문항판에 따른 결과 근거의 범위", () => {
  it.each(["v4.0-tendency", "v4.1-depth"])("%s는 기존 측면과 설명을 유지한다", async (version) => {
    const { result, quotes } = resultCase("swua-example");
    await harness.render(<WeddingCodeResultEditionProvider version={version}><AxisBlock axis={result.axes[0]} quotes={quotes[0]} onReview={vi.fn()} /></WeddingCodeResultEditionProvider>);
    expect(textOf(harness.container)).toContain("쓰는 곳");
    expect(textOf(harness.container)).toContain("계약 확인");
    expect(textOf(harness.container)).not.toContain("더 낼 만한 이유");
  });

  it("v4.2는 같은 코드에도 새 문항의 판단 근거와 예시를 적용한다", async () => {
    const { result, quotes } = resultCase("swua-example");
    await harness.render(<WeddingCodeResultEditionProvider version="v4.2-depth"><AxisBlock axis={result.axes[0]} quotes={quotes[0]} onReview={vi.fn()} /></WeddingCodeResultEditionProvider>);
    expect(textOf(harness.container)).toContain("더 낼 만한 이유");
    expect(textOf(harness.container)).toContain("비교할 근거");
    expect(textOf(harness.container)).not.toContain("쓰는 곳");
    const more = [...harness.container.querySelectorAll("button")].find((button) => button.textContent?.includes("더 보기"))!;
    await click(more);
    expect(textOf(harness.container)).toContain("추가안의 가치를 판단할 때 그날 얻을 경험부터");
    expect(textOf(harness.container)).not.toContain("남는 돈은 사진이나 꽃");
  });

  it("v4.2 장면 대화도 가족 의견을 모으는 순서와 지친 날의 첫 행동을 따른다", async () => {
    await harness.render(<WeddingCodeResultEditionProvider version="v4.2-depth"><FacetTalkProbe /></WeddingCodeResultEditionProvider>);
    expect(textOf(harness.container)).toContain("둘의 초안을 먼저 만들지, 가족 의견부터 모을지");
    expect(textOf(harness.container)).toContain("마음을 먼저 돌아볼지, 남은 일의 부담부터 덜지");
    expect(textOf(harness.container)).not.toContain("익숙한 방식");
    expect(textOf(harness.container)).not.toContain("혼자 회복할 시간");
  });

  it.each(["v4.0-tendency", "v4.1-depth"])("%s 장면 대화는 그 판의 질문 범위를 보존한다", async (version) => {
    await harness.render(<WeddingCodeResultEditionProvider version={version}><FacetTalkProbe /></WeddingCodeResultEditionProvider>);
    expect(textOf(harness.container)).toContain("익숙한 방식");
    expect(textOf(harness.container)).toContain("혼자 회복할 시간");
  });

  it("새판의 도움 예시는 첫 행동만 설명하고 확인하지 않은 회복 결과를 단정하지 않는다", async () => {
    await harness.render(<WeddingCodeResultEditionProvider version="v4.2-depth"><SupportAppearanceProbe /></WeddingCodeResultEditionProvider>);
    expect(textOf(harness.container)).toContain("남은 메시지에 답하기 전에 무엇이 버거웠는지");
    expect(textOf(harness.container)).toContain("남은 답장 한 통을 마친 뒤");
    expect(textOf(harness.container)).not.toContain("풀려요");
    expect(textOf(harness.container)).not.toContain("마음이 가벼워져요");
  });
});
