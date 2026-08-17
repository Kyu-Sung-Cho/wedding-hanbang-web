export const AMORA_PREPARATION_GUIDE_CONTRACT_VERSION = 1;

const EMPTY_LIST = Object.freeze([]);
const SUPPORTED_STATUSES = new Set(["not_started", "exploring", "in_progress"]);
const SAFE_MODULE_ID_RE = /^[a-z0-9]+(?:[._][a-z0-9]+)*$/u;
const SAFE_CHECKLIST_ID_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/u;
const UNSAFE_DISPLAY_TEXT_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const GUIDE_TEMPLATES = Object.freeze({
  meeting: Object.freeze({
    moduleId: "meeting.first_family_meeting.v1",
    topicKey: "meeting",
    title: "부모님 첫 만남 전에 맞춰볼 것",
    triggerItems: Object.freeze([
      Object.freeze({ id: "meeting_01", label: "양쪽 부모님 첫 만남 날짜 조율" }),
      Object.freeze({ id: "meeting_02", label: "만날 장소 정하고 예약" }),
      Object.freeze({ id: "meeting_03", label: "참석자와 옷차림 확인" }),
    ]),
    decisions: Object.freeze([
      "누가 참석하고 서로를 어떻게 소개할지 두 사람이 먼저 맞춰요.",
      "날짜·장소와 이동·식사에서 미리 배려할 점을 확인해요.",
      "이번 자리에서 나눌 내용과 다음으로 미룰 내용을 구분해요.",
    ]),
    exceptions: Object.freeze([
      "식사 제한·건강·이동 또는 좌석에서 배려가 필요하면 장소를 정하기 전에 확인해요.",
      "지각·불참·일정 변경이 생겼을 때 연락할 사람과 다음 선택을 미리 정해요.",
      "누군가 불편해하는 주제는 대화를 멈추고 두 사람이 다시 범위를 맞춰도 돼요.",
    ]),
    dialogueLines: Object.freeze([
      Object.freeze({
        say: "이번 자리에는 누구와 함께 오실지, 이동이나 식사에서 미리 배려할 점이 있는지 알려주세요.",
        note: "결혼 날짜·예산·선물 이야기는 어디까지 나눌지 두 사람이 먼저 정해 안내해요.",
      }),
    ]),
    completionEvidence: Object.freeze([
      "참석자·날짜·장소와 연락 담당을 다시 찾을 수 있게 적어둔 기록",
      "이동·식사에서 필요한 배려 사항을 확인한 기록",
      "합의된 것·아직 정하지 않은 것·다음에 이야기할 것을 나눈 기록",
    ]),
    provenance: Object.freeze({
      sourceKind: "independent_reviewed_guidance",
      contentRevision: 1,
      reviewedAt: "2026-08-16",
      reviewDueAt: "2026-11-16",
      applicabilityScope: "부모님 첫 만남의 참석자·장소·대화 범위 확인",
      limitations: Object.freeze([
        "선물·옷차림·비용 부담과 대화 순서는 가족마다 다른 선택 사항이에요.",
        "한 가지 관습을 정답이나 의무처럼 적용하지 않아요.",
      ]),
    }),
  }),
  venue: Object.freeze({
    moduleId: "venue.contract_before_signing.v1",
    topicKey: "venue",
    title: "결혼식장 비교·계약 전 확인",
    triggerItems: Object.freeze([
      Object.freeze({ id: "venue_06", label: "취소·변경 때 내거나 돌려받는 금액 확인" }),
      Object.freeze({ id: "venue_07", label: "계약금 납부 및 계약서 보관" }),
    ]),
    decisions: Object.freeze([
      "후보마다 포함된 항목과 별도 비용 항목을 같은 기준으로 비교해요.",
      "날짜·인원 변경과 취소를 요청할 때의 절차와 문서상 조건을 확인해요.",
      "계약금·추가금·잔금을 언제 어떤 문서를 받고 지급할지 확인해요.",
    ]),
    exceptions: Object.freeze([
      "상담에서 들은 내용과 문서가 다르면 서명 전에 문서 수정을 요청해요.",
      "같은 항목 이름도 제공 범위·수량·시간이 다를 수 있어 세부 구성을 확인해요.",
      "인원이나 시간이 바뀔 때 식사·공간·추가 항목의 조건도 함께 달라지는지 확인해요.",
    ]),
    dialogueLines: Object.freeze([
      Object.freeze({
        say: "이 견적에 포함된 항목과 별도 비용 항목, 각 지급 시점, 인원·날짜 변경과 취소 조건을 문서 기준으로 보여주세요.",
        note: "오늘 안내받은 추가 내용도 문서에 남길 수 있는지 물어봐요.",
      }),
    ]),
    completionEvidence: Object.freeze([
      "최신 견적서와 계약서에서 포함·별도 항목을 다시 찾을 수 있는 상태",
      "변경·취소 절차와 각 지급 시점을 두 사람이 같은 문서에서 확인한 상태",
      "상담에서 추가로 합의한 내용이 문서에 남은 상태",
    ]),
    provenance: Object.freeze({
      sourceKind: "independent_reviewed_guidance",
      contentRevision: 1,
      reviewedAt: "2026-08-16",
      reviewDueAt: "2026-11-16",
      applicabilityScope: "결혼식장 후보 비교와 계약 전 문서 확인",
      limitations: Object.freeze([
        "업체마다 조건이 다르므로 받은 견적서·합의하거나 서명한 계약서·업체의 서면 답변을 직접 대조해 확인해요.",
        "이 안내는 비교·확인을 돕는 점검 항목이며 개별 계약의 법률 판단을 제공하지 않아요.",
      ]),
    }),
  }),
  studio: Object.freeze({
    moduleId: "studio.deliverables_before_contract.v1",
    topicKey: "studio",
    title: "사진 촬영 결과물·계약 전 확인",
    triggerItems: Object.freeze([
      Object.freeze({ id: "studio_04", label: "받는 사진 수와 보정해 주는 사진 수 확인" }),
      Object.freeze({ id: "studio_06", label: "계약 및 계약금 납부" }),
    ]),
    decisions: Object.freeze([
      "후보마다 받는 사진 파일 수, 보정 사진 수, 앨범·액자 등 결과물 범위를 같은 기준으로 확인해요.",
      "촬영 시간·장소와 야외 촬영·영상·소품 중 이용할 항목을 고르고 포함 여부를 구분해요.",
      "선택한 결과물과 별도 항목, 일정 변경·취소 조건, 지급 시점이 문서에 남은 뒤 계약 여부를 정해요.",
    ]),
    exceptions: Object.freeze([
      "원본 파일·보정본·앨범의 수량이나 전달 방식이 문서마다 다르면 계약 전에 같은 내용으로 고쳐 달라고 요청해요.",
      "야외 촬영·이른 시작·시간 연장·영상이 필요하면 기본 촬영 범위와 별도 금액 기준을 나눠 확인해요.",
      "날씨나 일정 변경 때 바꿀 수 있는 날짜, 추가 비용, 취소 절차를 업체 문서에서 확인해요.",
    ]),
    dialogueLines: Object.freeze([
      Object.freeze({
        say: "받는 사진 파일과 보정 사진은 각각 몇 장인지, 촬영 시간·장소와 원하는 추가 항목이 어디까지 포함되는지 견적서 기준으로 알려주세요.",
        note: "미포함 항목의 금액과 일정 변경·취소 조건, 결과물 전달 시점도 문자나 계약서에 남길 수 있는지 물어봐요.",
      }),
    ]),
    completionEvidence: Object.freeze([
      "받는 사진 파일·보정 사진·앨범 등 결과물의 수량과 전달 방식을 다시 찾을 수 있게 적어둔 기록",
      "촬영 시간·장소와 선택한 별도 항목의 포함 여부·추가 금액 기준을 업체 서면 답변이나 견적서에서 확인한 상태",
      "일정 변경·취소 조건과 각 지급 시점을 받은 문서에서 확인한 상태",
    ]),
    provenance: Object.freeze({
      sourceKind: "independent_reviewed_guidance",
      contentRevision: 1,
      reviewedAt: "2026-08-17",
      reviewDueAt: "2026-11-16",
      applicabilityScope: "웨딩 사진 촬영 후보의 결과물·촬영 범위와 계약 전 문서 확인",
      limitations: Object.freeze([
        "이 안내는 견적의 포함·불포함과 확인 절차를 정리하며, 가격의 적정성·사진 품질·업체 신뢰도·계약의 법률 판단을 제공하지 않아요.",
        "실제 제공 범위·추가 금액·일정 변경·취소 조건은 사용자가 받은 최신 견적서·계약서·업체 서면 답변을 직접 대조해 확인해요.",
        "완료 상태는 확인 문서를 다시 찾을 수 있다는 뜻이며 결과물이 전달됐거나 결제가 확인됐다는 뜻은 아니에요.",
      ]),
    }),
  }),
  makeup: Object.freeze({
    moduleId: "makeup.rehearsal_and_scope.v1",
    topicKey: "makeup",
    title: "헤어·메이크업 사전 확인·포함 범위 정리",
    triggerItems: Object.freeze([
      Object.freeze({ id: "makeup_04", label: "결혼식 전에 미리 받아볼 날짜 예약" }),
      Object.freeze({ id: "makeup_05", label: "미리 받아보고 사진으로 남겨 확인" }),
      Object.freeze({ id: "makeup_06", label: "수정 사항 전달" }),
      Object.freeze({ id: "makeup_08", label: "부모님 헤어·메이크업이 필요한지 확인" }),
    ]),
    decisions: Object.freeze([
      "결혼식 전에 미리 받아볼 필요가 있는지와 견적 포함 여부를 확인하고, 이용한다면 날짜를 정해요.",
      "두 사람과 부모님 가운데 헤어·메이크업이 필요한 사람과 각자 받을 항목을 정해요.",
      "참고 사진이나 미리 받아본 사진에서 유지할 점과 바꿀 점을 구분해 최종 일정 전에 업체에 전달해요.",
    ]),
    exceptions: Object.freeze([
      "미리 받아보는 과정이 견적에 없거나 이용하지 않기로 했다면, 원하는 분위기와 원하지 않는 표현을 참고 사진과 문장으로 정리해요.",
      "이른 시작·담당자 선택·출장·붙임 머리·장식이 필요하면 기본 범위와 별도 금액을 나눠 확인해요.",
      "부모님이나 배우자의 서비스가 필요하면 인원·항목·시작 시간·장소가 두 사람의 서비스와 따로 정해지는지 확인해요.",
    ]),
    dialogueLines: Object.freeze([
      Object.freeze({
        say: "결혼식 전 미리 받아보는 과정과 두 사람·부모님에게 필요한 헤어·메이크업이 각각 견적에 포함되는지, 미포함이면 항목별 금액을 알려주세요.",
        note: "담당자·시작 시간·장소와 요청사항을 언제까지 어떤 방식으로 전달하면 되는지도 문자나 견적서에 남겨달라고 물어봐요.",
      }),
    ]),
    completionEvidence: Object.freeze([
      "미리 받아볼지 여부와 이용한다면 날짜·포함 범위를 다시 찾을 수 있게 적어둔 기록",
      "두 사람·부모님 가운데 필요한 사람과 각자 받을 항목·별도 금액을 업체 서면 답변이나 견적서에서 확인한 상태",
      "참고 사진과 유지할 점·바꿀 점, 최종 시작 시간·장소를 다시 찾을 수 있게 적어둔 기록",
    ]),
    provenance: Object.freeze({
      sourceKind: "independent_reviewed_guidance",
      contentRevision: 1,
      reviewedAt: "2026-08-17",
      reviewDueAt: "2026-11-16",
      applicabilityScope: "헤어·메이크업의 사전 확인, 대상 인원·포함 범위와 요청사항 정리",
      limitations: Object.freeze([
        "이 안내는 필요한 확인 항목을 정리하며, 결과의 만족도·가격의 적정성·업체나 담당자의 품질을 판정하지 않아요.",
        "미리 받아보기의 필요 여부와 받을 사람·항목은 업체의 제공 범위와 두 사람의 선택에 따라 달라져요.",
        "실제 포함 범위·담당자·시간·장소·추가 금액은 사용자가 받은 최신 견적서·계약서·업체 서면 답변을 직접 대조해 확인해요.",
        "완료 상태는 요청과 확인 내용을 기록했다는 뜻이며 업체 확정·서비스 제공·결제가 확인됐다는 뜻은 아니에요.",
      ]),
    }),
  }),
  mc: Object.freeze({
    moduleId: "mc.ceremony_run_of_show.v1",
    topicKey: "mc",
    title: "진행자·축하 노래 순서 맞추기",
    triggerItems: Object.freeze([
      Object.freeze({ id: "mc_05", label: "결혼식 진행 순서를 맡은 사람에게 전달" }),
      Object.freeze({ id: "mc_06", label: "결혼식 전 진행 순서를 맞춰볼 날짜 정하기" }),
    ]),
    decisions: Object.freeze([
      "각 순서의 담당자와 시작 신호를 한 문서에서 맞춰요.",
      "이름·호칭의 발음과 필요한 음원·영상·장비를 확인해요.",
      "당일 순서가 바뀔 때 연락할 사람과 결정할 사람을 정해요.",
    ]),
    exceptions: Object.freeze([
      "진행자나 축하 노래 담당자가 늦거나 오지 못할 때 대체하거나 생략할 순서를 정해요.",
      "음원·영상·마이크를 사용할 수 없을 때 쓸 대체 파일이나 건너뛸 순서를 정해요.",
      "앞 순서가 늦어지면 줄이거나 미룰 순서와 결정할 사람을 정해요.",
    ]),
    dialogueLines: Object.freeze([
      Object.freeze({
        say: "이 순서표 기준으로 진행 가능한지, 사용할 음원·영상 파일 형식과 전달 기한, 장비 확인 방법을 알려주세요.",
        note: "지연되거나 담당자가 못 올 때 대체하거나 생략할 순서도 함께 맞춰요.",
      }),
    ]),
    completionEvidence: Object.freeze([
      "두 사람·진행자·예식장 담당자가 같은 최신 순서표를 확인한 상태",
      "사용할 파일과 장비의 확인 결과를 다시 찾을 수 있는 상태",
      "사전 확인 시간과 담당자 부재 때의 대체 방법을 적어둔 기록",
    ]),
    provenance: Object.freeze({
      sourceKind: "independent_reviewed_guidance",
      contentRevision: 1,
      reviewedAt: "2026-08-16",
      reviewDueAt: "2026-11-16",
      applicabilityScope: "진행자·축하 노래와 그에 연결된 순서표·사전 확인",
      limitations: Object.freeze([
        "이 안내는 진행자·축하 노래와 해당 진행 순서만 다뤄요.",
        "하객 동선·촬영·물품·정산·긴급 연락망을 포함한 본식 당일 전체 운영이 완료됐다는 뜻은 아니에요.",
      ]),
    }),
  }),
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isSafeText(value, maxLength) {
  return typeof value === "string"
    && value === value.trim()
    && Array.from(value).length >= 1
    && Array.from(value).length <= maxLength
    && !UNSAFE_DISPLAY_TEXT_RE.test(value);
}

function isSafeDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isUniqueSafeTextList(value, { min, max, maxLength }) {
  if (!Array.isArray(value) || value.length < min || value.length > max) return false;
  const seen = new Set();
  for (const item of value) {
    if (!isSafeText(item, maxLength) || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

function isDialogueLine(value) {
  if (!isRecord(value)) return false;
  const expectedKeys = value.note === undefined ? ["say"] : ["say", "note"];
  return hasExactKeys(value, expectedKeys)
    && isSafeText(value.say, 260)
    && (value.note === undefined || isSafeText(value.note, 220));
}

function hasSameTextList(left, right) {
  return left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function hasSameDialogueLines(left, right) {
  return left.length === right.length
    && left.every((line, index) => (
      line.say === right[index].say
      && line.note === right[index].note
    ));
}

export function validateAmoraPreparationGuideModule(value, expectedTopicKey) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "version",
      "moduleId",
      "topicKey",
      "title",
      "whyShown",
      "decisions",
      "exceptions",
      "dialogueLines",
      "completionEvidence",
      "provenance",
    ])
  ) return { ok: false, reason: "module" };
  if (value.version !== AMORA_PREPARATION_GUIDE_CONTRACT_VERSION) {
    return { ok: false, reason: "version" };
  }
  if (
    !SAFE_MODULE_ID_RE.test(value.moduleId)
    || !Object.hasOwn(GUIDE_TEMPLATES, value.topicKey)
    || (expectedTopicKey !== undefined && value.topicKey !== expectedTopicKey)
    || !isSafeText(value.title, 90)
  ) return { ok: false, reason: "identity" };

  if (
    !isRecord(value.whyShown)
    || !hasExactKeys(value.whyShown, ["kind", "checklistItemId", "label"])
    || value.whyShown.kind !== "unfinished_checklist_item"
    || !SAFE_CHECKLIST_ID_RE.test(value.whyShown.checklistItemId)
    || !isSafeText(value.whyShown.label, 180)
  ) return { ok: false, reason: "why_shown" };
  if (
    !isUniqueSafeTextList(value.decisions, { min: 2, max: 5, maxLength: 220 })
    || !isUniqueSafeTextList(value.exceptions, { min: 2, max: 5, maxLength: 240 })
    || !Array.isArray(value.dialogueLines)
    || value.dialogueLines.length < 1
    || value.dialogueLines.length > 3
    || !value.dialogueLines.every(isDialogueLine)
    || !isUniqueSafeTextList(value.completionEvidence, { min: 2, max: 5, maxLength: 220 })
  ) return { ok: false, reason: "content" };

  const provenance = value.provenance;
  if (
    !isRecord(provenance)
    || !hasExactKeys(provenance, [
      "sourceKind",
      "contentRevision",
      "reviewedAt",
      "reviewDueAt",
      "applicabilityScope",
      "limitations",
    ])
    || provenance.sourceKind !== "independent_reviewed_guidance"
    || provenance.contentRevision !== 1
    || !isSafeDate(provenance.reviewedAt)
    || !isSafeDate(provenance.reviewDueAt)
    || Date.parse(provenance.reviewDueAt) <= Date.parse(provenance.reviewedAt)
    || !isSafeText(provenance.applicabilityScope, 180)
    || !isUniqueSafeTextList(provenance.limitations, {
      min: 1,
      max: 4,
      maxLength: 260,
    })
  ) return { ok: false, reason: "provenance" };

  const template = GUIDE_TEMPLATES[value.topicKey];
  const triggerItem = template.triggerItems.find((item) => (
    item.id === value.whyShown.checklistItemId
  ));
  if (value.moduleId !== template.moduleId || value.title !== template.title) {
    return { ok: false, reason: "identity" };
  }
  if (
    !triggerItem
    || value.whyShown.label
      !== `현재 준비 상태에서 ‘${triggerItem.label}’ 항목이 아직 확인 전이라 이 가이드를 보여드려요.`
  ) return { ok: false, reason: "why_shown" };
  if (
    !hasSameTextList(value.decisions, template.decisions)
    || !hasSameTextList(value.exceptions, template.exceptions)
    || !hasSameDialogueLines(value.dialogueLines, template.dialogueLines)
    || !hasSameTextList(value.completionEvidence, template.completionEvidence)
  ) return { ok: false, reason: "content" };
  if (
    provenance.sourceKind !== template.provenance.sourceKind
    || provenance.contentRevision !== template.provenance.contentRevision
    || provenance.reviewedAt !== template.provenance.reviewedAt
    || provenance.reviewDueAt !== template.provenance.reviewDueAt
    || provenance.applicabilityScope !== template.provenance.applicabilityScope
    || !hasSameTextList(provenance.limitations, template.provenance.limitations)
  ) return { ok: false, reason: "provenance" };

  return { ok: true, value };
}

function copyFrozenModule(template, triggerItem) {
  const guideModule = Object.freeze({
    version: AMORA_PREPARATION_GUIDE_CONTRACT_VERSION,
    moduleId: template.moduleId,
    topicKey: template.topicKey,
    title: template.title,
    whyShown: Object.freeze({
      kind: "unfinished_checklist_item",
      checklistItemId: triggerItem.id,
      label: `현재 준비 상태에서 ‘${triggerItem.label}’ 항목이 아직 확인 전이라 이 가이드를 보여드려요.`,
    }),
    decisions: Object.freeze([...template.decisions]),
    exceptions: Object.freeze([...template.exceptions]),
    dialogueLines: Object.freeze(template.dialogueLines.map((line) => Object.freeze({ ...line }))),
    completionEvidence: Object.freeze([...template.completionEvidence]),
    provenance: Object.freeze({
      ...template.provenance,
      limitations: Object.freeze([...template.provenance.limitations]),
    }),
  });
  return validateAmoraPreparationGuideModule(guideModule, template.topicKey).ok
    ? guideModule
    : null;
}

export function buildAmoraPreparationGuideModules(input) {
  if (!isRecord(input)) return EMPTY_LIST;
  const { topicKey, applicability, status, asOfDate, checklistItems } = input;
  if (
    applicability !== "applicable"
    || !SUPPORTED_STATUSES.has(status)
    || !isSafeDate(asOfDate)
    || !Array.isArray(checklistItems)
    || !Object.hasOwn(GUIDE_TEMPLATES, topicKey)
  ) return EMPTY_LIST;

  const template = GUIDE_TEMPLATES[topicKey];
  if (
    asOfDate < template.provenance.reviewedAt
    || asOfDate > template.provenance.reviewDueAt
  ) return EMPTY_LIST;
  const itemsById = new Map();
  for (const item of checklistItems) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.done !== "boolean") {
      continue;
    }
    if (itemsById.has(item.id)) return EMPTY_LIST;
    itemsById.set(item.id, item);
  }

  const triggerItem = template.triggerItems.find((canonicalItem) => (
    itemsById.get(canonicalItem.id)?.done === false
    && itemsById.get(canonicalItem.id)?.label === canonicalItem.label
  ));
  if (!triggerItem) return EMPTY_LIST;
  const guideModule = copyFrozenModule(template, triggerItem);
  return guideModule ? Object.freeze([guideModule]) : EMPTY_LIST;
}
