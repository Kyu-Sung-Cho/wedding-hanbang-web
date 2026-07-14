import type { Metadata } from "next";
import PublicCourtDetail from "@/components/couple-court/PublicCourtDetail";
import { notFound } from "next/navigation";
import { isCoupleCourtPublicEnabled } from "@/app/api/couple-court/_shared";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "익명 판결 | 웨딩한방 공개재판",
};

export default async function CoupleCourtPublicDetailPage({ params }: { params: Promise<{ postId: string }> }) {
  if (!isCoupleCourtPublicEnabled()) notFound();
  const { postId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return <PublicCourtDetail postId={postId} viewerUserId={user?.id ?? null} />;
}
