import { notFound } from "next/navigation";
import { isCoupleCourtEnabled } from "@/app/api/couple-court/_shared";

export default function CoupleCourtLayout({ children }: { children: React.ReactNode }) {
  if (!isCoupleCourtEnabled()) notFound();
  return children;
}
