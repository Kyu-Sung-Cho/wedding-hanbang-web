// PNG 카드를 그리는 데 쓰는 공통 도구 — 글자 폭 재기, 줄바꿈, 캔버스 → PNG.
//
// 2026-11-22 웨딩코드 공유 카드(`lib/weddingCode/shareCard.ts`)에서 그대로 옮겼다. 견적 확인 리포트
// 카드(`lib/quoteCheck/reportCard.ts`)가 이 도구를 빌려 쓰는데, 웨딩코드를 내리고 그 코드를 지울 때
// 견적 확인이 함께 깨지지 않게 하려는 것이다. 웨딩코드 쪽은 지울 때까지 이 파일을 다시 내보낸다.

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

/** 캔버스 → PNG Blob (공유시트용). 실패 시 null — 호출부가 다음 폴백으로 강하 */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      resolve(null);
    }
  });
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
