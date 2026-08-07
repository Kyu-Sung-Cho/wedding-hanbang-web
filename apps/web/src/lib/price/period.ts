const DISCLOSURE_DISCLAIMER =
  "본 정보는 공시 기준이며 실제 계약 조건·시점에 따라 달라질 수 있습니다. 계약 전 업체에 직접 확인하세요.";

/** 한국소비자원 참가격의 결혼준비대행서비스 공시 원문 게시판. */
export const DISCLOSURE_SOURCE_URL =
  "https://price.go.kr/tprice/portal/board/boardInfoMgr.do?boardTypeCode=0090000122";

/**
 * 소비자에게 보이는 **공시 기준 시점**.
 *
 * `price_snapshots.period_label`과 분리해서 쓴다. 그 값은 우리 내부 스냅샷 이름이고
 * (운영 실측 2026-07-27: `2026Q3`) 실제 공시 라운드가 아니다. 원본은 한국소비자원
 * 참가격 "결혼서비스 중요정보 공개 → 결혼준비대행서비스" 게시판의
 * **2025-11-12~13 라운드**다(소유자가 게시판 화면으로 확인).
 *
 * 스냅샷 이름을 기준 시점으로 렌더하는 바람에 화면이 "2026년 3분기 공시 기준"이라고
 * 주장하고 있었다. 유통 글 본문조차 "2025년 11월부터 가격·위약금 표시가 의무화"라고
 * 쓰는데 도착 화면은 2026년 3분기였다 — 가장 강한 자산 옆에서 신뢰가 깨지는 자리다.
 *
 * 자기 일관성 검사로는 잡히지 않는다: `collected_at`은 적재 시점(2026-07)이라
 * `2026Q3` 라벨과 우연히 맞는다. 사람이 게시일과 대조하는 수밖에 없다.
 *
 * **다음 라운드를 적재하면 이 값을 게시일 기준으로 갱신한다.**
 * 출처·확인 절차: `docs/operations/DISCLOSURE_SOURCE_PROVENANCE.md`
 * 확인 명령: `pnpm audit:production` (=== 1-b. 공시 스냅샷 출처 ===)
 */
export const DISCLOSURE_ROUND = "2025-11";

/**
 * 위 `DISCLOSURE_ROUND`가 근거로 삼은 **내부 스냅샷 이름**들.
 *
 * 표시값을 DB에서 떼어낸 대가로 새 함정이 생겼다: 다음 라운드를 적재하고 이
 * 상수를 안 고치면 화면이 **옛 공시 시점을 계속 주장**하는데, 단위 테스트는
 * 리터럴("2025-11")만 고정하므로 전부 통과한다. 즉 "가드가 있는 것처럼 보이지만
 * 실제로는 없는" 상태가 된다.
 *
 * 그래서 이 라운드가 어느 스냅샷을 근거로 하는지 함께 적어 둔다.
 * `pnpm audit:production`이 운영 DB의 **발행된** 스냅샷 목록을 이 값과 대조해,
 * 목록에 없는 스냅샷이 발행돼 있으면 실패한다(= 새 라운드가 들어왔으니
 * `DISCLOSURE_ROUND`를 게시일 기준으로 갱신하라는 신호).
 *
 * 운영 실측(2026-07-27): 발행 스냅샷은 `2026Q3` 하나다.
 */
export const DISCLOSURE_ROUND_SNAPSHOT_LABELS = ["2026Q3"] as const;

/** 스냅샷 이름을 사람이 읽는 문구로. 내부 표시(관리자 미리보기·디버깅)에만 쓴다. */
export function formatDisclosurePeriod(periodLabel: string): string {
  const normalized = periodLabel.trim();
  const quarter = /^(\d{4})Q([1-4])$/i.exec(normalized);
  if (quarter) return `${quarter[1]}년 ${quarter[2]}분기`;

  const month = /^(\d{4})-(0?[1-9]|1[0-2])$/.exec(normalized);
  if (month) return `${month[1]}년 ${Number(month[2])}월`;

  return normalized || "기간 확인 필요";
}

/**
 * 소비자 화면에 쓰는 공시 기준 문구. 스냅샷 이름을 **인수로 받지 않는다** —
 * 받게 두면 또 내부 이름이 기준일로 새어 나간다.
 */
export function disclosureRoundLabel(): string {
  return formatDisclosurePeriod(DISCLOSURE_ROUND);
}

/**
 * DB에 저장된 `source_label`을 소비자에게 보여줄 때 쓴다.
 *
 * 그 값에는 적재 당시 스냅샷 이름이 박혀 있다(운영 실측:
 * `"한국소비자원 참가격 · 2026Q3"`). 그대로 "가격 근거"로 띄우면 우리 내부 이름을
 * 출처인 것처럼 주장하게 된다 — 하필 근거를 보여주는 자리라 더 나쁘다.
 * 스냅샷 토큰만 확인된 라운드로 바꾸고 나머지 원문은 손대지 않는다.
 */
export function displaySourceLabel(sourceLabel: string): string {
  return sourceLabel.replace(/\d{4}Q[1-4]/gi, disclosureRoundLabel());
}

export function priceDisclosureLines(): readonly [string, string] {
  return [
    `가격 출처: 한국소비자원 참가격 · ${disclosureRoundLabel()} 공시 기준`,
    DISCLOSURE_DISCLAIMER,
  ];
}
