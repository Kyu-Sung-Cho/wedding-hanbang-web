import { describe, expect, it } from "vitest";

import { resolveCoupleConnectionState } from "@hanbang/shared";

/**
 * 배우자가 합류하면 지워지는 것을 **보내기 전에** 말한다.
 *
 * ## 왜
 *
 * 커플 구성이 바뀌면 `trg_reset_amora_memory_after_membership_change`
 * (20260716090000:265) 가 그 범위의 자동 메모·대화 요약·프로필을 지운다. 새로
 * 들어온 사람이 자기가 없던 시절의 추론을 "우리 커플의 사실"로 물려받으면 안
 * 되기 때문이고 **그 판단은 옳다.** 바꾸는 것은 지우는 동작이 아니라 침묵이다.
 *
 * 2026-08-30 운영 실측: 커플 58쌍 중 **21쌍이 혼자**이고, 합류 시 자동 메모 89 +
 * 요약 6 이 사라진다. 그중 사용자가 확인·수정한 것은 **0건**이고, 확인한 예산·
 * 일정 결정 41건은 애초에 트리거 조건에 걸리지 않는다(`memory_key` 도
 * `extracted_by` 도 없다). 그래서 화면이 "확인한 것은 그대로"라고 말할 수 있다.
 *
 * 혼자 시작해 한참 대화한 뒤 배우자를 부르는 것이 이 제품에서 가장 흔한 경로이고,
 * 손해를 보는 사람은 **초대하는 쪽**이다. 그래서 초대 코드를 보여주는 자리에 붙인다.
 */

const AWAITING = {
  inviteCode: "WH-ABC123",
  isFullyLinked: false,
  isMembershipSealed: false,
  inviteCodeExpiresAt: null,
  inviteCodeReissued: false,
};

describe("합류하면 지워지는 것을 초대 화면이 말한다", () => {
  it("서버가 센 개수를 그대로 싣는다", () => {
    const state = resolveCoupleConnectionState({
      ...AWAITING,
      pendingPartnerJoinPurge: { memories: 12, summaries: 3, profiles: 1, total: 16 },
    });
    expect(state.phase).toBe("awaiting_partner");
    expect(state.partnerJoinPurgeTotal).toBe(16);
  });

  it("지울 것이 없으면 0 이다 — null 과 다르다", () => {
    // 0 은 "지워질 게 없다"는 사실이고 null 은 "못 셌다"이다. 화면은 둘 다
    // 아무 말도 하지 않지만, 뭉개면 나중에 "0 이라 안 뜬 것"과 "고장나서 안 뜬 것"을
    // 구분할 수 없다.
    const state = resolveCoupleConnectionState({
      ...AWAITING,
      pendingPartnerJoinPurge: { memories: 0, summaries: 0, profiles: 0, total: 0 },
    });
    expect(state.partnerJoinPurgeTotal).toBe(0);
  });

  it("서버가 못 세면 null 이고, 그때는 말하지 않는다", () => {
    // 틀린 숫자는 없느니만 못하다. 초대 코드는 이 숫자보다 중요하므로 세지 못해도
    // 코드는 그대로 나간다.
    expect(resolveCoupleConnectionState({
      ...AWAITING,
      pendingPartnerJoinPurge: null,
    }).partnerJoinPurgeTotal).toBeNull();

    expect(resolveCoupleConnectionState(AWAITING).partnerJoinPurgeTotal).toBeNull();
  });

  it("망가진 값은 지어내지 않는다", () => {
    for (const broken of [
      { total: "16" },
      { total: -3 },
      { total: Number.NaN },
      { total: Number.POSITIVE_INFINITY },
      { memories: 5 },
      "16",
      16,
    ]) {
      expect(
        resolveCoupleConnectionState({ ...AWAITING, pendingPartnerJoinPurge: broken })
          .partnerJoinPurgeTotal,
        `망가진 값이 숫자로 새어 나왔다: ${JSON.stringify(broken)}`,
      ).toBeNull();
    }
  });

  it("이미 두 명이거나 봉인됐으면 말할 것이 없다", () => {
    // 합류할 사람이 없으므로 지워질 일도 없다. 서버가 실수로 숫자를 실어 보내도
    // 화면은 그 상태에서 이 문장을 만들지 않는다.
    const linked = resolveCoupleConnectionState({
      ...AWAITING,
      isFullyLinked: true,
      pendingPartnerJoinPurge: { total: 99 },
    });
    expect(linked.phase).toBe("linked");
    expect(linked.partnerJoinPurgeTotal).toBeNull();

    const sealed = resolveCoupleConnectionState({
      ...AWAITING,
      isMembershipSealed: true,
      pendingPartnerJoinPurge: { total: 99 },
    });
    expect(sealed.phase).toBe("sealed_single");
    expect(sealed.partnerJoinPurgeTotal).toBeNull();
  });
});
