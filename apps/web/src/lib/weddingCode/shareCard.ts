// 웨딩코드 공유 카드 렌더러 — 1080×1920 PNG, 외부 의존성 0 (Canvas API 직접 드로잉).
// 스크린샷이 유통 단위(지시서 §3): 주인공은 사용자의 문장, 타이포 대비로 위계,
// 이름 없음, 하단 브랜드마크만. 레이아웃 로직은 순수 함수로 분리해 16종 인용 문장
// 전부에 대해 줄바꿈·오버플로를 단위테스트한다 (승인 반영사항 3).

export interface MeasureFn {
  (text: string, fontSizePx: number): number;
}

/** 한글/라틴 혼용 근사 폭 추정 — 테스트용 결정적 측정기 (실 렌더는 ctx.measureText 사용) */
export function approxMeasure(text: string, fontSizePx: number): number {
  let width = 0;
  for (const ch of text) {
    if (ch === " ") width += 0.3;
    else if (/[a-zA-Z0-9.,'"!?~\-·:()%]/.test(ch)) width += 0.56;
    else width += 1.0; // 한글 등 전각
  }
  return width * fontSizePx;
}

/** 그리디 줄바꿈 — 공백 우선, 한 단어가 폭을 넘으면 글자 단위로 쪼갠다 */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSizePx: number,
  measure: MeasureFn
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(" ")) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate, fontSizePx) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) {
        lines.push(current);
        current = "";
      }
      // 단어 자체가 넘치면 글자 단위 분해
      let chunk = "";
      for (const ch of word) {
        const chunkCandidate = chunk + ch;
        if (measure(chunkCandidate, fontSizePx) <= maxWidth) {
          chunk = chunkCandidate;
        } else {
          if (chunk) lines.push(chunk);
          chunk = ch;
        }
      }
      current = chunk;
    }
    lines.push(current);
  }
  return lines.filter((line, i, arr) => line !== "" || i !== arr.length - 1);
}

export interface QuoteLayout {
  fontSize: number;
  lines: string[];
}

/**
 * 인용문 레이아웃 — 큰 크기부터 시도해 maxLines 안에 들어오는 첫 크기를 채택.
 * 수동 개행(\n)이 있으면 "수동 줄이 하나도 쪼개지지 않는" 가장 큰 크기를 우선한다
 * (의미 단위 존중 — 레이아웃 패치 2). 그런 크기가 없을 때만 일반 규칙으로 폴백.
 * 모든 크기에서 넘치면 최소 크기로 강제 래핑(오버플로 안전장치).
 */
export function layoutQuote(
  text: string,
  maxWidth: number,
  measure: MeasureFn,
  sizes: number[] = [84, 72, 64, 56, 48],
  maxLines = 6
): QuoteLayout {
  const paragraphs = text.split("\n");
  if (paragraphs.length > 1) {
    for (const fontSize of sizes) {
      const lines = wrapText(text, maxWidth, fontSize, measure);
      if (lines.length === paragraphs.length && lines.length <= maxLines) {
        return { fontSize, lines };
      }
    }
  }
  for (const fontSize of sizes) {
    const lines = wrapText(text, maxWidth, fontSize, measure);
    if (lines.length <= maxLines) return { fontSize, lines };
  }
  const minSize = sizes[sizes.length - 1];
  return { fontSize: minSize, lines: wrapText(text, maxWidth, minSize, measure).slice(0, maxLines + 2) };
}

// ── 세로 균형 (레이아웃 패치 1) ──────────────────────────────
// 인용 블록을 카드 광학 중심(H의 45%)에 놓되, 위로는 상황줄+인용부호,
// 아래로는 팩트 블록을 침범하지 않게 클램프한다. 순수 함수로 분리해 테스트한다.

export const CARD_W = 1080;
export const CARD_H = 1920;
export const CARD_PAD = 96;
/** 인용부호 글리프가 차지하는 세로 공간 */
export const QUOTE_MARK_SPACE = 190;

export function computeQuoteTop(params: {
  blockHeight: number;
  scenarioBottom: number;
  hasFact: boolean;
}): number {
  const opticalCenter = CARD_H * 0.45;
  const minTop = params.scenarioBottom + QUOTE_MARK_SPACE + 40;
  const bottomBound = (params.hasFact ? CARD_H - 460 : CARD_H - 260) - 80;
  const maxTop = bottomBound - params.blockHeight;
  const centered = opticalCenter - params.blockHeight / 2;
  // 블록이 너무 커서 min>max면 위쪽 기준(내용 우선)으로
  if (minTop > maxTop) return minTop;
  return Math.min(Math.max(centered, minTop), maxTop);
}

// ── 실제 캔버스 렌더 (브라우저 전용) ──────────────────────────

export interface ShareCardInput {
  scenario: string;
  quote: string;
  factText: string | null;
  factSource: string | null;
  brand: string;
}

const W = CARD_W;
const H = CARD_H;
const PAD = CARD_PAD;
const INK = "#263832";
const BG = "#fbf8f2";
const GOLD = "#9d6f36";
const MUTED = "#6d7a76";
const LINE = "#e5d8ca";

function fontStack(weightCss: string, sizePx: number): string {
  return `${weightCss} ${sizePx}px Paperlogy, "Noto Sans KR", sans-serif`;
}

export async function renderShareCard(input: ShareCardInput): Promise<HTMLCanvasElement> {
  // 웹폰트가 캔버스에 반영되도록 로드 완료 대기
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* 폰트 로드 실패 시 폴백 폰트로 진행 */
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const maxWidth = W - PAD * 2;
  const measure: MeasureFn = (text, size) => {
    ctx.font = fontStack("500", size);
    return ctx.measureText(text).width;
  };

  // 배경
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // 상단 상황 한 줄
  ctx.fillStyle = MUTED;
  ctx.font = fontStack("500", 34);
  ctx.textBaseline = "top";
  const scenarioLines = wrapText(input.scenario, maxWidth, 34, measure).slice(0, 2);
  let y = 180;
  for (const line of scenarioLines) {
    ctx.fillText(line, PAD, y);
    y += 48;
  }
  const scenarioBottom = y;

  // 본인 문장 (주인공) — 광학 중심(45%) 배치, 중앙 공백 밴드 제거 (패치 1)
  const quoteLayout = layoutQuote(input.quote, maxWidth, measure);
  const lineHeight = Math.round(quoteLayout.fontSize * 1.42);
  const blockHeight = quoteLayout.lines.length * lineHeight;
  const quoteTop = computeQuoteTop({
    blockHeight,
    scenarioBottom,
    hasFact: Boolean(input.factText),
  });

  // 큰 인용 부호 — 인용 블록 바로 위에 붙인다
  ctx.fillStyle = GOLD;
  ctx.font = `700 200px Georgia, "Times New Roman", serif`;
  ctx.fillText("“", PAD - 12, quoteTop - QUOTE_MARK_SPACE);

  ctx.fillStyle = INK;
  ctx.font = fontStack("700", quoteLayout.fontSize);
  let qy = quoteTop;
  for (const line of quoteLayout.lines) {
    ctx.fillText(line, PAD, qy);
    qy += lineHeight;
  }

  // 팩트 블록 (있을 때만 — 하단 고정 영역)
  let fy = H - 460;
  if (input.factText) {
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, fy - 48);
    ctx.lineTo(W - PAD, fy - 48);
    ctx.stroke();

    ctx.fillStyle = GOLD;
    ctx.font = fontStack("600", 30);
    ctx.fillText("함께 보는 시장 숫자", PAD, fy);
    fy += 56;

    ctx.fillStyle = INK;
    ctx.font = fontStack("500", 38);
    for (const line of wrapText(input.factText, maxWidth, 38, measure).slice(0, 4)) {
      ctx.fillText(line, PAD, fy);
      fy += 56;
    }
    if (input.factSource) {
      ctx.fillStyle = MUTED;
      ctx.font = fontStack("400", 28);
      ctx.fillText(`출처: ${input.factSource}`, PAD, fy + 8);
    }
  }

  // 하단 브랜드마크
  ctx.fillStyle = MUTED;
  ctx.font = fontStack("500", 30);
  const brandWidth = ctx.measureText(input.brand).width;
  ctx.fillText(input.brand, (W - brandWidth) / 2, H - 120);

  return canvas;
}

/** PNG 다운로드 — iOS Safari는 download 미지원 시 새 탭 이미지로 폴백 */
export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): void {
  const dataUrl = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  if (typeof link.download === "string") {
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    window.open(dataUrl, "_blank");
  }
}
