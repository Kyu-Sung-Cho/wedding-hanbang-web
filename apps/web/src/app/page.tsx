import { redirect } from "next/navigation";

// 메인 페이지 = 커뮤니티. 마케팅용 랜딩은 /landing으로 보존.
export default function Home() {
  redirect("/community");
}
