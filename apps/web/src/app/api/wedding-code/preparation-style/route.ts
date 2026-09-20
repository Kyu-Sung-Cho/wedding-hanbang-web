import { handlePreparationStyleRequest } from "@/lib/weddingCode/preparationStyleApi";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const GET = (request: Request) => handlePreparationStyleRequest(request, "read");
export const PUT = (request: Request) => handlePreparationStyleRequest(request, "save");
export const DELETE = (request: Request) => handlePreparationStyleRequest(request, "clear");
