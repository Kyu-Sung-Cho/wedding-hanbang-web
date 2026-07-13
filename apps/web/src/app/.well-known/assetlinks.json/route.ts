import { createAssetLinksResponse } from "@/lib/appAssociations";

export const dynamic = "force-dynamic";

export function GET() {
  return createAssetLinksResponse();
}
