import { redirect } from "next/navigation";

export const metadata = {
  title: "웨딩한방 베타 둘러보기",
  description: "웨딩한방의 현재 제공 기능과 베타 이용 흐름을 확인하세요.",
};

// 과거 마케팅 URL은 현재 구현과 일치하는 단일 베타 소개 화면으로 통합한다.
export default function LegacyLandingRedirect() {
  redirect("/demo");
}
