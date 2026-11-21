import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AMORA_TASK_COPY,
  AMORA_TASK_KINDS,
  AMORA_TASK_KIND_LABELS,
  AMORA_TASK_RESUMABLE_REASONS,
  AMORA_TASK_REVIEW_REASONS,
  AMORA_TASK_STAGE_LABELS,
  AMORA_TASK_STATUSES,
  amoraTaskAppPath,
  amoraTaskStage,
  amoraTaskWebPath,
  parseAmoraTaskDetail,
  parseAmoraTaskList,
  parseAmoraTaskOffer,
  safeAmoraTaskSourceUrl,
} from '../amoraTasks.mjs';

const RLO = String.fromCharCode(0x202e);
const ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const OTHER = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

const summary = (overrides = {}) => ({
  id: ID,
  kind: 'todo_deadlines',
  title: '할 일과 마감 정리',
  status: 'searching',
  reviewReason: null,
  createdAt: '2026-11-20T01:00:00.000Z',
  startedAt: '2026-11-20T01:00:05.000Z',
  finishedAt: null,
  updatedAt: '2026-11-20T01:00:30.000Z',
  ...overrides,
});

describe('맡은 일 단계', () => {
  it('홈에는 네 단계만 보이고 카드만 나온 일·그만둔 일·닫힌 카드는 보이지 않는다', () => {
    const stages = Object.fromEntries(AMORA_TASK_STATUSES.map((status) => [status, amoraTaskStage(status)]));
    assert.deepEqual(stages, {
      offered: null,
      queued: 'searching',
      searching: 'searching',
      organizing: 'organizing',
      needs_review: 'needs_review',
      done: 'done',
      cancelled: null,
      expired: null,
    });
    assert.deepEqual(Object.values(AMORA_TASK_STAGE_LABELS), ['찾는 중', '정리 중', '확인해 주세요', '끝남']);
  });

  it('종류마다 이름이 있다', () => {
    for (const kind of AMORA_TASK_KINDS) assert.ok(AMORA_TASK_KIND_LABELS[kind], kind);
    assert.equal(Object.keys(AMORA_TASK_KIND_LABELS).length, AMORA_TASK_KINDS.length);
  });

  it('멈춘 까닭마다 안내 문장이 있고, 이어서 하기는 한도와 일시적인 문제에만 준다', () => {
    for (const reason of AMORA_TASK_REVIEW_REASONS) assert.ok(AMORA_TASK_COPY.reviewReasons[reason], reason);
    for (const reason of ['gate_blocked', 'task_step_limit', 'needs_input', 'stale']) {
      assert.equal(AMORA_TASK_RESUMABLE_REASONS.includes(reason), false, reason);
    }
  });
});

describe('화면 문장', () => {
  const strings = [];
  for (const [key, value] of Object.entries(AMORA_TASK_COPY)) {
    if (typeof value === 'string') strings.push([key, value]);
    if (key === 'reviewReasons') for (const [reason, line] of Object.entries(value)) strings.push([reason, line]);
  }
  strings.push(['resultCheckedOn', AMORA_TASK_COPY.resultCheckedOn('2026-11-20')]);

  it('줄표를 쓰지 않는다', () => {
    for (const [key, line] of strings) assert.doesNotMatch(line, /[—–―]/u, key);
  });

  it('겹친 부정을 쓰지 않는다', () => {
    for (const [key, line] of strings) assert.doesNotMatch(line, /(않|없|못)[^.]*(않|없|못)/u, key);
  });

  it('문장은 해요체로 끝난다(버튼·제목은 마침표 없이 짧다)', () => {
    for (const [key, line] of strings) {
      if (line.endsWith('.')) assert.match(line, /요\.$/u, key);
      else assert.ok([...line].length <= 16, `${key}: ${line}`);
    }
  });

  it('확인한 날은 한국 날짜로 적는다', () => {
    assert.equal(AMORA_TASK_COPY.resultCheckedOn('2026-11-05'), '2026년 11월 5일 확인');
    assert.equal(AMORA_TASK_COPY.resultCheckedOn('어제'), ' 확인');
  });
});

describe('주소', () => {
  it('앱·웹 주소는 맡은 일 번호 모양일 때만 만든다', () => {
    assert.equal(amoraTaskAppPath(ID.toUpperCase()), `/amora-task/${ID}`);
    assert.equal(amoraTaskWebPath(ID), `/wedding/amora-tasks/${ID}`);
    assert.equal(amoraTaskAppPath('../settings'), null);
    assert.equal(amoraTaskWebPath(`${ID}/x`), null);
  });

  it('출처 링크는 https 만 링크로 준다', () => {
    assert.equal(safeAmoraTaskSourceUrl('https://hall.example/price'), 'https://hall.example/price');
    assert.equal(safeAmoraTaskSourceUrl('http://hall.example/price'), null);
    assert.equal(safeAmoraTaskSourceUrl('javascript:alert(1)'), null);
    assert.equal(safeAmoraTaskSourceUrl('https://user:pw@hall.example/'), null);
  });
});

describe('목록 응답 읽기', () => {
  it('스위치가 꺼졌거나 표가 없으면 아무것도 그리지 않는다', () => {
    assert.deepEqual(parseAmoraTaskList({ enabled: false, available: false, tasks: [summary()] }), { visible: false, tasks: [] });
    assert.deepEqual(parseAmoraTaskList({ enabled: true, available: false }), { visible: false, tasks: [] });
    assert.deepEqual(parseAmoraTaskList(null), { visible: false, tasks: [] });
  });

  it('모르는 상태·종류와 홈에 보이지 않는 상태는 버린다', () => {
    const list = parseAmoraTaskList({
      enabled: true,
      available: true,
      tasks: [
        summary(),
        summary({ id: OTHER, status: 'offered' }),
        summary({ id: OTHER, status: 'paused_forever' }),
        summary({ id: OTHER, kind: 'book_venue' }),
        summary({ id: 'not-a-uuid' }),
      ],
    });
    assert.equal(list.visible, true);
    assert.deepEqual(list.tasks.map((task) => [task.id, task.stage]), [[ID, 'searching']]);
  });

  it('제목의 제어 문자를 지우고 길이를 자른다', () => {
    const [task] = parseAmoraTaskList({
      enabled: true,
      available: true,
      tasks: [summary({ title: `할 일${RLO}정리${'가'.repeat(200)}` })],
    }).tasks;
    assert.equal(task.title.includes(RLO), false);
    assert.equal([...task.title].length, 80);
  });
});

describe('자세히 응답 읽기', () => {
  const detail = (task) => parseAmoraTaskDetail({ enabled: true, available: true, task });

  it('표의 출처 번호는 실제 출처 목록에 있는 것만 남긴다', () => {
    const parsed = detail(summary({
      status: 'done',
      result: {
        summary: '마감이 가까운 일부터 모았어요.',
        columns: ['할 일', '마감'],
        rows: [
          { cells: ['드레스 투어 예약', '12월 3일'], sourceIds: ['s1', 'x9'] },
          { cells: ['', ''], sourceIds: [] },
        ],
        sources: [
          { id: 's1', title: '일정', url: null, checkedOn: '2026-11-20' },
          { id: 'w1', title: '홀 안내', url: 'http://hall.example', checkedOn: '2026-11-20' },
        ],
        nextActions: [{ label: '일정에 넣기', prompt: '드레스 투어 예약을 12월 3일 일정에 넣어 줘' }, { label: '', prompt: 'x' }],
      },
    }));
    assert.deepEqual(parsed.result.rows, [{ cells: ['드레스 투어 예약', '12월 3일'], sourceIds: ['s1'] }]);
    assert.equal(parsed.result.sources[1].url, null);
    assert.deepEqual(parsed.result.nextActions, [{ label: '일정에 넣기', prompt: '드레스 투어 예약을 12월 3일 일정에 넣어 줘' }]);
  });

  it('이어서 하기와 그만하기는 상태와 까닭에 따라 정한다', () => {
    assert.equal(detail(summary({ status: 'needs_review', reviewReason: 'daily_step_limit' })).resumable, true);
    assert.equal(detail(summary({ status: 'needs_review', reviewReason: 'gate_blocked' })).resumable, false);
    assert.equal(detail(summary({ status: 'done' })).cancellable, false);
    assert.equal(detail(summary({ status: 'organizing' })).cancellable, true);
  });

  it('응답이 꺼짐이면 null', () => {
    assert.equal(parseAmoraTaskDetail({ enabled: false, available: true, task: summary() }), null);
  });
});

describe('대화 카드 읽기', () => {
  it('서버가 만든 표식이 있을 때만 카드를 그린다', () => {
    const output = {
      offer_kind: 'amora_task_offer_v1',
      task_id: ID,
      kind: 'hall_candidates',
      title: '웨딩홀 후보 찾기',
      plan: ['조건에 맞는 웨딩홀을 찾아요', '같은 기준 표로 정리해요'],
      offer_expires_at: '2026-11-21T01:00:00.000Z',
    };
    assert.equal(parseAmoraTaskOffer(output).taskId, ID);
    assert.equal(parseAmoraTaskOffer({ ...output, offer_kind: 'something_else' }), null);
    assert.equal(parseAmoraTaskOffer({ ...output, kind: 'book_venue' }), null);
  });
});
