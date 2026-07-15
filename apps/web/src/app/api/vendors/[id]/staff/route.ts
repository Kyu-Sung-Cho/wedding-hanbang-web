import { vendorCatalogRetiredResponse } from "@/lib/publicBetaApi";

export async function GET() {
  return vendorCatalogRetiredResponse();
}
