import { Redirect } from "expo-router";

// 시세는 웹의 한국소비자원 참가격 데이터(격월 자동 갱신)를 단일 출처로 쓴다.
// 하드코딩 사본은 실제 시세와 드리프트하고 "출처 있는 평균가만" 원칙에 어긋나
// 예절과 동일하게 웹뷰로 위임한다.
export default function MarketPricesScreen() {
  return <Redirect href="/webview?url=https://hanbang.ai/market-prices" />;
}
