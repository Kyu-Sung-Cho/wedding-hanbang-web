"use client";

import { useState, useRef, useEffect } from "react";
import {
  Upload, Sparkles, RefreshCw, Heart, Trash2,
  Clock, ChevronDown, ChevronUp, Image as ImageIcon, Star,
} from "lucide-react";
import { useFittingStore } from "@/stores/fittingStore";
import { useAuthStore } from "@/stores/authStore";
import { useJourneyStore } from "@/stores/journeyStore";
import { DRESS_STYLES, FittingRequest } from "@/types/fitting";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

type Tab = "fitting" | "history";

export default function FittingPage() {
  const { user } = useAuthStore();
  const { coupleId } = useJourneyStore();
  const {
    step,
    selectedPhotoPreview,
    selectedDressStyle,
    currentRequest,
    history,
    usage,
    isLoading,
    error,
    setStep,
    setSelectedPhoto,
    setSelectedDressStyle,
    startFitting,
    loadHistory,
    loadUsage,
    toggleSave,
    deleteFitting,
    reset,
    getRemainingFree,
  } = useFittingStore();

  const [activeTab, setActiveTab] = useState<Tab>("fitting");
  const [showHistory, setShowHistory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 초기 데이터 로드
  useEffect(() => {
    if (user?.id && coupleId) {
      loadUsage(user.id, coupleId);
      loadHistory(coupleId);
    }
  }, [user?.id, coupleId, loadUsage, loadHistory]);

  // 컴포넌트 언마운트 시 폴링 정리
  useEffect(() => {
    return () => {
      useFittingStore.getState().stopPolling();
    };
  }, []);

  const remainingFree = getRemainingFree();

  // 이미지 업로드
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setSelectedPhoto(file, event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // AI 피팅 시작
  const handleStartFitting = async () => {
    if (!user?.id || !coupleId) return;
    await startFitting(user.id, coupleId);
    // 완료 후 히스토리 새로고침
    await loadHistory(coupleId);
    await loadUsage(user.id, coupleId);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getDressLabel = (styleId: string) => {
    return DRESS_STYLES.find((d) => d.id === styleId)?.label || styleId;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* 소개 */}
      <Card className="bg-gradient-to-r from-rose-500/5 to-gold/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-glow">
              <Sparkles className="h-6 w-6 text-rose-500" />
            </div>
            <div>
              <h2 className="text-base font-medium text-noir-800">
                AI 가상 드레스 피팅
              </h2>
              <p className="text-sm text-taupe-500">
                내 사진에 다양한 드레스를 입혀보세요
              </p>
            </div>
          </div>
          {/* 사용량 표시 */}
          <div className="text-right">
            <p className="text-xs text-taupe-400">이번 달 무료</p>
            <p className="text-sm font-medium text-noir-800">
              {remainingFree}
              <span className="text-taupe-400">/5회</span>
            </p>
          </div>
        </div>
      </Card>

      {/* 탭 */}
      <div className="flex gap-1 rounded-xl bg-ivory-200 p-1">
        <button
          onClick={() => setActiveTab("fitting")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            activeTab === "fitting"
              ? "bg-white text-noir-800 shadow-sm"
              : "text-taupe-500 hover:text-noir-800"
          }`}
        >
          피팅하기
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            activeTab === "history"
              ? "bg-white text-noir-800 shadow-sm"
              : "text-taupe-500 hover:text-noir-800"
          }`}
        >
          히스토리 ({history.length})
        </button>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <Card className="border border-red-200 bg-red-50">
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      )}

      {/* 피팅 탭 */}
      {activeTab === "fitting" && (
        <>
          {step === "upload" && (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* 사진 업로드 */}
              <Card>
                <h3 className="mb-4 text-sm font-medium text-noir-800">
                  1. 사진 업로드
                </h3>
                {selectedPhotoPreview ? (
                  <div className="relative">
                    <img
                      src={selectedPhotoPreview}
                      alt="업로드된 사진"
                      className="w-full rounded-xl object-cover"
                      style={{ maxHeight: 400 }}
                    />
                    <button
                      onClick={() => {
                        setSelectedPhoto(null, null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="absolute right-2 top-2 rounded-full bg-noir-900/60 p-1.5 text-white hover:bg-noir-900/80"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-platinum bg-ivory-50 py-16 transition-colors hover:border-rose-500/30 hover:bg-rose-glow/30"
                  >
                    <Upload className="mb-3 h-10 w-10 text-taupe-400" />
                    <span className="text-sm font-medium text-noir-800">
                      사진을 업로드하세요
                    </span>
                    <span className="mt-1 text-xs text-taupe-400">
                      전신 사진이 가장 좋은 결과를 줍니다
                    </span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </Card>

              {/* 드레스 스타일 선택 */}
              <Card>
                <h3 className="mb-4 text-sm font-medium text-noir-800">
                  2. 드레스 스타일 선택
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {DRESS_STYLES.map((dress) => (
                    <button
                      key={dress.id}
                      onClick={() => setSelectedDressStyle(dress.id)}
                      className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-all ${
                        selectedDressStyle === dress.id
                          ? "border-rose-500 bg-rose-glow shadow-sm"
                          : "border-platinum hover:border-rose-500/30 hover:bg-ivory-50"
                      }`}
                    >
                      <span className="text-2xl">{dress.emoji}</span>
                      <span className="text-sm font-medium text-noir-800">
                        {dress.label}
                      </span>
                      <span className="text-center text-[10px] text-taupe-400">
                        {dress.description}
                      </span>
                    </button>
                  ))}
                </div>

                <Button
                  className="mt-6"
                  fullWidth
                  disabled={!selectedPhotoPreview || !selectedDressStyle || remainingFree <= 0}
                  onClick={handleStartFitting}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {remainingFree <= 0 ? "이번 달 무료 횟수 소진" : "AI 피팅 시작"}
                </Button>

                {remainingFree <= 0 && (
                  <p className="mt-2 text-center text-xs text-taupe-400">
                    매월 1일에 무료 횟수가 초기화됩니다
                  </p>
                )}
              </Card>
            </div>
          )}

          {step === "processing" && (
            <Card className="py-16 text-center">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-rose-glow">
                <Sparkles className="h-10 w-10 animate-pulse text-rose-500" />
              </div>
              <h3 className="text-lg font-medium text-noir-800">
                AI가 드레스를 입혀보고 있어요
              </h3>
              <p className="mt-2 text-sm text-taupe-500">
                잠시만 기다려주세요... 보통 10~30초 정도 소요됩니다
              </p>
              <div className="mx-auto mt-6 h-2 w-48 overflow-hidden rounded-full bg-ivory-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-rose-500 to-gold"
                  style={{
                    animation: "progress 2s ease-in-out infinite",
                    width: "60%",
                  }}
                />
              </div>
              <style jsx>{`
                @keyframes progress {
                  0%, 100% { width: 30%; margin-left: 0; }
                  50% { width: 70%; margin-left: 15%; }
                }
              `}</style>
            </Card>
          )}

          {step === "result" && currentRequest && (
            <div className="space-y-6">
              <Card>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-base font-medium text-noir-800">
                    피팅 결과
                  </h3>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleSave(currentRequest.id)}
                    >
                      <Heart
                        className={`mr-1.5 h-3.5 w-3.5 ${
                          currentRequest.is_saved ? "fill-rose-500 text-rose-500" : ""
                        }`}
                      />
                      {currentRequest.is_saved ? "저장됨" : "저장"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={reset}>
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      다시 하기
                    </Button>
                  </div>
                </div>
                {currentRequest.result_url && (
                  <div className="overflow-hidden rounded-xl">
                    <img
                      src={currentRequest.result_url}
                      alt="피팅 결과"
                      className="w-full object-cover"
                      style={{ maxHeight: 600 }}
                    />
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-taupe-400">
                    스타일: {getDressLabel(currentRequest.dress_style)}
                  </span>
                  <span className="text-xs text-taupe-400">
                    {formatDate(currentRequest.created_at)}
                  </span>
                </div>
                <p className="mt-4 text-center text-xs text-taupe-400">
                  * AI 생성 이미지입니다. 실제 드레스와 차이가 있을 수 있습니다.
                </p>
              </Card>

              {/* 다른 스타일 추천 */}
              <Card>
                <h3 className="mb-4 text-sm font-medium text-noir-800">
                  다른 스타일도 시도해보세요
                </h3>
                <div className="flex flex-wrap gap-2">
                  {DRESS_STYLES.filter((d) => d.id !== selectedDressStyle).map(
                    (dress) => (
                      <button
                        key={dress.id}
                        onClick={() => {
                          setSelectedDressStyle(dress.id);
                          setStep("upload");
                        }}
                        className="flex items-center gap-2 rounded-full border border-platinum px-4 py-2 text-sm transition-colors hover:border-rose-500 hover:bg-rose-glow"
                      >
                        <span>{dress.emoji}</span>
                        <span className="text-noir-800">{dress.label}</span>
                      </button>
                    )
                  )}
                </div>
              </Card>
            </div>
          )}

          {/* 안내 */}
          {step === "upload" && (
            <Card className="bg-ivory-100">
              <h4 className="mb-2 text-sm font-medium text-noir-800">
                더 좋은 결과를 위한 팁
              </h4>
              <ul className="space-y-1.5 text-xs text-taupe-500">
                <li>- 전신이 나온 정면 사진을 사용하세요</li>
                <li>- 배경이 심플한 사진이 좋은 결과를 줍니다</li>
                <li>- 밝은 조명에서 촬영한 사진을 추천합니다</li>
                <li>- 헤어와 메이크업을 한 상태에서 더 자연스럽습니다</li>
              </ul>
            </Card>
          )}
        </>
      )}

      {/* 히스토리 탭 */}
      {activeTab === "history" && (
        <>
          {history.length === 0 ? (
            <Card className="py-12 text-center">
              <ImageIcon className="mx-auto mb-3 h-10 w-10 text-taupe-400" />
              <p className="text-sm text-taupe-500">아직 피팅 기록이 없습니다</p>
              <p className="mt-1 text-xs text-taupe-400">
                AI 피팅을 시작해보세요!
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {history.map((item) => (
                <FittingHistoryCard
                  key={item.id}
                  item={item}
                  getDressLabel={getDressLabel}
                  formatDate={formatDate}
                  onToggleSave={() => toggleSave(item.id)}
                  onDelete={() => deleteFitting(item.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// 히스토리 카드 컴포넌트
function FittingHistoryCard({
  item,
  getDressLabel,
  formatDate,
  onToggleSave,
  onDelete,
}: {
  item: FittingRequest;
  getDressLabel: (id: string) => string;
  formatDate: (date: string) => string;
  onToggleSave: () => void;
  onDelete: () => void;
}) {
  const [showActions, setShowActions] = useState(false);

  return (
    <Card padding="none" className="overflow-hidden">
      {/* 이미지 */}
      {item.result_url ? (
        <div className="relative aspect-[3/4] bg-ivory-100">
          <img
            src={item.result_url}
            alt="피팅 결과"
            className="h-full w-full object-cover"
          />
          {/* 상태 배지 */}
          <div className="absolute left-2 top-2">
            <span className="rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-medium text-white">
              완료
            </span>
          </div>
          {item.is_saved && (
            <div className="absolute right-2 top-2">
              <Heart className="h-5 w-5 fill-rose-500 text-rose-500" />
            </div>
          )}
        </div>
      ) : (
        <div className="flex aspect-[3/4] items-center justify-center bg-ivory-100">
          {item.status === "processing" ? (
            <div className="text-center">
              <Sparkles className="mx-auto h-8 w-8 animate-pulse text-rose-500" />
              <p className="mt-2 text-xs text-taupe-500">처리 중...</p>
            </div>
          ) : item.status === "failed" ? (
            <div className="text-center">
              <p className="text-sm text-red-500">실패</p>
              <p className="mt-1 text-xs text-taupe-400">다시 시도해주세요</p>
            </div>
          ) : (
            <Clock className="h-8 w-8 text-taupe-400" />
          )}
        </div>
      )}
      {/* 정보 */}
      <div className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-noir-800">
            {getDressLabel(item.dress_style)}
          </span>
          <div className="flex gap-1">
            <button
              onClick={onToggleSave}
              className="rounded-lg p-1.5 hover:bg-ivory-100"
            >
              <Heart
                className={`h-4 w-4 ${
                  item.is_saved ? "fill-rose-500 text-rose-500" : "text-taupe-400"
                }`}
              />
            </button>
            <button
              onClick={onDelete}
              className="rounded-lg p-1.5 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4 text-taupe-400 hover:text-red-500" />
            </button>
          </div>
        </div>
        <p className="mt-0.5 text-xs text-taupe-400">
          {formatDate(item.created_at)}
        </p>
      </div>
    </Card>
  );
}
