"use client";

import PostCountGate from "@/components/app/PostCountGate";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <PostCountGate
      featureName="아모라 상담"
      featureDescription="24시간 곁에 있는 AI 웨딩 플래너와 데이터 직접 수정·갈등 중재까지."
    >
      {children}
    </PostCountGate>
  );
}
