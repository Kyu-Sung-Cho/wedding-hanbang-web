import { redirect } from "next/navigation";
import { weddingPath } from "@/lib/weddingPaths";

export default function DashboardPage() {
  redirect(weddingPath("/lounge"));
}
