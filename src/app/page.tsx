import Navigation from "@/components/landing/Navigation";
import Hero from "@/components/landing/Hero";
import BrandMarquee from "@/components/landing/BrandMarquee";
import PainPoints from "@/components/landing/PainPoints";
import FeatureSection from "@/components/landing/FeatureSection";
import Comparison from "@/components/landing/Comparison";
import Stats from "@/components/landing/Stats";
import HowItWorks from "@/components/landing/HowItWorks";
import Testimonials from "@/components/landing/Testimonials";
import CTA from "@/components/landing/CTA";
import Footer from "@/components/landing/Footer";

/* 기능 섹션 비주얼 컴포넌트들 */
function ChatMockup() {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
        <p className="text-xs font-medium text-gray-500">AI 웨딩 플래너</p>
      </div>
      <div className="space-y-3 p-4">
        <div className="ml-auto max-w-[70%] rounded-lg rounded-br-sm bg-gray-900 px-3 py-2 text-xs text-white">
          스튜디오 어떻게 골라야 해?
        </div>
        <div className="max-w-[80%] rounded-lg rounded-bl-sm bg-gray-100 px-3 py-2 text-xs leading-relaxed text-gray-700">
          D-120일 남으셨네요! 지금 시작하시면 딱 좋은 타이밍이에요. 스튜디오 선택 시 가장 중요한 4가지 포인트를 알려드릴게요.
        </div>
        <div className="ml-auto max-w-[70%] rounded-lg rounded-br-sm bg-gray-900 px-3 py-2 text-xs text-white">
          예산은 300만원 정도인데 가능할까?
        </div>
        <div className="max-w-[80%] rounded-lg rounded-bl-sm bg-gray-100 px-3 py-2 text-xs leading-relaxed text-gray-700">
          충분합니다! 300만원 예산이면 인기 스튜디오 3곳을 추천드릴 수 있어요.
        </div>
      </div>
    </div>
  );
}

function FittingMockup() {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
        <p className="text-xs font-medium text-gray-500">AI 가상 피팅</p>
      </div>
      <div className="p-4">
        <div className="mb-4 flex aspect-[4/3] items-center justify-center rounded-lg bg-gray-100">
          <div className="text-center">
            <div className="mx-auto mb-2 h-32 w-20 rounded-[40%_40%_50%_50%/30%_30%_45%_45%] bg-gradient-to-b from-gray-200 to-gray-300" />
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white">
              AI 피팅 중...
            </span>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {["A-라인", "머메이드", "볼가운", "엠파이어"].map((style) => (
            <div key={style} className="rounded-lg bg-gray-50 p-2 text-center text-[10px] text-gray-500">
              {style}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BudgetMockup() {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
        <p className="text-xs font-medium text-gray-500">예산 관리</p>
      </div>
      <div className="space-y-4 p-4">
        <div>
          <p className="mb-1 text-xs text-gray-500">총 예산</p>
          <p className="text-xl font-bold text-gray-900">₩10,000,000</p>
        </div>
        {[
          { label: "스튜디오", pct: 75, amount: "280만원" },
          { label: "드레스", pct: 45, amount: "200만원" },
          { label: "메이크업", pct: 60, amount: "80만원" },
          { label: "스냅/DVD", pct: 30, amount: "120만원" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            <span className="w-16 text-xs text-gray-500">{item.label}</span>
            <div className="flex-1 overflow-hidden rounded-full bg-gray-100">
              <div className="h-1.5 rounded-full bg-gray-900" style={{ width: `${item.pct}%` }} />
            </div>
            <span className="w-16 text-right text-xs font-medium text-gray-700">{item.amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScheduleMockup() {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
        <p className="text-xs font-medium text-gray-500">D-120 · 웨딩 타임라인</p>
      </div>
      <div className="relative space-y-0 p-4 pl-8">
        <div className="absolute top-6 bottom-6 left-6 w-px bg-gray-200" />
        {[
          { dday: "D-150", title: "스튜디오 계약 완료", done: true },
          { dday: "D-120", title: "드레스 투어 시작", done: true },
          { dday: "D-90", title: "메이크업 리허설", done: false },
          { dday: "D-60", title: "본식 최종 리허설", done: false },
        ].map((item) => (
          <div key={item.dday} className="relative flex items-start gap-3 py-3">
            <div
              className={`absolute -left-[10.5px] top-4 h-2.5 w-2.5 rounded-full border-2 ${
                item.done
                  ? "border-gray-900 bg-gray-900"
                  : "border-gray-300 bg-white"
              }`}
            />
            <div>
              <span className="text-[10px] font-medium text-gray-400">{item.dday}</span>
              <h5 className="text-sm font-medium text-gray-900">
                {item.title} {item.done && "✓"}
              </h5>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <Navigation />
      <Hero />
      <BrandMarquee />
      <PainPoints />

      {/* 기능 섹션 4개 (교차 레이아웃) */}
      <div id="features">
        <FeatureSection
          align="left"
          badge="AI 플래너"
          title="24시간 AI 웨딩 플래너"
          description="단순한 챗봇이 아닙니다. 당신의 결혼일, 예산, 선호도를 기억하고 실제 웨딩 플래너처럼 상황에 맞는 맞춤 조언을 제공합니다. 새벽 2시에 갑자기 든 고민도 바로 해결하세요."
        >
          <ChatMockup />
        </FeatureSection>

        <FeatureSection
          align="right"
          badge="AI 피팅"
          title="AI 가상 드레스 피팅"
          description="집에서 10분 만에 10벌의 드레스를 입어보세요. AI가 실시간으로 드레스를 합성해 보여드립니다. 마음에 드는 것만 직접 가서 확인하면 됩니다."
        >
          <FittingMockup />
        </FeatureSection>

        <FeatureSection
          align="left"
          badge="예산 관리"
          title="스마트 예산 관리"
          description="카테고리별 예산 배분, 실시간 지출 추적, AI가 숨겨진 추가 비용을 미리 경고해드립니다. 더 이상 예상치 못한 비용에 놀라지 마세요."
        >
          <BudgetMockup />
        </FeatureSection>

        <FeatureSection
          align="right"
          badge="일정 관리"
          title="AI 일정 관리 & D-day 가이드"
          description="결혼일 기준으로 해야 할 일을 자동으로 제안하고, 적절한 시점에 알림을 보내드립니다. 20개 카테고리, 127개 체크리스트 항목을 체계적으로 관리하세요."
        >
          <ScheduleMockup />
        </FeatureSection>
      </div>

      <Comparison />
      <Stats />
      <HowItWorks />
      <Testimonials />
      <CTA />
      <Footer />
    </>
  );
}
