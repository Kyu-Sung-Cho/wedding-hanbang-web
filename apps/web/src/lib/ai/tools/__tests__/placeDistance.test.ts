// @vitest-environment node

/**
 * 거리 정렬이 **틀린 거리로 정렬하지 않는가.**
 *
 * 좌표를 잘못 읽으면 지금(리뷰 수 순)보다 나빠진다. 그래서 확신할 수 없으면 손대지
 * 않는 쪽으로 만들었고, 여기서 그 경계를 고정한다.
 */

import { describe, expect, it } from "vitest";
import {
  dedupePlacesByIdentity,
  describeDistance,
  distanceInMeters,
  extractPlaceAnchor,
  parseNaverPoint,
  rankPlacesByDistance,
} from "@/lib/ai/tools/placeDistance";

// 실제 좌표(WGS84). 네이버는 10^7 배한 정수로 준다.
const GANGNAM_STATION = { longitude: 127.0276, latitude: 37.4979 };
const naver = (lon: number, lat: number) => ({
  mapx: String(Math.round(lon * 10_000_000)),
  mapy: String(Math.round(lat * 10_000_000)),
});

describe("좌표를 확신할 수 있을 때만 읽는다", () => {
  it("WGS84 를 10^7 배한 값을 읽는다", () => {
    expect(parseNaverPoint("1270276662", "374979340")).toEqual({
      longitude: 127.0276662,
      latitude: 37.497934,
    });
  });

  it("카텍 좌표는 좌표로 인정하지 않는다", () => {
    // 카텍은 대략 x 30만·y 55만 규모다. 10^7 로 나누면 0.03·0.055 가 되어 한국 범위 밖이다.
    // 이것을 경위도로 읽으면 거리가 조용히 틀린다.
    expect(parseNaverPoint("310000", "552000")).toBeNull();
  });

  it("한국 밖이거나 모양이 아니면 null", () => {
    expect(parseNaverPoint("0", "0")).toBeNull();
    expect(parseNaverPoint("1390000000", "356000000")).toBeNull(); // 도쿄 근처 경도
    expect(parseNaverPoint("-1270276662", "374979340")).toBeNull();
    expect(parseNaverPoint("127.0276662", "37.497934")).toBeNull();
    expect(parseNaverPoint(null, "374979340")).toBeNull();
    expect(parseNaverPoint(undefined, undefined)).toBeNull();
  });
});

describe("거리", () => {
  it("같은 지점은 0", () => {
    expect(distanceInMeters(GANGNAM_STATION, GANGNAM_STATION)).toBe(0);
  });

  it("강남역과 교대역 사이가 실제 거리와 비슷하다", () => {
    // 교대역 약 (127.0146, 37.4936). 실제 직선거리는 대략 1.2km 다.
    const meters = distanceInMeters(GANGNAM_STATION, { longitude: 127.0146, latitude: 37.4936 });
    expect(meters).toBeGreaterThan(1000);
    expect(meters).toBeLessThan(1500);
  });
});

describe("기준점 뽑기", () => {
  it("역·구·동으로 끝나는 낱말을 뽑는다", () => {
    expect(extractPlaceAnchor("강남역 한정식")).toBe("강남역");
    expect(extractPlaceAnchor("역삼동 한식당")).toBe("역삼동");
    expect(extractPlaceAnchor("서초구 조용한 한식")).toBe("서초구");
  });

  it("억지로 잡지 않는다", () => {
    // 접미사가 없으면 기준점이 없다고 본다. 잘못 잡으면 엉뚱한 곳에서 거리를 잰다.
    expect(extractPlaceAnchor("서초 한식당")).toBeNull();
    expect(extractPlaceAnchor("한정식")).toBeNull();
    expect(extractPlaceAnchor("")).toBeNull();
    expect(extractPlaceAnchor(null)).toBeNull();
  });
});

describe("가까운 순으로 세운다", () => {
  const near = { name: "가까운집", address: "A", ...naver(127.0280, 37.4982) };   // 약 40m
  const mid = { name: "중간집", address: "B", ...naver(127.0350, 37.5010) };      // 약 700m
  const far = { name: "먼집", address: "C", ...naver(127.0146, 37.4936) };        // 약 1.2km

  it("먼 것이 뒤로 간다", () => {
    const ranked = rankPlacesByDistance([far, mid, near], GANGNAM_STATION);
    expect(ranked.map((r) => r.place.name)).toEqual(["가까운집", "중간집", "먼집"]);
    expect(ranked[0].distanceMeters).toBeLessThan(200);
    expect(ranked[2].distanceMeters).toBeGreaterThan(1000);
  });

  it("좌표를 못 읽은 것은 버리지 않고 뒤에 둔다", () => {
    // 버리면 좌표 형식이 바뀌는 날 결과가 통째로 사라진다.
    const noCoords = { name: "좌표없음", address: "D", mapx: null, mapy: null };
    const ranked = rankPlacesByDistance([noCoords, far, near], GANGNAM_STATION);
    expect(ranked.map((r) => r.place.name)).toEqual(["가까운집", "먼집", "좌표없음"]);
    expect(ranked[2].distanceMeters).toBeNull();
  });

  it("기준점이 없으면 순서를 손대지 않는다", () => {
    // 오늘과 같은 결과여야 한다. 기준점이 없다고 순서를 흔들면 회귀다.
    const ranked = rankPlacesByDistance([far, mid, near], null);
    expect(ranked.map((r) => r.place.name)).toEqual(["먼집", "중간집", "가까운집"]);
    expect(ranked.every((r) => r.distanceMeters === null)).toBe(true);
  });

  it("거리가 같으면 원래 순서를 지킨다", () => {
    const a = { name: "A", address: "1", ...naver(127.0280, 37.4982) };
    const b = { name: "B", address: "2", ...naver(127.0280, 37.4982) };
    expect(rankPlacesByDistance([a, b], GANGNAM_STATION).map((r) => r.place.name))
      .toEqual(["A", "B"]);
  });
});

describe("사람이 읽는 거리", () => {
  it("직선거리라고 밝힌다", () => {
    // 걷는 거리인 척하면 사용자가 그것을 믿고 약속을 잡는다.
    expect(describeDistance("강남역", 340)).toBe("강남역에서 직선 약 340m");
    expect(describeDistance("강남역", 1240)).toBe("강남역에서 직선 약 1.2km");
  });

  it("모르면 아무 말도 하지 않는다", () => {
    expect(describeDistance("강남역", null)).toBeNull();
    expect(describeDistance("강남역", Number.NaN)).toBeNull();
  });
});

describe("같은 가게가 두 번 오지 않는다", () => {
  it("이름과 주소가 같으면 하나로 본다", () => {
    const list = [
      { name: "노랑저고리", address: "서울 서초구" },
      { name: "노랑저고리", address: "서울 서초구" },
      { name: "노랑저고리", address: "서울 강남구" },
    ];
    expect(dedupePlacesByIdentity(list)).toHaveLength(2);
  });

  it("이름도 주소도 없는 항목은 버린다", () => {
    expect(dedupePlacesByIdentity([{ name: "", address: "" }])).toHaveLength(0);
  });
});
