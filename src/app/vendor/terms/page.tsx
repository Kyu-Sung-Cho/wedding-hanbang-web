"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function VendorTermsPage() {
  return (
    <div className="min-h-screen bg-ivory-50">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-black/[0.04]">
        <div className="max-w-[850px] mx-auto px-6 h-16 flex items-center">
          <Link href="/vendor/register" className="flex items-center gap-2 text-[21px] text-taupe-500 hover:text-rose-500 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            업체 등록으로
          </Link>
        </div>
      </nav>

      <div className="max-w-[850px] mx-auto px-6 py-16 max-md:px-5 max-md:py-10">
        <h1 className="font-serif-kr text-[38px] font-light text-noir-800 mb-2">파트너 이용약관</h1>
        <p className="text-[21px] text-taupe-400 mb-10">최종 수정일: 2026년 3월 1일</p>

        <div className="prose prose-sm max-w-none text-[21px] text-charcoal leading-[1.9] font-light space-y-8">
          <section>
            <h2 className="font-serif-kr text-[21px] font-medium text-noir-800 mb-3">제1조 (목적)</h2>
            <p>본 약관은 주식회사 웨딩한방(이하 &quot;회사&quot;)이 운영하는 웨딩한방 플랫폼(이하 &quot;플랫폼&quot;)에서 제공하는 파트너 서비스(이하 &quot;서비스&quot;)의 이용과 관련하여, 회사와 파트너 업체(이하 &quot;파트너&quot;) 간의 권리·의무 및 기타 필요한 사항을 규정함을 목적으로 합니다.</p>
          </section>

          <section>
            <h2 className="font-serif-kr text-[21px] font-medium text-noir-800 mb-3">제2조 (정의)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>&quot;플랫폼&quot;이란 회사가 운영하는 웹사이트(hanbang.ai) 및 모바일 애플리케이션을 의미합니다.</li>
              <li>&quot;파트너&quot;란 본 약관에 동의하고 회사와 파트너 계약을 체결한 웨딩 관련 업체를 의미합니다.</li>
              <li>&quot;예약 수수료&quot;란 플랫폼을 통해 성사된 계약 건에 대해 파트너가 회사에 지급하는 수수료를 의미합니다.</li>
              <li>&quot;고객&quot;이란 플랫폼을 통해 웨딩 서비스를 탐색하고 이용하는 예비부부를 의미합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[21px] font-medium text-noir-800 mb-3">제3조 (파트너 등록)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>파트너 등록을 위해서는 사업자등록증 및 관련 서류를 제출하여야 합니다.</li>
              <li>회사는 제출된 서류를 검토한 후 파트너 등록을 승인 또는 거절할 수 있습니다.</li>
              <li>파트너는 등록 정보에 변동이 있을 경우 즉시 수정하여야 합니다.</li>
              <li>허위 정보를 등록한 경우, 회사는 파트너 자격을 즉시 해지할 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[21px] font-medium text-noir-800 mb-3">제4조 (수수료 정책)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>플랫폼을 통해 성사된 계약 건에 대해 예약 수수료가 발생합니다.</li>
              <li>수수료율은 서비스 안내 페이지에 명시된 요율을 적용합니다.</li>
              <li>수수료는 고객의 최종 결제 금액을 기준으로 산정합니다.</li>
              <li>회사는 수수료율을 변경할 수 있으며, 변경 시 최소 30일 전에 파트너에게 통지합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[21px] font-medium text-noir-800 mb-3">제5조 (정산)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>정산은 매월 1회, 전월 확정된 계약 건에 대해 진행합니다.</li>
              <li>정산금은 수수료를 공제한 후 파트너가 등록한 계좌로 입금됩니다.</li>
              <li>고객의 환불·취소가 발생한 경우, 해당 건의 수수료는 정산에서 차감됩니다.</li>
              <li>정산 관련 이의가 있는 경우 정산일로부터 7일 이내에 회사에 서면으로 통지하여야 합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[21px] font-medium text-noir-800 mb-3">제6조 (파트너의 의무)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>파트너는 플랫폼에 등록한 서비스를 성실히 제공하여야 합니다.</li>
              <li>파트너는 고객에게 정확한 가격 정보와 서비스 내용을 제공하여야 합니다.</li>
              <li>플랫폼을 통해 접수된 상담 요청에 대해 영업일 기준 2일 이내에 응답하여야 합니다.</li>
              <li>파트너는 관련 법규를 준수하며, 고객의 개인정보를 보호하여야 합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[21px] font-medium text-noir-800 mb-3">제7조 (계약 해지)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>파트너는 언제든지 서면 통지를 통해 파트너 계약을 해지할 수 있습니다.</li>
              <li>해지 시점에 이미 성사된 계약 건에 대한 수수료는 정상 정산됩니다.</li>
              <li>회사는 파트너가 본 약관을 위반한 경우 시정 요청 후 7일 이내에 시정되지 않으면 계약을 해지할 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[21px] font-medium text-noir-800 mb-3">제8조 (면책)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회사는 파트너와 고객 간의 개별 거래에 대해 직접적인 책임을 지지 않습니다.</li>
              <li>천재지변, 시스템 장애 등 불가항력으로 인한 서비스 중단에 대해 회사는 책임을 지지 않습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[21px] font-medium text-noir-800 mb-3">제9조 (분쟁 해결)</h2>
            <p>본 약관과 관련하여 분쟁이 발생한 경우, 회사의 본점 소재지를 관할하는 법원을 제1심 관할 법원으로 합니다.</p>
          </section>

          <section className="pt-4 border-t border-black/[0.06]">
            <p className="text-[21px] text-taupe-400">부칙: 본 약관은 2026년 3월 1일부터 시행합니다.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
