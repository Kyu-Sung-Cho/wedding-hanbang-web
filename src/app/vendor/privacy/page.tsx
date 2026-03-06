"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function VendorPrivacyPage() {
  return (
    <div className="min-h-screen bg-ivory-50">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-black/[0.04]">
        <div className="max-w-[800px] mx-auto px-6 h-16 flex items-center">
          <Link href="/vendor/register" className="flex items-center gap-2 text-[13px] text-taupe-500 hover:text-rose-500 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            업체 등록으로
          </Link>
        </div>
      </nav>

      <div className="max-w-[800px] mx-auto px-6 py-16 max-md:px-5 max-md:py-10">
        <h1 className="font-serif-kr text-[28px] font-light text-noir-800 mb-2">개인정보 처리방침</h1>
        <p className="text-[13px] text-taupe-400 mb-10">최종 수정일: 2026년 3월 1일</p>

        <div className="prose prose-sm max-w-none text-[14px] text-charcoal leading-[1.9] font-light space-y-8">
          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제1조 (개인정보의 수집 항목 및 수집 방법)</h2>
            <p>회사는 파트너 서비스 제공을 위해 다음과 같은 개인정보를 수집합니다.</p>
            <div className="mt-3 space-y-3">
              <div>
                <h3 className="text-[14px] font-medium text-noir-800 mb-1">필수 수집 항목</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>대표자 성명, 연락처(휴대전화번호), 이메일 주소</li>
                  <li>사업자등록번호, 상호명, 업종, 사업장 주소</li>
                  <li>정산을 위한 은행명, 계좌번호, 예금주명</li>
                </ul>
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-noir-800 mb-1">선택 수집 항목</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>업체 포트폴리오 이미지, 서비스 상세 설명</li>
                  <li>SNS 계정 정보(인스타그램, 블로그 등)</li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제2조 (개인정보의 수집 및 이용 목적)</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>파트너 등록 및 관리:</strong> 파트너 자격 확인, 본인 식별, 계약 관리</li>
              <li><strong>서비스 제공:</strong> 고객 매칭, 예약 관리, 상담 연결</li>
              <li><strong>정산:</strong> 수수료 정산, 세금계산서 발행</li>
              <li><strong>서비스 개선:</strong> 통계 분석, 서비스 품질 향상, 맞춤 프로모션</li>
              <li><strong>고지 및 안내:</strong> 약관 변경, 정책 안내, 마케팅 정보 전달</li>
            </ul>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제3조 (개인정보의 보유 및 이용 기간)</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>파트너 계약 기간 중:</strong> 수집된 개인정보는 파트너 계약 종료 시까지 보유·이용됩니다.</li>
              <li><strong>계약 종료 후:</strong> 관련 법령에 따른 보존 기간 동안 보관합니다.
                <ul className="list-disc pl-5 mt-1 space-y-1 text-[13px] text-taupe-500">
                  <li>계약 또는 청약철회 등에 관한 기록: 5년 (전자상거래법)</li>
                  <li>대금결제 및 재화 등의 공급에 관한 기록: 5년 (전자상거래법)</li>
                  <li>소비자 불만 또는 분쟁처리에 관한 기록: 3년 (전자상거래법)</li>
                  <li>세법에 따른 거래 기록: 5년 (국세기본법)</li>
                </ul>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제4조 (개인정보의 제3자 제공)</h2>
            <p>회사는 원칙적으로 파트너의 개인정보를 외부에 제공하지 않습니다. 다만, 다음의 경우에는 예외로 합니다.</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>파트너가 사전에 동의한 경우</li>
              <li>법령에 의하여 요구되는 경우</li>
              <li>서비스 제공에 필요한 최소한의 정보를 고객에게 제공하는 경우 (업체명, 연락처, 서비스 내용 등)</li>
            </ul>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제5조 (개인정보의 안전성 확보 조치)</h2>
            <p>회사는 개인정보의 안전성 확보를 위해 다음과 같은 조치를 취하고 있습니다.</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>개인정보 암호화 (전송 및 저장 시 SSL/TLS 적용)</li>
              <li>접근 권한 관리 및 제한</li>
              <li>개인정보 처리 시스템 접근 기록 보관</li>
              <li>보안 프로그램 설치 및 주기적 갱신</li>
            </ul>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제6조 (정보주체의 권리)</h2>
            <p>파트너는 언제든지 다음의 권리를 행사할 수 있습니다.</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>개인정보 열람 요청</li>
              <li>오류 등이 있을 경우 정정 요청</li>
              <li>삭제 요청</li>
              <li>처리 정지 요청</li>
            </ul>
            <p className="mt-2">위 권리 행사는 설정 페이지 또는 이메일(partner@hanbang.ai)을 통해 가능합니다.</p>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제7조 (개인정보 보호 책임자)</h2>
            <ul className="list-none space-y-1">
              <li>담당 부서: 파트너 서비스팀</li>
              <li>이메일: partner@hanbang.ai</li>
            </ul>
          </section>

          <section className="pt-4 border-t border-black/[0.06]">
            <p className="text-[13px] text-taupe-400">본 개인정보 처리방침은 2026년 3월 1일부터 시행합니다.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
