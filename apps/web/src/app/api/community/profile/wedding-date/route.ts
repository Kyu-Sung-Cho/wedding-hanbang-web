import { cohortRoomsRetiredResponse } from "@/lib/publicBetaApi";

export async function POST() {
  return cohortRoomsRetiredResponse();
}
