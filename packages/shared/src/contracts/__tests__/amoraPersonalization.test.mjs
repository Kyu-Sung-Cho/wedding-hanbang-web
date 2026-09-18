import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AMORA_ANSWER_DETAIL_VALUES,
  AMORA_DECISION_START_VALUES,
  AMORA_FAMILY_ORDER_VALUES,
  AMORA_PERSONALIZATION_FIELD_NAMES,
  AMORA_PERSONALIZATION_SECTIONS,
  AMORA_SUPPORT_ORDER_VALUES,
  AMORA_TONE_STYLE_VALUES,
  AMORA_WORK_MODE_VALUES,
  DEFAULT_AMORA_PERSONALIZATION,
  isAmoraPersonalizationChanges,
  mergeAmoraPersonalization,
  parseAmoraPersonalizationPreferences,
  parseAmoraPersonalizationProfile,
  parseAmoraPersonalizationRow,
} from '../amoraPersonalization.mjs';

/**
 * 아모라 도움 방식 계약 (2026-09-18 웹에서 옮김).
 *
 * 웹 설정·채팅 지시문·API 가 쓰던 선택지와 파서를 앱도 같이 쓰도록 여기로 옮겼다. 앱 화면이 선택지와
 * 문구를 따로 복사하면 두 벌이 갈라지고, 한쪽에만 있는 값은 서버가 400 으로 거절하거나 채팅 지시문
 * (`prompts.ts` 의 객체 인덱싱)이 빈 줄을 낸다. 그래서 화면 문구(SECTIONS)의 값이 저장 가능한 값
 * (VALUES)과 **순서까지** 같다는 것을 여기서 붙잡는다.
 */

const VALUES_BY_FIELD = {
  decisionStart: AMORA_DECISION_START_VALUES,
  answerDetail: AMORA_ANSWER_DETAIL_VALUES,
  supportOrder: AMORA_SUPPORT_ORDER_VALUES,
  workMode: AMORA_WORK_MODE_VALUES,
  familyOrder: AMORA_FAMILY_ORDER_VALUES,
  toneStyle: AMORA_TONE_STYLE_VALUES,
};

test('저장 가능한 값은 웹이 쓰던 목록 그대로다(순서 포함)', () => {
  assert.deepEqual([...AMORA_DECISION_START_VALUES], ['recommend_first', 'compare_first', 'ask_each_time']);
  assert.deepEqual([...AMORA_ANSWER_DETAIL_VALUES], ['brief', 'detailed', 'adaptive']);
  assert.deepEqual([...AMORA_SUPPORT_ORDER_VALUES], ['listen_first', 'action_first', 'ask_each_time']);
  assert.deepEqual([...AMORA_WORK_MODE_VALUES], ['together', 'owner_led', 'hybrid', 'ask_each_time']);
  assert.deepEqual([...AMORA_FAMILY_ORDER_VALUES], ['couple_first', 'family_input_first', 'case_by_case', 'ask_each_time']);
  assert.deepEqual([...AMORA_TONE_STYLE_VALUES], ['adaptive', 'warm', 'calm_clear', 'friendly_honest']);
  assert.deepEqual([...AMORA_PERSONALIZATION_FIELD_NAMES], ['decisionStart', 'answerDetail', 'supportOrder', 'workMode', 'familyOrder', 'toneStyle']);
});

test('기본값은 말투·설명 분량은 상황에 맞게, 나머지는 그때 물어보기다', () => {
  assert.deepEqual({ ...DEFAULT_AMORA_PERSONALIZATION }, {
    decisionStart: 'ask_each_time',
    answerDetail: 'adaptive',
    supportOrder: 'ask_each_time',
    workMode: 'ask_each_time',
    familyOrder: 'ask_each_time',
    toneStyle: 'adaptive',
  });
  assert.deepEqual(Object.keys(DEFAULT_AMORA_PERSONALIZATION).sort(), [...AMORA_PERSONALIZATION_FIELD_NAMES].sort());
});

test('공유 상수는 한 소비자가 고쳐 다른 화면까지 바꾸지 못한다', () => {
  for (const values of [...Object.values(VALUES_BY_FIELD), AMORA_PERSONALIZATION_FIELD_NAMES, AMORA_PERSONALIZATION_SECTIONS]) {
    assert.ok(Object.isFrozen(values));
  }
  assert.ok(Object.isFrozen(DEFAULT_AMORA_PERSONALIZATION));
  for (const section of AMORA_PERSONALIZATION_SECTIONS) {
    assert.ok(Object.isFrozen(section) && Object.isFrozen(section.choices));
    for (const choice of section.choices) assert.ok(Object.isFrozen(choice));
  }
});

test('화면 칸은 웹 순서로 여섯 개이고, 선택지 값은 저장 가능한 값과 순서까지 같다', () => {
  assert.deepEqual(
    AMORA_PERSONALIZATION_SECTIONS.map((section) => section.key),
    ['toneStyle', 'decisionStart', 'answerDetail', 'supportOrder', 'workMode', 'familyOrder'],
  );
  assert.deepEqual(
    AMORA_PERSONALIZATION_SECTIONS.map((section) => section.title),
    ['아모라 말투', '결정을 시작할 때', '설명 분량', '힘들다고 말했을 때', '둘이 준비하는 방식', '가족·하객 의견이 있을 때'],
  );
  assert.deepEqual(AMORA_PERSONALIZATION_SECTIONS.map((section) => section.choices.length), [4, 3, 3, 3, 4, 4]);
  for (const section of AMORA_PERSONALIZATION_SECTIONS) {
    assert.deepEqual(section.choices.map((choice) => choice.value), [...VALUES_BY_FIELD[section.key]], section.key);
    for (const text of [section.title, section.description, ...section.choices.flatMap((choice) => [choice.label, choice.description])]) {
      assert.equal(typeof text, 'string');
      assert.ok(text.trim().length > 0 && text === text.trim(), `${section.key}: 빈 문구 또는 앞뒤 공백`);
    }
  }
});

test('기본값이 가리키는 선택지 이름은 상황에 맞게 / 그때 물어보기다', () => {
  const labels = Object.fromEntries(AMORA_PERSONALIZATION_SECTIONS.map((section) => [
    section.key,
    section.choices.find((choice) => choice.value === DEFAULT_AMORA_PERSONALIZATION[section.key])?.label,
  ]));
  assert.deepEqual(labels, {
    toneStyle: '상황에 맞게',
    decisionStart: '그때 물어보기',
    answerDetail: '상황에 맞게',
    supportOrder: '그때 물어보기',
    workMode: '그때 물어보기',
    familyOrder: '그때 물어보기',
  });
});

test('부분 변경은 허용 목록의 키·값만 받는다', () => {
  assert.equal(isAmoraPersonalizationChanges({ decisionStart: 'recommend_first' }), true);
  assert.equal(isAmoraPersonalizationChanges({ supportOrder: 'listen_first', answerDetail: 'brief', toneStyle: 'warm' }), true);
  assert.equal(isAmoraPersonalizationChanges({ ...DEFAULT_AMORA_PERSONALIZATION }), true);
  for (const [field, values] of Object.entries(VALUES_BY_FIELD)) {
    for (const value of values) assert.equal(isAmoraPersonalizationChanges({ [field]: value }), true, `${field}=${value}`);
  }
  for (const value of [
    {},
    null,
    undefined,
    'decisionStart',
    [{ decisionStart: 'recommend_first' }],
    { decisionStart: 'personality_type' },
    { hiddenCompatibilityScore: 98 },
    { toneStyle: 'banmal' },
    { decisionStart: 'recommend_first', extra: true },
    { answerDetail: 'adaptive', workMode: 'compare_first' },
    { familyOrder: 1 },
  ]) {
    assert.equal(isAmoraPersonalizationChanges(value), false, JSON.stringify(value));
  }
});

test('확인한 변경만 합치고 나머지를 추정하지 않는다', () => {
  assert.deepEqual(mergeAmoraPersonalization(null, { decisionStart: 'compare_first' }), {
    ...DEFAULT_AMORA_PERSONALIZATION,
    decisionStart: 'compare_first',
  });
  const current = { ...DEFAULT_AMORA_PERSONALIZATION, workMode: 'hybrid', toneStyle: 'warm' };
  assert.deepEqual(mergeAmoraPersonalization(current, { toneStyle: 'calm_clear' }), { ...current, toneStyle: 'calm_clear' });
  assert.equal(current.toneStyle, 'warm', '입력을 고치지 않는다');
  assert.notEqual(mergeAmoraPersonalization(null, {}), DEFAULT_AMORA_PERSONALIZATION, '기본값 객체를 그대로 내주지 않는다');
});

const validProfile = () => ({
  preferences: { ...DEFAULT_AMORA_PERSONALIZATION, supportOrder: 'action_first', toneStyle: 'friendly_honest' },
  revision: 1,
  confirmedAt: '2026-07-31T08:00:00.000Z',
  updatedAt: '2026-07-31T08:00:00.000Z',
});

test('여섯 값이 모두 맞을 때만 선호로 읽고, 다른 키는 옮겨 싣지 않는다', () => {
  const preferences = validProfile().preferences;
  assert.deepEqual(parseAmoraPersonalizationPreferences({ ...preferences, ownerId: 'x' }), preferences);
  for (const field of AMORA_PERSONALIZATION_FIELD_NAMES) {
    const missing = { ...preferences };
    delete missing[field];
    assert.equal(parseAmoraPersonalizationPreferences(missing), null, `${field} 빠짐`);
    assert.equal(parseAmoraPersonalizationPreferences({ ...preferences, [field]: 'unknown_value' }), null, `${field} 모르는 값`);
  }
  assert.equal(parseAmoraPersonalizationPreferences(null), null);
  assert.equal(parseAmoraPersonalizationPreferences([preferences]), null);
});

test('저장된 도움 방식은 형식이 조금이라도 틀리면 읽지 않는다', () => {
  const valid = validProfile();
  assert.deepEqual(parseAmoraPersonalizationProfile(valid), valid);
  assert.deepEqual(parseAmoraPersonalizationProfile({ ...valid, revision: 42, extra: 'dropped' }), { ...valid, revision: 42 });
  for (const broken of [
    { ...valid, preferences: { ...valid.preferences, familyOrder: 'always_obey_family' } },
    { ...valid, preferences: { ...valid.preferences, toneStyle: 'expert_roleplay' } },
    { ...valid, preferences: null },
    { ...valid, revision: 0 },
    { ...valid, revision: -1 },
    { ...valid, revision: 1.5 },
    { ...valid, revision: '1' },
    { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, confirmedAt: null },
    { ...valid, updatedAt: 20260731 },
    null,
    [valid],
  ]) {
    assert.equal(parseAmoraPersonalizationProfile(broken), null, JSON.stringify(broken));
  }
});

test('DB 행은 snake_case 열을 제자리에 옮기고, 모르는 값이면 읽지 않는다', () => {
  const row = {
    decision_start: 'compare_first',
    answer_detail: 'brief',
    support_order: 'listen_first',
    work_mode: 'hybrid',
    family_order: 'case_by_case',
    tone_style: 'calm_clear',
    revision: 2,
    confirmed_at: '2026-07-31T08:00:00.000Z',
    updated_at: '2026-07-31T09:00:00.000Z',
  };
  assert.deepEqual(parseAmoraPersonalizationRow(row), {
    preferences: {
      decisionStart: 'compare_first',
      answerDetail: 'brief',
      supportOrder: 'listen_first',
      workMode: 'hybrid',
      familyOrder: 'case_by_case',
      toneStyle: 'calm_clear',
    },
    revision: 2,
    confirmedAt: '2026-07-31T08:00:00.000Z',
    updatedAt: '2026-07-31T09:00:00.000Z',
  });
  assert.equal(parseAmoraPersonalizationRow({ ...row, decision_start: 'secret_personality_mode' }), null);
  assert.equal(parseAmoraPersonalizationRow({ ...row, tone_style: undefined }), null);
  assert.equal(parseAmoraPersonalizationRow({ ...row, revision: 0 }), null);
  assert.equal(parseAmoraPersonalizationRow(null), null);
});
