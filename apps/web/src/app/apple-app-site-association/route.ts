import { createAppleAppSiteAssociationResponse } from "@/lib/appAssociations";

export const dynamic = "force-dynamic";

export function GET() {
  return createAppleAppSiteAssociationResponse();
}
