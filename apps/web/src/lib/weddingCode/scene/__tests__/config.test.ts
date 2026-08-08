import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V06_VERSION } from "@/constants/weddingCodeV06";
import { WEDDING_CODE_V08_VERSION } from "@/constants/weddingCodeV08";
import {
  CURRENT_WEDDING_CODE_SCENE_CONFIG,
  resolveWeddingCodeSceneConfig,
} from "../config";

describe("웨딩코드 장면 버전 선택", () => {
  it("새 진입은 v0.7을 사용한다", () => {
    expect(resolveWeddingCodeSceneConfig(undefined, false)?.version).toBe(WEDDING_CODE_V08_VERSION);
    expect(CURRENT_WEDDING_CODE_SCENE_CONFIG.version).toBe(WEDDING_CODE_V08_VERSION);
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
    expect(resolveWeddingCodeSceneConfig("v9-unknown", true)).toBeNull();
  });
});
