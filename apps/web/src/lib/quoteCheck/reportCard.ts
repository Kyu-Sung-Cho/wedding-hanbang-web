// 추가비용 확인 카드 — 사용자 입력 견적가와 확인 질문만 그린다.
// 항목별 가격·발생률·필수성·위험도·등급은 카드에 넣지 않는다.

import {
  wrapText,
  canvasToPngBlob,
  downloadCanvasPng,
  type MeasureFn,
} from "@/lib/weddingCode/shareCard";

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

export interface QuoteReportItem {
  name: string;
}

export interface QuoteReportInput {
  categoryLabel: string;
  quotePriceManwon: number;
  summaryTitle: string;
  unconfirmedTotal: number;
  items: QuoteReportItem[];
  sourceNote: string;
  brand: string;
}

export function formatReportManwon(manwon: number): string {
  return `${Math.round(manwon).toLocaleString()}만원`;
}

/** 항목 한 줄 텍스트 — 폭 초과 시 이름을 말줄임한다. */
export function buildItemLine(
  item: QuoteReportItem,
  fontSize: number,
  measure: MeasureFn,
  maxWidth: number = MAX_W
): string {
  let visibleName = item.name;
  let line = visibleName;
  while (visibleName.length > 4 && measure(line, fontSize) > maxWidth) {
    visibleName = visibleName.slice(0, -1);
    line = `${visibleName}…`;
  }
  return line;
}

/** 입력 순서를 유지해 최대 8개만 그린다. 중요도 정렬은 하지 않는다. */
export function selectReportItems(items: QuoteReportItem[]): {
  shown: QuoteReportItem[];
  moreCount: number;
} {
  const shown = items.slice(0, 8);
  return { shown, moreCount: Math.max(0, items.length - shown.length) };
}

function fontStack(weightCss: string, sizePx: number): string {
  return `${weightCss} ${sizePx}px Paperlogy, "Noto Sans KR", sans-serif`;
}

export async function renderQuoteReportCard(input: QuoteReportInput): Promise<HTMLCanvasElement> {
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // 폰트 로드 실패 시 시스템 폰트로 계속 렌더링한다.
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

  ctx.fillStyle = GOLD;
  ctx.font = fontStack("600", 34);
  ctx.fillText("추가비용 확인 카드", REPORT_PAD, 140);
  ctx.fillStyle = INK;
  ctx.font = fontStack("600", 46);
  ctx.fillText(`${input.categoryLabel} 견적`, REPORT_PAD, 196);

  ctx.fillStyle = MUTED;
  ctx.font = fontStack("500", 30);
  ctx.fillText("사용자가 입력한 견적가", REPORT_PAD, 300);
  ctx.fillStyle = INK;
  ctx.font = fontStack("700", 120);
  ctx.fillText(formatReportManwon(input.quotePriceManwon), REPORT_PAD, 344);

  let y = 520;
  ctx.fillStyle = INK;
  ctx.font = fontStack("700", 52);
  const titleLines = wrapText(input.summaryTitle, MAX_W, 52, measure).slice(0, 3);
  for (const line of titleLines) {
    ctx.fillText(line, REPORT_PAD, y);
    y += 72;
  }

  y += 24;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(REPORT_PAD, y);
  ctx.lineTo(REPORT_W - REPORT_PAD, y);
  ctx.stroke();
  y += 44;

  const { shown, moreCount } = selectReportItems(input.items);
  ctx.fillStyle = GOLD;
  ctx.font = fontStack("600", 34);
  ctx.fillText(
    input.unconfirmedTotal > 0
      ? `포함 여부를 더 확인할 항목 ${input.unconfirmedTotal}개`
      : "선택한 확인 항목을 모두 포함으로 표시했어요",
    REPORT_PAD,
    y
  );
  y += 64;

  ctx.fillStyle = INK;
  ctx.font = fontStack("500", 38);
  for (const item of shown) {
    ctx.fillText(`• ${buildItemLine(item, 38, measure, MAX_W - 28)}`, REPORT_PAD, y);
    y += 62;
  }
  if (moreCount > 0) {
    ctx.fillStyle = MUTED;
    ctx.font = fontStack("500", 32);
    ctx.fillText(`외 ${moreCount}개 항목`, REPORT_PAD, y);
  }

  const noticeY = REPORT_H - 430;
  ctx.strokeStyle = LINE;
  ctx.beginPath();
  ctx.moveTo(REPORT_PAD, noticeY - 40);
  ctx.lineTo(REPORT_W - REPORT_PAD, noticeY - 40);
  ctx.stroke();

  ctx.fillStyle = MUTED;
  ctx.font = fontStack("500", 28);
  ctx.fillText("체크하지 않은 항목은 미포함 판정이 아니에요.", REPORT_PAD, noticeY);
  ctx.fillText("해당하는 항목의 조건과 금액은 업체와 계약서로 확인하세요.", REPORT_PAD, noticeY + 44);

  ctx.font = fontStack("400", 26);
  const sourceLines = wrapText(`총괄 참고: ${input.sourceNote}`, MAX_W, 26, measure).slice(0, 3);
  let sourceY = noticeY + 116;
  for (const line of sourceLines) {
    ctx.fillText(line, REPORT_PAD, sourceY);
    sourceY += 38;
  }

  ctx.fillStyle = MUTED;
  ctx.font = fontStack("500", 30);
  const brandWidth = ctx.measureText(input.brand).width;
  ctx.fillText(input.brand, (REPORT_W - brandWidth) / 2, REPORT_H - 120);

  return canvas;
}
