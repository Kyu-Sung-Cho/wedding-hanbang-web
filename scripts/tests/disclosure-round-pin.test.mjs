// 화면이 주장하는 공시 기준 시점이 운영 DB와 어긋난 채 방치되지 않게 한다.
//
// `27d0d567`이 표시값을 `price_snapshots.period_label`에서 떼어냈다 — 그 값은 우리
// 내부 스냅샷 이름("2026Q3")이고 실제 공시 라운드(2025-11)가 아니라서, 화면이
// 가격 옆에서 틀린 기준 시점을 주장하고 있었기 때문이다. 옳은 수정이었지만
// **새 함정**을 만들었다: 다음 라운드를 적재하고 `DISCLOSURE_ROUND`를 안 고치면
// 화면이 옛 시점을 계속 주장하는데, 단위 테스트는 리터럴("2025-11")만 고정하므로
// 전부 통과한다. 가드가 있는 것처럼 보이지만 실제로는 없는 상태다.
//
// 실제 대조(운영 DB의 발행 스냅샷 ↔ 핀)는 DB를 볼 수 있는 `pnpm audit:production`이
// 한다. 이 파일은 그 대조가 **성립할 조건**을 지킨다 — 감사 스크립트가 상수를
// 실제로 읽어낼 수 있는지, 그리고 상수를 베껴 두지 않았는지.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const PERIOD_TS = resolve(ROOT, "apps", "web", "src", "lib", "price", "period.ts");
const AUDIT_MJS = resolve(ROOT, "scripts", "audit", "production-readiness-audit.mjs");

const periodSource = readFileSync(PERIOD_TS, "utf8");
const auditSource = readFileSync(AUDIT_MJS, "utf8");

/**
 * 주석을 걷어낸 소스. "베꼈는지" 검사는 **실행되는 코드**만 봐야 한다 —
 * 설명 주석에 값을 예시로 적는 것은 정상이고, 그것까지 위반으로 세면
 * 정확한 주석을 못 쓰게 된다(2026-07-27 이 파일이 실제로 그렇게 오탐했다).
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

const auditCode = stripComments(auditSource);

/** 감사 스크립트가 쓰는 것과 **같은** 정규식. 여기서 갈리면 검사가 무의미하다. */
const ROUND_PATTERN = /export const DISCLOSURE_ROUND\s*=\s*"([^"]+)"/;
const LABELS_PATTERN = /export const DISCLOSURE_ROUND_SNAPSHOT_LABELS\s*=\s*\[([^\]]*)\]/;

test("감사 스크립트가 쓰는 정규식이 period.ts에서 실제로 값을 뽑는다", () => {
  const round = ROUND_PATTERN.exec(periodSource);
  assert.ok(round, "DISCLOSURE_ROUND를 못 읽었다 — audit:production의 라운드 대조가 죽는다");
  assert.match(
    round[1],
    /^\d{4}-\d{2}$/,
    `DISCLOSURE_ROUND="${round[1]}"가 YYYY-MM이 아니다`
    + " — 내부 스냅샷 이름(2026Q3 등)을 다시 넣은 것은 아닌지 확인할 것",
  );

  const labels = LABELS_PATTERN.exec(periodSource);
  assert.ok(labels, "DISCLOSURE_ROUND_SNAPSHOT_LABELS를 못 읽었다 — 대조할 근거가 사라진다");
  const parsed = [...labels[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(parsed.length > 0, "근거 스냅샷 목록이 비어 있다 — 어떤 발행분과도 대조할 수 없다");
});

test("감사 스크립트는 상수를 베끼지 않고 period.ts에서 읽는다", () => {
  // 값을 두 곳에 적어 두면 그게 곧 드리프트다 — 이 점검이 막으려는 상태 그 자체.
  assert.match(
    auditCode,
    /price["'\], ]+period\.ts|"period\.ts"/,
    "감사 스크립트가 period.ts를 읽지 않는다 — 상수를 베꼈다면 드리프트를 못 잡는다",
  );
  const round = ROUND_PATTERN.exec(periodSource)[1];
  const labels = [...LABELS_PATTERN.exec(periodSource)[1].matchAll(/"([^"]+)"/g)]
    .map((match) => match[1]);
  for (const literal of [round, ...labels]) {
    assert.ok(
      !auditCode.includes(`"${literal}"`),
      `감사 스크립트에 "${literal}"이 리터럴로 박혀 있다 — period.ts와 따로 놀게 된다`,
    );
  }
});

test("라운드 대조 검사가 감사 스크립트에 실제로 배선돼 있다", () => {
  // 상수만 읽고 check()를 안 부르면 아무것도 막지 않는다.
  assert.match(
    auditSource,
    /check\(\s*\n?\s*"공시 라운드 표기가 발행 스냅샷과 맞물려 있음"/,
    "라운드 대조 check()가 없다 — 새 공시 라운드가 들어와도 아무도 모른다",
  );
  assert.match(
    auditCode,
    /where published is true/,
    "발행 스냅샷 전체를 조회하지 않는다 — 표시용 limit 조회에 새 라운드가 가려진다",
  );
});
