import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V06_QUESTIONS, WEDDING_CODE_V06_VERSION } from "@/constants/weddingCodeV06";
import { WEDDING_CODE_V08_QUESTIONS, WEDDING_CODE_V08_VERSION } from "@/constants/weddingCodeV08";
import { WEDDING_CODE_V09_QUESTIONS, WEDDING_CODE_V09_VERSION } from "@/constants/weddingCodeV09";
import {
  CURRENT_WEDDING_CODE_SCENE_CONFIG,
  resolveWeddingCodeSceneConfig,
  weddingCodeSceneConfigForExactVersion,
} from "../config";

describe("웨딩코드 장면 버전 선택", () => {
  it("새 진입은 v0.9를 사용한다", () => {
    expect(resolveWeddingCodeSceneConfig(undefined, false)?.version).toBe(WEDDING_CODE_V09_VERSION);
    expect(CURRENT_WEDDING_CODE_SCENE_CONFIG.version).toBe(WEDDING_CODE_V09_VERSION);
    expect(CURRENT_WEDDING_CODE_SCENE_CONFIG.questions).toBe(WEDDING_CODE_V09_QUESTIONS);
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
    expect(resolveWeddingCodeSceneConfig("v9-unknown", true)).toBeNull();
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
    expect(resolveWeddingCodeSceneConfig(WEDDING_CODE_V08_VERSION, true)?.questions)
      .toBe(WEDDING_CODE_V08_QUESTIONS);
  });
});
