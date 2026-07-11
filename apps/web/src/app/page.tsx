import { redirect } from "next/navigation";

export const metadata = {
  title: "웨딩한방 커뮤니티 — 경험을 나누고 결혼 준비를 정리해요",
  description:
    "이용자가 공유한 후기와 견적 경험, 예산 팁을 한 곳에서 확인하는 웨딩한방 커뮤니티.",
};

// 메인 도메인은 웨딩한방 시작점(/wedding)으로 보낸다.
// 과거 /landing URL은 현재 베타 소개(/demo)로 호환 리다이렉트한다.
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const params = new URLSearchParams();

  Object.entries(resolvedSearchParams ?? {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined) params.append(key, item);
      });
    } else if (value !== undefined) {
      params.set(key, value);
    }
  });

  const query = params.toString();
  redirect(query ? `/wedding?${query}` : "/wedding");
}
