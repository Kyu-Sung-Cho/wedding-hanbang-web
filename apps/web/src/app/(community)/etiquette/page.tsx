// 서버 컴포넌트 — 검색엔진이 예절 가이드 전문을 읽을 수 있도록 SEO 콘텐츠를 정적 렌더한 뒤
// 인터랙티브 위키 UI(클라이언트)를 함께 렌더. metadata는 layout.tsx가 제공.
import EtiquetteClient from "@/components/app/etiquette/EtiquetteClient";
import EtiquetteSeoContent from "@/components/app/etiquette/EtiquetteSeoContent";

export default function EtiquettePage() {
  return (
    <>
      <EtiquetteClient />
      <div className="px-4 pb-12 sm:px-6">
        <EtiquetteSeoContent />
      </div>
    </>
  );
}
