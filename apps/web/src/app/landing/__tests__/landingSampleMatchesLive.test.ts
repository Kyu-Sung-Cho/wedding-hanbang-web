import { describe, expect, it } from "vitest";

import { CURRENT_WEDDING_CODE_SCENE_CONFIG } from "@/lib/weddingCode/scene/config";
import { landingContent } from "@/components/landing/redesign/landingContent";

import { rendered } from "./landingSource";

/**
 * 랜딩이 보여 주는 장면 견본이 **실제 화면과 같은 것**이어야 한다.
 *
 * ## 왜 생겼나
 *
 * 2026-08-27 에 랜딩이 이렇게 보여 주고 있었다:
 *
 *   장면 07
 *   둘 다 마음에 든 결혼식장이 정해둔 예산보다 300만원 비쌌어요.
 *   그날 밤 속으로 든 생각은?
 *     · 그래도 여기서 하고 싶다. 다른 데서 줄이자.
 *     · 300만원이면 다른 데 쓰는 게 낫다.
 *
 * 실제 `/wedding-code` 의 A2 는 **선택지가 네 개**이고 문장도 다르다.
 * 번호 "장면 07" 도 지어낸 것이었다(A2 는 두 번째 문항이다).
 *
 * 누르고 들어간 사람이 랜딩에서 본 것과 다른 화면을 만난다. 타입체크·린트·
 * 전체 테스트가 전부 통과하는 종류의 거짓이라 여기서 따로 막는다.
 *
 * ## 무엇을 지키나
 *
 * 랜딩 견본의 장면·질문·선택지가 **현재 버전의 문항 하나와 글자까지 같은지**.
 * 문항을 고치면 랜딩도 같이 고쳐야 하고, 안 고치면 여기서 실패한다.
 */

const { questions } = CURRENT_WEDDING_CODE_SCENE_CONFIG;
const { sample } = landingContent.scenes;

describe("랜딩 장면 견본은 라이브 문항이다", () => {
  it("견본과 똑같은 문항이 현재 버전에 있다", () => {
    const match = questions.find(
      (q) => q.scene === sample.scene && q.question === sample.question,
    );
    expect(
      match,
      `랜딩 견본이 현재 버전의 문항과 다릅니다.\n`
        + `  랜딩 장면: ${sample.scene}\n`
        + `  랜딩 질문: ${sample.question}\n`
        + `문항을 고쳤다면 랜딩 카피(scenes.sample)도 같이 고치세요.`,
    ).toBeTruthy();
  });

  it("선택지가 글자까지 같고, 하나도 빠지지 않는다", () => {
    const match = questions.find(
      (q) => q.scene === sample.scene && q.question === sample.question,
    );
    expect(match, "견본과 같은 문항을 찾지 못했다").toBeTruthy();

    const live = match!.options.map((o) => o.label);
    // 개수부터 본다 — 둘만 보여 주면 읽는 사람이 이지선다인 줄 안다.
    expect(
      sample.options.length,
      `실제 화면은 선택지가 ${live.length}개인데 랜딩은 ${sample.options.length}개를 보여줍니다`,
    ).toBe(live.length);
    // 순서까지 같아야 한다. 순서가 다르면 "첫 번째 답" 이 서로 다른 것을 가리킨다.
    expect(sample.options, "선택지 문장이 라이브와 다릅니다").toEqual(live);
  });

  it("랜딩이 문항 번호를 지어내지 않는다", () => {
    // "장면 07" 처럼 번호를 박으면, 문항 순서가 바뀌는 순간 거짓이 된다.
    // 순서는 버전마다 바뀌고 랜딩은 그걸 따라갈 방법이 없다.
    const scenesSection = rendered(
      "src/components/landing/redesign/ScenesSection.tsx",
    );
    expect(
      scenesSection,
      "랜딩이 장면 번호를 박아 두었습니다 — 순서가 바뀌면 거짓이 됩니다",
    ).not.toMatch(/장면\s*\d/u);
  });

  it("랜딩이 말하는 장면 수가 실제 문항 수와 같다", () => {
    // "스무 장면" 은 현재 버전(v0.8, 20문항) 기준이다. 버전이 바뀌면 여기서 걸린다.
    const KOREAN: Record<number, string> = { 12: "열두", 16: "열여섯", 20: "스무", 24: "스물네" };
    const label = KOREAN[questions.length] ?? String(questions.length);
    const content = rendered("src/components/landing/redesign/landingContent.ts");

    // "맞는 말이 있나" 로 물으면 안 된다 — 랜딩은 장면 수를 여러 번 말하는데,
    // 한 곳만 틀려도 다른 곳이 대신 답한다(변형으로 확인했다).
    // **틀린 말이 있나** 로 묻는다.
    const wrong = [...content.matchAll(/(열두|열여섯|스무|스물네|\d+)\s*장면/gu)]
      .map((m) => m[0])
      .filter((phrase) => !phrase.startsWith(label));
    expect(
      [...new Set(wrong)],
      `랜딩이 현재 문항 수(${questions.length}개 = "${label} 장면")와 다른 수를 말합니다`,
    ).toEqual([]);

    // 그리고 적어도 한 번은 말해야 한다 — 전부 지워도 위 검사는 통과한다.
    expect(content, `랜딩이 장면 수를 한 번도 말하지 않습니다`).toContain(`${label} 장면`);
  });
});
