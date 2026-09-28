import { getWorkspace } from "@/lib/providers/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return getWorkspace(request);
}
