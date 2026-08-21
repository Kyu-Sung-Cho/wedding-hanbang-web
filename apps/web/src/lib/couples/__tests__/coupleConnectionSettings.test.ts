import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  describeCoupleInviteWindow,
  describeInviteDeadline,
  resolveCoupleConnectionState,
} from "@hanbang/shared";

describe("couple connection presentation", () => {
  it("never exposes a retained code or invite action for a sealed single-member couple", () => {
    expect(resolveCoupleConnectionState({
      inviteCode: "WH-RETAINED",
      isFullyLinked: false,
      isMembershipSealed: true,
    })).toEqual({
      phase: "sealed_single",
      inviteCode: null,
      canInvite: false,
      inviteExpiresAt: null,
      inviteReissued: false,
    });
  });

  it("shows an invite only for an explicitly unsealed, valid API response", () => {
    expect(resolveCoupleConnectionState({
      inviteCode: "WH-ABC123",
      isFullyLinked: false,
      isMembershipSealed: false,
    })).toEqual({
      phase: "awaiting_partner",
      inviteCode: "WH-ABC123",
      canInvite: true,
      inviteExpiresAt: null,
      inviteReissued: false,
    });
    expect(resolveCoupleConnectionState({
      inviteCode: "bad-code",
      isFullyLinked: false,
      isMembershipSealed: false,
    })).toEqual({
      phase: "unavailable",
      inviteCode: null,
      canInvite: false,
      inviteExpiresAt: null,
      inviteReissued: false,
    });
  });

  it("prefers confirmed partner presence and a stored roster seal over stale API fields", () => {
    expect(resolveCoupleConnectionState(
      { isFullyLinked: false, isMembershipSealed: true },
      { partnerPresent: true, membershipSealedAt: "2026-07-16T00:00:00Z" },
    ).phase).toBe("linked");
    expect(resolveCoupleConnectionState(
      {
        inviteCode: "WH-STALE1",
        isFullyLinked: false,
        isMembershipSealed: false,
      },
      { membershipSealedAt: "2026-07-16T00:00:00Z" },
    )).toEqual({
      phase: "sealed_single",
      inviteCode: null,
      canInvite: false,
      inviteExpiresAt: null,
      inviteReissued: false,
    });
  });

  it("fails closed when the API payload is missing or contradictory", () => {
    expect(resolveCoupleConnectionState(null)).toEqual({
      phase: "unavailable",
      inviteCode: null,
      canInvite: false,
      inviteExpiresAt: null,
      inviteReissued: false,
    });
    expect(resolveCoupleConnectionState({
      inviteCode: "WH-ABC123",
      isFullyLinked: "false",
      isMembershipSealed: false,
    })).toEqual({
      phase: "unavailable",
      inviteCode: null,
      canInvite: false,
      inviteExpiresAt: null,
      inviteReissued: false,
    });
    expect(resolveCoupleConnectionState(
      {
        inviteCode: "WH-ABC123",
        isFullyLinked: false,
        isMembershipSealed: false,
      },
      { membershipSealedAt: "" },
    )).toEqual({
      phase: "unavailable",
      inviteCode: null,
      canInvite: false,
      inviteExpiresAt: null,
      inviteReissued: false,
    });
  });
});

describe("web sealed-single settings contract", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/app/(app)/settings/page.tsx"),
    "utf8",
  );

  it("uses the normalized connection phase instead of the old linked boolean", () => {
    expect(source).toContain("resolveCoupleConnectionState");
    expect(source).toContain('phase === "sealed_single"');
    expect(source).toContain('phase === "awaiting_partner"');
  });

  it("explains that reinviting is blocked and offers restart and support paths", () => {
    expect(source).toContain("새 멤버를 이 커플에 초대할 수 없어요");
    expect(source).toContain("새 커플로 다시 시작");
    expect(source).toContain("mailto:${CONTACT.email}");
    expect(source).not.toContain("https://hanbang.ai/support");
  });
});

describe("초대한 쪽도 자기 코드의 상태를 안다", () => {
  function connection(payload: Record<string, unknown>) {
    return resolveCoupleConnectionState({
      isFullyLinked: false,
      isMembershipSealed: false,
      ...payload,
    });
  }

  it("방금 갈아끼운 코드는 '다시 보내라'고 말한다", () => {
    const notice = describeCoupleInviteWindow(connection({
      inviteCode: "WH-ABC123",
      inviteCodeExpiresAt: "2026-08-27T06:00:00.000Z",
      inviteCodeReissued: true,
    }));
    expect(notice?.tone).toBe("reissued");
    expect(notice?.message).toContain("예전에 보낸 코드는 더 이상 쓸 수 없으니");
  });

  it("그대로인 코드는 마감만 알린다", () => {
    const notice = describeCoupleInviteWindow(connection({
      inviteCode: "WH-ABC123",
      inviteCodeExpiresAt: "2026-08-27T06:00:00.000Z",
    }));
    expect(notice).toEqual({
      tone: "active",
      message: "이 코드는 2026년 8월 27일 15시까지 쓸 수 있어요.",
    });
  });

  // 창은 발급 '시각' + 7일이다. 날짜만 찍으면 15시에 죽는 코드를 두고 그 날
  // 하루를 통째로 약속하게 된다. 뷰어 타임존에 따라 하루가 밀리는 것도 막는다.
  it("마감을 KST 시각까지 못박는다 - 날짜만 말하면 그것도 거짓말이다", () => {
    const notice = describeCoupleInviteWindow(connection({
      inviteCode: "WH-ABC123",
      inviteCodeExpiresAt: "2026-08-27T15:30:00.000Z",
    }));
    // 15:30 UTC = 다음 날 00:30 KST
    expect(notice?.message).toBe("이 코드는 2026년 8월 28일 0시 30분까지 쓸 수 있어요.");
  });

  // 서버는 만료된 코드를 응답에 싣지 않는다(회전시킨 뒤 새 코드를 준다).
  // 기기 시계로 다시 판정하면, 시계가 앞선 사용자에게 멀쩡한 코드를 두고
  // "만료됐다"고 말하게 된다 - 없애려던 거짓말을 반대 방향으로 새로 만드는 셈이다.
  it("기기 시계로 만료를 판정하지 않는다", () => {
    const state = connection({
      inviteCode: "WH-ABC123",
      inviteCodeExpiresAt: "2020-01-01T00:00:00.000Z",
    });
    expect(state.inviteCode).toBe("WH-ABC123");
    expect(Object.keys(state)).not.toContain("inviteExpired");
    expect(describeCoupleInviteWindow(state)?.message ?? "").not.toContain("만료");
  });

  it("창을 모르면 마감일을 지어내지 않는다 - 마이그레이션 전 DB", () => {
    expect(describeCoupleInviteWindow(connection({ inviteCode: "WH-ABC123" }))).toBeNull();
  });

  it("연결이 끝난 커플에는 초대 창 문구가 붙지 않는다", () => {
    expect(describeCoupleInviteWindow(resolveCoupleConnectionState(
      { inviteCode: "WH-ABC123", isFullyLinked: true, isMembershipSealed: false },
    ))).toBeNull();
  });
});

describe("web invite window settings contract", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/app/(app)/settings/page.tsx"),
    "utf8",
  );

  it("초대 창 안내를 화면에 배선한다", () => {
    expect(source).toContain("describeCoupleInviteWindow");
    expect(source).toContain("inviteWindowNotice");
  });

  it("기기 시계로 만료를 판정하는 분기를 두지 않는다", () => {
    expect(source).not.toContain("inviteExpired");
  });
});

// 코드를 손에 쥐고 파트너에게 보내는 바로 그 화면이다. 여기서 기한을 말하지
// 않으면, 8일째 들어온 파트너만 만료를 알게 되고 초대한 쪽은 끝까지 모른다 —
// 설정 화면까지 들어가는 사람은 드물다.
describe("코드를 나눠주는 화면이 기한을 말한다", () => {
  it("서버가 창을 알려주면 KST 시각까지 문장으로 만든다", () => {
    expect(describeInviteDeadline("2026-08-27T06:00:00.000Z"))
      .toBe("이 코드는 2026년 8월 27일 15시까지 쓸 수 있어요.");
  });

  it("창을 모르면 아무 말도 하지 않는다", () => {
    expect(describeInviteDeadline(null)).toBeNull();
    expect(describeInviteDeadline(undefined)).toBeNull();
    expect(describeInviteDeadline("아무거나")).toBeNull();
  });

  // 기한을 온보딩 응답에 실으려면 그 라우트가 couples 를 직접 읽어야 하는데,
  // 그 경계는 route.test.ts 가 fromCalls 로 고정하고 있다(실제로 걸렸다).
  // 그래서 화면이 /api/couple/code 에 따로 묻는다.
  it("온보딩 라우트는 couples 를 직접 읽지 않는다", () => {
    const route = readFileSync(
      resolve(process.cwd(), "src/app/api/onboarding/route.ts"),
      "utf8",
    );
    expect(route).not.toContain('from("couples")');
  });

  // import 줄만 보면 배선을 지워도 통과한다 — 실제로 그렇게 새는 것을 확인했다.
  // 값을 꺼내는 호출과 화면에 찍는 자리를 각각 못박는다.
  it("웹·모바일 코드 카드가 기한을 실제로 배선한다", () => {
    const web = readFileSync(
      resolve(process.cwd(), "src/app/(auth)/onboarding/page.tsx"),
      "utf8",
    );
    expect(web).toContain('fetch("/api/couple/code")');
    expect(web).toContain("setInviteDeadline(describeInviteDeadline(expiresAt))");
    // 정의만 있고 부르지 않으면 화면엔 아무것도 안 뜬다 — 호출부까지 못박는다.
    expect(web).toContain("void loadInviteDeadline();");
    // 예전에는 화면이 기한을 직접 그렸다. 지금은 InviteCodePanel 에 넘겨서 코드 바로
    // 아래에 그린다 — 검사하는 것은 여전히 "그 값이 화면까지 실제로 간다"이다.
    expect(web).toContain("message: inviteDeadline");

    const mobile = readFileSync(
      resolve(process.cwd(), "../../apps/mobile/app/onboarding/index.tsx"),
      "utf8",
    );
    expect(mobile).toContain('apiFetch("/api/couple/code")');
    expect(mobile).toContain("setResultDeadline(describeInviteDeadline(codePayload?.inviteCodeExpiresAt))");
    expect(mobile).toContain("{resultDeadline}");
  });
});
