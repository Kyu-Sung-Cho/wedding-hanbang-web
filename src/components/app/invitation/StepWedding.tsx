"use client";

import { useInvitationStore } from "@/stores/invitationStore";

export default function StepWedding() {
  const { current, updateCurrent } = useInvitationStore();
  if (!current) return null;

  return (
    <div>
      <h2 className="text-[16px] font-medium text-noir-800 mb-1">예식 정보</h2>
      <p className="text-[13px] text-taupe-500 mb-6">예식 일시와 장소를 입력하세요.</p>

      <div className="flex flex-col gap-4">
        {/* 제목 */}
        <div>
          <label className="block text-[12px] font-medium text-taupe-500 mb-1.5">청첩장 제목</label>
          <input
            type="text"
            value={current.title ?? ""}
            onChange={(e) => updateCurrent({ title: e.target.value })}
            placeholder="우리 결혼합니다"
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[14px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
          />
        </div>

        {/* 예식 날짜/시간 */}
        <div>
          <label className="block text-[12px] font-medium text-taupe-500 mb-1.5">예식 일시</label>
          <input
            type="datetime-local"
            value={current.wedding_date?.slice(0, 16) ?? ""}
            onChange={(e) => updateCurrent({ wedding_date: e.target.value ? new Date(e.target.value).toISOString() : null })}
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[14px] text-noir-800 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
          />
        </div>

        {/* 예식장 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-medium text-taupe-500 mb-1.5">예식장 이름</label>
            <input
              type="text"
              value={current.wedding_venue ?? ""}
              onChange={(e) => updateCurrent({ wedding_venue: e.target.value })}
              placeholder="더 플라자 호텔"
              className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[14px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-taupe-500 mb-1.5">층/홀</label>
            <input
              type="text"
              value={current.wedding_hall ?? ""}
              onChange={(e) => updateCurrent({ wedding_hall: e.target.value })}
              placeholder="그랜드볼룸 3층"
              className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[14px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
            />
          </div>
        </div>

        {/* 주소 */}
        <div>
          <label className="block text-[12px] font-medium text-taupe-500 mb-1.5">주소</label>
          <input
            type="text"
            value={current.wedding_address ?? ""}
            onChange={(e) => updateCurrent({ wedding_address: e.target.value })}
            placeholder="서울특별시 중구 소공로 119"
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[14px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
          />
        </div>

        {/* 지도 URL */}
        <div>
          <label className="block text-[12px] font-medium text-taupe-500 mb-1.5">지도 링크 (선택)</label>
          <input
            type="url"
            value={current.wedding_map_url ?? ""}
            onChange={(e) => updateCurrent({ wedding_map_url: e.target.value })}
            placeholder="https://map.kakao.com/..."
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[14px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
          />
        </div>

        {/* 인사말 */}
        <div>
          <label className="block text-[12px] font-medium text-taupe-500 mb-1.5">인사말 제목</label>
          <input
            type="text"
            value={current.greeting_title ?? ""}
            onChange={(e) => updateCurrent({ greeting_title: e.target.value })}
            placeholder="소중한 분들을 초대합니다"
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[14px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-taupe-500 mb-1.5">인사말 본문</label>
          <textarea
            value={current.greeting_message ?? ""}
            onChange={(e) => updateCurrent({ greeting_message: e.target.value })}
            placeholder="서로 다른 두 사람이 만나 하나의 길을 걸어가려 합니다..."
            rows={4}
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[14px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20 resize-none"
          />
        </div>
      </div>
    </div>
  );
}
