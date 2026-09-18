import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V06_QUESTIONS, WEDDING_CODE_V06_VERSION } from "@/constants/weddingCodeV06";
import { WEDDING_CODE_V08_QUESTIONS, WEDDING_CODE_V08_VERSION } from "@/constants/weddingCodeV08";
import { WEDDING_CODE_V09_QUESTIONS, WEDDING_CODE_V09_VERSION } from "@/constants/weddingCodeV09";
import { WEDDING_CODE_V10_QUESTIONS, WEDDING_CODE_V10_VERSION } from "@/constants/weddingCodeV10";
import {
  CURRENT_WEDDING_CODE_SCENE_CONFIG,
  resolveWeddingCodeSceneConfig,
  weddingCodeSceneConfigForExactVersion,
} from "../config";

describe("웨딩코드 장면 버전 선택", () => {
  it("새 진입은 v1.0을 사용한다", () => {
    expect(resolveWeddingCodeSceneConfig(undefined, false)?.version).toBe(WEDDING_CODE_V10_VERSION);
    expect(resolveWeddingCodeSceneConfig("", false)?.version).toBe(WEDDING_CODE_V10_VERSION);
    expect(CURRENT_WEDDING_CODE_SCENE_CONFIG.version).toBe(WEDDING_CODE_V10_VERSION);
    expect(CURRENT_WEDDING_CODE_SCENE_CONFIG.questions).toBe(WEDDING_CODE_V10_QUESTIONS);
  });

  it("답 코드가 든 과거 무버전 링크는 v0.6으로 보존한다", () => {
    expect(resolveWeddingCodeSceneConfig(undefined, true)?.version).toBe(WEDDING_CODE_V06_VERSION);
    expect(resolveWeddingCodeSceneConfig("", true)?.version).toBe(WEDDING_CODE_V06_VERSION);
  });

  it("명시된 지원 버전만 열고 알 수 없는 버전은 거부한다", () => {
    expect(resolveWeddingCodeSceneConfig(WEDDING_CODE_V06_VERSION, true)?.version)
      .toBe(WEDDING_CODE_V06_VERSION);
    expect(resolveWeddingCodeSceneConfig(WEDDING_CODE_V08_VERSION, true)?.version)
      .toBe(WEDDING_CODE_V08_VERSION);
    expect(resolveWeddingCodeSceneConfig(WEDDING_CODE_V09_VERSION, true)?.version)
      .toBe(WEDDING_CODE_V09_VERSION);
    expect(resolveWeddingCodeSceneConfig(WEDDING_CODE_V10_VERSION, true)?.version)
      .toBe(WEDDING_CODE_V10_VERSION);
    expect(resolveWeddingCodeSceneConfig("v9-unknown", true)).toBeNull();
    // 표에 없는 다음 판 이름을 현재 판으로 바꿔 읽지 않는다.
    expect(resolveWeddingCodeSceneConfig("v1.1-code", true)).toBeNull();
    // 표에 있는 이름과 겹치는 객체 속성으로 새 판을 흉내내지 못한다.
    expect(resolveWeddingCodeSceneConfig("constructor", true)).toBeNull();
    expect(resolveWeddingCodeSceneConfig("toString", false)).toBeNull();
  });

  /**
   * 예전 구현은 「v0.6 이 아니면 v0.8」 삼항식이었다. 판을 하나 더하면 **새 판 답이 옛 판
   * 문장으로 보이는데** 타입 검사도 테스트도 못 잡았다. 판마다 **자기 문항**이 돌아오는지 본다.
   */
  it("판 이름마다 그 판의 문항을 돌려준다 — 옛 링크는 옛 문장으로 열린다", () => {
    expect(weddingCodeSceneConfigForExactVersion(WEDDING_CODE_V06_VERSION).questions)
      .toBe(WEDDING_CODE_V06_QUESTIONS);
    expect(weddingCodeSceneConfigForExactVersion(WEDDING_CODE_V08_VERSION).questions)
      .toBe(WEDDING_CODE_V08_QUESTIONS);
    expect(weddingCodeSceneConfigForExactVersion(WEDDING_CODE_V09_VERSION).questions)
      .toBe(WEDDING_CODE_V09_QUESTIONS);
    expect(weddingCodeSceneConfigForExactVersion(WEDDING_CODE_V10_VERSION).questions)
      .toBe(WEDDING_CODE_V10_QUESTIONS);
    expect(resolveWeddingCodeSceneConfig(WEDDING_CODE_V08_VERSION, true)?.questions)
      .toBe(WEDDING_CODE_V08_QUESTIONS);
    expect(resolveWeddingCodeSceneConfig(WEDDING_CODE_V09_VERSION, true)?.questions)
      .toBe(WEDDING_CODE_V09_QUESTIONS);
  });

  /**
   * v0.9 → v1.0 에서 바뀐 A2 의 B·D 는 판마다 자기 문장으로 읽혀야 한다. v0.9 링크로 B 를 고른
   * 사람에게 v1.0 문장(「실감 났어」)을 보여주면 고르지도 않은 말을 인용하게 된다.
   */
  it("v0.9 링크의 A2 는 v0.9 문장으로, 새 진입의 A2 는 v1.0 문장으로 읽힌다", () => {
    const a2Label = (version: string, value: "B" | "D") => resolveWeddingCodeSceneConfig(version, true)
      ?.questions.find((question) => question.key === "A2")
      ?.options.find((option) => option.value === value)?.label;
    expect(a2Label(WEDDING_CODE_V09_VERSION, "B")).toBe("'한 번뿐인 날인데 여기서 하자'고 했다");
    expect(a2Label(WEDDING_CODE_V09_VERSION, "D")).toBe("'여기 봐' 하고 그 홀 사진 한 장만 보냈다");
    expect(a2Label(WEDDING_CODE_V10_VERSION, "B")).toBe("'거기 가 보니까 결혼하는 게 실감 났어'라고 했다");
    expect(a2Label(WEDDING_CODE_V10_VERSION, "D")).toBe("'그 홀 천장 조명 진짜 예뻤어'라고만 보냈다");
  });
});
