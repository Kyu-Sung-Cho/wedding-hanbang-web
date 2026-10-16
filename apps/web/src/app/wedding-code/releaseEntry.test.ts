import { describe, expect, it } from "vitest";
import { MEASUREMENT_VERSION } from "@/lib/weddingCode/likert/types";
import { WC64_QUERY_VALUE } from "@/lib/weddingCode/wc64/types";
import {
  WEDDING_CODE_BARE_TARGET,
  isLegacyWeddingCodeQuery,
  weddingCodeExplicitTarget,
  weddingCodeReleaseTarget,
} from "./releaseEntry";

describe("맨 주소 기본 판과 명시 주소의 판 보존", () => {
  it("맨 주소 기본값은 스위치 상수 하나가 정하고, 지금은 64문항이다", () => {
    expect(WEDDING_CODE_BARE_TARGET).toBe("wc64");
    expect(WC64_QUERY_VALUE).toBe("64");
  });

  it("맨 주소와 유입 매개변수는 기본 판으로 연다", () => {
    for (const query of [{}, { utm_source: "team" }, { deleted: "1" }]) {
      expect(isLegacyWeddingCodeQuery(query)).toBe(false);
      expect(weddingCodeExplicitTarget(query)).toBeNull();
      expect(weddingCodeReleaseTarget(false, "", weddingCodeExplicitTarget(query))).toBe(WEDDING_CODE_BARE_TARGET);
      expect(weddingCodeReleaseTarget(false, "#", weddingCodeExplicitTarget(query))).toBe(WEDDING_CODE_BARE_TARGET);
    }
    expect(weddingCodeReleaseTarget(false, "")).toBe(WEDDING_CODE_BARE_TARGET);
  });

  it("36문항 명시 주소와 초대는 기본값과 상관없이 36문항으로 연다", () => {
    for (const query of [{ v: "36" }, { ct: "invite" }, { v: "36", utm_source: "kakao" }, { v: "36", deleted: "1" }]) {
      expect(isLegacyWeddingCodeQuery(query), JSON.stringify(query)).toBe(false);
      expect(weddingCodeExplicitTarget(query), JSON.stringify(query)).toBe("36");
      expect(weddingCodeReleaseTarget(false, "", weddingCodeExplicitTarget(query)), JSON.stringify(query)).toBe("36");
      expect(weddingCodeReleaseTarget(false, "#", weddingCodeExplicitTarget(query)), JSON.stringify(query)).toBe("36");
    }
  });

  it("64문항 명시 주소는 기본값과 상관없이 64문항으로 연다", () => {
    for (const query of [{ v: WC64_QUERY_VALUE }, { v: WC64_QUERY_VALUE, utm_source: "kakao" }]) {
      expect(isLegacyWeddingCodeQuery(query)).toBe(false);
      expect(weddingCodeExplicitTarget(query)).toBe("wc64");
      expect(weddingCodeReleaseTarget(false, "", "wc64")).toBe("wc64");
    }
    // v 가 있으면 v 가 정한다(초대 ct 가 붙어 와도 64문항 명시를 바꾸지 않는다. ct 자체는 프록시가 지운다).
    expect(weddingCodeExplicitTarget({ v: WC64_QUERY_VALUE, ct: "invite" })).toBe("wc64");
  });

  it("기존 30문항을 명시한 주소와 해시는 다른 판으로 변환하지 않는다", () => {
    expect(weddingCodeExplicitTarget({ v: MEASUREMENT_VERSION })).toBe("likert");
    expect(weddingCodeReleaseTarget(false, "", "likert")).toBe("likert");
    expect(weddingCodeReleaseTarget(false, "#wc-likert=existing")).toBe("likert");
    expect(weddingCodeReleaseTarget(false, "#wc-likert=existing", "wc64")).toBe("likert");
    expect(weddingCodeReleaseTarget(false, "#wc-likert=existing", "36")).toBe("likert");
  });

  it("명시 구판·모르는 판·이전 답 쿼리는 원래 파서로 보낸다", () => {
    for (const query of [
      { v: "v3.1-preferences" }, { v: "v4.0-tendency" }, { v: "future" }, { v: "65" }, { v: "36 " },
      { v: [MEASUREMENT_VERSION, "v3.1-preferences"] }, { v: ["36", "64"] },
      { a: "old-answer" }, { gb: "old-guess" }, { v: "36", a: "old-answer" }, { v: WC64_QUERY_VALUE, b: "old-answer" },
    ]) {
      expect(isLegacyWeddingCodeQuery(query), JSON.stringify(query)).toBe(true);
      expect(weddingCodeReleaseTarget(true, "")).toBe("legacy");
      expect(weddingCodeReleaseTarget(true, "#wc-likert=new")).toBe("legacy");
    }
    expect(weddingCodeExplicitTarget({ v: "future" })).toBeNull();
    expect(weddingCodeExplicitTarget({ v: ["36", "64"] })).toBeNull();
  });

  it("새 fragment는 30문항 IO로, 이전·잘못된 fragment는 이전 파서로 보낸다(명시 판이 있어도 같다)", () => {
    for (const explicit of [null, "36", "wc64"] as const) {
      expect(weddingCodeReleaseTarget(false, "#wc-likert=broken", explicit)).toBe("likert");
      expect(weddingCodeReleaseTarget(false, "#wc-likert=one&wc-likert=two", explicit)).toBe("likert");
      for (const hash of ["#v=v3.1-preferences&a=old", "#v=v4.0-tendency&a=old", "#a=old", "#unknown=x"]) {
        expect(weddingCodeReleaseTarget(false, hash, explicit), `${hash} ${explicit}`).toBe("legacy");
      }
    }
  });
});
