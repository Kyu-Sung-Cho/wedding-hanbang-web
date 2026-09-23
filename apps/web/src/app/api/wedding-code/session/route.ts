import { handlePairSessionRequest } from "@/lib/weddingCode/pairSessionServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handlePairSessionRequest(request); }
