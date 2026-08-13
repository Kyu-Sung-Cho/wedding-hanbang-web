import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECKLIST_ITEM_GUIDANCE,
  CHECKLIST_ITEM_GUIDANCE_SOURCES,
} from "../src/constants/checklistItemGuidance";
import { CATEGORY_CHECKLISTS } from "../src/constants/weddingPlanning";

const templates = CATEGORY_CHECKLISTS.flatMap((category) => category.items);
const templateIds = templates.map((item) => item.id).sort();
const guidanceIds = Object.keys(CHECKLIST_ITEM_GUIDANCE).sort();

test("218개 정본 항목을 빠짐없이 한 번씩 보강한다", () => {
  assert.equal(templates.length, 218);
  assert.deepEqual(guidanceIds, templateIds);
});

test("모든 항목에 바로 체크할 수 있는 기준·팁·주의가 있다", () => {
  for (const [itemId, guidance] of Object.entries(CHECKLIST_ITEM_GUIDANCE)) {
    assert.ok(
      guidance.completionCriteria.length >= 20 &&
        guidance.completionCriteria.length <= 260,
      `${itemId}: completionCriteria length`,
    );
    assert.ok(guidance.tip.length >= 15 && guidance.tip.length <= 220, `${itemId}: tip length`);
    assert.ok(
      guidance.caution.length >= 15 && guidance.caution.length <= 220,
      `${itemId}: caution length`,
    );

    if (guidance.relativeDueDays !== undefined) {
      assert.ok(
        Number.isInteger(guidance.relativeDueDays) &&
          guidance.relativeDueDays >= -180 &&
          guidance.relativeDueDays <= 540,
        `${itemId}: relativeDueDays`,
      );
    }

    const prose = `${guidance.completionCriteria} ${guidance.tip} ${guidance.caution}`;
    assert.doesNotMatch(prose, /(?:₩|\$|\d[\d,]*(?:만|천|억)?원)/, `${itemId}: fixed money claim`);
    assert.doesNotMatch(prose, /(?:무조건|반드시 성공|완벽하게 보장)/, `${itemId}: absolute claim`);
  }
});

test("분야 안에서도 준비 순서에 맞춘 개별 권장 시점을 제공한다", () => {
  for (const category of CATEGORY_CHECKLISTS) {
    const dueDays = category.items.map(
      (item) => CHECKLIST_ITEM_GUIDANCE[item.id].relativeDueDays,
    );

    assert.equal(dueDays[0], category.ddayStart, `${category.key}: first item`);
    assert.equal(
      dueDays[dueDays.length - 1],
      category.ddayDeadline,
      `${category.key}: last item`,
    );
    assert.ok(new Set(dueDays).size > 1, `${category.key}: staggered due dates`);
  }

  assert.equal(CHECKLIST_ITEM_GUIDANCE.makeup_07.relativeDueDays, 0);
  assert.equal(CHECKLIST_ITEM_GUIDANCE.aftercare_06.relativeDueDays, -90);
});

test("법·행정·주거·여행·안전 근거는 확인일과 공식 HTTPS 주소를 가진다", () => {
  const allowedHosts = new Set([
    "www.kca.go.kr",
    "efamily.scourt.go.kr",
    "www.easylaw.go.kr",
    "www.gov.kr",
    "www.iros.go.kr",
    "rt.molit.go.kr",
    "rtms.molit.go.kr",
    "www.molit.go.kr",
    "www.0404.go.kr",
    "www.kdca.go.kr",
    "www.foodsafetykorea.go.kr",
  ]);

  assert.ok(Object.keys(CHECKLIST_ITEM_GUIDANCE_SOURCES).length >= 8);

  for (const [sourceId, source] of Object.entries(CHECKLIST_ITEM_GUIDANCE_SOURCES)) {
    const url = new URL(source.url);
    assert.equal(url.protocol, "https:", `${sourceId}: HTTPS only`);
    assert.ok(allowedHosts.has(url.hostname), `${sourceId}: official host ${url.hostname}`);
    assert.ok(
      source.checkedAt === "2026-08-12" || source.checkedAt === "2026-08-13",
      `${sourceId}: checkedAt`,
    );
    assert.ok(source.title.length >= 5, `${sourceId}: title`);
  }

  for (const [itemId, guidance] of Object.entries(CHECKLIST_ITEM_GUIDANCE)) {
    for (const source of guidance.sourceRefs ?? []) {
      assert.ok(
        Object.values(CHECKLIST_ITEM_GUIDANCE_SOURCES).some(
          (knownSource) => knownSource.url === source.url,
        ),
        `${itemId}: unknown source ${source.url}`,
      );
    }
  }
});

test("운영 공백과 다양한 결혼 상황을 구체적인 완료 기준으로 다룬다", () => {
  const combined = (ids: string[]) =>
    ids
      .map((id) => {
        const entry = CHECKLIST_ITEM_GUIDANCE[id];
        assert.ok(entry, id);
        return `${entry.completionCriteria} ${entry.tip} ${entry.caution}`;
      })
      .join(" ");

  assert.match(combined(["venue_04", "guests_04", "guests_06"]), /알레르기/);
  assert.match(combined(["guests_05"]), /좌석/);
  assert.match(combined(["ceremony_03", "ceremony_07"]), /음향|마이크|재생/);
  assert.match(combined(["bouquet_06"]), /장식/);
  assert.match(combined(["ceremony_05"]), /현장.*책임|총괄/);
  assert.match(combined(["guests_07", "guests_08"]), /교통|숙박/);
  assert.match(combined(["contracts_07", "ceremony_08"]), /취소|대체안|비상/);
  assert.match(combined(["aftercare_03"]), /분쟁|피해구제/);
  assert.equal(CHECKLIST_ITEM_GUIDANCE.aftercare_06.relativeDueDays, -90);
  assert.match(combined(["special_cases_10"]), /반려동물/);
  assert.match(combined(["special_cases_01", "health_admin_07"]), /국제혼인/);
  assert.match(combined(["special_cases_04"]), /무예식|예식 없이/);
  assert.match(combined(["special_cases_05"]), /재혼/);
  assert.match(combined(["special_cases_07"]), /임신/);
  assert.match(combined(["special_cases_07", "special_cases_08"]), /접근|수어|통역/);
});
