// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { CURRENT_WEDDING_CODE_SCENE_CONFIG as config } from "@/lib/weddingCode/scene/config";
import { encodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import WeddingCodeV06Client from "./WeddingCodeV06Client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe("실제로 공개되는 비교 화면", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    window.history.replaceState(null, "", "/wedding-code");
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); });
  async function render(first: WeddingCodeV06Answers, second: WeddingCodeV06Answers) {
    const a = encodeWeddingCodeV06(first, config.questions), b = encodeWeddingCodeV06(second, config.questions);
    window.history.replaceState(null, "", `/wedding-code#v=${config.version}&a=${a}&b=${b}`);
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={a} bothCodes={{ first, second }} />));
  }
  it("공통 응답 0개를 같은 방향이라고 설명하지 않는다", async () => {
    await render({ A1: "A" }, { B1: "A" });
    expect(container.textContent).toContain("함께 답한 장면이 없어요");
    expect(container.querySelector('[data-result="couple"]')?.textContent).not.toMatch(/모두 같은|방향이 같/);
    expect(container.querySelector("[data-pair-state]")).toBeNull();
  });
  it("상대 링크에서 내 모든 문항을 건너뛰면 열리지 않는 비교 링크를 만들지 않는다", async () => {
    const first = { A1: "A" } as const;
    const a = encodeWeddingCodeV06(first, config.questions);
    window.history.replaceState(null, "", `/wedding-code#v=${config.version}&a=${a}`);
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={first} partnerCode={a} bothCodes={null} />));
    await act(async () => Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes("나도 답해보기"))?.click());
    for (const question of config.questions) {
      await act(async () => container.querySelector<HTMLButtonElement>(`[data-skip-question="${question.key}"]`)?.click());
    }
    expect(container.querySelector("[data-share-url]")).toBeNull();
    expect(container.textContent).toContain("내가 답한 장면이 없어서 결과 링크를 만들 수 없어요");
  });
  it("반대 응답이 상쇄된 동률을 같은 답으로 표시하지 않는다", async () => {
    await render({ C1: "A", C2: "B" }, { C1: "C", C2: "A" });
    expect(container.querySelector('[data-pair-axis="coordinationScope"] [data-pair-state]')?.getAttribute("data-pair-state")).toBe("different");
    expect(container.textContent).not.toContain("함께 답한 자리가 없어서");
    expect(container.textContent).toContain("반반이라 글자를 비교하지 않았어요");
    // 글자만 보여주지 않고 짧은 이름을 함께 쓴다(혼자 결과의 범례와 같은 이름).
    expect(container.querySelector('[data-code-slot="coordinationScope"]')?.textContent).toContain("글자 없음");
  });
  it("1자리만 같은 부분 결과를 네 글자 모두 같다고 하지 않는다", async () => {
    await render({ A1: "A" }, { A1: "A" });
    expect(container.querySelector("[data-code-pair]")?.textContent).toContain("비교할 수 있는 1자리");
    expect(container.textContent).not.toContain("글자가 모두 같아요");
    // 같은 자리도 글자와 짧은 이름을 함께 보여준다.
    expect(container.querySelector('[data-code-slot="decisionCriteria"]')?.textContent)
      .toContain("먼저 답한 사람 V(조건 먼저) · 나중에 답한 사람 V(조건 먼저)");
  });
  it("같은 쪽으로 집계한 서로 다른 답도 펼친 목록에 모두 남는다", async () => {
    await render({ B1: "C" }, { B1: "D" });
    const scene = container.querySelector('[data-compared-scene="B1"]');
    const question = config.questions.find(q => q.key === "B1")!;
    expect(scene?.textContent).toContain(question.options.find(o => o.value === "C")!.label);
    expect(scene?.textContent).toContain(question.options.find(o => o.value === "D")!.label);
    expect(container.querySelector("h1")?.textContent).toContain("1곳에서 다른 답");
  });
  it("다시 답하기를 누른 후 새로고침해도 예전 두 사람 결과로 돌아가지 않는다", async () => {
    await render({ A1: "A" }, { A1: "B" });
    expect(container.querySelector("[data-share-text]")?.getAttribute("data-share-text")).not.toContain("내 웨딩코드");
    const restart = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes("처음부터 새로 답하기"));
    expect(restart).toBeTruthy();
    await act(async () => restart?.click());
    expect(new URLSearchParams(window.location.hash.slice(1)).has("b")).toBe(false);
  });
  it("다른 잘못된 링크로 바뀌면 이전 사람의 결과와 입력을 남기지 않는다", async () => {
    await render({ C1: "A", C2: "B" }, { C1: "C", C2: "A" });
    await act(async () => {
      window.history.replaceState(null, "", "/wedding-code#v=unknown&a=AAAA");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(container.querySelector('[data-result="couple"]')).toBeNull();
    expect(container.textContent).toContain("이 링크는 열 수 없어요");
    await act(async () => {
      window.history.replaceState(null, "", "/wedding-code");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(container.textContent).not.toContain("같은 수로 골랐어요");
    expect(container.textContent).toContain("시작하기");
  });
});
