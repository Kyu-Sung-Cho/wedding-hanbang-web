import { describe, expect, it } from "vitest";

import { timeAgo } from "@/utils/timeAgo";

/**
 * **읽을 수 없는 시각 하나가 화면 전체를 내리면 안 된다.**
 *
 * `timeAgo` 는 커뮤니티의 client component 여섯 곳에서 그려진다(글 카드·피드·상세·
 * 댓글·내 글·업체 페이지). 그 컴포넌트들은 하이드레이션 뒤 브라우저에서 다시 그려지므로,
 * 여기서 던지면 **API 가 200 을 줬는데도** 루트 경계가 「화면을 불러오지 못했어요」로
 * 바뀐다. 글 하나, 댓글 하나면 충분하다.
 *
 * 2026-09-02 실측(고치기 전):
 *
 *     timeAgo("not-a-date")  → RangeError: Invalid time value
 *     timeAgo(undefined)     → RangeError: Invalid time value
 *     timeAgo(null)          → "1970.01.01"   ← 던지지는 않지만 **틀린 사실**
 *
 * 30일이 넘으면 `Intl.DateTimeFormat.format()` 을 타는데, 그 함수는 Invalid Date 에
 * RangeError 를 던진다. `created_at`·`updated_at` 은 스키마에서 nullable 이고
 * (`20260325000000_community.sql`), 클라이언트가 만든 낙관적 객체에는 아예 없을 수도
 * 있다.
 *
 * 모르는 시각은 **비워 둔다.** 틀린 날짜를 적는 것보다 아무 말도 안 하는 편이 맞다.
 */
describe("timeAgo 는 읽을 수 없는 값에 던지지 않는다", () => {
  it.each([
    ["빈 문자열", ""],
    ["날짜가 아닌 문자열", "not-a-date"],
    ["잘린 ISO", "2026-13-45T99:99:99Z"],
    ["null", null],
    ["undefined", undefined],
    ["숫자", 0],
    ["객체", {}],
  ])("%s 에 던지지 않고 빈 문자열을 준다", (_label, value) => {
    expect(() => timeAgo(value as never)).not.toThrow();
    expect(timeAgo(value as never)).toBe("");
  });

  it("읽을 수 있는 시각은 지금까지와 똑같이 그린다", () => {
    const now = new Date("2026-09-02T00:00:00.000Z");
    expect(timeAgo("2026-09-02T00:00:00.000Z", now)).toBe("방금 전");
    expect(timeAgo("2026-09-01T23:00:00.000Z", now)).toBe("1시간 전");
    expect(timeAgo("2026-08-28T00:00:00.000Z", now)).toBe("5일 전");
    // 30일이 넘으면 KST 절대 날짜 — 여기가 예전에 던지던 자리다.
    expect(timeAgo("2026-07-01T00:00:00.000Z", now)).toBe("2026.07.01");
  });
});
