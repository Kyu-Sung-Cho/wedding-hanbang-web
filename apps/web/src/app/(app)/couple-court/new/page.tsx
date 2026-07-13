import type { Metadata } from "next";
import { redirect } from "next/navigation";
import CaseCreationWizard from "@/components/couple-court/CaseCreationWizard";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "사건 접수 | 한방 커플재판소",
};

export default async function CoupleCourtNewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/couple-court/new")}`);
  return <CaseCreationWizard draftOwnerId={user.id} />;
}
