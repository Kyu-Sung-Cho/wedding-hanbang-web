// 견적 체크 리포트 카드 — 1080×1920 PNG, 웨딩코드 카드와 같은 디자인 언어(팔레트·폰트).
// 원칙: 사실만 그린다 — 입력가·확인 안 된 항목·출처. 런타임 공시가가
// 연결된 경우에만 참고값을 표시한다.
// 판정 언어(바가지/위험/안전/등급) 금지 — summaryTitle 자체가 사실 서술이어야 한다(엔진 보장).
// 측정·랩핑은 공통 카드 도구(`lib/canvasCard.ts`, 2026-11-22 웨딩코드 공유 카드에서 옮김)를 쓴다.

import {
  wrapText,
  canvasToPngBlob,
  downloadCanvasPng,
  type MeasureFn,
} from "@/lib/canvasCard";

export { canvasToPngBlob, downloadCanvasPng };

export const REPORT_W = 1080;
export const REPORT_H = 1920;
export const REPORT_PAD = 96;
const MAX_W = REPORT_W - REPORT_PAD * 2;

const INK = "#263832";
const BG = "#fbf8f2";
const GOLD = "#9d6f36";
const MUTED = "#6d7a76";
const LINE = "#e5d8ca";
const FIRST_CHECK = "#36534E";

export interface QuoteReportItem {
  name: string;
  severity: "critical" | "high" | "medium";
}

export interface QuoteReportInput {
  categoryLabel: string;
  quotePriceManwon: number;
  marketMedianManwon: number;
  marketComparatorLabel: string;
  summaryTitle: string;
  missingTotal: number;
  missingCriticalCount: number;
  items: QuoteReportItem[];
  sourceNote: string;
  brand: string;
}

export function formatReportManwon(manwon: number): string {
  return `${Math.round(manwon).toLocaleString()}만원`;
}

function severityTag(severity: QuoteReportItem["severity"]): string {
  return severity === "critical" ? "먼저" : severity === "high" ? "함께" : "해당 시";
}

/** 항목 한 줄 텍스트 — 폭 초과 시 이름을 말줄임 (테스트로 폭 보장) */
export function buildItemLine(
  item: QuoteReportItem,
  fontSize: number,
  measure: MeasureFn,
  maxWidth: number = MAX_W
): string {
  let name = item.name;
  let line = name;
  while (name.length > 4 && measure(line, fontSize) > maxWidth) {
    name = name.slice(0, -1);
    line = `${name}…`;
  }
  return line;
}

/** 리포트에 그릴 항목 수 — 공간상 최대 6개, 나머지는 "+N개 더" 로 정직 표기 */
export function selectReportItems(items: QuoteReportItem[]): {
  shown: QuoteReportItem[];
  moreCount: number;
} {
  const order = { critical: 0, high: 1, medium: 2 } as const;
  const sorted = [...items].sort((a, b) => order[a.severity] - order[b.severity]);
  const shown = sorted.slice(0, 6);
  return { shown, moreCount: Math.max(0, sorted.length - shown.length) };
}

function fontStack(weightCss: string, sizePx: number): string {
  return `${weightCss} ${sizePx}px "Pretendard Variable", "Pretendard", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
}

export async function renderQuoteReportCard(input: QuoteReportInput): Promise<HTMLCanvasElement> {
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* 폰트 실패 시 폴백 폰트로 진행 */
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = REPORT_W;
  canvas.height = REPORT_H;
  const ctx = canvas.getContext("2d")!;
  const measure: MeasureFn = (text, size) => {
    ctx.font = fontStack("500", size);
    return ctx.measureText(text).width;
  };

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, REPORT_W, REPORT_H);
  ctx.textBaseline = "top";

  // 상단 라벨 + 카테고리
  ctx.fillStyle = GOLD;
  ctx.font = fontStack("600", 34);
  ctx.fillText("견적 체크 리포트", REPORT_PAD, 140);
  ctx.fillStyle = INK;
  ctx.font = fontStack("600", 46);
  ctx.fillText(`${input.categoryLabel} 견적`, REPORT_PAD, 196);

  // 히어로 — standalone 체크리스트는 불필요한 가격 입력을 받지 않는다.
  ctx.fillStyle = MUTED;
  ctx.font = fontStack("500", 30);
  ctx.fillText(
    input.quotePriceManwon > 0 ? "입력한 견적가" : "확인 필요로 남긴 항목",
    REPORT_PAD,
    300,
  );
  ctx.fillStyle = INK;
  ctx.font = fontStack("700", 120);
  ctx.fillText(
    input.quotePriceManwon > 0
      ? formatReportManwon(input.quotePriceManwon)
      : `${input.missingTotal}개`,
    REPORT_PAD,
    344,
  );

  // 런타임 공시가가 연결됐을 때만 참고값 표시. 0을 가격처럼 그리지 않는다.
  ctx.fillStyle = MUTED;
  ctx.font = fontStack("500", 34);
  const compareLines = wrapText(
    input.marketMedianManwon > 0
      ? `참고 공시가 · ${input.marketComparatorLabel}: ${formatReportManwon(input.marketMedianManwon)}`
      : "최신 업체별 공시가는 웨딩한방 ‘업체 공시가’에서 확인하세요.",
    MAX_W,
    34,
    measure
  ).slice(0, 2);
  let y = 510;
  for (const line of compareLines) {
    ctx.fillText(line, REPORT_PAD, y);
    y += 48;
  }

  // 요약 타이틀 (사실 서술)
  ctx.fillStyle = INK;
  ctx.font = fontStack("700", 52);
  const titleLines = wrapText(input.summaryTitle, MAX_W, 52, measure).slice(0, 3);
  y += 28;
  for (const line of titleLines) {
    ctx.fillText(line, REPORT_PAD, y);
    y += 72;
  }

  // 구분선
  y += 24;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(REPORT_PAD, y);
  ctx.lineTo(REPORT_W - REPORT_PAD, y);
  ctx.stroke();
  y += 44;

  // 아직 확인하지 않은 항목
  const { shown, moreCount } = selectReportItems(input.items);
  ctx.fillStyle = GOLD;
  ctx.font = fontStack("600", 34);
  ctx.fillText(
    input.missingTotal > 0
      ? `아직 견적서에서 확인하지 않은 항목 ${input.missingTotal}개`
      : "주요 항목이 모두 견적서에 명시돼 있어요",
    REPORT_PAD,
    y
  );
  y += 64;

  ctx.font = fontStack("500", 38);
  for (const item of shown) {
    const tag = severityTag(item.severity);
    ctx.fillStyle = item.severity === "critical" ? FIRST_CHECK : GOLD;
    ctx.font = fontStack("600", 28);
    ctx.fillText(`[${tag}]`, REPORT_PAD, y + 8);
    const tagWidth = ctx.measureText(`[${tag}]`).width + 16;
    ctx.fillStyle = INK;
    ctx.font = fontStack("500", 38);
    ctx.fillText(
      buildItemLine(item, 38, measure, MAX_W - tagWidth),
      REPORT_PAD + tagWidth,
      y
    );
    y += 66;
  }
  if (moreCount > 0) {
    ctx.fillStyle = MUTED;
    ctx.font = fontStack("500", 32);
    ctx.fillText(`외 ${moreCount}개 항목 — 체크리스트 화면에서 모두 확인`, REPORT_PAD, y);
    y += 60;
  }

  // 하단 고정 — 안내문 + 출처 + 브랜드
  const noticeY = REPORT_H - 420;
  ctx.strokeStyle = LINE;
  ctx.beginPath();
  ctx.moveTo(REPORT_PAD, noticeY - 40);
  ctx.lineTo(REPORT_W - REPORT_PAD, noticeY - 40);
  ctx.stroke();

  ctx.fillStyle = MUTED;
  ctx.font = fontStack("500", 28);
  ctx.fillText("'확인 필요'로 남긴 항목만 정리했어요.", REPORT_PAD, noticeY);
  ctx.fillText("'이용 안 함'으로 고른 항목은 결과에서 제외했어요.", REPORT_PAD, noticeY + 44);

  ctx.font = fontStack("400", 26);
  const sourceLines = wrapText(`출처: ${input.sourceNote}`, MAX_W, 26, measure).slice(0, 2);
  let sy = noticeY + 116;
  for (const line of sourceLines) {
    ctx.fillText(line, REPORT_PAD, sy);
    sy += 38;
  }

  ctx.fillStyle = MUTED;
  ctx.font = fontStack("500", 30);
  const brandWidth = ctx.measureText(input.brand).width;
  ctx.fillText(input.brand, (REPORT_W - brandWidth) / 2, REPORT_H - 120);

  return canvas;
}
