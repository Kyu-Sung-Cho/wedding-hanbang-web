"use client";

import { Suspense } from "react";
import ChecklistContent from "@/components/app/checklist/ChecklistContent";

export default function ChecklistPage() {
  return (
    <Suspense fallback={null}>
      <ChecklistContent />
    </Suspense>
  );
}
