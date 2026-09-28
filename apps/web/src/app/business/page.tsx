import type { Metadata } from "next";

import ProviderShell, { ProviderHeading } from "@/components/providers/ProviderShell";
import Button from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "함께하기 · 서비스·공간 등록 | 웨딩한방",
  description: "결혼 준비를 돕는 개인, 팀, 업체와 공간 운영자를 위한 웨딩한방 참여 안내입니다.",
  alternates: { canonical: "/business" },
};

export default function BusinessPage() {
  return (
    <ProviderShell active="business">
      <ProviderHeading eyebrow="웨딩한방과 함께하기" title="당신의 일과 공간을 소개해 주세요">
        <p>혼자 일하는 사진가도, 함께 움직이는 작은 팀도, 공간을 운영하는 분도 참여할 수 있어요. 서비스의 범위와 조건을 분명히 알리고, 결혼을 준비하는 사람들과 만나는 창구입니다.</p>
      </ProviderHeading>
      <div className="flex flex-wrap gap-3">
        <Button href="/business/register" variant="primary" size="lg">서비스·공간 등록</Button>
        <Button href="/business/inquiry" variant="secondary" size="lg">협업·비즈니스 문의</Button>
      </div>
      <p className="mt-3 text-xs leading-6 text-[var(--hb-text-muted)]">신청과 문의는 기존 웨딩한방 계정으로 진행합니다. 커플 연결이나 결혼 준비 정보 입력은 필요하지 않아요.</p>

      <section aria-labelledby="participation-fields" className="mt-10">
        <h2 id="participation-fields" className="text-lg font-semibold text-[var(--hb-text-strong)]">어떤 일을 하고 계신가요?</h2>
        <div className="mt-5 grid gap-6 sm:grid-cols-3">
          {[
            ["사진·영상", "본식 스냅, 가족식 촬영, 웨딩 영상. 실제 촬영자와 작업 범위를 소개해 주세요."],
            ["헤어·메이크업", "샵과 출장 서비스. 활동 지역, 준비 시간, 포함 항목과 추가 비용을 함께 안내해 주세요."],
            ["공간과 진행", "레스토랑, 갤러리, 꽃, 사회, 디렉팅 등. 공간의 이용 조건과 가능한 서비스를 알려주세요."],
          ].map(([title, description]) => (
            <article key={title} className="border-t border-[var(--hb-hairline)] pt-4">
              <h3 className="font-semibold text-[var(--hb-text-strong)]">{title}</h3>
              <p className="mt-2 text-sm leading-7">{description}</p>
            </article>
          ))}
        </div>
        <p className="mt-5 text-xs leading-6 text-[var(--hb-text-muted)]">모든 분야의 참여 문의를 받습니다. 검수 기준이 준비되지 않은 분야는 문의 접수만 가능하며 공개 일정은 미정입니다.</p>
      </section>

      <section aria-labelledby="participation-process" className="mt-10 border-t border-[var(--hb-hairline)] pt-7">
        <h2 id="participation-process" className="text-lg font-semibold text-[var(--hb-text-strong)]">신청부터 공개까지</h2>
        <ol className="mt-5 grid gap-6 sm:grid-cols-3">
          {[
            ["참여 신청", "활동명, 분야, 지역과 소개를 먼저 받습니다. 신청만으로 공개되지는 않아요."],
            ["등록·관리권 확인", "웨딩한방이 등록과 관리 권한을 승인하면 소개글과 작업 사진을 직접 게시하고 수정할 수 있어요."],
            ["서비스별 검수", "가격·포함 항목·추가 비용은 따로 검토합니다. 공개와 추천 자격도 서비스별로 구분해요."],
          ].map(([title, description], index) => (
            <li key={title}>
              <p className="text-xs tabular-nums text-[var(--hb-text-muted)]">0{index + 1}</p>
              <h3 className="mt-2 font-semibold text-[var(--hb-text-strong)]">{title}</h3>
              <p className="mt-2 text-sm leading-7">{description}</p>
            </li>
          ))}
        </ol>
      </section>
      <p className="mt-9 border-l-2 border-[var(--hb-action)] bg-[var(--hb-surface-hover)] px-4 py-4 text-sm leading-7">광고·협업 여부는 일반 추천의 후보 선정에 반영하지 않습니다. 활동 형태보다 확인된 서비스 조건과 커플이 원하는 준비 방식을 기준으로 연결합니다.</p>
    </ProviderShell>
  );
}
