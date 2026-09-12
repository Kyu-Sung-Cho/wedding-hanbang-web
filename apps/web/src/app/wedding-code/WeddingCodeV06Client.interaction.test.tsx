// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_WEDDING_CODE_SCENE_CONFIG } from "@/lib/weddingCode/scene/config";
import { useAuthStore } from "@/stores/authStore";
import WeddingCodeV06Client from "./WeddingCodeV06Client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("WeddingCodeV06Client interaction", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: null }), { status: 200 }));
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

  it("한 장면의 응답 지연 결과는 반복·함께 검토로 과장하지 않고 원문과 부분 코드를 보여준다", async () => {
    const config = CURRENT_WEDDING_CODE_SCENE_CONFIG;
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={null} bothCodes={null} />));
    const clickText = async (text: string) => {
      const button = [...container.querySelectorAll("button")].find(candidate => candidate.textContent?.includes(text));
      expect(button).toBeDefined();
      await act(async () => button!.click());
    };
    await clickText("시작하기");
    for (const question of config.questions) {
      if (question.key === "B5") {
        await act(async () => container.querySelector<HTMLButtonElement>('[data-option="A"]')!.click());
        await clickText("다음 문항");
      } else {
        await clickText("이 장면은 우리와 안 맞아요");
      }
    }
    const result = container.querySelector('[data-result="solo"]')!;
    expect(result.querySelector("h1")?.textContent).toBe("내가 이번에 고른 것");
    expect(result.textContent).toContain("답한 1장면만 셌고");
    expect(result.textContent).toContain("둘 다 못 받아서 답이 며칠씩 밀렸다");
    expect(result.textContent).toContain("연락을 받지 못한 경험과 함께 검토한 경험은 달라요");
    expect(container.textContent).not.toContain("둘이 같이 보는 답을 더 많이 골랐어요");
    expect(result.textContent).not.toContain("반복해서 고른");
    expect(container.querySelector('[data-share-url]')?.getAttribute("data-share-url")).toMatch(/#v=[^&]+&a=-{9}A-{10}$/);
  });

  it("계약할 뻔한 한 장면을 답하면 배지·본문에 실제 경험을 보존하고 공유 답도 그대로 남긴다", async () => {
    const config = CURRENT_WEDDING_CODE_SCENE_CONFIG;
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={null} bothCodes={null} />));
    const clickText = async (text: string) => {
      const button = [...container.querySelectorAll("button")].find(candidate => candidate.textContent?.includes(text));
      expect(button).toBeDefined();
      await act(async () => button!.click());
    };
    await clickText("시작하기");
    for (const question of config.questions) {
      if (question.key === "D4") {
        await act(async () => container.querySelector<HTMLButtonElement>('[data-option="D"]')!.click());
        await clickText("다음 문항");
      } else {
        await clickText("이 장면은 우리와 안 맞아요");
      }
    }
    const result = container.querySelector('[data-result="solo"]')!;
    expect(result.textContent).toContain("답한 1장면만 셌고");
    expect(result.textContent).toContain("깎아준다는 말에 그 자리에서 계약할 뻔했다");
    expect(result.textContent).toContain("계약할 뻔한 경험과 할 일을 정리한 경험은 달라요");
    expect(container.textContent).toContain("할 일과 결정에 관한 답을 더 많이 골랐어요");
    expect(container.textContent).not.toContain("먼저 할 일을 정하는 답");
    expect(container.querySelector('[data-wedding-code="···A"]')).not.toBeNull();
    expect(container.querySelector('[data-share-url]')?.getAttribute("data-share-url")).toMatch(/#v=v0\.8-code&a=-{18}D-$/);
  });

  it("moves from the intro through an answered question", async () => {
    const config = CURRENT_WEDDING_CODE_SCENE_CONFIG;

    await act(async () => {
      root.render(
        <WeddingCodeV06Client
          shareOrigin="https://hanbang.ai"
          version={config.version}
          partnerAnswers={null}
          partnerCode={null}
          bothCodes={null}
        />,
      );
    });

    const startButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("시작하기"));
    expect(startButton).toBeTruthy();

    await act(async () => startButton?.click());

    const firstQuestion = config.questions[0];
    expect(container.textContent).toContain(firstQuestion.scene);
    expect(container.textContent).toContain(firstQuestion.question);

    const nextButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("다음 문항")) as HTMLButtonElement | undefined;
    expect(nextButton?.disabled).toBe(true);

    const firstOption = container.querySelector<HTMLButtonElement>(
      `[data-option="${firstQuestion.options[0].value}"]`,
    );
    await act(async () => firstOption?.click());
    expect(firstOption?.getAttribute("aria-pressed")).toBe("true");
    expect(nextButton?.disabled).toBe(false);

    await act(async () => nextButton?.click());
    expect(container.textContent).toContain(config.questions[1].scene);
  });

  /**
   * 혼자 끝까지 답한 사람이 실제로 보는 화면. 상대가 답하기 전에도 **내 답의 셈과 인용,
   * 상대에게 할 말, 계약 전에 챙길 것**이 남아야 한다. 예전 개인 결과는 고른 문장 네 개를
   * 되돌려주는 것이 전부여서, 여기서 아무것도 알게 되지 않았다.
   */
  it("혼자 스무 장면을 끝내면 내 답을 읽어주는 결과가 나온다", async () => {
    const config = CURRENT_WEDDING_CODE_SCENE_CONFIG;

    await act(async () => {
      root.render(
        <WeddingCodeV06Client
          shareOrigin="https://hanbang.ai"
          version={config.version}
          partnerAnswers={null}
          partnerCode={null}
          bothCodes={null}
        />,
      );
    });

    const click = async (selector: string) => {
      const element = container.querySelector<HTMLButtonElement>(selector);
      await act(async () => element?.click());
    };
    const clickText = async (text: string) => {
      const button = Array.from(container.querySelectorAll("button"))
        .find((candidate) => candidate.textContent?.includes(text));
      await act(async () => button?.click());
    };

    await clickText("시작하기");

    // 네 축 모두 한쪽으로 몰리게 고른다. 선택지 위치가 문항마다 달라 letter가 섞인다.
    const picks = [
      "A", "A", "C", "B", "A",
      "A", "B", "C", "A", "A",
      "A", "A", "C", "B", "A",
      "A", "B", "C", "A", "A",
    ];
    for (const [index, pick] of picks.entries()) {
      await click(`[data-option="${pick}"]`);
      await clickText(index === picks.length - 1 ? "결과 보기" : "다음 문항");
    }

    const result = container.querySelector('[data-result="solo"]');
    expect(result).toBeTruthy();

    const text = result?.textContent ?? "";
    // 축 네 개가 모두 읽힌다.
    for (const axis of config.axes) {
      expect(container.querySelector(`[data-self-axis="${axis.key}"]`), axis.key).toBeTruthy();
      expect(text, axis.labelKo).toContain(axis.labelKo);
    }
    // 셈, 인용, 다음 행동이 모두 있다.
    expect(text).toMatch(/답한 5장면 중 5곳에서/);
    expect(text).toContain(config.questions[0].options[0].label);
    expect(text).toContain("상대에게 미리 말해두기");
    expect(text).toContain("한 가지 챙긴다면");
    expect(text).toContain("한 번도 고르지 않았어요");
    // 받침에 맞는 조사가 붙어야 한다 — 문구가 바뀔 때 제일 먼저 틀리는 자리다.
    expect(text).toContain("“사진·영상과 분위기에 관한 생각”과 “기대하거나 마음에 남은 점” 쪽 문장은 한 번도 고르지 않았어요");
    expect(text).toContain("“한 사람이 맡아 정리하는 방법” 쪽 문장은 한 번도 고르지 않았어요");
    expect(text).toContain("“가족과 하객의 사정” 쪽 문장은 한 번도 고르지 않았어요");
    // 판정은 여전히 하지 않는다. 「유형을 붙이지 않는다」는 고지는 남아야 하므로
    // 낱말이 아니라 판정으로 읽히는 형태를 막는다.
    for (const banned of ["유형이", "유형은", "궁합", "점수가", "점수는", "등급"]) {
      expect(text, banned).not.toContain(banned);
    }
    expect(text).toContain("유형을 붙이거나 점수를 매기지 않아요");

    // 네 글자 코드가 맨 위에 나온다.
    const badge = container.querySelector("[data-wedding-code]");
    expect(badge).toBeTruthy();
    const code = badge?.getAttribute("data-wedding-code") ?? "";
    expect(code).toHaveLength(config.axes.length);
    for (const axis of config.axes) {
      expect(container.querySelector(`[data-letter="${axis.key}"]`), axis.key).toBeTruthy();
    }
    // 글자마다 몇 대 몇이었는지 같이 나온다 — MBTI가 숨기는 것을 드러낸다.
    const badgeText = badge?.textContent ?? "";
    expect(badgeText).toMatch(/답한 \d장면에서 이쪽과 반대쪽 답은 \d 대 \d예요/);
    expect(badgeText).toContain("성격을 맞힌 게 아니라");
    expect(badgeText).not.toMatch(/\d+\s*점|궁합|잘 맞는/);

    // 아모라로 넘어갈 도움 방식 제안이 근거와 함께 남는다.
    const proposals = container.querySelector('[data-amora-proposals]');
    expect(proposals).toBeTruthy();
    const proposalText = proposals?.textContent ?? "";
    expect(container.querySelector('[data-proposal="workMode"]')).toBeTruthy();
    expect(container.querySelector('[data-proposal="familyOrder"]')).toBeTruthy();
    expect(container.querySelector('[data-proposal="supportOrder"]')).toBeTruthy();
    expect(proposalText).toContain("지금 원하는 도움과 같지는 않아요");
    // 없는 자동 연동을 있는 것처럼 말하지 않는다.
    expect(proposalText).toContain("직접 고른 항목만");
    expect(proposalText).not.toMatch(/자동으로 반영(됐|되었|됩니다|돼요)/);
    expect(proposals?.querySelector('a[href="/settings/amora-style"]')).toBeTruthy();

    /**
     * 로그인하지 않은 사람에게는 저장 버튼 대신 로그인 경로만 준다. 그리고 무엇이
     * 저장되는지(설정값)와 무엇이 저장되지 않는지(답과 고른 문장)를 함께 말한다.
     */
    expect(container.querySelector("[data-apply-amora]")).toBeNull();
    expect(proposalText).toContain("로그인하고 선택한 방식 확인하기");
    expect(container.querySelector<HTMLButtonElement>("[data-continue-amora]")?.disabled).toBe(true);
    expect(proposalText).toContain("웨딩코드 답과 고른 문장은");
    // 저장 결과를 확인하기 전에 반영됐다고 말하지 않는다.
    expect(proposalText).not.toContain("아모라에 반영했어요");
  });

  /**
   * 「아모라가 성향에 맞게 움직인다」는 약속은 설정 화면 링크로는 지켜지지 않는다.
   * 이 버튼이 실제로 `PUT /api/amora/personalization`까지 가야 한다.
   */
  it("로그인한 사람은 아모라 도움 방식을 실제로 저장한다", async () => {
    const config = CURRENT_WEDDING_CODE_SCENE_CONFIG;
    const calls: { url: string; method: string; body: unknown }[] = [];
    const savedProfile = {
      preferences: {
        decisionStart: "compare_first",
        answerDetail: "adaptive",
        supportOrder: "listen_first",
        workMode: "together",
        familyOrder: "couple_first",
        toneStyle: "adaptive",
      },
      revision: 2,
      confirmedAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/auth/me") return new Response(JSON.stringify({ user: useAuthStore.getState().user }), { status: 200 });
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return {
        ok: true,
        json: async () => ({ profile: init?.method === "PUT" ? savedProfile : null }),
      } as Response;
    }) as typeof globalThis.fetch;
    useAuthStore.setState({ user: { id: "u1", email: "a@b.c" } });

    try {
      await act(async () => {
        root.render(
          <WeddingCodeV06Client
            shareOrigin="https://hanbang.ai"
            version={config.version}
            partnerAnswers={null}
            partnerCode={null}
            bothCodes={null}
          />,
        );
      });

      const clickText = async (text: string) => {
        const button = Array.from(container.querySelectorAll("button"))
          .find((candidate) => candidate.textContent?.includes(text));
        await act(async () => button?.click());
      };

      await clickText("시작하기");
      const picks = [
        "A", "A", "C", "B", "A",
        "A", "B", "C", "A", "A",
        "A", "A", "C", "B", "A",
        "A", "B", "C", "A", "A",
      ];
      for (const [index, pick] of picks.entries()) {
        const option = container.querySelector<HTMLButtonElement>(`[data-option="${pick}"]`);
        await act(async () => option?.click());
        await clickText(index === picks.length - 1 ? "결과 보기" : "다음 문항");
      }

      const apply = container.querySelector<HTMLButtonElement>("[data-apply-amora]");
      expect(apply).toBeTruthy();
      expect(apply?.disabled).toBe(true);
      expect(calls.filter(c => c.method === "PUT")).toHaveLength(0);
      for (const [field, value] of Object.entries({ workMode: "together", familyOrder: "couple_first", supportOrder: "listen_first", decisionStart: "compare_first" })) {
        const select = container.querySelector<HTMLSelectElement>(`#wc-help-${field}`)!;
        await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
      }
      expect(apply?.disabled).toBe(false);
      await act(async () => apply?.click());
      // save()의 then은 클릭 act 밖의 마이크로태스크에서 끝난다. 한 번 더 흘려보낸다.
      await act(async () => { await Promise.resolve(); });

      const put = calls.find((call) => call.method === "PUT");
      expect(put?.url).toBe("/api/amora/personalization");
      // 웨딩코드가 만든 값이 그대로 실려야 한다 — 왼쪽으로 몰린 응답이므로.
      expect(put?.body).toMatchObject({
        preferences: {
          workMode: "together",
          familyOrder: "couple_first",
          supportOrder: "listen_first",
          decisionStart: "compare_first",
        },
      });
      // 답이나 고른 문장은 어떤 요청에도 실리지 않는다.
      const sent = JSON.stringify(calls);
      expect(sent).not.toContain("맨 아래 총액부터");
      expect(sent).not.toContain(config.questions[0].scene);

      // 저장 결과를 확인한 뒤에만 반영됐다고 말한다.
      expect(container.querySelector("[data-apply-amora]")?.textContent)
        .toContain("아모라에 반영했어요");
      expect(container.textContent).toContain("저장한 방식은 다음 아모라 답변에 참고돼요");
    } finally {
      globalThis.fetch = originalFetch;
      useAuthStore.setState({ user: null });
    }
  });

  /**
   * 서술형은 여기에만 둔다. 문항마다 자유 입력을 받으면 그 글이 공유 링크에 실려
   * 이름·집안 사정·금액이 카톡과 브라우저 기록에 남는다. 이 상자는 링크에도 저장소에도
   * 들어가지 않고 사용자의 클립보드로만 간다.
   */
  it("상대에게 보낼 말은 고쳐 쓸 수 있고 링크에는 실리지 않는다", async () => {
    const config = CURRENT_WEDDING_CODE_SCENE_CONFIG;

    await act(async () => {
      root.render(
        <WeddingCodeV06Client
          shareOrigin="https://hanbang.ai"
          version={config.version}
          partnerAnswers={null}
          partnerCode={null}
          bothCodes={null}
        />,
      );
    });

    const clickText = async (text: string) => {
      const button = Array.from(container.querySelectorAll("button"))
        .find((candidate) => candidate.textContent?.includes(text));
      await act(async () => button?.click());
    };

    await clickText("시작하기");
    const picks = [
      "A", "A", "C", "B", "A",
      "A", "B", "C", "A", "A",
      "A", "A", "C", "B", "A",
      "A", "B", "C", "A", "A",
    ];
    for (const [index, pick] of picks.entries()) {
      const option = container.querySelector<HTMLButtonElement>(`[data-option="${pick}"]`);
      await act(async () => option?.click());
      await clickText(index === picks.length - 1 ? "결과 보기" : "다음 문항");
    }

    const box = container.querySelector<HTMLTextAreaElement>("#wedding-code-tell-partner");
    expect(box).toBeTruthy();
    // 초안은 답한 축의 문장으로 채워져 있고, 비어 있지 않다.
    expect(box?.value.length ?? 0).toBeGreaterThan(0);
    expect(container.querySelector("[data-tell-partner]")?.textContent)
      .toContain("공유 링크에 들어가지");

    // 고쳐 쓴 글이 공유 링크에 섞이지 않는다.
    const written = "나는 계약서 읽는 게 제일 무서워. 그건 같이 보자.";
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(box, written);
      box?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(box?.value).toBe(written);

    const shareUrl = container
      .querySelector("[data-share-url]")
      ?.getAttribute("data-share-url") ?? "";
    expect(shareUrl).not.toContain("무서워");
    expect(shareUrl).not.toContain(encodeURIComponent(written));
    expect(shareUrl).toMatch(/#v=[^&]+&a=[A-D-]{20}$/);
  });

  /**
   * 부모님이 안 계시거나 결혼식을 하지 않는 사람도 이 화면을 연다. 안 맞는 장면에서
   * 네 개 중 하나를 억지로 고르게 하면 불편할 뿐 아니라, 고르지도 않은 답이 결과와
   * 아모라 제안에 실린다. 건너뛴 주제는 비운 채로 결과가 나와야 한다.
   */
  it("안 맞는 장면을 건너뛰면 그 주제를 비운 채로 결과가 나온다", async () => {
    const config = CURRENT_WEDDING_CODE_SCENE_CONFIG;

    await act(async () => {
      root.render(
        <WeddingCodeV06Client
          shareOrigin="https://hanbang.ai"
          version={config.version}
          partnerAnswers={null}
          partnerCode={null}
          bothCodes={null}
        />,
      );
    });

    const clickText = async (text: string) => {
      const button = Array.from(container.querySelectorAll("button"))
        .find((candidate) => candidate.textContent?.includes(text));
      await act(async () => button?.click());
    };

    await clickText("시작하기");

    // 앞의 네 장면(정할 때 뭘 먼저 보나)만 답하고 나머지 열두 장면은 건너뛴다.
    const picks = ["A", "A", "C", "B", "A"];
    for (const pick of picks) {
      const option = container.querySelector<HTMLButtonElement>(`[data-option="${pick}"]`);
      await act(async () => option?.click());
      await clickText("다음 문항");
    }
    for (let remaining = config.questions.length - picks.length; remaining > 0; remaining -= 1) {
      // 답을 고르지 않아도 건너뛰기는 항상 눌린다.
      await clickText("이 장면은 우리와 안 맞아요");
    }

    const result = container.querySelector('[data-result="solo"]');
    expect(result).toBeTruthy();
    const text = result?.textContent ?? "";

    // 답한 주제는 읽어주고, 건너뛴 주제는 비운다.
    expect(text).toContain("답한 5장면 중 5곳에서");
    expect(text).toContain("답한 5장면만 셌고, 건너뛴 장면은 비워뒀어요");
    expect(container.querySelectorAll("[data-skipped]").length).toBe(config.axes.length - 1);
    expect(text).toContain("이 주제는 건너뛰었어요");
    // 건너뛴 주제로는 아모라 제안을 만들지 않는다.
    expect(container.querySelector('[data-proposal="workMode"]')).toBeNull();
    expect(container.querySelector('[data-proposal="supportOrder"]')).toBeNull();
  });

  /**
   * 답이 하나도 없는 코드는 유효한 링크가 아니다. 빈 결과에 공유 버튼을 그대로 두면
   * 열리지 않는 링크를 보내게 된다.
   */
  it("모두 건너뛰면 빈 결과 대신 안내를 보여주고 링크를 만들지 않는다", async () => {
    const config = CURRENT_WEDDING_CODE_SCENE_CONFIG;

    await act(async () => {
      root.render(
        <WeddingCodeV06Client
          shareOrigin="https://hanbang.ai"
          version={config.version}
          partnerAnswers={null}
          partnerCode={null}
          bothCodes={null}
        />,
      );
    });

    const clickText = async (text: string) => {
      const button = Array.from(container.querySelectorAll("button"))
        .find((candidate) => candidate.textContent?.includes(text));
      await act(async () => button?.click());
    };

    await clickText("시작하기");
    for (let remaining = config.questions.length; remaining > 0; remaining -= 1) {
      await clickText("이 장면은 우리와 안 맞아요");
    }

    expect(container.querySelector("[data-empty]")).toBeTruthy();
    expect(container.textContent).toContain("답을 지어내는 것보다");
    expect(container.querySelector("[data-share-url]")).toBeNull();
    // 탓하지 않는다.
    expect(container.textContent).not.toMatch(/다시 해주세요|답해야|하셔야/);
  });

  it("건너뛴 답은 공유 코드에도 미응답으로 남는다", async () => {
    const config = CURRENT_WEDDING_CODE_SCENE_CONFIG;

    await act(async () => {
      root.render(
        <WeddingCodeV06Client
          shareOrigin="https://hanbang.ai"
          version={config.version}
          partnerAnswers={null}
          partnerCode={null}
          bothCodes={null}
        />,
      );
    });

    const clickText = async (text: string) => {
      const button = Array.from(container.querySelectorAll("button"))
        .find((candidate) => candidate.textContent?.includes(text));
      await act(async () => button?.click());
    };

    await clickText("시작하기");
    const first = container.querySelector<HTMLButtonElement>('[data-option="A"]');
    await act(async () => first?.click());
    await clickText("다음 문항");
    for (let remaining = config.questions.length - 1; remaining > 0; remaining -= 1) {
      await clickText("이 장면은 우리와 안 맞아요");
    }

    const shareUrl = container
      .querySelector("[data-share-url]")
      ?.getAttribute("data-share-url") ?? "";
    // 첫 글자만 답이고 나머지는 미응답(-)이다. 안 고른 답을 채워 보내지 않는다.
    expect(shareUrl).toContain(`a=A${"-".repeat(config.questions.length - 1)}`);
  });
});
