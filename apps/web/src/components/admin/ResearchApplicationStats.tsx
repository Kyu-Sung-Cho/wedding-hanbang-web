import {
  summarizeResearchApplicationDailyCounts,
  type DailyResearchApplicationCount,
} from "@/lib/admin/researchApplicationStats";

interface ResearchApplicationStatsProps {
  totalCount: number;
  pendingVerificationCount: number;
  dailyCounts: DailyResearchApplicationCount[];
}

export default function ResearchApplicationStats({
  totalCount,
  pendingVerificationCount,
  dailyCounts,
}: ResearchApplicationStatsProps) {
  const { todayCount, sevenDayAverage } = summarizeResearchApplicationDailyCounts(dailyCounts);
  const chartDailyCounts = dailyCounts.slice(-14);
  const maxDailyCount = Math.max(...chartDailyCounts.map((day) => day.count), 1);

  return (
    <>
      <div className="grid grid-cols-4 gap-6 mb-10 max-xl:grid-cols-2 max-md:grid-cols-1">
        <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
          <p className="text-sm text-taupe-500 mb-2">선정 검토 가능</p>
          <p className="font-display text-4xl font-light text-noir-800">{totalCount}</p>
        </div>
        <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
          <p className="text-sm text-taupe-500 mb-2">이메일 확인 대기</p>
          <p className="font-display text-4xl font-light text-noir-800">
            {pendingVerificationCount}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
          <p className="text-sm text-taupe-500 mb-2">오늘 신청</p>
          <p
            className="font-display text-4xl font-light text-noir-800"
            data-testid="research-today-count"
          >
            {todayCount}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
          <p className="text-sm text-taupe-500 mb-2">최근 7일 평균</p>
          <p
            className="font-display text-4xl font-light text-noir-800"
            data-testid="research-seven-day-average"
          >
            {sevenDayAverage}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-8 border border-black/[0.04] mb-10">
        <h2 className="font-serif-kr text-lg font-normal mb-6">날짜별 신청 현황</h2>
        <div className="flex items-end gap-2 h-[200px]">
          {chartDailyCounts.map((day) => (
            <div key={day.date} className="flex-1 flex flex-col items-center gap-2">
              <span className="text-[11px] text-taupe-500 font-medium">{day.count}</span>
              <div
                className="w-full bg-gradient-to-t from-rose-500 to-rose-light rounded-t-md transition-all duration-500"
                style={{
                  height: `${(day.count / maxDailyCount) * 160}px`,
                  minHeight: day.count > 0 ? "4px" : "0",
                }}
              />
              <span className="text-[10px] text-taupe-400 -rotate-45 origin-top-left whitespace-nowrap">
                {day.date.slice(5)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
