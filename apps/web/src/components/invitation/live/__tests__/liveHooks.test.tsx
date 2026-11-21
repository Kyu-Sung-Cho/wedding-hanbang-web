import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPARE_STATE_COPY,
  EXAMPLE_LETTER,
  JOURNEY_STATE_COPY,
  LETTER_STATE_COPY,
  VENDOR_REPLY_COPY,
  type ConsultationPasteSchedulePost,
  type InvitationHomeResponse,
  type LetterSelfSend,
} from "@hanbang/shared/invitation";

import { isConsultationResponse, isHomeResponse, isLetterResponse } from "../invitationGuards";
import { useInvitationHalls } from "../useInvitationHalls";
import { useInvitationConditions, useInvitationConsultation, usePastedConsultationSchedule } from "../useInvitationHome";
import { useInvitationJourney } from "../useInvitationJourney";
import { useInvitationLetter } from "../useInvitationLetter";
import { useInvitationQuery } from "../useInvitationQuery";
import type { LiveIdentity } from "../useLiveIdentity";
import {
  FINGERPRINT,
  HALL_A,
  HALL_B,
  LETTER_ID,
  NEXT_FINGERPRINT,
  NEXT_VERSION,
  PARTNER,
  REPLY,
  REPLY_PASTE,
  VERSION,
  approverResponse,
  compareModel,
  conditionsResponse,
  consultationResponse,
  hallsResponse,
  homeResponse,
  journeyResponse,
  letterResponse,
  selfSendFor,
  selfSendLetterResponse,
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

  it("꺼진 서버의 보내기(send)는 저장 실패를 예전 그대로 말한다: 잠긴 편지는 이미 보냈다고 하고 다시 읽으며, 받는 홀이 바뀐 409 는 다시 누르라고만 하고 다시 읽지 않는다", async () => {
    const api = letterApi({
      "GET /api/invitation/letter": json(letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT })),
      "PUT /api/invitation/letter": [
        apiError(409, "LETTER_LOCKED", "이미 보낼 준비를 마친 편지예요. 새 편지로 써 주세요."),
        apiError(409, "RECIPIENTS_UNAVAILABLE", "받는 홀이 바뀌었어요. 담은 홀을 다시 확인해 주세요."),
      ],
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    result.current.toggleShare("budget");
    await flush();
    await result.current.send();
    await flush();
    expect(result.current.notice).toEqual({ tone: "error", text: LETTER_STATE_COPY.alreadySent });
    expect(api.count("GET", "/api/invitation/letter")).toBe(2);

    await result.current.send();
    await flush();
    expect(result.current.notice).toEqual({ tone: "error", text: LETTER_STATE_COPY.saveFailed });
    expect(api.count("GET", "/api/invitation/letter")).toBe(2);
    expect(api.count("POST", "/api/invitation/letter/approve")).toBe(0);
    expect(result.current.preparedCount).toBe(0);
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

describe("useInvitationLetter: 직접 보내기(D-83 1단계)", () => {
  const SAVED = { letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, status: "awaiting_approval" as const };

  function letterApi(routes: Parameters<typeof mockApi>[0]) {
    return mockApi({ "GET /api/invitation/approver": json(approverResponse()), ...routes });
  }

  it("칸이 없으면 직접 보내기가 아니다. 칸이 있으면(null 이어도) 직접 보내기이고, 저장한 판이 없으면 보낼 글 없이 저장만 누를 수 있다", async () => {
    letterApi({ "GET /api/invitation/letter": json(letterResponse()) });
    const off = probe(() => useInvitationLetter(identity()));
    await render(<off.Probe />);
    expect(off.result.current.selfSendMode).toBe(false);
    expect(off.result.current.selfSend).toBeNull();
    await cleanup();

    letterApi({ "GET /api/invitation/letter": json(selfSendLetterResponse({}, { selfSend: null })) });
    const draft = probe(() => useInvitationLetter(identity()));
    await render(<draft.Probe />);
    expect(draft.result.current.selfSendMode).toBe(true);
    expect(draft.result.current.selfSend).toBeNull();
    expect(draft.result.current.canPrepare).toBe(true);
  });

  it("보낼 글은 그 글을 만든 판이 화면의 판과 같고 고친 것이 없을 때만 준다", async () => {
    letterApi({ "GET /api/invitation/letter": json(selfSendLetterResponse(SAVED, { selfSend: selfSendFor() })) });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    expect(result.current.selfSend?.versionId).toBe(VERSION);
    expect(result.current.canPrepare).toBe(false);

    result.current.toggleShare("budget");
    await flush();
    expect(result.current.dirty).toBe(true);
    expect(result.current.selfSend).toBeNull();
    expect(result.current.canPrepare).toBe(true);
    await cleanup();

    letterApi({ "GET /api/invitation/letter": json(selfSendLetterResponse(SAVED, { selfSend: selfSendFor(VERSION, NEXT_FINGERPRINT) })) });
    const mismatch = probe(() => useInvitationLetter(identity()));
    await render(<mismatch.Probe />);
    expect(mismatch.result.current.selfSendMode).toBe(true);
    expect(mismatch.result.current.selfSend).toBeNull();
  });

  it("prepare 는 화면의 편지를 PUT 으로 저장만 하고 승인은 부르지 않는다. 저장한 판의 보낼 글을 곧바로 준다", async () => {
    const api = letterApi({
      "GET /api/invitation/letter": json(selfSendLetterResponse({}, { selfSend: null })),
      "PUT /api/invitation/letter": json({
        ...selfSendLetterResponse(SAVED, { selfSend: selfSendFor() }),
        saved: { letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, created: true },
      }),
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);

    await result.current.prepare();
    await flush();
    expect(api.count("PUT", "/api/invitation/letter")).toBe(1);
    expect(api.count("POST", "/api/invitation/letter/approve")).toBe(0);
    // 직접 보내기 서버는 휴대폰 번호 줄을 주지 않으므로 저장 본문의 번호는 꺼져 있다.
    expect(api.last("PUT", "/api/invitation/letter")?.body).toEqual({
      letterId: null,
      recipientHallIds: [HALL_A, HALL_B],
      body: EXAMPLE_LETTER.body,
      shares: { name: { on: true, value: "김민지" }, phone: { on: false, value: null }, budget: { on: false } },
    });
    expect(result.current.model?.shares.map((share) => share.key)).toEqual(["name", "budget"]);
    expect(result.current.needsPhone).toBe(false);
    expect(result.current.state?.versionId).toBe(VERSION);
    expect(result.current.selfSend?.messages.map((message) => message.hallId)).toEqual([HALL_A, HALL_B]);
    expect(result.current.notice).toBeNull();
    expect(result.current.canPrepare).toBe(false);
  });

  it("prepare 의 저장 본문은 send 의 저장 본문과 같다(새로 적은 휴대폰 번호와 바꾼 정보 포함)", async () => {
    // 두 저장 본문을 만드는 곳이 갈라지지 않았는지 보는 시험이라 두 번 다 휴대폰 번호 줄이 있는 응답을 쓴다
    // (직접 보내기 서버는 그 줄을 빼고 준다. 그 응답은 `selfSendLetterResponse` 를 쓰는 시험들이 본다).
    async function putBodyAfter(action: "send" | "prepare", selfSend: LetterSelfSend | undefined) {
      const response = letterResponse(SAVED, selfSend ? { selfSend } : {});
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
      result.current.toggleShare("phone");
      await flush();
      result.current.setPhone(" 010-1234-5678 ");
      await flush();
      result.current.toggleShare("budget");
      await flush();
      await result.current[action]();
      await flush();
      const body = api.last("PUT", "/api/invitation/letter")?.body;
      await cleanup();
      return body;
    }

    const viaSend = await putBodyAfter("send", undefined);
    const viaPrepare = await putBodyAfter("prepare", selfSendFor());
    expect(viaPrepare).toEqual(viaSend);
    expect(viaPrepare).toMatchObject({ shares: { phone: { on: true, value: "010-1234-5678" }, budget: { on: true } } });
  });

  it("저장이 실패했는데 서버가 이유를 말하지 않으면(연결 끊김) 다시 누르라고 말하고, 같은 순간 두 번 눌러도 PUT 은 한 번만 나간다", async () => {
    const api = letterApi({
      "GET /api/invitation/letter": json(selfSendLetterResponse({}, { selfSend: null })),
      "PUT /api/invitation/letter": () => Promise.reject(new TypeError("Failed to fetch")),
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    await Promise.all([result.current.prepare(), result.current.prepare()]);
    await flush();
    expect(api.count("PUT", "/api/invitation/letter")).toBe(1);
    expect(result.current.notice).toEqual({ tone: "error", text: LETTER_STATE_COPY.saveFailed });
    expect(api.count("GET", "/api/invitation/letter")).toBe(1);
  });

  it("받는 홀이 바뀌어 저장이 409 로 막히면 서버가 말한 이유를 보이고 편지를 다시 읽는다. 다시 누르면 다시 읽은 받는 곳으로 저장한다(같은 409 를 되풀이하지 않는다)", async () => {
    const onlyA = [{ hallId: HALL_A, name: "하나 웨딩홀" }];
    const reread = selfSendLetterResponse({ letterId: LETTER_ID, recipients: onlyA }, { selfSend: null });
    const api = letterApi({
      "GET /api/invitation/letter": [
        json(selfSendLetterResponse(SAVED, { selfSend: selfSendFor() })),
        json({ ...reread, letter: { ...reread.letter!, recipients: ["하나 웨딩홀"] } }),
      ],
      "PUT /api/invitation/letter": [
        apiError(409, "RECIPIENTS_UNAVAILABLE", "받는 홀이 바뀌었어요. 담은 홀을 다시 확인해 주세요."),
        json({
          ...selfSendLetterResponse(
            { ...SAVED, versionId: NEXT_VERSION, version: 2, fingerprint: NEXT_FINGERPRINT, recipients: onlyA },
            { selfSend: selfSendFor(NEXT_VERSION, NEXT_FINGERPRINT, { messages: [selfSendFor().messages[0]] }) },
          ),
          saved: { letterId: LETTER_ID, versionId: NEXT_VERSION, version: 2, fingerprint: NEXT_FINGERPRINT, created: true },
        }),
      ],
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    result.current.toggleShare("budget");
    await flush();

    await result.current.prepare();
    await flush();
    expect((api.last("PUT", "/api/invitation/letter")?.body as { recipientHallIds: string[] }).recipientHallIds).toEqual([HALL_A, HALL_B]);
    expect(result.current.notice).toEqual({ tone: "error", text: "받는 홀이 바뀌었어요. 담은 홀을 다시 확인해 주세요." });
    expect(api.count("GET", "/api/invitation/letter")).toBe(2);
    expect(result.current.state?.recipients.map((recipient) => recipient.hallId)).toEqual([HALL_A]);
    expect(result.current.canPrepare).toBe(true);
    expect(result.current.preparedCount).toBe(0);

    await result.current.prepare();
    await flush();
    expect((api.last("PUT", "/api/invitation/letter")?.body as { recipientHallIds: string[] }).recipientHallIds).toEqual([HALL_A]);
    expect(result.current.notice).toBeNull();
    expect(result.current.selfSend?.messages.map((message) => message.hallId)).toEqual([HALL_A]);
    expect(result.current.preparedCount).toBe(1);
    expect(api.count("POST", "/api/invitation/letter/approve")).toBe(0);
  });

  it("직접 보내기의 저장 실패는 이미 보냈다고 말하지 않는다: 잠긴 편지(409)는 서버가 말한 이유를, 이유가 없으면 다시 누르라고 말하고 어느 409 든 편지를 다시 읽는다", async () => {
    const locked = letterApi({
      "GET /api/invitation/letter": json(selfSendLetterResponse(SAVED, { selfSend: selfSendFor() })),
      "PUT /api/invitation/letter": [
        apiError(409, "LETTER_LOCKED", "이미 보낼 준비를 마친 편지예요. 새 편지로 써 주세요."),
        apiError(409, "LETTER_LOCKED", " "),
      ],
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    result.current.toggleShare("budget");
    await flush();
    await result.current.prepare();
    await flush();
    expect(result.current.notice).toEqual({ tone: "error", text: "이미 보낼 준비를 마친 편지예요. 새 편지로 써 주세요." });
    expect(locked.count("GET", "/api/invitation/letter")).toBe(2);

    await result.current.prepare();
    await flush();
    expect(result.current.notice).toEqual({ tone: "error", text: LETTER_STATE_COPY.saveFailed });
    expect(result.current.notice?.text).not.toBe(LETTER_STATE_COPY.alreadySent);
    expect(locked.count("GET", "/api/invitation/letter")).toBe(3);
  });

  it("409 가 아닌 저장 실패는 서버가 말한 이유를 보이되 편지를 다시 읽지 않고 고친 것을 그대로 둔다", async () => {
    const api = letterApi({
      "GET /api/invitation/letter": json(selfSendLetterResponse(SAVED, { selfSend: selfSendFor() })),
      "PUT /api/invitation/letter": apiError(400, "LETTER_SHARES_INVALID", "알려줄 정보를 다시 확인해 주세요."),
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    result.current.toggleShare("budget");
    await flush();
    await result.current.prepare();
    await flush();
    expect(result.current.notice).toEqual({ tone: "error", text: "알려줄 정보를 다시 확인해 주세요." });
    expect(api.count("GET", "/api/invitation/letter")).toBe(1);
    expect(result.current.dirty).toBe(true);
    expect(result.current.preparing).toBe(false);
  });

  it("preparing 은 저장하는 동안만 참이다. 승인 방식 제안에 답하는 동안(busy)에는 거짓이다", async () => {
    let finishPut: (response: Response) => void = () => undefined;
    let finishConfirm: (response: Response) => void = () => undefined;
    const pending = { proposalId: "99999999-9999-4999-8999-999999999999", mode: "both" as const, designatedUserId: null, proposedBy: PARTNER, proposedAt: "2026-11-17T03:00:00.000Z", viewerCanRespond: true };
    letterApi({
      "GET /api/invitation/approver": json(approverResponse({ pending })),
      "GET /api/invitation/letter": json(selfSendLetterResponse({}, { selfSend: null })),
      "PUT /api/invitation/letter": () => new Promise<Response>((resolve) => {
        finishPut = resolve;
      }),
      "POST /api/invitation/approver/confirm": () => new Promise<Response>((resolve) => {
        finishConfirm = resolve;
      }),
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);

    const confirming = result.current.respondToProposal(true);
    await flush();
    expect(result.current.busy).toBe(true);
    expect(result.current.preparing).toBe(false);
    finishConfirm(json(approverResponse({ setting: { mode: "both", designatedUserId: null, revision: 2 }, pending: null, outcome: "confirmed" })));
    await confirming;
    await flush();
    expect(result.current.busy).toBe(false);

    const saving = result.current.prepare();
    await flush();
    expect(result.current.preparing).toBe(true);
    finishPut(json({
      ...selfSendLetterResponse(SAVED, { selfSend: selfSendFor() }),
      saved: { letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, created: true },
    }));
    await saving;
    await flush();
    expect(result.current.preparing).toBe(false);
    expect(result.current.preparedCount).toBe(1);
  });

  it("needsSave 는 쓰기가 도는 동안에도 그대로다(잠기는 것은 canPrepare 뿐이다). 대기열에 넣은 옛 편지와 글이 나온 판은 저장할 것이 없다", async () => {
    let finishConfirm: (response: Response) => void = () => undefined;
    const pending = { proposalId: "99999999-9999-4999-8999-999999999999", mode: "both" as const, designatedUserId: null, proposedBy: PARTNER, proposedAt: "2026-11-17T03:00:00.000Z", viewerCanRespond: true };
    letterApi({
      "GET /api/invitation/approver": json(approverResponse({ pending })),
      "GET /api/invitation/letter": json(selfSendLetterResponse({}, { selfSend: null })),
      "POST /api/invitation/approver/confirm": () => new Promise<Response>((resolve) => {
        finishConfirm = resolve;
      }),
    });
    const draft = probe(() => useInvitationLetter(identity()));
    await render(<draft.Probe />);
    expect(draft.result.current.needsSave).toBe(true);
    expect(draft.result.current.canPrepare).toBe(true);

    const confirming = draft.result.current.respondToProposal(true);
    await flush();
    expect(draft.result.current.busy).toBe(true);
    expect(draft.result.current.needsSave).toBe(true);
    expect(draft.result.current.canPrepare).toBe(false);
    finishConfirm(json(approverResponse({ setting: { mode: "both", designatedUserId: null, revision: 2 }, pending: null, outcome: "confirmed" })));
    await confirming;
    await flush();
    expect(draft.result.current.needsSave).toBe(true);
    expect(draft.result.current.canPrepare).toBe(true);
    await cleanup();

    // 대기열에 넣은 옛 편지는 고쳐도 저장할 것이 없다(서버가 받지 않는다).
    letterApi({ "GET /api/invitation/letter": json(selfSendLetterResponse({ ...SAVED, status: "queued", viewerCanApprove: false }, { selfSend: null })) });
    const queued = probe(() => useInvitationLetter(identity()));
    await render(<queued.Probe />);
    expect(queued.result.current.needsSave).toBe(false);
    queued.result.current.toggleShare("budget");
    await flush();
    expect(queued.result.current.dirty).toBe(true);
    expect(queued.result.current.needsSave).toBe(false);
    expect(queued.result.current.canPrepare).toBe(false);
    await cleanup();

    letterApi({ "GET /api/invitation/letter": json(selfSendLetterResponse(SAVED, { selfSend: selfSendFor() })) });
    const saved = probe(() => useInvitationLetter(identity()));
    await render(<saved.Probe />);
    expect(saved.result.current.needsSave).toBe(false);
    saved.result.current.toggleShare("budget");
    await flush();
    expect(saved.result.current.needsSave).toBe(true);
  });

  it("직접 보내기에서는 승인을 저장했다·누구를 기다린다는 줄을 말하지 않는다. 대기열에 넣은 옛 편지만 그렇다고 말한다", async () => {
    letterApi({
      "GET /api/invitation/letter": json(selfSendLetterResponse(
        { ...SAVED, status: "approved_not_queued", notQueuedReason: "sending_disabled" },
        { selfSend: selfSendFor() },
      )),
    });
    const paused = probe(() => useInvitationLetter(identity()));
    await render(<paused.Probe />);
    expect(paused.result.current.notice).toBeNull();
    await cleanup();

    letterApi({ "GET /api/invitation/letter": json(selfSendLetterResponse({ ...SAVED, waitingFor: [PARTNER] }, { selfSend: selfSendFor() })) });
    const waiting = probe(() => useInvitationLetter(identity()));
    await render(<waiting.Probe />);
    expect(waiting.result.current.notice).toBeNull();
    await cleanup();

    letterApi({
      "GET /api/invitation/letter": json(selfSendLetterResponse({ ...SAVED, status: "queued", viewerCanApprove: false }, { selfSend: null })),
    });
    const queued = probe(() => useInvitationLetter(identity()));
    await render(<queued.Probe />);
    expect(queued.result.current.notice).toEqual({ tone: "status", text: LETTER_STATE_COPY.alreadySent });
    expect(queued.result.current.canPrepare).toBe(false);
  });

  it("먼저 물을 조건은 희망 시기·하객 수뿐이다(지역은 편지 글에 들어가지 않는다)", async () => {
    letterApi({ "GET /api/invitation/letter": json(selfSendLetterResponse({}, { missing: ["month", "region", "guests"], selfSend: null })) });
    const all = probe(() => useInvitationLetter(identity()));
    await render(<all.Probe />);
    expect(all.result.current.missingConditions).toEqual(["month", "guests"]);
    await cleanup();

    letterApi({ "GET /api/invitation/letter": json(selfSendLetterResponse({}, { missing: ["region"], selfSend: null })) });
    const regionOnly = probe(() => useInvitationLetter(identity()));
    await render(<regionOnly.Probe />);
    expect(regionOnly.result.current.missingConditions).toEqual([]);
  });

  it("화면을 연 뒤 직접 보내기가 켜져 승인을 받지 않으면(409 SELF_SEND_MODE) 실패라고 하지 않고 편지를 다시 읽어 보낼 글을 보인다", async () => {
    const api = letterApi({
      "GET /api/invitation/letter": [
        // 스위치가 꺼져 있을 때 연 화면: 칸이 없다.
        json(letterResponse(SAVED)),
        // 다시 읽으면 켜진 서버의 편지다: 저장한 판으로 엮은 보낼 글이 있다.
        json(selfSendLetterResponse(SAVED, { selfSend: selfSendFor() })),
      ],
      "POST /api/invitation/letter/approve": apiError(409, "SELF_SEND_MODE", "지금은 두 분이 편지를 직접 보내요."),
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    expect(result.current.selfSendMode).toBe(false);

    await result.current.send();
    await flush();
    expect(api.count("POST", "/api/invitation/letter/approve")).toBe(1);
    expect(api.count("GET", "/api/invitation/letter")).toBe(2);
    expect(result.current.selfSendMode).toBe(true);
    expect(result.current.selfSend?.versionId).toBe(VERSION);
    expect(result.current.notice).toBeNull();
  });

  it("승인 방식을 바꾸다 직접 보내기가 켜진 것을 알아도(409 SELF_SEND_MODE) 실패라고 하지 않고 편지를 다시 읽는다", async () => {
    const api = letterApi({
      "GET /api/invitation/letter": [
        json(letterResponse(SAVED)),
        json(selfSendLetterResponse(SAVED, { selfSend: selfSendFor() })),
      ],
      "PUT /api/invitation/approver": apiError(409, "SELF_SEND_MODE", "지금은 두 분이 편지를 직접 보내요."),
    });
    const { result, Probe } = probe(() => useInvitationLetter(identity()));
    await render(<Probe />);
    expect(result.current.selfSendMode).toBe(false);

    await result.current.chooseApprover("both");
    await flush();
    expect(api.count("PUT", "/api/invitation/approver")).toBe(1);
    expect(api.count("GET", "/api/invitation/letter")).toBe(2);
    expect(result.current.selfSendMode).toBe(true);
    expect(result.current.notice).toBeNull();
  });
});

describe("직접 보내기·붙여 넣기 응답의 경계 검사", () => {
  it("편지 응답: selfSend 칸이 없거나 null 이면 받고, 있으면 모양이 맞아야 받는다", () => {
    const base = letterResponse();
    expect(isLetterResponse(base)).toBe(true);
    expect(isLetterResponse({ ...base, selfSend: null })).toBe(true);
    expect(isLetterResponse({ ...base, selfSend: selfSendFor() })).toBe(true);
    expect(isLetterResponse({ ...base, selfSend: { ...selfSendFor(), phoneOmitted: "no" } })).toBe(false);
    expect(isLetterResponse({ ...base, selfSend: { ...selfSendFor(), messages: [{ hallId: HALL_A, name: "하나 웨딩홀" }] } })).toBe(false);
    expect(isLetterResponse({ ...base, selfSend: { ...selfSendFor(), versionId: null } })).toBe(false);
  });

  it("상담 응답: replyPaste 칸이 없으면 받고, 있으면 홀마다 ID 와 이름이 있어야 받는다", () => {
    const base = consultationResponse();
    expect(isConsultationResponse(base)).toBe(true);
    expect(isConsultationResponse({ ...base, replyPaste: REPLY_PASTE })).toBe(true);
    expect(isConsultationResponse({ ...base, replyPaste: { halls: [], addedCount: 0 } })).toBe(true);
    expect(isConsultationResponse({ ...base, replyPaste: null })).toBe(false);
    expect(isConsultationResponse({ ...base, replyPaste: { halls: [{ hallId: HALL_A }], addedCount: 0 } })).toBe(false);
  });

  it("상담 응답: 붙여 넣은 답으로 넣은 상담 수(addedCount)는 0 이상의 정수여야 받는다", () => {
    const base = consultationResponse();
    const withCount = (addedCount: unknown) => ({ ...base, replyPaste: { halls: REPLY_PASTE.halls, addedCount } });
    expect(isConsultationResponse(withCount(0))).toBe(true);
    expect(isConsultationResponse(withCount(3))).toBe(true);
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "2", null, undefined]) {
      expect(isConsultationResponse(withCount(bad))).toBe(false);
    }
    expect(isConsultationResponse({ ...base, replyPaste: { halls: REPLY_PASTE.halls } })).toBe(false);
  });
});

describe("usePastedConsultationSchedule", () => {
  it("누르기 전에는 부르지 않는다. 넣기는 홀·날짜·시간 세 칸만 보내고, 넣었는지·이미 있었는지를 한 줄로 준다", async () => {
    const api = mockApi({
      "POST /api/invitation/consultation/paste-schedule": [
        json({ added: true, alreadyInCalendar: false, eventId: "event-1" }),
        json({ added: false, alreadyInCalendar: true, eventId: "event-1" }),
      ],
    });
    const { result, Probe } = probe(() => usePastedConsultationSchedule());
    await render(<Probe />);
    expect(api.calls).toHaveLength(0);

    // 다른 칸이 섞여 들어와도(붙여 넣은 글 같은) 세 칸만 보낸다.
    const withExtra = { hallId: HALL_A, date: "2026-11-30", time: "14:00", raw: "붙여 넣은 글" } as ConsultationPasteSchedulePost;
    await result.current.add(withExtra);
    await flush();
    expect(api.last("POST", "/api/invitation/consultation/paste-schedule")?.body).toEqual({ hallId: HALL_A, date: "2026-11-30", time: "14:00" });
    expect(result.current.outcome).toEqual({ tone: "status", text: VENDOR_REPLY_COPY.added });

    await result.current.add({ hallId: HALL_A, date: "2026-11-30" });
    await flush();
    expect(api.last("POST", "/api/invitation/consultation/paste-schedule")?.body).toEqual({ hallId: HALL_A, date: "2026-11-30" });
    expect(result.current.outcome).toEqual({ tone: "status", text: VENDOR_REPLY_COPY.alreadyAdded });

    result.current.clear();
    await flush();
    expect(result.current.outcome).toBeNull();
  });

  it("onAdded 는 새 상담을 넣었을 때(added: true)만 부른다. 이미 있던 일정이나 실패에는 부르지 않는다", async () => {
    mockApi({
      "POST /api/invitation/consultation/paste-schedule": [
        json({ added: false, alreadyInCalendar: true, eventId: "event-1" }),
        apiError(409, "SCHEDULE_FULL", "일정이 너무 많아 더 넣을 수 없어요."),
        json({ added: true, alreadyInCalendar: false, eventId: "event-2" }),
      ],
    });
    const onAdded = vi.fn();
    const { result, Probe } = probe(() => usePastedConsultationSchedule({ onAdded }));
    await render(<Probe />);
    const body = { hallId: HALL_A, date: "2026-11-30" };

    await result.current.add(body);
    await flush();
    await result.current.add(body);
    await flush();
    expect(onAdded).not.toHaveBeenCalled();

    await result.current.add(body);
    await flush();
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(result.current.outcome).toEqual({ tone: "status", text: VENDOR_REPLY_COPY.added });
  });

  it("같은 순간 두 번 눌러도 한 번만 보내고, 넣지 못하면 서버가 말한 까닭을 준다", async () => {
    const api = mockApi({
      "POST /api/invitation/consultation/paste-schedule": apiError(409, "SCHEDULE_FULL", "일정이 너무 많아 더 넣을 수 없어요."),
    });
    const { result, Probe } = probe(() => usePastedConsultationSchedule());
    await render(<Probe />);
    const body = { hallId: HALL_A, date: "2026-11-30" };
    await Promise.all([result.current.add(body), result.current.add(body)]);
    await flush();
    expect(api.count("POST", "/api/invitation/consultation/paste-schedule")).toBe(1);
    expect(result.current.outcome).toEqual({ tone: "error", text: "일정이 너무 많아 더 넣을 수 없어요." });
    expect(result.current.adding).toBe(false);
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
