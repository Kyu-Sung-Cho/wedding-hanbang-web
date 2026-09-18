import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARED_ACTION_STATUS_COLUMNS,
  SHARED_ACTION_STATUS_ANNOUNCEMENTS,
  SHARED_ACTION_SOURCE_LABELS,
  sharedActionSourceLabel,
  isSharedActionId,
  parseSharedAction,
  parseSharedActionList,
  normalizeLikeServer,
  buildManualCreateBody,
  matchesManualCreateReceipt,
  buildActionUpdateDiff,
  matchesActionUpdateReceipt,
} from '../amoraSharedActions.mjs';

/**
 * 공유 할 일(`/api/amora/actions`) 계약. 앱이 웹과 같은 규칙으로 읽고 쓰게 한다.
 * 웹과 문구·정규화가 같은지는 `apps/web/src/lib/amora/__tests__/sharedActionsParity.test.ts` 가 잰다.
 */

const row = (over = {}) => ({
  id: 'amora_manual_0123abcd', title: '청첩장 문구 확정하기', description: '부모님 성함 표기를 확인해요.',
  dueDate: '다음 주 중', categoryKey: 'invitation', priority: 'medium', status: 'open', source: 'manual',
  href: '/wedding/checklist?category=invitation', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
  ...over,
});

const requestId = '0f8fad5b-d9cb-469f-a165-70867728950e';
const owner = 'user-1';
const couple = '11111111-1111-4111-8111-111111111111';

test('상태 이름·안내와 상태 변경 알림은 웹 보드와 같은 말이다', () => {
  assert.deepEqual(SHARED_ACTION_STATUS_COLUMNS.map((column) => [column.status, column.label]), [
    ['done', '완료'], ['open', '진행 중'], ['dismissed', '보류·숨김'],
  ]);
  for (const column of SHARED_ACTION_STATUS_COLUMNS) assert.ok(column.rule.endsWith('요.'), column.status);
  assert.deepEqual(SHARED_ACTION_STATUS_ANNOUNCEMENTS, {
    done: '완료로 표시했어요.', dismissed: '보류·숨김으로 옮겼어요.', open: '진행 중으로 다시 꺼냈어요.',
  });
});

test('출처 이름은 알려진 여섯 출처만 있고, 모르는 출처에는 이름을 붙이지 않는다', () => {
  assert.deepEqual(Object.keys(SHARED_ACTION_SOURCE_LABELS).sort(), ['budget', 'chat', 'guardrail', 'manual', 'quote', 'schedule']);
  assert.equal(sharedActionSourceLabel('manual'), '직접 추가한 할 일');
  for (const value of ['unknown', '', null, undefined, 'toString', '__proto__']) assert.equal(sharedActionSourceLabel(value), '');
});

test('항목 해석은 설명·예정일 원문·분야·출처·연결 화면·변경 시각을 버리지 않는다', () => {
  assert.deepEqual(parseSharedAction(row()), {
    id: 'amora_manual_0123abcd', title: '청첩장 문구 확정하기', description: '부모님 성함 표기를 확인해요.',
    dueDate: '다음 주 중', categoryKey: 'invitation', source: 'manual', href: '/wedding/checklist?category=invitation',
    status: 'open', priority: 'medium', updatedAt: '2026-09-11T00:00:00.000Z',
  });
  // 예정일은 사용자가 쓴 글 그대로다 — 날짜 모양이어도 "…까지"로 바꾸지 않는다.
  assert.equal(parseSharedAction(row({ dueDate: '2026-10-15' })).dueDate, '2026-10-15');
  // 모르는 출처는 버리지 않고 이름만 없다.
  assert.equal(parseSharedAction(row({ source: 'robot' })).source, null);
  // 모르는 분야 키도 그대로 둔다 — 수정 화면이 "기존 분야 유지"를 보여 줄 수 있어야 한다.
  assert.equal(parseSharedAction(row({ categoryKey: 'general' })).categoryKey, 'general');
  const bare = parseSharedAction({ id: 'act_abcd', title: '제목', status: 'done' });
  assert.deepEqual(bare, { id: 'act_abcd', title: '제목', description: '', dueDate: '', categoryKey: '', source: null, href: '', status: 'done', priority: 'medium', updatedAt: '' });
});

test('id 는 서버 수정 경로와 같은 모양만 받고, 자르지 않고 거부한다', () => {
  assert.equal(isSharedActionId('a'.repeat(120)), true);
  assert.equal(isSharedActionId('a'.repeat(121)), false);
  assert.equal(parseSharedAction(row({ id: 'a'.repeat(121) })), null, '121자 id 를 120자로 잘라 다른 항목을 고치면 안 된다');
  for (const id of ['act/1234', 'act 1234', 'abc', '', '../act_1234', 'act_1234\n', 'act%2F1234', 1234, null]) {
    assert.equal(parseSharedAction(row({ id })), null, String(id));
  }
});

test('제목이 없거나 상태를 모르는 항목은 버린다 — 무엇을 바꾸는지 모르는 줄에 버튼을 주지 않는다', () => {
  for (const patch of [{ title: '   ' }, { title: 3 }, { status: 'archived' }, { status: undefined }]) {
    assert.equal(parseSharedAction(row(patch)), null, JSON.stringify(patch));
  }
  for (const value of [null, undefined, 'x', [], 1]) assert.equal(parseSharedAction(value), null);
});

test('길이 한도: 제목 120 · 설명 500 · 예정일 40 · 분야 80 · 연결 화면 180', () => {
  const parsed = parseSharedAction(row({ title: `  ${'가'.repeat(130)}  `, description: '나'.repeat(510), dueDate: '다'.repeat(45), categoryKey: 'k'.repeat(81), href: `/${'x'.repeat(180)}` }));
  assert.equal(parsed.title.length, 120);
  assert.equal(parsed.description.length, 500);
  assert.equal(parsed.dueDate.length, 40);
  assert.equal(parsed.categoryKey, '');
  assert.equal(parsed.href, '');
  assert.equal(parseSharedAction(row({ href: 'https://evil.example' })).href, '');
  assert.equal(parseSharedAction(row({ priority: 'urgent' })).priority, 'medium');
});

test('목록 해석은 읽을 수 없는 항목을 빼고 순서를 지킨다', () => {
  const parsed = parseSharedActionList({ actions: [row({ id: 'act_0001' }), row({ id: 'no' }), null, row({ id: 'act_0002' })] });
  assert.deepEqual(parsed.map((action) => action.id), ['act_0001', 'act_0002']);
  for (const payload of [null, undefined, {}, { actions: 'x' }, []]) assert.deepEqual(parseSharedActionList(payload), []);
});

test('서버와 같은 정규화: 위험 블록·태그를 걷고 공백을 한 칸으로 모은 뒤 자르고 다듬는다', () => {
  assert.equal(normalizeLikeServer('  첫 줄\n둘째  줄\t셋째 ', 500), '첫 줄 둘째 줄 셋째');
  assert.equal(normalizeLikeServer('<b>굵게</b> 확인', 120), '굵게 확인');
  assert.equal(normalizeLikeServer('앞<script>alert(1)</script>뒤', 120), '앞뒤');
  assert.equal(normalizeLikeServer('<!-- 메모 -->본문', 120), '본문');
  assert.equal(normalizeLikeServer('<!-- a > b -->본문', 120), '본문');
  assert.equal(normalizeLikeServer('가나다 라', 4), '가나다');
  for (const value of ['', '   ', '<b></b>', null, undefined, 3]) assert.equal(normalizeLikeServer(value, 120), null);
});

test('직접 추가 요청 몸통은 웹과 같은 순서·기본값이고 비운 칸은 보내지 않는다', () => {
  const body = buildManualCreateBody({ title: '  식전 영상 확인  ', categoryKey: 'venue', description: '길이\n확인', dueDate: '다음 주 중' },
    { requestId: requestId.toUpperCase(), expectedOwnerId: owner, expectedCoupleId: couple });
  assert.deepEqual(Object.keys(body), ['title', 'category_key', 'description', 'due_date', 'status', 'priority', 'source', 'requestId', 'expectedOwnerId', 'expectedCoupleId']);
  assert.deepEqual(body, { title: '식전 영상 확인', category_key: 'venue', description: '길이\n확인', due_date: '다음 주 중', status: 'open', priority: 'medium', source: 'manual', requestId, expectedOwnerId: owner, expectedCoupleId: couple });
  assert.deepEqual(buildManualCreateBody({ title: '제목', categoryKey: '', description: '', dueDate: '' }, { requestId, expectedOwnerId: owner, expectedCoupleId: couple }),
    { title: '제목', status: 'open', priority: 'medium', source: 'manual', requestId, expectedOwnerId: owner, expectedCoupleId: couple });
});

test('직접 추가 요청은 제목·길이·요청번호·계정 범위가 맞지 않으면 만들지 않는다', () => {
  const scope = { requestId, expectedOwnerId: owner, expectedCoupleId: couple };
  for (const fields of [{ title: '' }, { title: '   ' }, { title: '<b></b>' }, { title: '가'.repeat(121) }, { title: '제목', description: '나'.repeat(501) }, { title: '제목', dueDate: '다'.repeat(41) }, { title: '제목', categoryKey: 'k'.repeat(81) }, null]) {
    assert.equal(buildManualCreateBody(fields, scope), null, JSON.stringify(fields));
  }
  for (const patch of [{ requestId: 'not-a-uuid' }, { requestId: '0f8fad5b-d9cb-169f-a165-70867728950e' }, { expectedOwnerId: '' }, { expectedCoupleId: 'couple' }, { expectedCoupleId: null }]) {
    assert.equal(buildManualCreateBody({ title: '제목' }, { ...scope, ...patch }), null, JSON.stringify(patch));
  }
});

test('직접 추가 영수증: 요청번호·정규화한 제목·설명·예정일·분야·기본값이 모두 같아야 성공이다', () => {
  const body = buildManualCreateBody({ title: '식전 영상 확인', categoryKey: 'venue', description: '길이\n  확인', dueDate: '다음 주 중' },
    { requestId, expectedOwnerId: owner, expectedCoupleId: couple });
  const saved = { id: 'amora_manual_abcdef', title: '식전 영상 확인', description: '길이 확인', dueDate: '다음 주 중', categoryKey: 'venue', priority: 'medium', status: 'open', source: 'manual', createdAt: 'x', updatedAt: 'y' };
  // 여러 줄 설명을 서버가 한 줄로 저장해도 성공이다.
  assert.equal(matchesManualCreateReceipt({ action: saved, requestId, replayed: false }, body).id, 'amora_manual_abcdef');
  assert.equal(matchesManualCreateReceipt({ action: saved, requestId, replayed: true }, body).id, 'amora_manual_abcdef');
  for (const [name, payload] of [
    ['other request', { action: saved, requestId: requestId.replace('0f8f', '1f8f'), replayed: false }],
    ['no replayed flag', { action: saved, requestId }],
    ['title', { action: { ...saved, title: '다른 제목' }, requestId, replayed: false }],
    ['description', { action: { ...saved, description: '길이\n  확인' }, requestId, replayed: false }],
    ['due', { action: { ...saved, dueDate: '2026-10-01' }, requestId, replayed: false }],
    ['category', { action: { ...saved, categoryKey: undefined }, requestId, replayed: false }],
    ['source', { action: { ...saved, source: 'chat' }, requestId, replayed: false }],
    ['status', { action: { ...saved, status: 'done' }, requestId, replayed: false }],
    ['priority', { action: { ...saved, priority: 'high' }, requestId, replayed: false }],
    ['href', { action: { ...saved, href: '/budget' }, requestId, replayed: false }],
    ['bad id', { action: { ...saved, id: 'a/b' }, requestId, replayed: false }],
    ['empty', {}],
  ]) assert.equal(matchesManualCreateReceipt(payload, body), null, name);
  const plain = buildManualCreateBody({ title: '제목만' }, { requestId, expectedOwnerId: owner, expectedCoupleId: couple });
  assert.ok(matchesManualCreateReceipt({ action: { ...saved, title: '제목만', description: undefined, dueDate: undefined, categoryKey: undefined }, requestId, replayed: false }, plain));
  assert.equal(matchesManualCreateReceipt({ action: { ...saved, title: '제목만', dueDate: undefined, categoryKey: undefined }, requestId, replayed: false }, plain), null);
});

test('수정 요청은 바뀐 칸만 보내고, 비운 칸은 빈 문자열로 보낸다', () => {
  const original = parseSharedAction(row());
  const same = { title: original.title, categoryKey: original.categoryKey, description: original.description, dueDate: original.dueDate };
  assert.deepEqual(buildActionUpdateDiff(original, same), {});
  assert.deepEqual(buildActionUpdateDiff(original, { ...same, title: '  새 제목 ' }), { title: '새 제목' });
  assert.deepEqual(buildActionUpdateDiff(original, { ...same, description: '', dueDate: '' }), { description: '', due_date: '' });
  assert.deepEqual(buildActionUpdateDiff(original, { ...same, categoryKey: 'venue' }), { category_key: 'venue' });
  assert.deepEqual(buildActionUpdateDiff(original, { ...same, categoryKey: '' }), { category_key: '' });
  for (const draft of [{ ...same, title: '  ' }, { ...same, title: '가'.repeat(121) }, { ...same, description: '나'.repeat(501) }, { ...same, dueDate: '다'.repeat(41) }, null]) {
    assert.equal(buildActionUpdateDiff(original, draft), null);
  }
});

test('수정 영수증은 같은 항목이고 바꾼 칸마다 서버 정규화 결과와 같아야 한다', () => {
  const saved = row({ title: '새 제목', description: '한 줄 설명', dueDate: '', categoryKey: 'venue', status: 'done' });
  assert.ok(matchesActionUpdateReceipt({ action: saved }, saved.id, { title: ' 새 제목 ', description: '한 줄\n설명' }));
  assert.ok(matchesActionUpdateReceipt({ action: { ...saved, dueDate: undefined } }, saved.id, { due_date: '' }));
  assert.ok(matchesActionUpdateReceipt({ action: saved }, saved.id, { status: 'done', category_key: 'venue' }));
  for (const [name, payload, updates] of [
    ['other id', { action: { ...saved, id: 'act_other' } }, { status: 'done' }],
    ['status', { action: saved }, { status: 'open' }],
    ['title', { action: saved }, { title: '다른 제목' }],
    ['description', { action: saved }, { description: '다른 설명' }],
    ['cleared due kept', { action: { ...saved, dueDate: '다음 주 중' } }, { due_date: '' }],
    ['category', { action: saved }, { category_key: 'dress' }],
    ['no action', {}, { status: 'done' }],
  ]) assert.equal(matchesActionUpdateReceipt(payload, saved.id, updates), null, name);
});
