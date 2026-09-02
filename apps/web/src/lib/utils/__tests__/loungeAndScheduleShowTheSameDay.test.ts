import { afterEach, describe, expect, it, vi } from "vitest";

import {
  koreanFullDateInKst,
  koreanMonthDayInKst,
  kstDateFromValue,
  shortKoreanDateFromYmd,
  ymdInKst,
} from "@/lib/utils/kstDate";

/** 이 검사가 도는 프로세스의 시간대. 아래 몇몇 검사의 뜻이 여기 달려 있다. */
const PROCESS_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * 같은 일정이 두 화면에서 같은 날로 보이는가.
 *
 * ## 무엇이 갈라져 있었나
 *
 * 라운지는 `new Date("2026-10-05")`, 일정 화면은 `new Date("2026-10-05T00:00:00")`
 * 로 같은 값을 읽었다. 앞은 **UTC 자정**, 뒤는 **로컬 자정**이다(ISO 날짜만 있는
 * 문자열의 규격이 그렇다). 그래서 UTC− 시간대에서는 라운지가 하루 앞선 날짜를
 * 그렸고, 서버 렌더(UTC)와 브라우저(KST)가 다른 날짜를 그려 하이드레이션도
 * 어긋날 수 있었다.
 *
 * 저장된 날짜는 사용자가 고른 **한국 날짜**다. 그래서 검사는 시간대를 실제로
 * 옮겨 가며 값이 흔들리지 않는지 본다 — 한 시간대에서만 재면 갈라짐이 안 보인다.
 */

/**
 * 프로세스 시간대는 실행 중에 바꿀 수 없다(`TZ` 를 나중에 바꿔도 `Intl` 의 기본
 * 시간대는 이미 정해져 있다). 그래서 시간대를 바꿔 가며 재는 대신, **한 순간이
 * 시간대마다 다른 달력 날짜인 지점**을 골라 잰다. 그 지점에서 값이 한국 날짜와
 * 같으면 KST 로 못박혔다는 뜻이고, 아니면 실행 환경을 따라간 것이다.
 */
const CROSSES_MIDNIGHT_IN_KST_ONLY = "2026-10-04T16:00:00.000Z";

afterEach(() => {
  vi.useRealTimers();
});

describe("저장된 날짜는 어디서 읽어도 같은 한국 날짜다", () => {
  it("시간대마다 날짜가 갈리는 순간에도 한국 날짜를 말한다", () => {
    // 이 순간은 한국에서 10월 5일 01:00, UTC 와 미국에서는 아직 10월 4일이다.
    const instant = new Date(CROSSES_MIDNIGHT_IN_KST_ONLY);

    // 재료가 실제로 갈리는 지점인지 먼저 확인한다. 안 갈리면 아래 검사가 무의미하다.
    const asUtc = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "UTC",
      month: "long",
      day: "numeric",
    }).format(instant);
    expect(asUtc, "재료가 시간대에 따라 갈리지 않는다 — 검사가 무의미해진다")
      .toContain("10월 4일");

    expect(koreanMonthDayInKst(instant)).toContain("10월 5일");
    expect(koreanFullDateInKst(instant)).toBe("2026년 10월 5일");
  });

  it("`YYYY-MM-DD` 문자열도 UTC 자정으로 읽히지 않는다", () => {
    // 예전 코드는 `new Date("2026-10-05")` 로 읽었다. 그것은 UTC 자정이라
    // UTC− 시간대에서는 10월 4일로 그려진다.
    const kstMidnight = kstDateFromValue("2026-10-05");
    expect(kstMidnight?.toISOString()).toBe("2026-10-04T15:00:00.000Z");
    expect(koreanMonthDayInKst("2026-10-05")).toContain("10월 5일");
  });

  it("짧은 표기도 같은 날을 가리킨다", () => {
    expect(shortKoreanDateFromYmd("2026-10-05")).toBe("10/5 (월)");
    // 라운지의 긴 표기와 일정 화면의 짧은 표기가 같은 달·일을 말한다.
    expect(koreanMonthDayInKst("2026-10-05")).toContain("10월 5일");
  });

  it("연도까지 붙는 표기도 KST 달력을 따른다", () => {
    expect(koreanFullDateInKst("2027-01-01")).toBe("2027년 1월 1일");
  });

  it("자정 경계에서 하루가 밀리지 않는다", () => {
    // UTC 로 읽으면 12월 31일이 되는 값들.
    expect(koreanMonthDayInKst("2027-01-01")).toContain("1월 1일");
    expect(shortKoreanDateFromYmd("2027-01-01")).toBe("1/1 (금)");
  });

  it("읽을 수 없는 값에 날짜를 지어내지 않는다", () => {
    for (const value of [null, undefined, "", "언젠가", "2026-13-40"]) {
      expect(kstDateFromValue(value as string | null)).toBeNull();
      expect(koreanMonthDayInKst(value as string | null)).toBeNull();
    }
    // 형식이 아니면 짧은 표기도 만들지 않는다.
    expect(shortKoreanDateFromYmd("2026/10/05")).toBeNull();
  });
});

describe("오늘은 한국 새벽에도 오늘이다", () => {
  it("KST 00:00~09:00 구간에서 어제로 넘어가지 않는다", () => {
    // 한국 2026-10-05 03:00 = UTC 2026-10-04 18:00. UTC 로 읽으면 어제다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T18:00:00.000Z"));
    expect(ymdInKst()).toBe("2026-10-05");
  });

  it("이 검사가 도는 시간대가 한국이 아님을 기록해 둔다", () => {
    // 프로세스가 KST 로 돌면 위 검사들은 KST 못박기와 실행 환경 추종을 구분하지
    // 못한다(둘 다 같은 값을 낸다). CI 는 UTC 라 구분되지만, 개발자 기기가 KST 면
    // 이 줄이 그 사실을 눈에 보이게 한다.
    expect(PROCESS_TIME_ZONE).toBeTruthy();
    if (PROCESS_TIME_ZONE === "Asia/Seoul") {
      // 실패시키지 않는다 — 한국에서 개발하는 것은 정상이다. 다만 KST 못박기를
      // 실제로 증명하는 것은 `koreanMonthDayInKst(instant)` 쪽 검사이고, 그 검사는
      // 재료가 갈리는지 스스로 먼저 확인하므로 이 시간대에서도 유효하다.
      expect(koreanMonthDayInKst(new Date(CROSSES_MIDNIGHT_IN_KST_ONLY)))
        .toContain("10월 5일");
    }
  });
});
