import { redirect } from "next/navigation";

// 유입 query를 요청별로 보존하는 공개 루트 폴백이다.
export const dynamic = "force-dynamic";

export const metadata = {
  // 이 폴백과 실제 착지 랜딩의 제목이 갈리면 유입 경로마다 다른 제목이 보인다.
  // `src/app/landing/page.tsx`의 title과 **글자까지 같아야** 한다.
  // `components/community/__tests__/landingFunnelInstrumentation.test.ts`(정본)와
  // `app/landing/__tests__/landingTitleParity.test.ts`가 함께 검사한다.
  title: "웨딩한방 | 결혼 준비 동반자, 아모라",
  // 검색 결과의 금액·조건 확정이나 외부 예약을 약속하지 않고 실제 준비 기능을 설명한다.
  description:
    "결혼 준비, 뭐부터 할까요? 아모라와 고민을 정리하고, 직접 확인한 예산·할 일·일정을 파트너와 함께 관리하세요. "
    + "견적 질문 만들기와 웨딩코드는 가입 없이 시작할 수 있어요.",
};

/**
 * 2026-09-08: 도메인 루트는 로그인 여부와 관계없이 랜딩으로 보낸다.
 * 실제 307은 미들웨어가 먼저 반환하며 이 폴백도 같은 목적지를 유지한다.
 * 로그인 복귀·커플 초대·앱 내부 이동은 각 명시적 경로의 인증 관문을 따른다.
 */
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

  const destination = "/landing";
  // UTM 같은 유입 표식은 목적지까지 들고 간다 — 루트에서 끊기면 어디서 왔는지 사라진다.
  const query = params.toString();
  redirect(query ? `${destination}?${query}` : destination);
}
