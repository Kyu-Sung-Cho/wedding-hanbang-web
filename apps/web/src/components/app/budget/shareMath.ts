/**
 * 비중 계산은 **웹의 것이 아니다.**
 *
 * 같은 예산 화면이 모바일에도 있고 둘 다 같은 `progress` 를 읽는다. 각자 계산하면
 * 두 화면이 같은 커플에게 다른 숫자를 말한다 — 이 저장소가 여러 번 앓은 병이다.
 * 그래서 구현은 `packages/shared/src/contracts/budgetShare.mjs` 한 곳에 있고,
 * 이 파일은 웹 쪽 이름표일 뿐이다.
 *
 * 여기에 계산을 다시 적지 마라. 고칠 것이 있으면 shared 를 고친다.
 */

export {
  foldPayerSides,
  formatManwon,
  formatPercentCell,
  withPercents,
} from "@hanbang/shared/budget-share";
