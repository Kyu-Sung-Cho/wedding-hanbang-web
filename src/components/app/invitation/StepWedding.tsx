"use client";

import { useState } from "react";
import { useInvitationStore } from "@/stores/invitationStore";
import { Sparkles, Loader2 } from "lucide-react";

const HOURS = Array.from({ length: 13 }, (_, i) => i + 9); // 9~21시
const MINUTES = [0, 30];

export default function StepWedding() {
  const { current, updateCurrent } = useInvitationStore();
  const [aiLoading, setAiLoading] = useState(false);

  if (!current) return null;

  // 날짜/시간 분리
  const dateValue = current.wedding_date ? current.wedding_date.slice(0, 10) : "";
  const timeObj = current.wedding_date ? new Date(current.wedding_date) : null;
  const selectedHour = timeObj ? timeObj.getHours() : null;
  const selectedMinute = timeObj ? timeObj.getMinutes() : null;

  const handleDateChange = (date: string) => {
    if (!date) {
      updateCurrent({ wedding_date: null });
      return;
    }
    const h = selectedHour ?? 12;
    const m = selectedMinute ?? 0;
    const dt = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
    updateCurrent({ wedding_date: dt.toISOString() });
  };

  const handleTimeChange = (hour: number, minute: number) => {
    const d = dateValue || new Date().toISOString().slice(0, 10);
    const dt = new Date(`${d}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
    updateCurrent({ wedding_date: dt.toISOString() });
  };

  const generateGreeting = async () => {
    setAiLoading(true);
    try {
      const res = await fetch("/api/scripts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script_type: "invitation_text",
          tone: "warm",
          params: {
            groom_name: current.groom_name || "신랑",
            bride_name: current.bride_name || "신부",
            wedding_date: current.wedding_date,
            wedding_venue: current.wedding_venue,
          },
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let text = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                text += parsed.text;
                updateCurrent({ greeting_message: text });
              }
            } catch {
              // skip
            }
          }
        }
      }
    } catch {
      // 실패 시 무시
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-[25px] font-medium text-noir-800 mb-1">예식 정보</h2>
      <p className="text-[25px] text-taupe-500 mb-6">예식 일시와 장소를 입력하세요.</p>

      <div className="flex flex-col gap-4">
        {/* 제목 */}
        <div>
          <label className="block text-[38px] font-medium text-taupe-500 mb-1.5">청첩장 제목</label>
          <input
            type="text"
            value={current.title ?? ""}
            onChange={(e) => updateCurrent({ title: e.target.value })}
            placeholder="우리 결혼합니다"
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
          />
        </div>

        {/* 예식 날짜 */}
        <div>
          <label className="block text-[38px] font-medium text-taupe-500 mb-1.5">예식 날짜</label>
          <input
            type="date"
            value={dateValue}
            onChange={(e) => handleDateChange(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
          />
        </div>

        {/* 예식 시간 — 버튼 피커 */}
        <div>
          <label className="block text-[38px] font-medium text-taupe-500 mb-1.5">예식 시간</label>
          <div className="flex flex-wrap gap-1.5">
            {HOURS.map((h) =>
              MINUTES.map((m) => {
                const label = `${h === 12 ? "낮 12" : h < 12 ? `오전 ${h}` : `오후 ${h - 12}`}:${String(m).padStart(2, "0")}`;
                const isSelected = selectedHour === h && selectedMinute === m;
                return (
                  <button
                    key={`${h}-${m}`}
                    onClick={() => handleTimeChange(h, m)}
                    className={`px-3 py-1.5 rounded-lg text-[38px] font-medium transition-colors ${
                      isSelected
                        ? "bg-rose-500 text-white"
                        : "bg-ivory-100 text-taupe-500 hover:bg-ivory-200"
                    }`}
                  >
                    {label}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 예식장 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[38px] font-medium text-taupe-500 mb-1.5">예식장 이름</label>
            <input
              type="text"
              value={current.wedding_venue ?? ""}
              onChange={(e) => updateCurrent({ wedding_venue: e.target.value })}
              placeholder="더 플라자 호텔"
              className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
            />
          </div>
          <div>
            <label className="block text-[38px] font-medium text-taupe-500 mb-1.5">층/홀</label>
            <input
              type="text"
              value={current.wedding_hall ?? ""}
              onChange={(e) => updateCurrent({ wedding_hall: e.target.value })}
              placeholder="그랜드볼룸 3층"
              className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
            />
          </div>
        </div>

        {/* 주소 */}
        <div>
          <label className="block text-[38px] font-medium text-taupe-500 mb-1.5">주소</label>
          <input
            type="text"
            value={current.wedding_address ?? ""}
            onChange={(e) => updateCurrent({ wedding_address: e.target.value })}
            placeholder="서울특별시 중구 소공로 119"
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
          />
        </div>

        {/* 지도 URL */}
        <div>
          <label className="block text-[38px] font-medium text-taupe-500 mb-1.5">지도 링크 (선택)</label>
          <input
            type="url"
            value={current.wedding_map_url ?? ""}
            onChange={(e) => updateCurrent({ wedding_map_url: e.target.value })}
            placeholder="https://map.kakao.com/..."
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
          />
        </div>

        {/* 교통편 안내 */}
        <div>
          <label className="block text-[38px] font-medium text-taupe-500 mb-1.5">교통편 안내 (선택)</label>
          <textarea
            value={current.wedding_transport ?? ""}
            onChange={(e) => updateCurrent({ wedding_transport: e.target.value || null })}
            placeholder={"지하철: 2호선 삼성역 5번 출구 도보 5분\n버스: 143, 240번 삼성동 정류장\n자가용: 지하 주차장 이용 가능 (2시간 무료)"}
            rows={4}
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20 resize-none"
          />
          <p className="text-[23px] text-taupe-400 mt-1">줄바꿈으로 교통수단별 안내를 구분할 수 있습니다.</p>
        </div>

        {/* 인사말 제목 */}
        <div>
          <label className="block text-[38px] font-medium text-taupe-500 mb-1.5">인사말 제목</label>
          <input
            type="text"
            value={current.greeting_title ?? ""}
            onChange={(e) => updateCurrent({ greeting_title: e.target.value })}
            placeholder="소중한 분들을 초대합니다"
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
          />
        </div>

        {/* 인사말 본문 + AI 생성 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[38px] font-medium text-taupe-500">인사말 본문</label>
            <button
              onClick={generateGreeting}
              disabled={aiLoading}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gradient-to-r from-rose-500 to-rose-600 text-white text-[23px] font-medium hover:from-rose-600 hover:to-rose-700 disabled:opacity-50 transition-all"
            >
              {aiLoading ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> 생성 중...</>
              ) : (
                <><Sparkles className="w-3 h-3" /> AI 인사말 생성</>
              )}
            </button>
          </div>
          <textarea
            value={current.greeting_message ?? ""}
            onChange={(e) => updateCurrent({ greeting_message: e.target.value })}
            placeholder="서로 다른 두 사람이 만나 하나의 길을 걸어가려 합니다..."
            rows={5}
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20 resize-none"
          />
          <p className="text-[23px] text-taupe-400 mt-1">AI가 생성한 인사말을 자유롭게 수정할 수 있습니다.</p>
        </div>
      </div>
    </div>
  );
}
