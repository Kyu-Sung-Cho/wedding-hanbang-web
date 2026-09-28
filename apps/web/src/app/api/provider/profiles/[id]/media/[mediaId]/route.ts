import { readProviderMedia, removeProviderMedia } from "@/lib/providers/mediaHandlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; mediaId: string }> };
export async function GET(request: Request, context: Context) {
  const { id, mediaId } = await context.params;
  return readProviderMedia(request, id, mediaId);
}
export async function DELETE(request: Request, context: Context) {
  const { id, mediaId } = await context.params;
  return removeProviderMedia(request, id, mediaId);
}
