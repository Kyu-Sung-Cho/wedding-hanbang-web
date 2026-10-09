import { describe, expect, it } from "vitest";
import { MEASUREMENT_VERSION } from "@/lib/weddingCode/likert/types";
import { isLegacyWeddingCodeQuery, weddingCodeReleaseTarget } from "./releaseEntry";

describe("30문항 기본 진입과 원래 링크의 판 보존", () => {
  it("맨 주소와 유입 매개변수는 새 개편본으로 연다", () => {
    for (const query of [{}, { utm_source: "team" }, { v: MEASUREMENT_VERSION }]) {
      expect(isLegacyWeddingCodeQuery(query)).toBe(false);
      expect(weddingCodeReleaseTarget(false, "")).toBe("likert");
    }
  });
  it("명시 구판·모르는 판·이전 답 쿼리는 원래 파서로 보낸다", () => {
    for (const query of [{ v: "v3.1-preferences" }, { v: "v4.0-tendency" }, { v: "future" }, { v: [MEASUREMENT_VERSION, "v3.1-preferences"] }, { a: "old-answer" }, { gb: "old-guess" }]) {
      expect(isLegacyWeddingCodeQuery(query)).toBe(true);
      expect(weddingCodeReleaseTarget(true, "#wc-likert=new")).toBe("legacy");
    }
  });
  it("새 fragment는 새 IO로, 이전·잘못된 fragment는 이전 파서로 보낸다", () => {
    expect(weddingCodeReleaseTarget(false, "#wc-likert=broken")).toBe("likert");
    expect(weddingCodeReleaseTarget(false, "#wc-likert=one&wc-likert=two")).toBe("likert");
    for (const hash of ["#v=v3.1-preferences&a=old", "#v=v4.0-tendency&a=old", "#a=old", "#unknown=x"]) {
      expect(weddingCodeReleaseTarget(false, hash)).toBe("legacy");
    }
  });
});
