import type { Metadata } from "next";

import AmoraPersonalActions from "@/components/app/amora-personal/AmoraPersonalActions";

export const metadata: Metadata = { title: "나만 보는 할 일 | 웨딩한방" };

export default function AmoraPersonalPage() {
  return <AmoraPersonalActions />;
}
