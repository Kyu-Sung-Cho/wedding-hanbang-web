/**
 * 기능 첫 화면 요약(라운지·예산·체크리스트·예약 기록)의 색.
 *
 * ## 왜 바꿨나
 *
 * 웹은 2026-09-13에 요약을 샴페인 면(`summaryPalette`, 웹 `featureSummaryStyles.ts`)으로 바꿨는데
 * 앱은 네 화면 모두 어두운 유칼립투스 카드에 남아 있었다. 내용 카드와 다른 무게로 보이긴 했지만
 * 두 가지가 읽기 기준(글자 4.5:1)에 못 미쳤다.
 * - 예산 초과 빨강 `#EF4444` 가 어두운 카드 위에서 2.23:1
 * - 회색 라벨 `taupe[400]` 이 어두운 카드 위에서 3.69:1
 *
 * 그래서 면·선·글자는 웹과 같은 `summaryPalette` 에서 가져오고, 요약 위에 올라가는 **모든 글자색**을
 * 여기 한 곳에 둔다. `featureSummaryContrast.test.mjs` 가 면과 알약 바탕 위에서 전부 4.5:1 이상인지 잰다.
 *
 * 요약 면은 완료·주의·선택 상태를 뜻하지 않는다(웹 토큰 주석과 같다). 상태는 알약과 글자로 말한다.
 */
import { summaryPalette } from "@hanbang/design-tokens";

export const summaryColors = {
  surface: summaryPalette.surface,
  line: summaryPalette.line,
  accent: summaryPalette.accent,
  track: summaryPalette.track,
  /** 큰 숫자·제목. */
  ink: summaryPalette.ink,
  /** 라벨·설명. 예전 회색(3.69:1)의 자리. */
  label: summaryPalette.label,
  /** 초과·지남 같은 경고 글자. 웹 예산 요약의 `#913C3C` 와 같다. 예전 `#EF4444`(2.23:1)의 자리. */
  danger: "#913C3C",
} as const;

export type SummaryPillTone = "neutral" | "rose" | "success" | "warning" | "danger";

/**
 * 요약 안의 상태 알약. 공용 `StatusPill` 은 흰 카드용이라 반투명 바탕 + 밝은 글자(위험 `#D95F5F` 는
 * 샴페인 면에서 3:1)여서 이 면에서는 쓰지 않는다. 바탕을 불투명하게 두어 대비를 계산할 수 있게 했다.
 */
export const summaryPillColors: Record<SummaryPillTone, { background: string; text: string }> = {
  neutral: { background: "#FBF8F2", text: summaryPalette.label },
  rose: { background: "#EADDD8", text: "#7D5753" },
  success: { background: "#DBE3D6", text: "#3F5241" },
  warning: { background: "#EFE0C8", text: "#6B4F1F" },
  danger: { background: "#F6DEDA", text: "#8C3030" },
};
