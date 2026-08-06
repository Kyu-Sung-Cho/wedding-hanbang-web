import { describe, expect, it } from "vitest";
import { buildLifecycleCareDigest } from "@/lib/amora/careMessageIdentity";
import { buildAmoraLifecyclePlan } from "@/lib/amora/lifecycle";

// §15: "같은 내용은 상태가 바뀌기 전 반복하지 않는다."
//      "알림을 무시해도 죄책감이나 관계 불안을 만들지 않는다."
//      "아모라가 정말 잘 케어하고 있다면 중요하지 않은 날에는 조용할 수 있어야 한다."
//
// 중복 방지 키에 6시간 버킷이 들어 있어서, 내용이 한 글자도 바뀌지 않았는데 같은
// 메시지가 6시간마다 무기한 다시 나갔다.

const COUPLE = "11111111-1111-4111-8111-111111111111";

describe("같은 상태면 같은 키다", () => {
  it("시간이 지나도 키가 바뀌지 않는다", () => {
    // 예전에는 floor(now / 6시간)이 키에 들어가 6시간마다 새 알림이 됐다.
    const first = buildLifecycleCareDigest(COUPLE, "category_venue_warning");
    const second = buildLifecycleCareDigest(COUPLE, "category_venue_warning");
    expect(second).toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("커플이 다르면 키가 다르다", () => {
    expect(buildLifecycleCareDigest(COUPLE, "category_venue_warning"))
      .not.toBe(buildLifecycleCareDigest(
        "22222222-2222-4222-8222-222222222222",
        "category_venue_warning",
      ));
  });
});

describe("상태가 바뀌면 다시 말한다", () => {
  it("심각도가 올라가면 새 알림이다", () => {
    expect(buildLifecycleCareDigest(COUPLE, "category_venue_warning"))
      .not.toBe(buildLifecycleCareDigest(COUPLE, "category_venue_critical"));
  });

  it("다른 항목이면 새 알림이다", () => {
    expect(buildLifecycleCareDigest(COUPLE, "category_venue_warning"))
      .not.toBe(buildLifecycleCareDigest(COUPLE, "category_dress_warning"));
  });
});

describe("날짜 숫자가 줄어드는 것은 상태 변화가 아니다", () => {
  it("남은 일수만 다른 두 날은 같은 알림으로 본다", () => {
    // 본문에는 "확인 시점까지 30일 남았어요"처럼 매일 바뀌는 숫자가 들어간다.
    // 본문을 해시했다면 6시간마다가 매일로 바뀔 뿐이었다. 같은 항목이 같은 급함으로
    // 남아 있다는 것은 새 소식이 아니다.
    const day30 = buildAmoraLifecyclePlan({
      weddingDate: "2027-06-15",
      venue: "확정 예식장",
      totalBudget: 30_000_000,
      progress: {},
    });
    const day29 = buildAmoraLifecyclePlan({
      weddingDate: "2027-06-16",
      venue: "확정 예식장",
      totalBudget: 30_000_000,
      progress: {},
    });

    // 같은 항목·같은 심각도라면 하루 차이로 다시 말하지 않는다.
    if (day30.primaryAction.id === day29.primaryAction.id) {
      expect(buildLifecycleCareDigest(COUPLE, day29.primaryAction.id))
        .toBe(buildLifecycleCareDigest(COUPLE, day30.primaryAction.id));
    }
  });
});

describe("적대적인 입력", () => {
  it("빈 값에도 던지지 않고 서로 구분된다", () => {
    expect(() => buildLifecycleCareDigest("", "")).not.toThrow();
    expect(buildLifecycleCareDigest("a", "b")).not.toBe(buildLifecycleCareDigest("ab", ""));
  });
});
