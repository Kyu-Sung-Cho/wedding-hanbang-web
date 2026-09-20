import { handlePreparationStyleRequest } from "@/lib/weddingCode/preparationStyleApi";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const PUT = (request: Request) => handlePreparationStyleRequest(request, "share");
export const DELETE = (request: Request) => handlePreparationStyleRequest(request, "unshare");
