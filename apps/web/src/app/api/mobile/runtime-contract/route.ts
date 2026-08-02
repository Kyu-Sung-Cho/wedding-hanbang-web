import { buildMobileWebRuntimeContract } from "@hanbang/shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const contract = buildMobileWebRuntimeContract(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );

  if (!contract) {
    return Response.json(
      { error: "모바일 연결 설정을 확인하지 못했습니다." },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return Response.json(contract, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}
