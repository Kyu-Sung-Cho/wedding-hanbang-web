import { saveOffering } from "@/lib/providers/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return saveOffering(request, id);
}
