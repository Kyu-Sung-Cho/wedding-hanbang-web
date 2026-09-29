import { saveOffering } from "@/lib/providers/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ id: string; offeringId: string }> }) {
  const { id, offeringId } = await context.params;
  return saveOffering(request, id, offeringId);
}
