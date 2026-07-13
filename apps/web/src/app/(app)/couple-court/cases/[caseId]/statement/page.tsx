import type { Metadata } from "next";
import { redirect } from "next/navigation";
import StatementForm from "@/components/couple-court/StatementForm";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "진술 작성 | 한방 커플재판소",
};

export default async function CoupleCourtStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ revision?: string | string[] }>;
}) {
  const { caseId } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/couple-court/cases/${caseId}/statement`)}`);
  }
  return <StatementForm caseId={caseId} revisionMode={query.revision === "1"} draftOwnerId={user.id} />;
}
