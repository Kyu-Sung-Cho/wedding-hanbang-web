"use client";

interface AttachmentPrivacyNoticeProps {
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  showPartnerBoundary?: boolean;
  compact?: boolean;
}

export default function AttachmentPrivacyNotice({
  confirmed,
  onConfirmedChange,
  showPartnerBoundary = false,
  compact = false,
}: AttachmentPrivacyNoticeProps) {
  return (
    <div
      className={`rounded-xl border border-[#E8DDD3] bg-[#FFF9F4] text-[#665B54] ${
        compact
          ? "mx-3 mb-2 px-3 py-2 text-[0.625rem] leading-relaxed"
          : "mx-1 mb-2 px-3 py-2 text-[0.6875rem] leading-relaxed sm:mx-2 sm:text-xs"
      }`}
      aria-live="polite"
    >
      <p className="font-medium text-[#504444]">첨부 파일은 답변 생성을 위해 OpenAI로 전송됩니다.</p>
      <p className="mt-1">현재 첨부는 이미지와 PDF만 지원합니다.</p>
      <p className="mt-1">주민번호·계좌·연락처는 가리고 올려주세요. 불필요한 이름도 지워주세요.</p>
      <p>
        이미지 위치정보 등 메타데이터는 서버에서 제거합니다. PDF의 내용과 속성은 자동 제거되지 않습니다.
      </p>
      {showPartnerBoundary && <p>상대방에게 보내려면 먼저 첨부를 삭제해주세요.</p>}
      <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg bg-white/70 px-2 py-1.5 font-medium text-[#504444]">
        <input
          type="checkbox"
          required
          aria-required="true"
          checked={confirmed}
          onChange={(event) => onConfirmedChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#795252]"
        />
        <span>민감정보를 가렸고 OpenAI 전송 범위를 확인했습니다.</span>
      </label>
    </div>
  );
}
