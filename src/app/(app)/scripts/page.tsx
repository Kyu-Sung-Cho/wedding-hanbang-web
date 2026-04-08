"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useInvitationStore } from "@/stores/invitationStore";
import type { ScriptType } from "@/types/invitation.types";
import {
  Mic, Heart, BookOpen, Users, Mail, MessageSquare,
  Plus, Star, Trash2, Copy, Check, ChevronDown, ChevronUp,
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
    <div className="max-w-[850px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[23px] font-semibold text-noir-800">AI 웨딩 대본</h1>
          <p className="text-[21px] text-taupe-500 mt-1">AI가 작성하는 완벽한 웨딩 대본</p>
        </div>
        <button
          onClick={() => setShowGenerator(true)}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-noir-800 text-white rounded-xl text-[21px] font-medium hover:bg-noir-900 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          새 대본 생성
        </button>
      </div>

      {/* 대본 생성 폼 */}
      {showGenerator && (
        <div className="bg-white rounded-2xl border border-black/[0.06] p-6 mb-6">
          <h2 className="text-[21px] font-medium text-noir-800 mb-4">대본 생성</h2>

          {/* 타입 선택 */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
            {SCRIPT_TYPES.map((type) => (
              <button
                key={type.key}
                onClick={() => { setSelectedType(type.key); setTitle(type.label); }}
                className={`flex items-center gap-2 p-3 rounded-xl text-left transition-colors ${
                  selectedType === type.key
                    ? "bg-noir-800 text-white"
                    : "bg-ivory-100 text-taupe-500 hover:bg-ivory-200"
                }`}
              >
                <type.icon className="w-4 h-4 flex-shrink-0" />
                <div>
                  <div className="text-[21px] font-medium">{type.label}</div>
                  <div className={`text-[21px] ${selectedType === type.key ? "text-white/60" : "text-taupe-400"}`}>
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
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[21px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 mb-3"
          />

          {/* 톤 */}
          <div className="flex gap-2 mb-3">
            {["격식있고 따뜻한", "유쾌하고 밝은", "감동적이고 서정적인", "간결하고 모던한"].map((t) => (
              <button
                key={t}
                onClick={() => setTone(t)}
                className={`px-3 py-1.5 rounded-lg text-[21px] font-medium transition-colors ${
                  tone === t ? "bg-rose-500 text-white" : "bg-ivory-100 text-taupe-500"
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
            className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[21px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 resize-none mb-4"
          />

          <div className="flex gap-2">
            <button
              onClick={() => setShowGenerator(false)}
              className="px-4 py-2.5 text-[21px] text-taupe-500 hover:text-noir-800"
            >
              취소
            </button>
            <button
              onClick={handleGenerate}
              disabled={!title.trim() || scriptStreaming}
              className="flex-1 py-2.5 bg-rose-500 text-white rounded-xl text-[21px] font-medium hover:bg-rose-600 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              AI 대본 생성
            </button>
          </div>
        </div>
      )}

      {/* 스트리밍 중 */}
      {scriptStreaming && (
        <div className="bg-white rounded-2xl border border-rose-500/20 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Loader2 className="w-4 h-4 text-rose-500 animate-spin" />
            <span className="text-[21px] font-medium text-rose-500">대본 생성 중...</span>
          </div>
          <div className="text-[21px] text-noir-800 leading-[1.8] whitespace-pre-wrap">
            {scriptStreamContent}
            <span className="inline-block w-0.5 h-4 bg-rose-500 animate-pulse ml-0.5" />
          </div>
        </div>
      )}

      {/* 로딩 */}
      {scriptsLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* 대본 목록 */}
      {!scriptsLoading && scripts.length === 0 && !scriptStreaming && (
        <div className="text-center py-20 bg-white rounded-2xl border border-black/[0.06]">
          <Sparkles className="w-12 h-12 text-taupe-400 mx-auto mb-4" />
          <h2 className="text-[21px] font-medium text-noir-800 mb-2">아직 대본이 없습니다</h2>
          <p className="text-[21px] text-taupe-500 mb-6">
            AI가 사회자 대본, 서약, 축사 등을 작성해드립니다.
          </p>
          <button
            onClick={() => setShowGenerator(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-rose-500 text-white rounded-xl text-[21px] font-medium"
          >
            <Plus className="w-4 h-4" />
            첫 대본 생성하기
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {scripts.map((script) => {
          const info = typeInfo(script.script_type as ScriptType);
          const isExpanded = expandedId === script.id;

          return (
            <div key={script.id} className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
              {/* 헤더 */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : script.id)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-ivory-50 transition-colors"
              >
                {info && <info.icon className="w-5 h-5 text-rose-500 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[21px] font-medium text-noir-800 truncate">{script.title}</span>
                    {script.is_favorite && <Star className="w-3.5 h-3.5 text-gold fill-gold" />}
                  </div>
                  <span className="text-[21px] text-taupe-400">
                    {info?.label} · {new Date(script.created_at).toLocaleDateString("ko-KR")}
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-taupe-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-taupe-400" />
                )}
              </button>

              {/* 콘텐츠 */}
              {isExpanded && (
                <div className="px-4 pb-4">
                  <div className="p-4 bg-ivory-50 rounded-xl mb-3 max-h-[400px] overflow-y-auto">
                    <pre className="text-[21px] text-noir-800 leading-[1.8] whitespace-pre-wrap font-sans">
                      {script.content}
                    </pre>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopy(script.content, script.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[21px] font-medium bg-ivory-100 text-taupe-500 hover:bg-ivory-200 transition-colors"
                    >
                      {copiedId === script.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedId === script.id ? "복사됨" : "복사"}
                    </button>
                    <button
                      onClick={() => toggleScriptFavorite(script.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[21px] font-medium transition-colors ${
                        script.is_favorite ? "bg-gold/10 text-gold" : "bg-ivory-100 text-taupe-500 hover:bg-ivory-200"
                      }`}
                    >
                      <Star className={`w-3.5 h-3.5 ${script.is_favorite ? "fill-gold" : ""}`} />
                      즐겨찾기
                    </button>
                    {deleteConfirm === script.id ? (
                      <div className="flex gap-1 ml-auto">
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="px-2 py-1 text-[21px] text-taupe-500"
                        >
                          취소
                        </button>
                        <button
                          onClick={() => handleDelete(script.id)}
                          className="px-2 py-1 bg-red-500 text-white text-[21px] rounded-lg"
                        >
                          삭제
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(script.id)}
                        className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[21px] text-taupe-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
