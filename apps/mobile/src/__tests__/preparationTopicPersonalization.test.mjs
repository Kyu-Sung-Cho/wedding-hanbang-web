import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import {
  buildPreparationTopicAmoraHandoff,
  buildPreparationTopicPersonalization,
  loadPreparationTopicCoupleContext,
  loadPreparationTopicOwnerContext,
} from "../lib/preparationTopicPersonalization.mjs";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const PARTNER_ID = "10000000-0000-4000-8000-000000000002";
const COUPLE_ID = "30000000-0000-4000-8000-000000000001";
const summarySource = await readFile(
  new URL("../components/planning/PreparationTopicSummary.tsx", import.meta.url),
  "utf8",
);
const scheduleSource = await readFile(
  new URL("../../app/schedule/index.tsx", import.meta.url),
  "utf8",
);

const preferences = Object.freeze({
  decisionStart: "recommend_first",
  answerDetail: "adaptive",
  supportOrder: "listen_first",
  workMode: "hybrid",
  familyOrder: "couple_first",
  toneStyle: "calm_clear",
});

test("confirmed private and couple context becomes one compact truth-scoped section", () => {
  const section = buildPreparationTopicPersonalization({
    ownerContext: {
      readState: "loaded",
      preferences,
      coreCriterion: "가족들이 편안한 자리를 우선해요",
    },
    coupleContext: {
      readState: "loaded",
      confirmedCriterion: "무리하지 않는 예산 안에서 결정해요",
    },
  });

  assert.deepEqual(section, {
    title: "우리 상황",
    items: [
      {
        key: "owner-style",
        title: "내 방식",
        detail: "추천 한 가지부터 · 필요한 만큼 · 중요한 건 함께",
        scopeLabel: "나만 보기",
        accessibilityLabel:
          "내 방식, 추천 한 가지부터, 필요한 만큼, 중요한 건 함께, 나만 보기",
      },
      {
        key: "owner-criterion",
        title: "내 기준",
        detail: "가족들이 편안한 자리를 우선해요",
        scopeLabel: "나만 보기",
        accessibilityLabel:
          "내 기준, 가족들이 편안한 자리를 우선해요, 나만 보기",
      },
      {
        key: "couple-criterion",
        title: "우리 기준",
        detail: "무리하지 않는 예산 안에서 결정해요",
        scopeLabel: "둘이 확인",
        accessibilityLabel:
          "우리 기준, 무리하지 않는 예산 안에서 결정해요, 둘이 확인",
      },
    ],
    notices: [],
    note:
      "아모라는 이 주제로 이야기할 때 위 기준을 참고해요. 다음 행동 순서는 저장된 체크리스트와 일정 기준이에요.",
  });

  assert.doesNotMatch(JSON.stringify(section), /decisionId|criterionId|ownerUserId|coupleId/);
});

test("loaded empty context stays quiet while read failures remain visible", () => {
  const empty = buildPreparationTopicPersonalization({
    ownerContext: {
      readState: "loaded",
      preferences: null,
      coreCriterion: null,
    },
    coupleContext: {
      readState: "loaded",
      confirmedCriterion: null,
    },
  });
  assert.equal(empty, null);

  const unavailable = buildPreparationTopicPersonalization({
    ownerContext: {
      readState: "unavailable",
      preferences: null,
      coreCriterion: null,
    },
    coupleContext: {
      readState: "unavailable",
      confirmedCriterion: null,
    },
  });
  assert.deepEqual(unavailable, {
    title: "우리 상황",
    items: [],
    notices: [
      "내 설정을 지금 확인하지 못했어요.",
      "둘이 확인한 기준을 지금 확인하지 못했어요.",
    ],
    note: null,
  });

  assert.equal(buildPreparationTopicPersonalization({
    ownerContext: {
      readState: "loading",
      preferences: null,
      coreCriterion: null,
    },
    coupleContext: {
      readState: "loading",
      confirmedCriterion: null,
    },
  }), null);
});

test("owner-private personalization and criterion load as one private read lane", async () => {
  const calls = [];
  const result = await loadPreparationTopicOwnerContext({
    ownerId: OWNER_ID,
    isCurrent: () => true,
    apiFetch: async (path, options) => {
      calls.push({ path, options });
      if (path === "/api/amora/personalization") {
        return {
          ok: true,
          json: async () => ({
            profile: {
              preferences,
              revision: 2,
              confirmedAt: "2026-08-17T01:00:00.000Z",
              updatedAt: "2026-08-17T01:00:00.000Z",
            },
          }),
        };
      }
      if (path === "/api/amora/criterion") {
        return {
          ok: true,
          json: async () => ({
            version: 1,
            criterion: {
              id: "20000000-0000-4000-8000-000000000001",
              value: "가족들이 편안한 자리를 우선해요",
              updatedAt: "2026-08-17T01:00:00.000Z",
            },
          }),
        };
      }
      throw new Error(`unexpected path: ${path}`);
    },
  });

  assert.deepEqual(result, {
    readState: "loaded",
    preferences,
    coreCriterion: "가족들이 편안한 자리를 우선해요",
  });
  assert.deepEqual(calls.map((call) => call.path).sort(), [
    "/api/amora/criterion",
    "/api/amora/personalization",
  ]);
  assert.equal(calls.every((call) => call.options.method === "GET"), true);
  assert.equal(calls.every((call) => call.options.signal instanceof globalThis.AbortSignal), true);
});

test("couple lane exposes only the current confirmed criterion for the exact couple", async () => {
  const result = await loadPreparationTopicCoupleContext({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    isCurrent: () => true,
    apiFetch: async (path, options) => {
      assert.equal(path, "/api/amora/couple-criterion");
      assert.equal(options.method, "GET");
      assert.equal(options.signal instanceof globalThis.AbortSignal, true);
      return {
        ok: true,
        json: async () => ({
          version: 1,
          coupleId: COUPLE_ID,
          linked: true,
          current: {
            decisionId: "40000000-0000-4000-8000-000000000001",
            value: "무리하지 않는 예산 안에서 결정해요",
            confirmedAt: "2026-08-17T01:00:00.000Z",
          },
          proposal: {
            id: "50000000-0000-4000-8000-000000000001",
            value: "확인 전인 제안은 보여주지 않아요",
            revision: 1,
            proposerUserId: OWNER_ID,
            brideUserId: OWNER_ID,
            groomUserId: PARTNER_ID,
            acceptedUserIds: [OWNER_ID],
            createdAt: "2026-08-17T01:10:00.000Z",
            updatedAt: "2026-08-17T01:10:00.000Z",
          },
        }),
      };
    },
  });

  assert.deepEqual(result, {
    readState: "loaded",
    confirmedCriterion: "무리하지 않는 예산 안에서 결정해요",
  });
  assert.doesNotMatch(JSON.stringify(result), /확인 전인 제안|proposal|decisionId/);
});

test("one failed owner-private resource is partial instead of being mistaken for empty", async () => {
  const result = await loadPreparationTopicOwnerContext({
    ownerId: OWNER_ID,
    isCurrent: () => true,
    apiFetch: async (path) => {
      if (path === "/api/amora/personalization") {
        return { ok: false, json: async () => ({ error: "unavailable" }) };
      }
      return {
        ok: true,
        json: async () => ({
          version: 1,
          criterion: {
            id: "20000000-0000-4000-8000-000000000001",
            value: "가족들이 편안한 자리를 우선해요",
            updatedAt: "2026-08-17T01:00:00.000Z",
          },
        }),
      };
    },
  });

  assert.deepEqual(result, {
    readState: "partial",
    preferences: null,
    coreCriterion: "가족들이 편안한 자리를 우선해요",
  });
});

test("topic continuation creates a private composer draft without auto-applying preparation changes", () => {
  const handoff = buildPreparationTopicAmoraHandoff({
    topicLabel: "부모님 첫 만남",
    statusLabel: "준비 중",
    progressLabel: "6개 중 2개 확인",
    nextAction: {
      title: "참석자와 가능한 날짜 확인하기",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
    },
    privateCriterion: "가족들이 편안한 자리를 우선해요",
    useCoupleCriterion: true,
  });

  assert.equal(handoff.title, "아모라와 이 준비 이어보기");
  assert.equal(
    handoff.description,
    "현재 상태와 기준을 가져가서 질문 한 가지부터 시작해요.",
  );
  assert.match(handoff.prompt, /부모님 첫 만남/);
  assert.match(handoff.prompt, /참석자와 가능한 날짜 확인하기/);
  assert.match(handoff.prompt, /6개 중 2개 확인/);
  assert.match(handoff.prompt, /가족들이 편안한 자리를 우선해요/);
  assert.match(handoff.prompt, /서버에서 현재 우리 기준이 확인되면/);
  assert.match(handoff.prompt, /내가 확인하기 전에는 어떤 기록도 바꾸거나 상대에게 공유하지 마/);
  assert.doesNotMatch(JSON.stringify(handoff), /ownerUserId|coupleId|decisionId/);
});

test("the topic summary renders truth scopes and stages only an explicit Amora draft action", () => {
  assert.match(summarySource, /personalizationSection\.items\.map/);
  assert.match(summarySource, /\{item\.scopeLabel\}/);
  assert.match(summarySource, /accessibilityLabel=\{item\.accessibilityLabel\}/);
  assert.match(summarySource, /personalizationSection\.notices\.map/);
  assert.match(
    summarySource,
    /<ActionRow[\s\S]{0,300}amoraHandoff\.title[\s\S]{0,300}onContinueWithAmora\?\.\(amoraHandoff\.prompt\)/,
  );
  assert.doesNotMatch(
    summarySource,
    /requestChatStream|requestAiMessageIngest|supabase\.|decision_nodes|amora_actions/,
  );
});

test("the schedule screen reads private and couple context separately and opens only a staged private composer", () => {
  const ownerReadStart = scheduleSource.indexOf(
    "const topicOwnerContextResultPromise = loadPreparationTopicOwnerContext",
  );
  const coupleReadStart = scheduleSource.indexOf(
    "const topicCoupleContextResultPromise = loadPreparationTopicCoupleContext",
  );
  const coreAwaitStart = scheduleSource.indexOf("= await Promise.all([", ownerReadStart);
  assert.ok(ownerReadStart >= 0 && coupleReadStart > ownerReadStart);
  assert.ok(coreAwaitStart > coupleReadStart);
  assert.match(
    scheduleSource.slice(ownerReadStart, coreAwaitStart),
    /apiFetchForExpectedUser\([\s\S]{0,100}topicPersonalizationIdentity\.ownerId/,
  );
  assert.match(
    scheduleSource.slice(ownerReadStart, coreAwaitStart),
    /scheduleSessionFenceRef\.isCurrent\(topicOwnerContextSessionToken\)/,
  );
  assert.match(
    scheduleSource.slice(coupleReadStart, coreAwaitStart),
    /scheduleSessionFenceRef\.isCurrent\(topicCoupleContextSessionToken\)/,
  );
  assert.match(scheduleSource, /buildPreparationTopicPersonalization\(\{/);
  assert.match(scheduleSource, /buildPreparationTopicAmoraHandoff\(\{/);
  assert.match(scheduleSource, /stagePrivateChatHandoff\(\{/);
  assert.match(
    scheduleSource,
    /pathname: "\/\(tabs\)\/chat"[\s\S]{0,100}params: \{ companionHandoff \}/,
  );
  assert.match(scheduleSource, /personalizationSection=\{topicPersonalizationSection\}/);
  assert.match(scheduleSource, /amoraHandoff=\{topicAmoraHandoff\}/);
  assert.match(scheduleSource, /onContinueWithAmora=\{openPreparationTopicAmora\}/);

  const openHandlerStart = scheduleSource.indexOf(
    "const openPreparationTopicAmora = useCallback",
  );
  const openHandlerEnd = scheduleSource.indexOf(");", openHandlerStart);
  assert.ok(openHandlerStart >= 0 && openHandlerEnd > openHandlerStart);
  assert.doesNotMatch(
    scheduleSource.slice(openHandlerStart, openHandlerEnd),
    /requestChatStream|requestAiMessageIngest|decision_nodes|amora_actions|\.insert\(|\.update\(/,
  );
});

test("unavailable or loading lanes cannot smuggle stale private or couple values into the screen", () => {
  assert.equal(buildPreparationTopicPersonalization({
    ownerContext: {
      readState: "unavailable",
      preferences,
      coreCriterion: "이전 사용자의 기준",
    },
    coupleContext: {
      readState: "loaded",
      confirmedCriterion: null,
    },
  }), null);

  assert.equal(buildPreparationTopicPersonalization({
    ownerContext: {
      readState: "loaded",
      preferences: null,
      coreCriterion: null,
    },
    coupleContext: {
      readState: "loading",
      confirmedCriterion: "이전 커플의 기준",
    },
  }), null);
});
