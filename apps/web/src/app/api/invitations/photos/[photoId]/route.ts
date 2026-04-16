import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ photoId: string }> }
) {
  const { photoId } = await params;
  const supabase = await createClientFromRequest(_request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { error } = await supabase
    .from("invitation_photos")
    .delete()
    .eq("id", photoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
