import type { Metadata } from "next";

import { kstDateString, seedFromDate } from "@/lib/todayOneLine/deck";
import TodayClient from "./TodayClient";

/**
 * 「오늘」이 실제로 매일 바뀌게 하려면 seed가 날짜에서 나와야 하는데, 그러면 이 페이지는
 * 빌드 시점에 고정될 수 없다. 10분 ISR — 자정 직후 최대 10분은 어제 세 장이 보일 수
 * 있지만, 매 요청 SSR 비용을 내는 것보다 낫다.
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: "오늘 한 마디 | 웨딩한방",
  description:
    "결혼 준비하다 마주치는 장면에서, 오늘 연인에게 꺼낼 한 마디를 직접 고릅니다."
    + " 로그인 없이 바로 볼 수 있고 점수·유형·궁합은 없습니다.",
  alternates: { canonical: "/today" },
  openGraph: {
    title: "오늘 한 마디 | 웨딩한방",
    description: "오늘 연인에게 꺼낼 한 마디를 직접 고릅니다.",
    url: "/today",
    type: "website",
  },
};

/**
 * 공유 링크에 쓸 origin. 배포 환경에서는 정식 도메인, 로컬에서는 개발 서버를 가리킨다.
 * `NEXT_PUBLIC_*`가 아닌 값을 클라이언트로 넘기지 않도록 여기서만 읽는다.
 */
function shareOrigin(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) return site.replace(/\/$/, "");
  return "https://hanbang.ai";
}

export default function TodayPage() {
  return <TodayClient shareOrigin={shareOrigin()} seed={seedFromDate(kstDateString(new Date()))} />;
}
