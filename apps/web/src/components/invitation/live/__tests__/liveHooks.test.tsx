import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPARE_STATE_COPY,
  JOURNEY_STATE_COPY,
  LETTER_STATE_COPY,
  type InvitationHomeResponse,
} from "@hanbang/shared/invitation";

import { isHomeResponse } from "../invitationGuards";
import { useInvitationHalls } from "../useInvitationHalls";
import { useInvitationConditions, useInvitationConsultation } from "../useInvitationHome";
import { useInvitationJourney } from "../useInvitationJourney";
import { useInvitationLetter } from "../useInvitationLetter";
import { useInvitationQuery } from "../useInvitationQuery";
import type { LiveIdentity } from "../useLiveIdentity";
import {
  FINGERPRINT,
  HALL_A,
  LETTER_ID,
  NEXT_FINGERPRINT,
  NEXT_VERSION,
  PARTNER,
  REPLY,
  VERSION,
  approverResponse,
  compareModel,
  conditionsResponse,
  consultationResponse,
  hallsResponse,
  homeResponse,
  journeyResponse,
  letterResponse,
} from "./liveFixtures";
import { apiError, cleanup, flush, json, mockApi, never, render } from "./liveTestKit";

/**
 * 실제 커플 화면의 읽기·쓰기 훅(2026-11-17 파운더 디자인 아티팩트). 서버는 `fetch` 를 흉내 낸다.
 * 성공, 빈 자료, 실패, 409(편지 판이 바뀜), 보내기 스위치가 꺼진 승인을 잰다.
 */

const identity = (owner: string | null = "user-1"): LiveIdentity => ({
  owner,
  isDemo: false,
  onboardingCompleted: true,
  refreshKey: "journey:1",
});

/** 훅을 그리는 작은 화면. 그릴 때마다 훅이 돌려준 값을 바깥에서 읽게 둔다(그린 뒤 효과에서 옮긴다). */
function probe<T>(useHook: () => T) {
  const result: { current: T } = { current: undefined as T };
  function Probe() {
    const value = useHook();
    useLayoutEffect(() => {
      result.current = value;
    });
    return null;
  }
  return { result, Probe };
}

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe("useInvitationQuery", () => {
  it("같은 출처로 쿠키를 실어 부르고, 받은 모델을 준다", async () => {
    const api = mockApi({ "GET /api/invitation/home": json(homeResponse()) });
    const { result, Probe } = probe(() => useInvitationQuery("/home", { owner: "user-1", accept: isHomeResponse }));
    await render(<Probe />);

    expect(result.current.loading).toBe(false);
    expect(result.current.data?.home.people.length).toBeGreaterThan(0);
    const fetchInit = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1];
    expect(fetchInit.credentials).toBe("same-origin");
    expect(fetchInit.cache).toBe("no-store");
    expect(api.count("GET", "/api/invitation/home")).toBe(1);
  });

  it("서버 오류는 코드와 사람이 읽는 문장을 함께 넘기고 자료는 비운다", async () => {
    mockApi({ "GET /api/invitation/home": apiError(503, "HOME_UNAVAILABLE", "홈을 불러오지 못했어요.") });
    const { result, Probe } = probe(() => useInvitationQuery("/home", { owner: "user-1", accept: isHomeResponse }));
    await render(<Probe />);

    expect(result.current.data).toBeNull();
    expect(result.current.failure).toMatchObject({ status: 503, code: "HOME_UNAVAILABLE", error: "홈을 불러오지 못했어요." });
  });

  it("모양이 다른 응답은 그리지 않고 실패로 다룬다", async () => {
    mockApi({ "GET /api/invitation/home": json({ home: { people: "민지" } }) });
    const { result, Probe } = probe(() => useInvitationQuery("/home", { owner: "user-1", accept: isHomeResponse }));
    await render(<Probe />);

    expect(result.current.data).toBeNull();
    expect(result.current.failure?.code).toBe("RESPONSE_SHAPE");
  });

  it("화면을 떠나면 요청을 멈춘다", async () => {
    const api = mockApi({ "GET /api/invitation/home": never });
    const { Probe } = probe(() => useInvitationQuery("/home", { owner: "user-1", accept: isHomeResponse }));
    const view = await render(<Probe />);
    const signal = api.calls[0].signal;
    expect(signal?.aborted).toBe(false);

    await view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("로그인한 사람이 바뀌면 앞 사람의 자료를 곧바로 버린다(새 자료가 오기 전에도)", async () => {
    let second: ((response: Response) => void) | null = null;
    mockApi({
      "GET /api/invitation/home": [
        json(homeResponse()),
        () => new Promise<Response>((resolve) => {
          second = resolve;
        }),
      ],
    });
    let owner = "user-1";
    const { result, Probe } = probe(() => useInvitationQuery<InvitationHomeResponse>("/home", { owner, accept: isHomeResponse }));
    const view = await render(<Probe />);
    expect(result.current.data?.home.invitation.firstName).toBe("민지");

    owner = "user-2";
    await view.rerender(<Probe />);
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    (second as unknown as (response: Response) => void)(json(homeResponse({ home: { ...homeResponse().home, invitation: { ...homeResponse().home.invitation, firstName: "새 사람" } } })));
    await flush();
    expect(result.current.data?.home.invitation.firstName).toBe("새 사람");
  });

  it("체험 모드처럼 끈 읽기는 서버를 부르지 않는다", async () => {
    const api = mockApi({});
    const { result, Probe } = probe(() => useInvitationQuery("/home", { owner: "user-1", enabled: false, accept: isHomeResponse }));
    await render(<Probe />);
    expect(api.calls).toHaveLength(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });
});

describe("useInvitationConditions", () => {
  it("저장하면 PATCH 로 보내고 서버가 준 조건으로 바꾼다", async () => {
    const api = mockApi({
      "GET /api/invitation/conditions": json(conditionsResponse({ missing: ["region", "guests"] })),
      "PATCH /api/invitation/conditions": json(conditionsResponse()),
    });
    const { result, Probe } = probe(() => useInvitationConditions(identity()));
    await render(<Probe />);
    expect(result.current.data?.missing).toEqual(["region", "guests"]);

    const saved = await result.current.save({ hopedYear: 2027, hopedMonth: 5, region: "서울", guestCount: 200 });
    await flush();
    expect(saved.ok).toBe(true);
    expect(api.last("PATCH", "/api/invitation/conditions")?.body).toEqual({ hopedYear: 2027, hopedMonth: 5, region: "서울", guestCount: 200 });
    expect(result.current.data?.missing).toEqual([]);
  });
});

describe("useInvitationJourney", () => {
  beforeEach(() => vi.clearAllMocks());

  it("빼기는 화면을 먼저 바꾸고 저장한 뒤 서버의 순서로 맞춘다", async () => {
    let release: (() => void) | null = null;
    const api = mockApi({
      "GET /api/invitation/journey": json(journeyResponse()),
      "PATCH /api/invitation/journey-plan": () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json(journeyResponse({ off: ["families"], addOns: [] })));
        }),
    });
    const { result, Probe } = probe(() => useInvitationJourney(identity()));
    await render(<Probe />);

    result.current.toggleStage("families");
    await flush();
    expect(result.current.data?.journey.rows.find((row) => row.key === "families")?.off).toBe(true);
    expect(result.current.saving).toBe(true);
    expect(api.last("PATCH", "/api/invitation/journey-plan")?.body).toEqual({ off: ["families"], addOns: [] });

    (release as unknown as () => void)();
    await flush();
    expect(result.current.saving).toBe(false);
    expect(result.current.data?.plan.off).toEqual(["families"]);
    expect(await result.current.settle()).toBe(true);
  });

  it("저장이 실패하면 되돌리고 다시 누르라고 말한다", async () => {
    mockApi({
      "GET /api/invitation/journey": json(journeyResponse()),
      "PATCH /api/invitation/journey-plan": apiError(503, "PLAN_CHANGE_UNAVAILABLE", "저장 상태를 확인하지 못했어요."),
    });
    const { result, Probe } = probe(() => useInvitationJourney(identity()));
    await render(<Probe />);

    result.current.toggleAddOn("rings");
    await flush();
    expect(result.current.data?.journey.addOns.find((addOn) => addOn.key === "rings")?.added).toBe(false);
    expect(result.current.saveFailed).toBe(JOURNEY_STATE_COPY.saveFailed);
    expect(await result.current.settle()).toBe(false);
  });

  it("뺄 수 없는 단계는 보내지 않는다", async () => {
    const api = mockApi({ "GET /api/invitation/journey": json(journeyResponse()) });
    const { result, Probe } = probe(() => useInvitationJourney(identity()));
    await render(<Probe />);
    result.current.toggleStage("venue");
    await flush();
    expect(api.count("PATCH", "/api/invitation/journey-plan")).toBe(0);
  });
});

describe("useInvitationHalls", () => {
  it("하트를 누르면 먼저 담기고, 서버가 답한 담긴 상태와 개수로 맞춘다", async () => {
    const api = mockApi({
      "GET /api/invitation/halls": json(hallsResponse()),
      [`POST /api/invitation/halls/${HALL_A}/shortlist`]: json({ hallId: HALL_A, picked: true, pickedCount: 1 }),
    });
    const { result, Probe } = probe(() => useInvitationHalls(identity(), "total"));
    await render(<Probe />);
    expect(api.last("GET", "/api/invitation/halls")?.url).toBe("/api/invitation/halls?sort=total");

    await result.current.toggleShortlist(HALL_A);
    await flush();
    expect(result.current.data?.compare?.halls[0].picked).toBe(true);
    expect(result.current.data?.pickedCount).toBe(1);
    expect(result.current.shortlistFailed).toBeNull();
  });

  it("상담 후보가 가득 차면(409) 되돌리고 서버가 말한 까닭을 보인다", async () => {
    mockApi({
      "GET /api/invitation/halls": json(hallsResponse()),
      [`POST /api/invitation/halls/${HALL_A}/shortlist`]: apiError(409, "SHORTLIST_FULL", "상담 후보는 5곳까지 담을 수 있어요."),
    });
    const { result, Probe } = probe(() => useInvitationHalls(identity(), "total"));
    await render(<Probe />);

    await result.current.toggleShortlist(HALL_A);
    await flush();
    expect(result.current.data?.compare?.halls[0].picked).toBe(false);
    expect(result.current.shortlistFailed).toBe("상담 후보는 5곳까지 담을 수 있어요.");
  });

  it("정렬을 바꾸면 그 기준으로 다시 묻는다", async () => {
    const api = mockApi({ "GET /api/invitation/halls": json(hallsResponse()) });
    let sort: "total" | "transit" = "total";
    const { Probe } = probe(() => useInvitationHalls(identity(), sort));
    const view = await render(<Probe />);
    sort = "transit";
    await view.rerender(<Probe />);
    expect(api.last("GET", "/api/invitation/halls")?.url).toBe("/api/invitation/halls?sort=transit");
  });

  it("조건이 모자라면 비교 모델 없이 무엇이 필요한지 준다", async () => {
    mockApi({ "GET /api/invitation/halls": json(hallsResponse({ compare: null, missing: ["region", "guests"] })) });
    const { result, Probe } = probe(() => useInvitationHalls(identity(), "total"));
    await render(<Probe />);
    expect(result.current.data?.compare).toBeNull();
    expect(COMPARE_STATE_COPY.needConditions).toBeTruthy();
  });
});

describe("useInvitationLetter", () => {
  function letterApi(routes: Parameters<typeof mockApi>[0]) {
    return mockApi({
      "GET /api/invitation/approver": json(approverResponse()),
      ...routes,
    });
  }

  it("초안은 먼저 판으로 저장하고 그 판을 승인한다. 보내기가 꺼져 있으면 승인만 저장됐다고 말한다", async () => {
    const api = letterApi({
      "GET /api/invitation/letter": json(letterResponse()),
      "PUT /api/invitation/letter": json({
        ...letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT }),
        saved: { letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, created: true },
      }),
      "POST /api/invitation/letter/approve": json({
        result: { status: "approved_not_queued", notQueuedReason: "sending_disabled", queuedCount: 0, duplicateHallIds: [], waitingFor: [] },
        letter: letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, status: "approved_not_queued", notQueuedReason: "sending_disabled" }),
      }),
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    expect(result.current.canSend).toBe(true);

    await result.current.send();
    await flush();
    const put = api.last("PUT", "/api/invitation/letter")?.body as Record<string, unknown>;
    expect(put.recipientHallIds).toHaveLength(2);
    expect(api.last("POST", "/api/invitation/letter/approve")?.body).toEqual({ versionId: VERSION, fingerprint: FINGERPRINT });
    expect(result.current.notice).toEqual({ tone: "status", text: LETTER_STATE_COPY.approvedNotSent });
  });

  it("승인 결과만으로도(편지를 다시 못 읽었어도) 보내기가 꺼져 업체에 가지 않았다고 말한다", async () => {
    letterApi({
      "GET /api/invitation/letter": json(letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT })),
      "POST /api/invitation/letter/approve": json({
        result: { status: "approved_not_queued", notQueuedReason: "sending_disabled", queuedCount: 0, duplicateHallIds: [], waitingFor: [] },
        letter: null,
      }),
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    await result.current.send();
    await flush();
    expect(result.current.notice).toEqual({ tone: "status", text: LETTER_STATE_COPY.approvedNotSent });
  });

  it("그 사이 편지가 바뀌었으면(409) 바뀐 편지를 다시 읽고 다시 확인하라고 말한다", async () => {
    const api = letterApi({
      "GET /api/invitation/letter": [
        json(letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT })),
        json(letterResponse({ letterId: LETTER_ID, versionId: NEXT_VERSION, version: 2, fingerprint: NEXT_FINGERPRINT })),
      ],
      "POST /api/invitation/letter/approve": apiError(409, "LETTER_VERSION_CHANGED", "편지 내용이 바뀌었어요."),
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);

    await result.current.send();
    await flush();
    expect(api.count("PUT", "/api/invitation/letter")).toBe(0);
    expect(result.current.notice).toEqual({ tone: "error", text: LETTER_STATE_COPY.versionChanged });
    expect(api.count("GET", "/api/invitation/letter")).toBe(2);
    expect(result.current.state?.versionId).toBe(NEXT_VERSION);
  });

  it("대기열에 넣었으면 몇 곳인지, 두 분 모두 승인해야 하면 누구를 기다리는지 말한다", async () => {
    letterApi({
      "GET /api/invitation/letter": json(letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT })),
      "POST /api/invitation/letter/approve": [
        json({ result: { status: "queued", notQueuedReason: null, queuedCount: 2, duplicateHallIds: [], waitingFor: [] }, letter: null }),
      ],
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    await result.current.send();
    await flush();
    expect(result.current.notice).toEqual({ tone: "status", text: LETTER_STATE_COPY.queued(2) });

    await cleanup();
    letterApi({
      "GET /api/invitation/letter": json(letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT })),
      "POST /api/invitation/letter/approve": json({
        result: { status: "awaiting_approval", notQueuedReason: null, queuedCount: 0, duplicateHallIds: [], waitingFor: [PARTNER] },
        letter: null,
      }),
    });
    const second = probe(() => useInvitationLetter(identity()));
    await render(<second.Probe />);
    await second.result.current.send();
    await flush();
    expect(second.result.current.notice).toEqual({ tone: "status", text: LETTER_STATE_COPY.waitingFor("준호") });
  });

  it("이미 보낸 편지는 다시 보낼 수 없고 그렇다고 말한다", async () => {
    letterApi({
      "GET /api/invitation/letter": json(letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, status: "queued", viewerCanApprove: false })),
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    expect(result.current.canSend).toBe(false);
    expect(result.current.notice).toEqual({ tone: "status", text: LETTER_STATE_COPY.alreadySent });
  });

  it("알려줄 정보를 바꾸면 보내기 전에 새 판을 저장한다(저장이 실패하면 승인하지 않는다)", async () => {
    const api = letterApi({
      "GET /api/invitation/letter": json(letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT })),
      "PUT /api/invitation/letter": apiError(400, "LETTER_SHARES_INVALID", "알려줄 정보를 다시 확인해 주세요."),
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    result.current.toggleShare("budget");
    await flush();
    expect(result.current.dirty).toBe(true);
    expect(result.current.model?.shares.find((share) => share.key === "budget")?.on).toBe(true);

    await result.current.send();
    await flush();
    const put = api.last("PUT", "/api/invitation/letter")?.body as { letterId: string; shares: { budget: { on: boolean }; phone: { on: boolean; value: unknown } } };
    expect(put.letterId).toBe(LETTER_ID);
    expect(put.shares.budget.on).toBe(true);
    // 화면은 가린 번호만 받으므로 새로 적지 않은 번호는 비워 보내 앞 판의 번호를 쓰게 한다.
    expect(put.shares.phone).toEqual({ on: true, value: null });
    expect(api.count("POST", "/api/invitation/letter/approve")).toBe(0);
    expect(result.current.notice).toEqual({ tone: "error", text: LETTER_STATE_COPY.saveFailed });
  });

  it("저장된 번호 없이 휴대폰을 켜면 번호 칸이 필요하다고 알리고, 적은 번호를 보낸다", async () => {
    const response = letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT });
    const letter = response.letter!;
    const api = letterApi({
      "GET /api/invitation/letter": json({
        ...response,
        letter: { ...letter, shares: letter.shares.map((share) => (share.key === "phone" ? { ...share, on: false, value: "" } : share)) },
      }),
      "PUT /api/invitation/letter": apiError(503, "INQUIRY_UNAVAILABLE", "잠시 후 다시 시도해 주세요."),
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    expect(result.current.needsPhone).toBe(false);
    result.current.toggleShare("phone");
    await flush();
    expect(result.current.needsPhone).toBe(true);
    result.current.setPhone("010-1234-5678");
    await flush();
    await result.current.send();
    await flush();
    const put = api.last("PUT", "/api/invitation/letter")?.body as { shares: { phone: { on: boolean; value: unknown } } };
    expect(put.shares.phone).toEqual({ on: true, value: "010-1234-5678" });
  });

  it("승인할 사람을 고르면 PUT 하고 편지 상태를 다시 읽는다", async () => {
    const api = letterApi({
      "GET /api/invitation/letter": json(letterResponse()),
      "PUT /api/invitation/approver": json(approverResponse({ setting: { mode: "designated", designatedUserId: PARTNER, revision: 2 } })),
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    expect(result.current.approverLine).toBe(LETTER_STATE_COPY.approverUnset);

    await result.current.chooseApprover("designated", PARTNER);
    await flush();
    expect(api.last("PUT", "/api/invitation/approver")?.body).toEqual({ mode: "designated", designatedUserId: PARTNER });
    expect(api.count("GET", "/api/invitation/letter")).toBe(2);
    expect(result.current.approverLine).toBe(LETTER_STATE_COPY.approverDesignated("준호"));
  });

  it("담은 홀이 없으면 편지가 아니라 먼저 담으라고 한다", async () => {
    letterApi({ "GET /api/invitation/letter": json({ letter: null, state: null, missing: ["shortlist"] }) });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    expect(result.current.needShortlist).toBe(true);
  });
});

describe("useInvitationConsultation", () => {
  it("일정에 넣기는 누를 때만 POST 하고, 넣으면 일정에 있다고 바꾼다", async () => {
    const api = mockApi({
      "GET /api/invitation/consultation": json(consultationResponse()),
      "POST /api/invitation/consultation/schedule": json({ added: true, alreadyInCalendar: false, eventId: "event-1" }),
    });
    const { result, Probe } = probe(() => useInvitationConsultation(identity()));
    await render(<Probe />);
    expect(api.count("POST", "/api/invitation/consultation/schedule")).toBe(0);

    await result.current.addToCalendar();
    await flush();
    expect(api.last("POST", "/api/invitation/consultation/schedule")?.body).toEqual({ replyId: REPLY });
    expect(result.current.added).toBe(true);
    expect(result.current.data?.inCalendar).toBe(true);
  });

  it("넣지 못하면 서버가 말한 까닭을 보인다", async () => {
    mockApi({
      "GET /api/invitation/consultation": json(consultationResponse()),
      "POST /api/invitation/consultation/schedule": apiError(409, "SCHEDULE_FULL", "일정이 너무 많아 더 넣을 수 없어요."),
    });
    const { result, Probe } = probe(() => useInvitationConsultation(identity()));
    await render(<Probe />);
    await result.current.addToCalendar();
    await flush();
    expect(result.current.addFailed).toBe("일정이 너무 많아 더 넣을 수 없어요.");
    expect(result.current.data?.inCalendar).toBe(false);
  });
});

describe("오늘 한 일의 주체", () => {
  it("줄마다 누가 했는지가 없는 응답은 받지 않는다(담당자의 일이 아모라의 일처럼 놓이지 않게)", async () => {
    mockApi({ "GET /api/invitation/activity": json({ activity: [{ timeLabel: "13:40", text: "가온 웨딩홀 답장을 정리했어요" }] }) });
    const { useInvitationActivity } = await import("../useInvitationHome");
    const { result, Probe } = probe(() => useInvitationActivity(identity()));
    await render(<Probe />);
    expect(result.current.data).toBeNull();
    expect(result.current.failure?.code).toBe("RESPONSE_SHAPE");
  });

  it("주체가 있으면 받는다", async () => {
    mockApi({ "GET /api/invitation/activity": json({ activity: [{ timeLabel: "13:40", text: "가온 웨딩홀 답장을 정리했어요", actor: "operator" }] }) });
    const { useInvitationActivity } = await import("../useInvitationHome");
    const { result, Probe } = probe(() => useInvitationActivity(identity()));
    await render(<Probe />);
    expect(result.current.data?.activity[0].actor).toBe("operator");
  });
});

describe("compareModel fixture", () => {
  it("실제 웨딩홀 사진은 https 주소다", () => {
    expect(compareModel().halls[0].photo?.startsWith("https://")).toBe(true);
  });
});
