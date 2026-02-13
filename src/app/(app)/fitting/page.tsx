"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Upload, Sparkles, RefreshCw, Heart, Trash2,
  Camera, Video, X, Check, AlertCircle,
  ChevronLeft, Share2, Clock,
  Image as ImageIcon,
} from "lucide-react";
import { useFittingStore } from "@/stores/fittingStore";
import { useAuthStore } from "@/stores/authStore";
import { useJourneyStore } from "@/stores/journeyStore";
import { FITTING_COST_KRW } from "@/lib/services/fittingService";
import { FittingRequest } from "@/types/fitting";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

type Tab = "fitting" | "history";

export default function FittingPage() {
  const { user } = useAuthStore();
  const { coupleId } = useJourneyStore();
  const {
    step,
    setStep,
    selectedDressImageUrl,
    uploadedDressPreview,
    isStreaming,
    isLoading,
    error,
    currentRequestId,
    fittingHistory,
    selectDress,
    setUploadedDressPreview,
    uploadDressImage,
    startSession,
    endSession,
    saveFitting,
    deleteFitting,
    loadFittingHistory,
    reset,
    setError,
  } = useFittingStore();

  const [activeTab, setActiveTab] = useState<Tab>("fitting");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // 초기 데이터 로드
  useEffect(() => {
    if (coupleId) {
      loadFittingHistory(coupleId);
    }
  }, [coupleId, loadFittingHistory]);

  // 웹캠 시작/정리
  const startWebcam = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 1280, height: 720 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("[Fitting] 웹캠 접근 실패:", err);
      setError("카메라 접근에 실패했습니다. 브라우저 권한을 확인해주세요.");
    }
  }, [setError]);

  const stopWebcam = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  useEffect(() => {
    if (step === "streaming") {
      startWebcam();
    }
    return () => {
      stopWebcam();
    };
  }, [step, startWebcam, stopWebcam]);

  // 드레스 이미지 업로드 핸들러
  const handleDressUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setUploadedDressPreview(event.target?.result as string);
    };
    reader.readAsDataURL(file);

    const url = await uploadDressImage(file);
    if (url) {
      selectDress(url);
    }
  };

  // 피팅 세션 시작
  const handleStartFitting = async () => {
    if (!coupleId) return;
    await startSession(coupleId);
  };

  // 피팅 세션 종료
  const handleEndSession = () => {
    stopWebcam();
    endSession();
    if (coupleId) {
      loadFittingHistory(coupleId);
    }
  };

  // 영상 캡처
  const handleCapture = useCallback(() => {
    if (!streamRef.current) return;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      return;
    }

    chunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current, {
      mimeType: "video/webm;codecs=vp9",
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const { captureVideo } = useFittingStore.getState();
      await captureVideo(blob);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;

    // 5초 후 자동 중지
    setTimeout(() => {
      if (recorder.state === "recording") {
        recorder.stop();
      }
    }, 5000);
  }, []);

  // 날짜 포맷
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // 만료일 계산
  const getDaysUntilExpiry = (expiresAt: string | null) => {
    if (!expiresAt) return null;
    const diff = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat("ko-KR").format(cost);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* 헤더 */}
      <Card className="bg-gradient-to-r from-rose-500/5 to-gold/5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-glow">
            <Sparkles className="h-6 w-6 text-rose-500" />
          </div>
          <div>
            <h2 className="text-base font-medium text-noir-800">
              AI 실시간 드레스 피팅
            </h2>
            <p className="text-sm text-taupe-500">
              카메라 앞에 서면 AI가 실시간으로 드레스를 입혀드려요
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
          히스토리 ({fittingHistory.length})
        </button>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <Card className="border border-red-200 bg-red-50">
          <div className="flex items-center justify-between">
            <p className="text-sm text-red-600">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        </Card>
      )}

      {/* 피팅 탭 */}
      {activeTab === "fitting" && (
        <>
          {/* Step 1: 드레스 선택 */}
          {step === "select" && (
            <div className="space-y-6">
              <Card>
                <h3 className="mb-4 text-sm font-medium text-noir-800">
                  드레스 이미지를 선택하세요
                </h3>
                <p className="mb-6 text-xs text-taupe-500">
                  입어보고 싶은 드레스 사진을 업로드하면 AI가 실시간으로 합성해드려요
                </p>

                {uploadedDressPreview ? (
                  <div className="relative mx-auto w-fit">
                    <img
                      src={uploadedDressPreview}
                      alt="선택한 드레스"
                      className="max-h-80 rounded-xl object-cover"
                    />
                    <button
                      onClick={() => {
                        setUploadedDressPreview(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="absolute right-2 top-2 rounded-full bg-noir-900/60 p-1.5 text-white hover:bg-noir-900/80"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-platinum bg-ivory-50 py-16 transition-colors hover:border-rose-500/30 hover:bg-rose-glow/30"
                  >
                    <Upload className="mb-3 h-10 w-10 text-taupe-400" />
                    <span className="text-sm font-medium text-noir-800">
                      드레스 사진 업로드
                    </span>
                    <span className="mt-1 text-xs text-taupe-400">
                      업체에서 본 드레스 사진을 업로드하세요
                    </span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleDressUpload}
                  className="hidden"
                />
              </Card>

              {/* 안내 */}
              <Card className="bg-ivory-100">
                <h4 className="mb-2 text-sm font-medium text-noir-800">
                  실시간 피팅 안내
                </h4>
                <ul className="space-y-1.5 text-xs text-taupe-500">
                  <li className="flex items-start gap-2">
                    <Camera className="mt-0.5 h-3 w-3 shrink-0" />
                    전신이 보이도록 카메라를 배치해주세요
                  </li>
                  <li className="flex items-start gap-2">
                    <Video className="mt-0.5 h-3 w-3 shrink-0" />
                    마음에 드는 순간을 영상으로 캡처할 수 있어요
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    1세션당 {formatCost(FITTING_COST_KRW)}원이 청구됩니다
                  </li>
                </ul>
              </Card>
            </div>
          )}

          {/* Step 2: 확인 (비용 안내 + 시작) */}
          {step === "confirm" && (
            <Card className="space-y-6">
              <div className="text-center">
                <h3 className="text-lg font-medium text-noir-800">
                  실시간 드레스 피팅
                </h3>
                <p className="mt-2 text-sm text-taupe-500">
                  카메라 앞에 서면 AI가 실시간으로<br />
                  드레스를 입은 모습을 보여드려요
                </p>
              </div>

              {/* 드레스 미리보기 */}
              {selectedDressImageUrl && (
                <div className="flex flex-col items-center">
                  <img
                    src={selectedDressImageUrl}
                    alt="선택한 드레스"
                    className="h-56 w-40 rounded-2xl bg-ivory-100 object-cover"
                  />
                  <span className="mt-2 text-xs text-taupe-400">선택한 드레스</span>
                </div>
              )}

              {/* 비용 안내 */}
              <div className="flex items-center justify-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
                <AlertCircle className="h-4 w-4 text-rose-500" />
                <span className="text-sm font-medium text-rose-500">
                  {formatCost(FITTING_COST_KRW)}원이 청구됩니다 (1세션)
                </span>
              </div>

              {/* 팁 */}
              <div className="space-y-2 px-2">
                <p className="flex items-center gap-2 text-xs text-taupe-500">
                  <Camera className="h-3.5 w-3.5 text-taupe-400" />
                  전신이 보이도록 카메라를 배치해주세요
                </p>
                <p className="flex items-center gap-2 text-xs text-taupe-500">
                  <Video className="h-3.5 w-3.5 text-taupe-400" />
                  마음에 드는 순간을 영상으로 캡처할 수 있어요
                </p>
              </div>

              {/* 버튼 */}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setStep("select");
                    setUploadedDressPreview(null);
                  }}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  뒤로
                </Button>
                <Button
                  className="flex-[2]"
                  onClick={handleStartFitting}
                  isLoading={isLoading}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  실시간 피팅 시작 ({formatCost(FITTING_COST_KRW)}원)
                </Button>
              </div>
            </Card>
          )}

          {/* Step 3: 연결 중 */}
          {step === "connecting" && (
            <Card className="py-16 text-center">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-rose-glow">
                <Sparkles className="h-10 w-10 animate-pulse text-rose-500" />
              </div>
              <h3 className="text-lg font-medium text-noir-800">
                AI 피팅 세션을 준비하고 있어요...
              </h3>
              <p className="mt-2 text-sm text-taupe-500">
                카메라와 AI를 연결 중입니다
              </p>
            </Card>
          )}

          {/* Step 4: 실시간 스트리밍 */}
          {step === "streaming" && (
            <div className="space-y-4">
              <Card padding="none" className="overflow-hidden">
                <div className="relative aspect-[3/4] max-h-[600px] bg-noir-900">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                    style={{ transform: "scaleX(-1)" }}
                  />
                  <div className="absolute left-3 top-3 rounded-full bg-red-500 px-3 py-1 text-xs font-medium text-white">
                    LIVE
                  </div>
                  <div className="absolute right-3 top-3 rounded-full bg-noir-900/60 px-3 py-1 text-xs text-white">
                    AI 피팅 중
                  </div>
                </div>
              </Card>

              <div className="flex items-center justify-center gap-6">
                <button
                  onClick={handleCapture}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg transition-transform hover:scale-105 active:scale-95">
                    <Video className="h-6 w-6" />
                  </div>
                  <span className="text-xs font-medium text-rose-500">캡처</span>
                </button>

                <button
                  onClick={handleEndSession}
                  className="rounded-full bg-ivory-200 px-5 py-3 text-sm font-medium text-taupe-500 transition-colors hover:bg-ivory-100"
                >
                  피팅 종료
                </button>
              </div>
            </div>
          )}

          {/* Step 5: 결과 */}
          {step === "result" && (
            <FittingResultView
              requestId={currentRequestId}
              history={fittingHistory}
              onSave={(id) => saveFitting(id)}
              onRetry={() => reset()}
              formatDate={formatDate}
              getDaysUntilExpiry={getDaysUntilExpiry}
            />
          )}
        </>
      )}

      {/* 히스토리 탭 */}
      {activeTab === "history" && (
        <>
          {fittingHistory.length === 0 ? (
            <Card className="py-12 text-center">
              <ImageIcon className="mx-auto mb-3 h-10 w-10 text-taupe-400" />
              <p className="text-sm text-taupe-500">아직 피팅 기록이 없습니다</p>
              <p className="mt-1 text-xs text-taupe-400">
                AI 실시간 피팅을 시작해보세요!
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fittingHistory.map((item) => (
                <FittingHistoryCard
                  key={item.id}
                  item={item}
                  formatDate={formatDate}
                  getDaysUntilExpiry={getDaysUntilExpiry}
                  onSave={() => saveFitting(item.id)}
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

// 피팅 결과 뷰
function FittingResultView({
  requestId,
  history,
  onSave,
  onRetry,
  formatDate,
  getDaysUntilExpiry,
}: {
  requestId: string | null;
  history: FittingRequest[];
  onSave: (id: string) => void;
  onRetry: () => void;
  formatDate: (d: string) => string;
  getDaysUntilExpiry: (d: string | null) => number | null;
}) {
  const currentFitting = history.find((f) => f.id === requestId);
  const [isSaved, setIsSaved] = useState(currentFitting?.is_saved || false);

  const handleSave = () => {
    if (!requestId || isSaved) return;
    onSave(requestId);
    setIsSaved(true);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "웨딩한방 AI 드레스 피팅",
          text: "웨딩한방에서 실시간 드레스 피팅을 해봤어요!",
        });
      } catch {
        // 사용자가 공유를 취소한 경우
      }
    }
  };

  const daysLeft = getDaysUntilExpiry(currentFitting?.expires_at || null);

  return (
    <Card className="space-y-6 text-center">
      {/* 완료 아이콘 */}
      <div className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full bg-green-500 shadow-lg shadow-green-500/30">
        <Check className="h-8 w-8 text-white" />
      </div>

      <div>
        <h3 className="text-lg font-medium text-noir-800">피팅 완료!</h3>
        <p className="mt-1 text-sm text-taupe-500">
          실시간 드레스 피팅이 완료되었어요
        </p>
      </div>

      {/* 영상 정보 */}
      {currentFitting?.saved_video_url ? (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-rose-500/5 px-4 py-3">
          <Video className="h-5 w-5 text-rose-500" />
          <span className="text-sm font-medium text-taupe-500">
            캡처된 영상이 저장되었어요
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-ivory-100 px-4 py-3">
          <Video className="h-5 w-5 text-taupe-400" />
          <span className="text-sm text-taupe-400">
            캡처된 영상이 없어요
          </span>
        </div>
      )}

      {/* 만료 안내 */}
      <div className="rounded-xl bg-ivory-100 px-4 py-3">
        <p className="text-xs text-taupe-500">
          {isSaved
            ? "영구 저장됨"
            : daysLeft !== null
              ? `${daysLeft}일 후 자동 삭제돼요. 저장하면 영구 보관할 수 있어요.`
              : "7일 후 자동 삭제돼요. 저장하면 영구 보관할 수 있어요."}
        </p>
      </div>

      {/* 액션 버튼 */}
      <div className="flex justify-center gap-4">
        <button
          onClick={handleSave}
          className={`flex flex-col items-center gap-1 rounded-xl px-6 py-3 ${
            isSaved ? "bg-green-50" : "bg-ivory-100 hover:bg-ivory-200"
          }`}
        >
          {isSaved ? (
            <Check className="h-5 w-5 text-green-500" />
          ) : (
            <Heart className="h-5 w-5 text-rose-500" />
          )}
          <span className={`text-xs font-medium ${isSaved ? "text-green-500" : "text-taupe-500"}`}>
            {isSaved ? "저장됨" : "저장"}
          </span>
        </button>

        <button
          onClick={handleShare}
          className="flex flex-col items-center gap-1 rounded-xl bg-ivory-100 px-6 py-3 hover:bg-ivory-200"
        >
          <Share2 className="h-5 w-5 text-taupe-500" />
          <span className="text-xs font-medium text-taupe-500">공유</span>
        </button>
      </div>

      {/* 하단 버튼 */}
      <div className="space-y-3 pt-4">
        <Button variant="outline" fullWidth onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          다시 피팅하기
        </Button>
      </div>
    </Card>
  );
}

// 히스토리 카드
function FittingHistoryCard({
  item,
  formatDate,
  getDaysUntilExpiry,
  onSave,
  onDelete,
}: {
  item: FittingRequest;
  formatDate: (d: string) => string;
  getDaysUntilExpiry: (d: string | null) => number | null;
  onSave: () => void;
  onDelete: () => void;
}) {
  const daysLeft = getDaysUntilExpiry(item.expires_at);

  return (
    <Card padding="none" className="overflow-hidden">
      {/* 이미지 / 상태 */}
      <div className="relative aspect-[3/4] bg-ivory-100">
        {item.status === "completed" ? (
          <>
            {item.saved_video_url ? (
              <video
                src={item.saved_video_url}
                className="h-full w-full object-cover"
                controls
                playsInline
              />
            ) : item.dress_image_url ? (
              <img
                src={item.dress_image_url}
                alt="피팅 드레스"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Check className="h-8 w-8 text-green-500" />
              </div>
            )}
            <div className="absolute left-2 top-2">
              <span className="rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-medium text-white">
                완료
              </span>
            </div>
          </>
        ) : item.status === "streaming" ? (
          <div className="flex h-full flex-col items-center justify-center">
            <Sparkles className="h-8 w-8 animate-pulse text-rose-500" />
            <p className="mt-2 text-xs text-taupe-500">진행 중...</p>
          </div>
        ) : item.status === "failed" ? (
          <div className="flex h-full flex-col items-center justify-center">
            <X className="h-8 w-8 text-red-500" />
            <p className="mt-2 text-xs text-red-500">실패</p>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Clock className="h-8 w-8 text-taupe-400" />
          </div>
        )}

        {item.is_saved && (
          <div className="absolute right-2 top-2">
            <Heart className="h-5 w-5 fill-rose-500 text-rose-500" />
          </div>
        )}

        {!item.is_saved && daysLeft !== null && daysLeft <= 3 && (
          <div className="absolute bottom-2 left-2 right-2 rounded-lg bg-noir-900/70 px-2 py-1 text-center text-[10px] text-white">
            {daysLeft === 0 ? "오늘 삭제 예정" : `${daysLeft}일 후 삭제`}
          </div>
        )}
      </div>

      {/* 정보 */}
      <div className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-noir-800">
            {new Intl.NumberFormat("ko-KR").format(item.cost_krw)}원
          </span>
          <div className="flex gap-1">
            {!item.is_saved && item.status === "completed" && (
              <button
                onClick={onSave}
                className="rounded-lg p-1.5 hover:bg-ivory-100"
                title="영구 저장"
              >
                <Heart className="h-4 w-4 text-taupe-400 hover:text-rose-500" />
              </button>
            )}
            <button
              onClick={onDelete}
              className="rounded-lg p-1.5 hover:bg-red-50"
              title="삭제"
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
