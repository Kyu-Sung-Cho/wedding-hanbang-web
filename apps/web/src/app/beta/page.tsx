import CustomerNav from "@/components/customer-landing/CustomerNav";
import Footer from "@/components/landing/Footer";
import { PUBLIC_COUPLE_SUPPORT_NOTICES } from "@/constants/coupleRoleSupport";

export const revalidate = 60;

export const metadata = {
  title: "사전등록 · 웨딩한방",
  description: "웨딩한방 소식을 먼저 받아보세요. 계정은 지금 바로 만들 수 있고, 이 페이지는 사전등록입니다.",
};

// 이 페이지는 원래 "승인 후 참여"를 전제로 쓰여 있었다. 가입은 승인 관문 없이
// 열려 있으므로 그 전제가 거짓이 됐다 — 기다릴 이유가 없는 사람을 대기열에
// 세우고, 오지 않을 심사 회신을 기다리게 만든다. 사전등록으로 정정한다.
const BENEFITS = [
  "기능 변경과 정식 출시 소식을 이메일로 안내",
  "불편한 점과 필요한 기능을 제품팀에 전달",
  "지금 바로 계정을 만들어 쓸 수도 있어요 · 승인을 기다리지 않아도 됩니다",
  "추가 이용 방법·비용은 아직 미정 · 사전등록만으로 결제되지 않음",
];

const CONDITIONS = [
  "현재 결혼을 준비 중인 본인",
  ...PUBLIC_COUPLE_SUPPORT_NOTICES,
  "사용 중 발견한 불편이나 오류를 전달할 수 있는 분",
];

export default async function BetaPage() {
  return (
    <main className="min-h-screen bg-[var(--hb-primary)]">
      {/* 이 화면은 어두운 히어로다. 안 넘기면 로고·메뉴가 어두운 글자로 나와
          어두운 바탕에 묻힌다(2026-08-28 실측 1.13:1). */}
      <CustomerNav onDark />

      {/* Hero */}
      <section className="relative pt-[120px] md:pt-[160px] pb-[clamp(60px,8vw,100px)] px-[clamp(20px,5vw,60px)] overflow-hidden">
        <div
          className="absolute top-[20%] right-[-10%] w-[min(720px,85vw)] h-[min(720px,85vw)] bg-[radial-gradient(circle,rgba(212,175,160,0.18),transparent_65%)] rounded-full pointer-events-none"
          aria-hidden
        />
        <div
          className="absolute bottom-[-20%] left-[-8%] w-[min(520px,80vw)] h-[min(520px,80vw)] bg-[radial-gradient(circle,rgba(201,169,110,0.10),transparent_62%)] rounded-full pointer-events-none"
          aria-hidden
        />

        <div className="relative z-10 max-w-[1240px] mx-auto">
          <p className="text-[11px] tracking-[0.3em] text-rose-light mb-6 font-medium">
            베타 모집
          </p>
          <h1 className="font-serif-kr text-[clamp(34px,5.5vw,68px)] font-light text-white leading-[1.15] tracking-normal max-w-3xl">
            아모라의 운영 검증에
            <br />
            <em className="not-italic text-rose-light">함께해 주실 분</em>을 찾습니다.
          </h1>
          <p className="text-white/70 text-[15px] md:text-[17px] leading-[1.9] font-light max-w-xl mt-8">
            계정은 지금 바로 만들 수 있어요.
            <br />
            아직 시작할 때가 아니라면, 소식만 먼저 받아보세요.
          </p>
        </div>
      </section>

      {/* Body: 좌측 혜택·조건 + 우측 신청 카드 */}
      {/* 상단 내비의 "베타 신청"이 여기로 스크롤한다. 이 id 가 없으면 그 버튼은
          preventDefault 뒤 아무 일도 하지 않고 끝난다(CustomerNav.handleClick). */}
      <section id="cta" className="px-[clamp(20px,5vw,60px)] pb-[clamp(80px,10vw,140px)]">
        <div className="max-w-[1240px] mx-auto grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-12 lg:gap-20 items-start">
          {/* 좌측 */}
          <div className="space-y-14">
            {/* Benefits */}
            <div>
              <p className="text-[11px] tracking-[0.22em] text-rose-light/80 mb-7 font-medium">
                베타 참여 혜택
              </p>
              <ul className="space-y-6">
                {BENEFITS.map((benefit, idx) => (
                  <li
                    key={benefit}
                    className="flex items-baseline gap-6 text-[16px] md:text-[18px] text-white/90 font-light leading-[1.65]"
                  >
                    <span className="font-display text-rose-light/70 text-sm shrink-0 w-7">
                      0{idx + 1}
                    </span>
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Conditions */}
            <div className="pt-10 border-t border-white/10">
              <p className="text-[11px] tracking-[0.22em] text-rose-light/80 mb-6 font-medium">
                참여 조건
              </p>
              <ul className="space-y-4 text-[14px] md:text-[15px] text-white/70 font-light leading-[1.85]">
                {CONDITIONS.map((cond) => (
                  <li key={cond} className="flex items-baseline gap-5">
                    <span className="text-rose-light/40">·</span>
                    <span>{cond}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* 과정 */}
            <div className="pt-10 border-t border-white/10">
              <p className="text-[11px] tracking-[0.22em] text-rose-light/80 mb-6 font-medium">
                신청 이후 과정
              </p>
              <ul className="space-y-4 text-[14px] md:text-[15px] text-white/70 font-light leading-[1.85]">
                <li className="flex items-baseline gap-5">
                  <span className="font-display text-rose-light/60 text-sm w-7 shrink-0">01</span>
                  신청 접수 (이 페이지)
                </li>
                <li className="flex items-baseline gap-5">
                  <span className="font-display text-rose-light/60 text-sm w-7 shrink-0">02</span>
                  등록하신 주소로 접수 확인 메일 발송
                </li>
                <li className="flex items-baseline gap-5">
                  <span className="font-display text-rose-light/60 text-sm w-7 shrink-0">03</span>
                  기능 변경·정식 출시 소식이 생기면 같은 주소로 안내
                </li>
                <li className="flex items-baseline gap-5">
                  <span className="font-display text-rose-light/60 text-sm w-7 shrink-0">04</span>
                  기다리지 않고 지금 시작하려면 회원가입으로 바로 이용
                </li>
              </ul>
            </div>
          </div>

          {/* 우측: 바로 시작 */}
          <div className="lg:sticky lg:top-24">
            {/*
              사전등록 폼을 걷어냈다(2026-08-23 파운더 결정). 계정은 승인 없이 지금
              바로 만들 수 있어서 대기열에 세울 이유가 없었고, 폼은 **동의 절차 없이**
              이메일·이름·예식 예정일을 받고 있었다 — 처리방침 제1조에도 그 수집이
              없었다. 안내만 붙이는 대신 받는 것을 없앴다.
            */}
            <div className="rounded-[20px] border border-white/15 bg-white/[0.04] p-8">
              <h2 className="text-[22px] font-semibold text-white">지금 바로 시작할 수 있어요</h2>
              <p className="mt-3 text-[14px] leading-[1.8] text-white/70">
                승인을 기다리지 않아도 됩니다. 계정을 만들면 아모라와 바로 이야기할 수 있어요.
              </p>
              <a
                href="/login"
                className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-white px-7 text-[15px] font-semibold text-[var(--hb-text-strong)] transition-colors hover:bg-white/90"
              >
                계정 만들기
              </a>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
