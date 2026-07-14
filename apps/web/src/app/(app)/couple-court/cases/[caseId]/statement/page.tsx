import type { Metadata } from "next";
import { redirect } from "next/navigation";
import StatementForm from "@/components/couple-court/StatementForm";
import { createClient } from "@/lib/supabase/server";
import { weddingPath } from "@/lib/weddingPaths";

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
  const revision = Array.isArray(query.revision) ? query.revision[0] : query.revision;
  const revisionMode = revision === "1";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const statementPath = `/couple-court/cases/${caseId}/statement${revisionMode ? "?revision=1" : ""}`;
    redirect(`/login?next=${encodeURIComponent(weddingPath(statementPath))}`);
  }
  return <StatementForm caseId={caseId} revisionMode={revisionMode} draftOwnerId={user.id} />;
}
