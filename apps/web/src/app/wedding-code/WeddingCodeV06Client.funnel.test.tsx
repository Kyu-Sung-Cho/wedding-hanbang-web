// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_WEDDING_CODE_SCENE_CONFIG } from "@/lib/weddingCode/scene/config";
import WeddingCodeV06Client from "./WeddingCodeV06Client";

const captured = vi.hoisted(() => [] as Array<[string, Record<string, unknown>]>);
vi.mock("@/lib/analytics", () => ({
  captureWeddingCodeEvent: (event: string, properties: Record<string, unknown> = {}) => {
    captured.push([event, properties]);
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 흐름 기록은 「몇 명이 시작해서 몇 번째에서 멈췄나」만 답해야 한다.
 * 어떤 답을 골랐는지·코드·링크가 호출 인자에 한 번이라도 실리면 이 제품의 약속이 깨진다.
 */
describe("WeddingCodeV06Client funnel events", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    captured.length = 0;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: null }), { status: 200 }));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    window.history.replaceState(null, "", "/wedding-code");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("시작·장면 도달·완료·공유를 답 없이 순서대로 남긴다", async () => {
    const config = CURRENT_WEDDING_CODE_SCENE_CONFIG;
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={null} bothCodes={null} />));
    const clickText = async (text: string) => {
      const button = [...container.querySelectorAll("button")].find(candidate => candidate.textContent?.includes(text));
      expect(button, text).toBeDefined();
      await act(async () => button!.click());
    };

    await clickText("시작하기");
    const picked: string[] = [];
    for (const [position, question] of config.questions.entries()) {
      if (position === 3) {
        await clickText("이 장면은 건너뛸게요");
        continue;
      }
      if (position === 5) {
        // 뒤로 갔다 다시 온 장면은 도달 기록을 두 번 남기지 않는다.
        await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="이전 문항"]')!.click());
        await clickText("다음 문항");
      }
      const option = question.options[position % question.options.length];
      picked.push(option.label);
      await act(async () => container.querySelector<HTMLButtonElement>(`[data-option="${option.value}"]`)!.click());
      await clickText(position === config.questions.length - 1 ? "결과 보기" : "다음 문항");
    }
    const shareButton = container.querySelector<HTMLButtonElement>("[data-share-url]")!;
    const shareUrl = shareButton.getAttribute("data-share-url")!;
    await act(async () => shareButton.click());

    const names = captured.map(([event]) => event);
    expect(names[0]).toBe("wedding_code_intro_viewed");
    expect(names[1]).toBe("wedding_code_started");
    const reached = captured.filter(([event]) => event === "wedding_code_scene_reached");
    expect(reached.map(([, properties]) => properties.scene_index))
      .toEqual(config.questions.map((_, position) => position + 1));
    expect(captured.find(([event]) => event === "wedding_code_completed")?.[1]).toEqual({
      version: config.version,
      has_partner_link: false,
      scene_total: config.questions.length,
      answered_count: config.questions.length - 1,
      skipped_count: 1,
    });
    expect(names.at(-1)).toBe("wedding_code_share_copied");

    const payload = JSON.stringify(captured);
    const code = decodeURIComponent(shareUrl.split("a=")[1]);
    expect(code.length).toBe(config.questions.length);
    expect(payload).not.toContain(code);
    expect(payload).not.toContain("#v=");
    for (const label of picked) expect(payload).not.toContain(label);
  });

  it("두 사람 링크로 바로 열린 비교 화면은 완료가 아니라 비교 열람으로 센다", async () => {
    const config = CURRENT_WEDDING_CODE_SCENE_CONFIG;
    const answers = Object.fromEntries(config.questions.map(question => [question.key, "A" as const]));
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={"A".repeat(config.questions.length)} bothCodes={{ first: answers, second: answers }} />));

    expect(captured.map(([event]) => event)).toEqual(["wedding_code_comparison_viewed"]);
    expect(captured[0][1]).toEqual({ version: config.version, has_partner_link: true });
  });
});
