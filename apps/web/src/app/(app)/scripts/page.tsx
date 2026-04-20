"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useInvitationStore } from "@/stores/invitationStore";
import type { ScriptType } from "@/types/invitation.types";
import {
  Mic, Heart, BookOpen, Users, Mail, MessageSquare,
  Plus, Trash2, Copy, Check, ChevronDown, ChevronUp,
  Sparkles, Loader2,
} from "lucide-react";

const SCRIPT_TYPES: { key: ScriptType; label: string; desc: string; icon: typeof Mic }[] = [
  { key: "mc_script", label: "사회자 대본", desc: "결혼식 전체 진행 대본", icon: Mic },
  { key: "vow", label: "결혼 서약", desc: "감동적인 결혼 서약서", icon: Heart },
  { key: "parents_letter", label: "부모님 감사편지", desc: "부모님께 드리는 편지", icon: BookOpen },
  { key: "friend_speech", label: "축사", desc: "친구/지인 축사 원고", icon: Users },
  { key: "invitation_text", label: "청첩장 인사말", desc: "모바일 청첩장용 인사말", icon: Mail },
  { key: "thank_you", label: "감사 인사", desc: "결혼식 후 감사 메시지", icon: MessageSquare },
];

export default function ScriptsPage() {
  const { couple, profile, journey } = useAuthStore();
  const {
    scripts, scriptsLoading, scriptStreaming, scriptStreamContent,
    loadScripts, generateScript, deleteScript, toggleScriptFavorite,
  } = useInvitationStore();
  const [showGenerator, setShowGenerator] = useState(false);
  const [selectedType, setSelectedType] = useState<ScriptType>("mc_script");
  const [title, setTitle] = useState("");
  const [tone, setTone] = useState("격식있고 따뜻한");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (couple?.id) loadScripts(couple.id);
  }, [couple?.id, loadScripts]);

  const handleGenerate = async () => {
    if (!couple?.id || !title.trim()) return;
    setShowGenerator(false);
    await generateScript({
      coupleId: couple.id,
      scriptType: selectedType,
      title: title.trim(),
      context: {
        groomName: profile?.role === "groom" ? profile.name : "",
        brideName: profile?.role === "bride" ? profile.name : "",
        weddingDate: journey?.wedding_date,
        venue: journey?.venue,
        tone,
        additionalInfo,
      },
    });
    setTitle("");
    setAdditionalInfo("");
  };

  const handleCopy = (content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (id: string) => {
    await deleteScript(id);
    setDeleteConfirm(null);
  };

  const typeInfo = (type: ScriptType) => SCRIPT_TYPES.find((t) => t.key === type);

  return (
    <div className="max-w-[800px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif-kr text-4xl font-light text-[#1A1A1F] tracking-tight">AI 웨딩 대본</h1>
          <p className="text-base text-[#B5ADA3] mt-2 font-light">AI가 작성하는 완벽한 웨딩 대본</p>
        </div>
        <button
          onClick={() => setShowGenerator(true)}
          className="inline-flex items-center gap-1.5 px-6 py-3 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-xl text-base font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)] transition-all"
        >
          <Sparkles className="w-5 h-5" />
          새 대본 생성
        </button>
      </div>

      {/* 대본 생성 폼 */}
      {showGenerator && (
        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 mb-6">
          <h2 className="font-serif-kr text-2xl font-light text-[#1A1A1F] mb-4">대본 생성</h2>

          {/* 타입 선택 */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
            {SCRIPT_TYPES.map((type) => (
              <button
                key={type.key}
                onClick={() => { setSelectedType(type.key); setTitle(type.label); }}
                className={`flex items-center gap-2 p-4 rounded-xl text-left transition-colors ${
                  selectedType === type.key
                    ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white"
                    : "bg-[#F6F3F2] text-[#504444] hover:bg-[#EDE6E4]"
                }`}
              >
                <type.icon className="w-5 h-5 flex-shrink-0" />
                <div>
                  <div className="text-base font-medium">{type.label}</div>
                  <div className={`text-sm ${selectedType === type.key ? "text-white/70" : "text-[#B5ADA3]"}`}>
                    {type.desc}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* 제목 */}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="대본 제목"
            className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:ring-2 focus:ring-[#795252]/30 mb-3"
          />

          {/* 톤 */}
          <div className="flex gap-2 mb-3 flex-wrap">
            {["격식있고 따뜻한", "유쾌하고 밝은", "감동적이고 서정적인", "간결하고 모던한"].map((t) => (
              <button
                key={t}
                onClick={() => setTone(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tone === t
                    ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white"
                    : "bg-[#F6F3F2] text-[#504444]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* 추가 정보 */}
          <textarea
            value={additionalInfo}
            onChange={(e) => setAdditionalInfo(e.target.value)}
            placeholder="추가 정보 (선택): 특별히 포함할 에피소드, 분위기 등"
            rows={3}
            className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:ring-2 focus:ring-[#795252]/30 resize-none mb-4"
          />

          <div className="flex gap-2">
            <button
              onClick={() => setShowGenerator(false)}
              className="px-5 py-3 text-base text-[#504444] hover:text-[#1A1A1F]"
            >
              취소
            </button>
            <button
              onClick={handleGenerate}
              disabled={!title.trim() || scriptStreaming}
              className="flex-1 py-3 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-xl text-base font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)] disabled:opacity-40 transition-all flex items-center justify-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              AI 대본 생성
            </button>
          </div>
        </div>
      )}

      {/* 스트리밍 중 */}
      {scriptStreaming && (
        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Loader2 className="w-5 h-5 text-[#795252] animate-spin" />
            <span className="text-base font-medium text-[#795252]">대본 생성 중...</span>
          </div>
          <div className="text-base text-[#1A1A1F] leading-[1.8] whitespace-pre-wrap">
            {scriptStreamContent}
            <span className="inline-block w-0.5 h-5 bg-[#795252] animate-pulse ml-0.5" />
          </div>
        </div>
      )}

      {/* 로딩 */}
      {scriptsLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-[#795252] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* 대본 목록 */}
      {!scriptsLoading && scripts.length === 0 && !scriptStreaming && (
        <div className="text-center py-20 bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <Sparkles className="w-14 h-14 text-[#B5ADA3] mx-auto mb-4" />
          <h2 className="font-serif-kr text-2xl font-light text-[#1A1A1F] mb-2">아직 대본이 없습니다</h2>
          <p className="text-base text-[#504444] mb-6 font-light">
            AI가 사회자 대본, 서약, 축사 등을 작성해드립니다.
          </p>
          <button
            onClick={() => setShowGenerator(true)}
            className="inline-flex items-center gap-2 px-6 py-3.5 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-xl text-base font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)] transition-all"
          >
            <Plus className="w-5 h-5" />
            첫 대본 생성하기
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {scripts.map((script) => {
          const info = typeInfo(script.script_type as ScriptType);
          const isExpanded = expandedId === script.id;

          return (
            <div key={script.id} className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
              {/* 헤더 */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : script.id)}
                className="w-full flex items-center gap-3 p-5 text-left hover:bg-[#F6F3F2]/40 transition-colors"
              >
                {info && <info.icon className="w-6 h-6 text-[#795252] flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-serif-kr text-xl font-light text-[#1A1A1F] truncate">{script.title}</span>
                    {script.is_favorite && (
                      <Heart className="w-4 h-4 text-[#795252] fill-[#795252]" />
                    )}
                  </div>
                  <span className="text-sm text-[#B5ADA3]">
                    {info?.label} · {new Date(script.created_at).toLocaleDateString("ko-KR")}
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-5 h-5 text-[#B5ADA3]" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-[#B5ADA3]" />
                )}
              </button>

              {/* 콘텐츠 */}
              {isExpanded && (
                <div className="px-5 pb-5">
                  <div className="p-5 bg-[#F6F3F2] rounded-xl mb-3 max-h-[400px] overflow-y-auto">
                    <pre className="text-base text-[#1A1A1F] leading-[1.8] whitespace-pre-wrap font-sans">
                      {script.content}
                    </pre>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopy(script.content, script.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-[#F6F3F2] text-[#504444] hover:text-[#795252] transition-colors"
                    >
                      {copiedId === script.id ? <Check className="w-4 h-4 text-[#795252]" /> : <Copy className="w-4 h-4" />}
                      {copiedId === script.id ? "복사됨" : "복사"}
                    </button>
                    <button
                      onClick={() => toggleScriptFavorite(script.id)}
                      className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        script.is_favorite
                          ? "bg-[#795252]/10 text-[#795252]"
                          : "bg-[#F6F3F2] text-[#504444] hover:text-[#795252]"
                      }`}
                    >
                      <Heart className={`w-4 h-4 ${script.is_favorite ? "fill-[#795252]" : ""}`} />
                      즐겨찾기
                    </button>
                    {deleteConfirm === script.id ? (
                      <div className="flex gap-1 ml-auto">
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="px-3 py-1.5 text-sm text-[#504444]"
                        >
                          취소
                        </button>
                        <button
                          onClick={() => handleDelete(script.id)}
                          className="px-3 py-1.5 bg-red-500 text-white text-sm rounded-lg"
                        >
                          삭제
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(script.id)}
                        className="ml-auto inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm text-[#B5ADA3] hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
