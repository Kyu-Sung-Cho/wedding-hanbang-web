import { redirect } from "next/navigation";

export const metadata = {
  title: "웨딩한방 — 둘이 함께 쓰는 결혼 준비 AI 아모라",
  description:
    "두 사람이 커플 공동 채팅에서 결혼 준비 AI 아모라와 이야기하고, 확인한 변경만 "
    + "예산·할 일·일정에 반영합니다. 필요한 아모라 답변은 저장해 둘이 함께 다시 볼 수 있습니다.",
};

// 메인 도메인은 서비스를 설명하는 랜딩(/landing)으로 보낸다. 앱(커뮤니티 피드)은
// 랜딩 안의 링크로 들어간다 — 자세한 이유는 next.config.ts의 같은 리다이렉트 주석.
// 이 페이지는 엣지 리다이렉트가 걸리지 않는 환경을 위한 폴백이라 목적지를 맞춰 둔다.
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
  redirect(query ? `/landing?${query}` : "/landing");
}
