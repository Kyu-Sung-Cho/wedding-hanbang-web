import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import {
  AMORA_PREPARATION_GUIDE_CONTRACT_VERSION,
  buildAmoraPreparationGuideModules,
  validateAmoraPreparationGuideModule,
} from "@hanbang/shared/amora-preparation-guide";
import { buildAmoraPreparationTopicView } from "@hanbang/shared/amora-preparation-topic";

const canonicalChecklistSource = await readFile(
  new URL("../../../../packages/shared/src/constants/weddingPlanning.ts", import.meta.url),
  "utf8",
);

const applicableInput = (overrides = {}) => ({
  topicKey: "venue",
  applicability: "applicable",
  status: "in_progress",
  asOfDate: "2026-08-16",
  checklistItems: [
    { id: "venue_06", label: "취소·변경 때 내거나 돌려받는 금액 확인", done: false },
    { id: "venue_07", label: "계약금 납부 및 계약서 보관", done: false },
  ],
  ...overrides,
});

test("an exact unfinished venue trigger returns one bounded reviewed guide", () => {
  const modules = buildAmoraPreparationGuideModules(applicableInput());

  assert.equal(modules.length, 1);
  assert.deepEqual(modules[0].whyShown, {
    kind: "unfinished_checklist_item",
    checklistItemId: "venue_06",
    label: "현재 준비 상태에서 ‘취소·변경 때 내거나 돌려받는 금액 확인’ 항목이 아직 확인 전이라 이 가이드를 보여드려요.",
  });
  assert.equal(modules[0].version, AMORA_PREPARATION_GUIDE_CONTRACT_VERSION);
  assert.equal(modules[0].moduleId, "venue.contract_before_signing.v1");
  assert.equal(modules[0].topicKey, "venue");
  assert.equal(modules[0].title, "결혼식장 비교·계약 전 확인");
  assert.ok(modules[0].decisions.length >= 3);
  assert.ok(modules[0].exceptions.length >= 2);
  assert.ok(modules[0].dialogueLines.length >= 1);
  assert.ok(modules[0].completionEvidence.length >= 2);
  assert.equal(
    modules[0].provenance.sourceKind,
    "independent_reviewed_guidance",
  );
  assert.equal(
    validateAmoraPreparationGuideModule(modules[0], "venue").ok,
    true,
  );
});

test("an exact unfinished studio deliverables trigger returns the frozen contract guide", () => {
  const modules = buildAmoraPreparationGuideModules({
    topicKey: "studio",
    applicability: "applicable",
    status: "in_progress",
    asOfDate: "2026-08-17",
    checklistItems: [
      {
        id: "studio_04",
        label: "받는 사진 수와 보정해 주는 사진 수 확인",
        done: false,
      },
    ],
  });

  assert.deepEqual(modules, [{
    version: AMORA_PREPARATION_GUIDE_CONTRACT_VERSION,
    moduleId: "studio.deliverables_before_contract.v1",
    topicKey: "studio",
    title: "사진 촬영 결과물·계약 전 확인",
    whyShown: {
      kind: "unfinished_checklist_item",
      checklistItemId: "studio_04",
      label: "현재 준비 상태에서 ‘받는 사진 수와 보정해 주는 사진 수 확인’ 항목이 아직 확인 전이라 이 가이드를 보여드려요.",
    },
    decisions: [
      "후보마다 받는 사진 파일 수, 보정 사진 수, 앨범·액자 등 결과물 범위를 같은 기준으로 확인해요.",
      "촬영 시간·장소와 야외 촬영·영상·소품 중 이용할 항목을 고르고 포함 여부를 구분해요.",
      "선택한 결과물과 별도 항목, 일정 변경·취소 조건, 지급 시점이 문서에 남은 뒤 계약 여부를 정해요.",
    ],
    exceptions: [
      "원본 파일·보정본·앨범의 수량이나 전달 방식이 문서마다 다르면 계약 전에 같은 내용으로 고쳐 달라고 요청해요.",
      "야외 촬영·이른 시작·시간 연장·영상이 필요하면 기본 촬영 범위와 별도 금액 기준을 나눠 확인해요.",
      "날씨나 일정 변경 때 바꿀 수 있는 날짜, 추가 비용, 취소 절차를 업체 문서에서 확인해요.",
    ],
    dialogueLines: [{
      say: "받는 사진 파일과 보정 사진은 각각 몇 장인지, 촬영 시간·장소와 원하는 추가 항목이 어디까지 포함되는지 견적서 기준으로 알려주세요.",
      note: "미포함 항목의 금액과 일정 변경·취소 조건, 결과물 전달 시점도 문자나 계약서에 남길 수 있는지 물어봐요.",
    }],
    completionEvidence: [
      "받는 사진 파일·보정 사진·앨범 등 결과물의 수량과 전달 방식을 다시 찾을 수 있게 적어둔 기록",
      "촬영 시간·장소와 선택한 별도 항목의 포함 여부·추가 금액 기준을 업체 서면 답변이나 견적서에서 확인한 상태",
      "일정 변경·취소 조건과 각 지급 시점을 받은 문서에서 확인한 상태",
    ],
    provenance: {
      sourceKind: "independent_reviewed_guidance",
      contentRevision: 1,
      reviewedAt: "2026-08-17",
      reviewDueAt: "2026-11-16",
      applicabilityScope: "웨딩 사진 촬영 후보의 결과물·촬영 범위와 계약 전 문서 확인",
      limitations: [
        "이 안내는 견적의 포함·불포함과 확인 절차를 정리하며, 가격의 적정성·사진 품질·업체 신뢰도·계약의 법률 판단을 제공하지 않아요.",
        "실제 제공 범위·추가 금액·일정 변경·취소 조건은 사용자가 받은 최신 견적서·계약서·업체 서면 답변을 직접 대조해 확인해요.",
        "완료 상태는 확인 문서를 다시 찾을 수 있다는 뜻이며 결과물이 전달됐거나 결제가 확인됐다는 뜻은 아니에요.",
      ],
    },
  }]);
  assert.equal(validateAmoraPreparationGuideModule(modules[0], "studio").ok, true);
});

test("an exact unfinished makeup rehearsal trigger returns the frozen scope guide", () => {
  const modules = buildAmoraPreparationGuideModules({
    topicKey: "makeup",
    applicability: "applicable",
    status: "in_progress",
    asOfDate: "2026-08-17",
    checklistItems: [{
      id: "makeup_04",
      label: "결혼식 전에 미리 받아볼 날짜 예약",
      done: false,
    }],
  });

  assert.deepEqual(modules, [{
    version: AMORA_PREPARATION_GUIDE_CONTRACT_VERSION,
    moduleId: "makeup.rehearsal_and_scope.v1",
    topicKey: "makeup",
    title: "헤어·메이크업 사전 확인·포함 범위 정리",
    whyShown: {
      kind: "unfinished_checklist_item",
      checklistItemId: "makeup_04",
      label: "현재 준비 상태에서 ‘결혼식 전에 미리 받아볼 날짜 예약’ 항목이 아직 확인 전이라 이 가이드를 보여드려요.",
    },
    decisions: [
      "결혼식 전에 미리 받아볼 필요가 있는지와 견적 포함 여부를 확인하고, 이용한다면 날짜를 정해요.",
      "두 사람과 부모님 가운데 헤어·메이크업이 필요한 사람과 각자 받을 항목을 정해요.",
      "참고 사진이나 미리 받아본 사진에서 유지할 점과 바꿀 점을 구분해 최종 일정 전에 업체에 전달해요.",
    ],
    exceptions: [
      "미리 받아보는 과정이 견적에 없거나 이용하지 않기로 했다면, 원하는 분위기와 원하지 않는 표현을 참고 사진과 문장으로 정리해요.",
      "이른 시작·담당자 선택·출장·붙임 머리·장식이 필요하면 기본 범위와 별도 금액을 나눠 확인해요.",
      "부모님이나 배우자의 서비스가 필요하면 인원·항목·시작 시간·장소가 두 사람의 서비스와 따로 정해지는지 확인해요.",
    ],
    dialogueLines: [{
      say: "결혼식 전 미리 받아보는 과정과 두 사람·부모님에게 필요한 헤어·메이크업이 각각 견적에 포함되는지, 미포함이면 항목별 금액을 알려주세요.",
      note: "담당자·시작 시간·장소와 요청사항을 언제까지 어떤 방식으로 전달하면 되는지도 문자나 견적서에 남겨달라고 물어봐요.",
    }],
    completionEvidence: [
      "미리 받아볼지 여부와 이용한다면 날짜·포함 범위를 다시 찾을 수 있게 적어둔 기록",
      "두 사람·부모님 가운데 필요한 사람과 각자 받을 항목·별도 금액을 업체 서면 답변이나 견적서에서 확인한 상태",
      "참고 사진과 유지할 점·바꿀 점, 최종 시작 시간·장소를 다시 찾을 수 있게 적어둔 기록",
    ],
    provenance: {
      sourceKind: "independent_reviewed_guidance",
      contentRevision: 1,
      reviewedAt: "2026-08-17",
      reviewDueAt: "2026-11-16",
      applicabilityScope: "헤어·메이크업의 사전 확인, 대상 인원·포함 범위와 요청사항 정리",
      limitations: [
        "이 안내는 필요한 확인 항목을 정리하며, 결과의 만족도·가격의 적정성·업체나 담당자의 품질을 판정하지 않아요.",
        "미리 받아보기의 필요 여부와 받을 사람·항목은 업체의 제공 범위와 두 사람의 선택에 따라 달라져요.",
        "실제 포함 범위·담당자·시간·장소·추가 금액은 사용자가 받은 최신 견적서·계약서·업체 서면 답변을 직접 대조해 확인해요.",
        "완료 상태는 요청과 확인 내용을 기록했다는 뜻이며 업체 확정·서비스 제공·결제가 확인됐다는 뜻은 아니에요.",
      ],
    },
  }]);
  assert.equal(validateAmoraPreparationGuideModule(modules[0], "makeup").ok, true);
});

test("makeup triggers advance in the canonical rehearsal, feedback, and family-scope order", () => {
  const triggerItems = [
    ["makeup_04", "결혼식 전에 미리 받아볼 날짜 예약"],
    ["makeup_05", "미리 받아보고 사진으로 남겨 확인"],
    ["makeup_06", "수정 사항 전달"],
    ["makeup_08", "부모님 헤어·메이크업이 필요한지 확인"],
  ];

  for (let expectedIndex = 1; expectedIndex < triggerItems.length; expectedIndex += 1) {
    const [module] = buildAmoraPreparationGuideModules({
      topicKey: "makeup",
      applicability: "applicable",
      status: "in_progress",
      asOfDate: "2026-08-17",
      checklistItems: triggerItems.map(([id, label], index) => ({
        id,
        label,
        done: index < expectedIndex,
      })),
    });
    const [expectedId, expectedLabel] = triggerItems[expectedIndex];

    assert.deepEqual(module.whyShown, {
      kind: "unfinished_checklist_item",
      checklistItemId: expectedId,
      label: `현재 준비 상태에서 ‘${expectedLabel}’ 항목이 아직 확인 전이라 이 가이드를 보여드려요.`,
    });
  }
});

test("the studio contract trigger is selected only after the earlier deliverables trigger is done", () => {
  const [module] = buildAmoraPreparationGuideModules({
    topicKey: "studio",
    applicability: "applicable",
    status: "in_progress",
    asOfDate: "2026-08-17",
    checklistItems: [
      {
        id: "studio_04",
        label: "받는 사진 수와 보정해 주는 사진 수 확인",
        done: true,
      },
      { id: "studio_06", label: "계약 및 계약금 납부", done: false },
    ],
  });

  assert.deepEqual(module.whyShown, {
    kind: "unfinished_checklist_item",
    checklistItemId: "studio_06",
    label: "현재 준비 상태에서 ‘계약 및 계약금 납부’ 항목이 아직 확인 전이라 이 가이드를 보여드려요.",
  });
});

test("only exact applicable unfinished triggers can select a guide", () => {
  const cases = [
    applicableInput({ applicability: "unknown" }),
    applicableInput({ applicability: "not_applicable" }),
    applicableInput({ status: "decision_needed" }),
    applicableInput({ status: "completed", checklistItems: [
      { id: "venue_06", label: "취소·변경 때 내거나 돌려받는 금액 확인", done: false },
    ] }),
    applicableInput({ checklistItems: [
      { id: "venue_05", label: "결혼식 시간대 정하기", done: false },
    ] }),
    applicableInput({ checklistItems: [
      { id: "meeting_01", label: "양쪽 부모님 첫 만남 날짜 조율", done: false },
    ] }),
    applicableInput({ checklistItems: [
      { id: "venue_06_extra", label: "비슷하지만 정본이 아닌 항목", done: false },
    ] }),
  ];

  for (const input of cases) {
    assert.deepEqual(buildAmoraPreparationGuideModules(input), []);
  }
  for (const malformed of [null, "venue", [], 7]) {
    assert.deepEqual(buildAmoraPreparationGuideModules(malformed), []);
  }
});

test("schedule-linked exploration may show the same guide without inventing schedule facts", () => {
  const [module] = buildAmoraPreparationGuideModules(applicableInput({
    status: "exploring",
    checklistItems: [
      { id: "venue_07", label: "계약금 납부 및 계약서 보관", done: false },
    ],
  }));

  assert.equal(module.whyShown.checklistItemId, "venue_07");
  assert.equal(
    module.whyShown.label,
    "현재 준비 상태에서 ‘계약금 납부 및 계약서 보관’ 항목이 아직 확인 전이라 이 가이드를 보여드려요.",
  );
  assert.doesNotMatch(JSON.stringify(module), /\d{4}-\d{2}-\d{2} ·|D-|마감|긴급/u);
  assert.deepEqual(buildAmoraPreparationGuideModules(applicableInput({
    status: "exploring",
    checklistItems: [
      { id: "venue_07", label: "클라이언트가 바꾼 문장", done: false },
    ],
  })), []);
});

test("missing, future-before-review, and expired catalog dates fail closed", () => {
  assert.deepEqual(buildAmoraPreparationGuideModules(applicableInput({
    asOfDate: undefined,
  })), []);
  assert.deepEqual(buildAmoraPreparationGuideModules(applicableInput({
    asOfDate: "2026-08-15",
  })), []);
  assert.equal(buildAmoraPreparationGuideModules(applicableInput({
    asOfDate: "2026-11-16",
  })).length, 1);
  assert.deepEqual(buildAmoraPreparationGuideModules(applicableInput({
    asOfDate: "2026-11-17",
  })), []);
});

test("the studio guide is visible only inside its inclusive reviewed window", () => {
  const buildAt = (asOfDate) => buildAmoraPreparationGuideModules({
    topicKey: "studio",
    applicability: "applicable",
    status: "in_progress",
    asOfDate,
    checklistItems: [
      {
        id: "studio_04",
        label: "받는 사진 수와 보정해 주는 사진 수 확인",
        done: false,
      },
    ],
  });

  assert.deepEqual(buildAt("2026-08-16"), []);
  assert.equal(buildAt("2026-08-17").length, 1);
  assert.equal(buildAt("2026-11-16").length, 1);
  assert.deepEqual(buildAt("2026-11-17"), []);
});

test("the makeup guide is visible only inside its inclusive reviewed window", () => {
  const buildAt = (asOfDate) => buildAmoraPreparationGuideModules({
    topicKey: "makeup",
    applicability: "applicable",
    status: "in_progress",
    asOfDate,
    checklistItems: [{
      id: "makeup_04",
      label: "결혼식 전에 미리 받아볼 날짜 예약",
      done: false,
    }],
  });

  assert.deepEqual(buildAt("2026-08-16"), []);
  assert.equal(buildAt("2026-08-17").length, 1);
  assert.equal(buildAt("2026-11-16").length, 1);
  assert.deepEqual(buildAt("2026-11-17"), []);
});

test("duplicate, drifted, done, inapplicable, and unsupported studio inputs fail closed", () => {
  const base = {
    topicKey: "studio",
    applicability: "applicable",
    status: "in_progress",
    asOfDate: "2026-08-17",
    checklistItems: [{
      id: "studio_04",
      label: "받는 사진 수와 보정해 주는 사진 수 확인",
      done: false,
    }],
  };
  const cases = [
    {
      ...base,
      checklistItems: [base.checklistItems[0], { ...base.checklistItems[0] }],
    },
    {
      ...base,
      checklistItems: [{ ...base.checklistItems[0], label: "비슷하지만 정본이 아닌 문장" }],
    },
    {
      ...base,
      checklistItems: [{ ...base.checklistItems[0], done: true }],
    },
    { ...base, applicability: "unknown" },
    { ...base, applicability: "not_applicable" },
    { ...base, status: "decision_needed" },
    { ...base, status: "completed" },
  ];

  for (const input of cases) {
    assert.deepEqual(buildAmoraPreparationGuideModules(input), []);
  }
});

test("duplicate, drifted, done, inapplicable, and unsupported makeup inputs fail closed", () => {
  const base = {
    topicKey: "makeup",
    applicability: "applicable",
    status: "in_progress",
    asOfDate: "2026-08-17",
    checklistItems: [{
      id: "makeup_04",
      label: "결혼식 전에 미리 받아볼 날짜 예약",
      done: false,
    }],
  };
  const cases = [
    {
      ...base,
      checklistItems: [base.checklistItems[0], { ...base.checklistItems[0] }],
    },
    {
      ...base,
      checklistItems: [{ ...base.checklistItems[0], label: "비슷하지만 정본이 아닌 문장" }],
    },
    {
      ...base,
      checklistItems: [{ ...base.checklistItems[0], done: true }],
    },
    { ...base, applicability: "unknown" },
    { ...base, applicability: "not_applicable" },
    { ...base, status: "decision_needed" },
    { ...base, status: "completed" },
  ];

  for (const input of cases) {
    assert.deepEqual(buildAmoraPreparationGuideModules(input), []);
  }
});

test("meeting and ceremony-program guides use the same contract without widening their scope", () => {
  const [meeting] = buildAmoraPreparationGuideModules({
    topicKey: "meeting",
    applicability: "applicable",
    status: "not_started",
    asOfDate: "2026-08-16",
    checklistItems: [
      { id: "meeting_02", label: "만날 장소 정하고 예약", done: false },
    ],
  });
  const [mc] = buildAmoraPreparationGuideModules({
    topicKey: "mc",
    applicability: "applicable",
    status: "in_progress",
    asOfDate: "2026-08-16",
    checklistItems: [
      { id: "mc_05", label: "결혼식 진행 순서를 맡은 사람에게 전달", done: false },
    ],
  });

  assert.equal(meeting.moduleId, "meeting.first_family_meeting.v1");
  assert.match(meeting.provenance.applicabilityScope, /부모님 첫 만남/u);
  assert.match(meeting.provenance.limitations.join(" "), /선택 사항|의무/u);
  assert.equal(mc.moduleId, "mc.ceremony_run_of_show.v1");
  assert.match(mc.provenance.applicabilityScope, /진행자·축하 노래/u);
  assert.match(mc.provenance.limitations.join(" "), /본식 당일 전체 운영/u);
  assert.doesNotMatch(mc.title, /본식 당일 전체|완벽|모든/u);
});

test("guide output is deterministic, deeply frozen, and detached from caller mutation", () => {
  const checklistItems = [
    { id: "venue_07", label: "계약금 납부 및 계약서 보관", done: false },
    { id: "venue_06", label: "취소·변경 때 내거나 돌려받는 금액 확인", done: false },
  ];
  const first = buildAmoraPreparationGuideModules(applicableInput({ checklistItems }));
  checklistItems[0].id = "meeting_01";
  checklistItems[0].label = "호출 뒤 바뀐 문장";
  checklistItems.push({ id: "venue_06", label: "뒤늦은 변경", done: false });
  const second = buildAmoraPreparationGuideModules(applicableInput({
    checklistItems: [
      { id: "venue_07", label: "계약금 납부 및 계약서 보관", done: false },
      { id: "venue_06", label: "취소·변경 때 내거나 돌려받는 금액 확인", done: false },
    ],
  }));

  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first[0]), true);
  assert.equal(Object.isFrozen(first[0].decisions), true);
  assert.equal(Object.isFrozen(first[0].dialogueLines[0]), true);
  assert.equal(Object.isFrozen(first[0].provenance.limitations), true);
});

test("curated v1 content contains no unsupported price, law, obligation, or guarantee claims", () => {
  const modules = [
    buildAmoraPreparationGuideModules(applicableInput())[0],
    buildAmoraPreparationGuideModules({
      topicKey: "meeting",
      applicability: "applicable",
      status: "in_progress",
      asOfDate: "2026-08-16",
      checklistItems: [{ id: "meeting_01", label: "양쪽 부모님 첫 만남 날짜 조율", done: false }],
    })[0],
    buildAmoraPreparationGuideModules({
      topicKey: "mc",
      applicability: "applicable",
      status: "in_progress",
      asOfDate: "2026-08-16",
      checklistItems: [{ id: "mc_06", label: "결혼식 전 진행 순서를 맞춰볼 날짜 정하기", done: false }],
    })[0],
    buildAmoraPreparationGuideModules({
      topicKey: "studio",
      applicability: "applicable",
      status: "in_progress",
      asOfDate: "2026-08-17",
      checklistItems: [{
        id: "studio_04",
        label: "받는 사진 수와 보정해 주는 사진 수 확인",
        done: false,
      }],
    })[0],
    buildAmoraPreparationGuideModules({
      topicKey: "makeup",
      applicability: "applicable",
      status: "in_progress",
      asOfDate: "2026-08-17",
      checklistItems: [{
        id: "makeup_04",
        label: "결혼식 전에 미리 받아볼 날짜 예약",
        done: false,
      }],
    })[0],
  ];

  assert.equal(modules.every(Boolean), true);
  for (const module of modules) {
    const text = JSON.stringify(module);
    assert.doesNotMatch(
      text,
      /\d[\d,.]*\s*(?:원|만원)|%|법적으로|법정|무조건|반드시|보장|완벽|전문가 검수|공식 인증|필수 예절/u,
    );
    assert.equal(
      module.completionEvidence.every((item) => /(?:기록|상태)$/u.test(item)),
      true,
    );
    assert.doesNotMatch(text, /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
    const reviewedAt = Date.parse(module.provenance.reviewedAt);
    const reviewDueAt = Date.parse(module.provenance.reviewDueAt);
    assert.equal(Number.isFinite(reviewedAt), true);
    assert.equal(Number.isFinite(reviewDueAt), true);
    assert.ok(reviewDueAt > reviewedAt);
    assert.ok(reviewDueAt - reviewedAt <= 183 * 24 * 60 * 60 * 1000);
    assert.ok(reviewDueAt >= Date.parse(new Date().toISOString().slice(0, 10)));
  }
  assert.doesNotMatch(
    modules[0].provenance.limitations.join(" "),
    /업체가 제공한 최신 견적서·계약서가 기준/u,
  );
  assert.match(
    modules[3].provenance.limitations.join(" "),
    /가격의 적정성[\s\S]*제공하지 않아요/u,
  );
  assert.match(
    modules[3].provenance.limitations.join(" "),
    /결과물이 전달됐거나 결제가 확인됐다는 뜻은 아니에요/u,
  );
  assert.match(
    modules[4].provenance.limitations.join(" "),
    /결과의 만족도·가격의 적정성[\s\S]*판정하지 않아요/u,
  );
  assert.match(
    modules[4].provenance.limitations.join(" "),
    /업체 확정·서비스 제공·결제가 확인됐다는 뜻은 아니에요/u,
  );
});

test("strict validation rejects extra keys, topic mismatch, and malformed nested content", () => {
  const [valid] = buildAmoraPreparationGuideModules(applicableInput());
  assert.equal(validateAmoraPreparationGuideModule({ ...valid, extra: true }, "venue").ok, false);
  assert.equal(validateAmoraPreparationGuideModule(valid, "meeting").ok, false);
  assert.equal(validateAmoraPreparationGuideModule({
    ...valid,
    dialogueLines: [{ say: "안전한 문장", hidden: "not allowed" }],
  }, "venue").ok, false);
  assert.equal(validateAmoraPreparationGuideModule({
    ...valid,
    provenance: { ...valid.provenance, reviewedAt: "not-a-date" },
  }, "venue").ok, false);
  assert.equal(validateAmoraPreparationGuideModule({
    ...valid,
    decisions: [
      "형식은 안전하지만 편집 검토를 거치지 않은 새 문장입니다.",
      ...valid.decisions.slice(1),
    ],
  }, "venue").ok, false);
  assert.equal(validateAmoraPreparationGuideModule({
    ...valid,
    moduleId: "venue.unreviewed_variant.v1",
  }, "venue").ok, false);
});

test("studio content and provenance cannot be replaced by valid-looking caller text", () => {
  const [valid] = buildAmoraPreparationGuideModules({
    topicKey: "studio",
    applicability: "applicable",
    status: "in_progress",
    asOfDate: "2026-08-17",
    checklistItems: [
      {
        id: "studio_04",
        label: "받는 사진 수와 보정해 주는 사진 수 확인",
        done: false,
      },
    ],
  });

  assert.equal(validateAmoraPreparationGuideModule({
    ...valid,
    decisions: [
      "형식은 맞지만 검토된 가이드를 바꾸는 문장입니다.",
      ...valid.decisions.slice(1),
    ],
  }, "studio").ok, false);
  assert.equal(validateAmoraPreparationGuideModule({
    ...valid,
    provenance: {
      ...valid.provenance,
      limitations: [
        "형식은 맞지만 검토된 한계를 바꾸는 문장입니다.",
        ...valid.provenance.limitations.slice(1),
      ],
    },
  }, "studio").ok, false);
});

test("makeup content and provenance cannot be replaced by valid-looking caller text", () => {
  const [valid] = buildAmoraPreparationGuideModules({
    topicKey: "makeup",
    applicability: "applicable",
    status: "in_progress",
    asOfDate: "2026-08-17",
    checklistItems: [{
      id: "makeup_04",
      label: "결혼식 전에 미리 받아볼 날짜 예약",
      done: false,
    }],
  });

  assert.equal(validateAmoraPreparationGuideModule({
    ...valid,
    decisions: [
      "형식은 맞지만 검토된 가이드를 바꾸는 문장입니다.",
      ...valid.decisions.slice(1),
    ],
  }, "makeup").ok, false);
  assert.equal(validateAmoraPreparationGuideModule({
    ...valid,
    provenance: {
      ...valid.provenance,
      limitations: [
        "형식은 맞지만 검토된 한계를 바꾸는 문장입니다.",
        ...valid.provenance.limitations.slice(1),
      ],
    },
  }, "makeup").ok, false);
});

test("the topic projection attaches the guide without changing state, progress, or next action", () => {
  const input = {
    topicKey: "venue",
    topics: [{
      key: "venue",
      label: "결혼식장",
      items: [
        { id: "venue_06", label: "취소·변경 때 내거나 돌려받는 금액 확인" },
        { id: "venue_07", label: "계약금 납부 및 계약서 보관" },
      ],
    }],
    progress: {
      venue: {
        status: "in_progress",
        checklist: [
          { id: "venue_06", label: "취소·변경 때 내거나 돌려받는 금액 확인", done: true },
          { id: "venue_07", label: "계약금 납부 및 계약서 보관", done: false },
        ],
      },
    },
    nowIso: "2026-08-16T00:00:00.000Z",
  };
  const view = buildAmoraPreparationTopicView(input);

  assert.equal(view.status, "in_progress");
  assert.deepEqual(view.progress, { completed: 1, total: 2, percent: 50 });
  assert.deepEqual(view.nextAction, {
    title: "계약금 납부 및 계약서 보관",
    reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
    completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
    source: "saved_checklist",
  });
  assert.equal(view.guideModules.length, 1);
  assert.equal(view.guideModules[0].moduleId, "venue.contract_before_signing.v1");
  assert.deepEqual(view.linkedScheduleIds, []);
  assert.deepEqual(view.linkedBudgetCategoryKeys, []);
  assert.deepEqual(view.linkedActionIds, []);
  assert.deepEqual(
    buildAmoraPreparationTopicView({ ...input, nowIso: undefined }).guideModules,
    [],
  );
  assert.deepEqual(
    buildAmoraPreparationTopicView({
      ...input,
      nowIso: "2026-08-15T14:59:59.999Z",
    }).guideModules,
    [],
  );
  assert.equal(
    buildAmoraPreparationTopicView({
      ...input,
      nowIso: "2026-08-15T15:00:00.000Z",
    }).guideModules.length,
    1,
  );
});

test("the studio guide changes no topic status, progress, next action, or linked evidence", () => {
  const input = {
    topicKey: "studio",
    topics: [{
      key: "studio",
      label: "웨딩 사진 촬영",
      items: [
        { id: "studio_01", label: "원하는 사진 분위기와 촬영 장소 정하기" },
        { id: "studio_04", label: "받는 사진 수와 보정해 주는 사진 수 확인" },
        { id: "studio_06", label: "계약 및 계약금 납부" },
      ],
    }],
    progress: {
      studio: {
        status: "in_progress",
        checklist: [
          {
            id: "studio_01",
            label: "원하는 사진 분위기와 촬영 장소 정하기",
            done: true,
          },
          {
            id: "studio_04",
            label: "받는 사진 수와 보정해 주는 사진 수 확인",
            done: false,
          },
          { id: "studio_06", label: "계약 및 계약금 납부", done: false },
        ],
      },
    },
  };
  const withGuide = buildAmoraPreparationTopicView({
    ...input,
    nowIso: "2026-08-17T00:00:00.000Z",
  });
  const withoutGuide = buildAmoraPreparationTopicView({
    ...input,
    nowIso: "2026-08-16T14:59:59.999Z",
  });
  const { guideModules: attachedGuide, ...withGuideState } = withGuide;
  const { guideModules: absentGuide, ...withoutGuideState } = withoutGuide;

  assert.equal(attachedGuide.length, 1);
  assert.deepEqual(absentGuide, []);
  assert.deepEqual(withGuideState, withoutGuideState);
  assert.equal(withGuide.status, "in_progress");
  assert.deepEqual(withGuide.progress, { completed: 1, total: 3, percent: 33 });
  assert.deepEqual(withGuide.nextAction, {
    title: "받는 사진 수와 보정해 주는 사진 수 확인",
    reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
    completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
    source: "saved_checklist",
  });
});

test("the makeup guide changes no topic status, progress, next action, or linked evidence", () => {
  const input = {
    topicKey: "makeup",
    topics: [{
      key: "makeup",
      label: "헤어·메이크업",
      items: [
        { id: "makeup_01", label: "원하는 헤어·메이크업 분위기 사진 정리" },
        { id: "makeup_04", label: "결혼식 전에 미리 받아볼 날짜 예약" },
        { id: "makeup_05", label: "미리 받아보고 사진으로 남겨 확인" },
        { id: "makeup_06", label: "수정 사항 전달" },
        { id: "makeup_08", label: "부모님 헤어·메이크업이 필요한지 확인" },
      ],
    }],
    progress: {
      makeup: {
        status: "in_progress",
        checklist: [
          {
            id: "makeup_01",
            label: "원하는 헤어·메이크업 분위기 사진 정리",
            done: true,
          },
          { id: "makeup_04", label: "결혼식 전에 미리 받아볼 날짜 예약", done: false },
          { id: "makeup_05", label: "미리 받아보고 사진으로 남겨 확인", done: false },
          { id: "makeup_06", label: "수정 사항 전달", done: false },
          {
            id: "makeup_08",
            label: "부모님 헤어·메이크업이 필요한지 확인",
            done: false,
          },
        ],
      },
    },
  };
  const withGuide = buildAmoraPreparationTopicView({
    ...input,
    nowIso: "2026-08-17T00:00:00.000Z",
  });
  const withoutGuide = buildAmoraPreparationTopicView({
    ...input,
    nowIso: "2026-08-16T14:59:59.999Z",
  });
  const { guideModules: attachedGuide, ...withGuideState } = withGuide;
  const { guideModules: absentGuide, ...withoutGuideState } = withoutGuide;

  assert.equal(attachedGuide.length, 1);
  assert.deepEqual(absentGuide, []);
  assert.deepEqual(withGuideState, withoutGuideState);
  assert.equal(withGuide.status, "in_progress");
  assert.deepEqual(withGuide.progress, { completed: 1, total: 5, percent: 20 });
  assert.deepEqual(withGuide.nextAction, {
    title: "결혼식 전에 미리 받아볼 날짜 예약",
    reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
    completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
    source: "saved_checklist",
  });
});

test("all guide triggers stay aligned with the current canonical checklist labels", () => {
  const triggerFixtures = {
    meeting: [
      ["meeting_01", "양쪽 부모님 첫 만남 날짜 조율"],
      ["meeting_02", "만날 장소 정하고 예약"],
      ["meeting_03", "참석자와 옷차림 확인"],
    ],
    venue: [
      ["venue_06", "취소·변경 때 내거나 돌려받는 금액 확인"],
      ["venue_07", "계약금 납부 및 계약서 보관"],
    ],
    studio: [
      ["studio_04", "받는 사진 수와 보정해 주는 사진 수 확인"],
      ["studio_06", "계약 및 계약금 납부"],
    ],
    makeup: [
      ["makeup_04", "결혼식 전에 미리 받아볼 날짜 예약"],
      ["makeup_05", "미리 받아보고 사진으로 남겨 확인"],
      ["makeup_06", "수정 사항 전달"],
      ["makeup_08", "부모님 헤어·메이크업이 필요한지 확인"],
    ],
    mc: [
      ["mc_05", "결혼식 진행 순서를 맡은 사람에게 전달"],
      ["mc_06", "결혼식 전 진행 순서를 맞춰볼 날짜 정하기"],
    ],
  };
  for (const [topicKey, triggerItems] of Object.entries(triggerFixtures)) {
    for (const [id, label] of triggerItems) {
      assert.ok(canonicalChecklistSource.includes(`{ id: "${id}", label: "${label}"`));
    }
    const modules = buildAmoraPreparationGuideModules({
      topicKey,
      applicability: "applicable",
      status: "in_progress",
      asOfDate: "2026-08-17",
      checklistItems: triggerItems.map(([id, label]) => ({
        id,
        label,
        done: false,
      })),
    });
    assert.equal(modules.length, 1);
    assert.equal(modules[0].topicKey, topicKey);
  }
});

test("budget and action records cannot rewrite or select the static guide content", () => {
  const baseInput = {
    topicKey: "venue",
    topics: [{
      key: "venue",
      label: "결혼식장",
      items: [
        { id: "venue_06", label: "취소·변경 때 내거나 돌려받는 금액 확인" },
        { id: "venue_07", label: "계약금 납부 및 계약서 보관" },
      ],
    }],
    progress: {
      venue: {
        status: "in_progress",
        budget: 5_000_000,
        spent: 1_000_000,
        checklist: [
          { id: "venue_06", label: "취소·변경 때 내거나 돌려받는 금액 확인", done: true },
          { id: "venue_07", label: "계약금 납부 및 계약서 보관", done: false },
        ],
      },
    },
    nowIso: "2026-08-16T00:00:00.000Z",
  };
  const withoutPlan = buildAmoraPreparationTopicView(baseInput);
  const withPlan = buildAmoraPreparationTopicView({
    ...baseInput,
    budgetCategoryKeys: ["venue"],
    openActions: [{
      id: "venue-action",
      title: "계약과 결제가 모두 끝났다고 가정하기",
      dueDate: null,
      priority: "high",
      source: "manual",
      categoryKey: "venue",
      sourceRevision: 1,
      createdAt: "2026-08-16T01:00:00.000Z",
    }],
  });

  assert.deepEqual(withPlan.guideModules, withoutPlan.guideModules);
  assert.doesNotMatch(
    JSON.stringify(withPlan.guideModules),
    /모두 끝났다고 가정|5000000|1000000/u,
  );
});
