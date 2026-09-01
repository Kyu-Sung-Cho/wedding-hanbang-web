import { NextResponse } from "next/server";
import { log } from "@/utils/log";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInternalVendorRequest } from "@/lib/vendors/internalAuth";
import { loadVendorProfile } from "@/lib/vendors/vendorProfileData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const vendorIdSchema = z.uuid();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!verifyInternalVendorRequest(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const { id } = await params;
  const parsedId = vendorIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: "Invalid vendor id" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const client = createAdminClient();
    const profile = await loadVendorProfile(client, parsedId.data);
    if (!profile) {
      return NextResponse.json(
        { error: "Vendor profile not found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(profile, { headers: NO_STORE_HEADERS });
  } catch (err) {
    log.error("api/internal/vendors/[id]/profile", err);
    return NextResponse.json(
      { error: "Vendor profile unavailable" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
