import { cohortRoomsRetiredResponse } from "@/lib/publicBetaApi";

export async function GET() {
  return cohortRoomsRetiredResponse();
}
