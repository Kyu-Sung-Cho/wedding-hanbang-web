import { Redirect } from "expo-router";
import {
  buildMobileSiteUrl,
  resolveMobileSiteOrigin,
} from "@/lib/siteUrl.mjs";

const siteOrigin = resolveMobileSiteOrigin(
  process.env.EXPO_PUBLIC_SITE_URL,
  { isDevelopment: __DEV__ },
);
const weddingCodeUrl = buildMobileSiteUrl("/wedding-code", siteOrigin);

// 웨딩코드는 웹과 같은 화면을 그대로 연다. 앱에 사본을 만들지 않는 이유는 두 가지다.
//
// 1. 답은 주소의 `#` 뒤에 실려 서로 링크로 오간다. 앱이 따로 문항·코드를 구현하면
//    두 곳의 문항 판이 갈라지는 순간 같은 링크가 다른 답으로 읽힌다.
// 2. 답 보태기의 동의 문구·보관 기간·삭제 절차는 처리방침과 한 벌이다. 사본을 두면
//    고지와 화면이 어긋날 자리가 하나 더 생긴다.
//
// 로그인이 필요 없는 공개 화면이라 세션 없는 웹뷰로 충분하다.
export default function WeddingCodeScreen() {
  return (
    <Redirect
      href={{
        pathname: "/webview",
        params: { url: weddingCodeUrl },
      }}
    />
  );
}
