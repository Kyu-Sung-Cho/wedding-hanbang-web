import { submitInquiry } from "@/lib/providers/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return submitInquiry(request);
}
