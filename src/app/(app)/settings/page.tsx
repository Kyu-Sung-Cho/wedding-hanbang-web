"use client";

import { useState, useEffect } from "react";
import {
  User, Calendar, Heart, Bell, Trash2, LogOut,
  Copy, Users, ChevronRight, Shield, Check, Loader2, Link2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { useJourneyStore } from "@/stores/journeyStore";
import { useBudgetStore } from "@/stores/budgetStore";
import { useScheduleStore } from "@/stores/scheduleStore";
import { useChatStore } from "@/stores/chatStore";
import { createClient } from "@/lib/supabase/client";
import * as coupleService from "@/lib/services/coupleService";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";

export default function SettingsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const {
    weddingDate,
    role,
    coupleId,
    setWeddingDate,
    setRole,
  } = useJourneyStore();

  const [showDateModal, setShowDateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showCoupleModal, setShowCoupleModal] = useState(false);
  const [dateInput, setDateInput] = useState(
    weddingDate ? new Date(weddingDate).toISOString().split("T")[0] : ""
  );

  // 커플 연동 상태
  const [inviteCode, setInviteCode] = useState("");
  const [myInviteCode, setMyInviteCode] = useState<string | null>(null);
  const [partnerInfo, setPartnerInfo] = useState<{
    email: string | null;
    name: string | null;
    role: string | null;
  } | null>(null);
  const [isLinked, setIsLinked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [coupleLoading, setCoupleLoading] = useState(false);
  const [coupleError, setCoupleError] = useState<string | null>(null);
  const [joinSuccess, setJoinSuccess] = useState(false);

  // 커플 정보 로드
  useEffect(() => {
    if (user?.id) {
      loadCoupleInfo();
    }
  }, [user?.id]);

  const loadCoupleInfo = async () => {
    if (!user?.id) return;

    const { couple, myRole } = await coupleService.getMyCouple(user.id);
    if (couple) {
      setMyInviteCode(couple.invite_code);
      setIsLinked(!!(couple.bride_id && couple.groom_id));

      const partner = await coupleService.getPartnerInfo(user.id);
      if (partner) {
        setPartnerInfo(partner);
      }
    }
  };

  // 커플 생성 (초대 코드 생성)
  const handleCreateCouple = async () => {
    if (!user?.id || !role) return;
    setCoupleLoading(true);
    setCoupleError(null);

    const couple = await coupleService.createCouple(user.id, role);
    if (couple) {
      setMyInviteCode(couple.invite_code);
    } else {
      setCoupleError("커플 생성에 실패했습니다.");
    }
    setCoupleLoading(false);
  };

  // 초대 코드로 커플 참여
  const handleJoinCouple = async () => {
    if (!user?.id || !role || !inviteCode) return;
    setCoupleLoading(true);
    setCoupleError(null);

    const result = await coupleService.joinCouple(user.id, inviteCode, role);
    if (result.success) {
      setJoinSuccess(true);
      setIsLinked(true);
      await loadCoupleInfo();
      setTimeout(() => {
        setShowCoupleModal(false);
        setJoinSuccess(false);
      }, 2000);
    } else {
      setCoupleError(result.error || "연동에 실패했습니다.");
    }
    setCoupleLoading(false);
  };

  // 결혼식 날짜 변경
  const handleDateChange = () => {
    if (dateInput) {
      setWeddingDate(dateInput);
    }
    setShowDateModal(false);
  };

  // 역할 변경
  const handleRoleChange = (newRole: "bride" | "groom") => {
    setRole(newRole);
  };

  // 데이터 초기화
  const handleReset = async () => {
    useJourneyStore.getState().resetAll();
    useBudgetStore.getState().resetBudget();
    useScheduleStore.getState().clearAll();
    useChatStore.getState().clearChat();
    setShowResetModal(false);
  };

  // 로그아웃
  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
  };

  // 초대 코드 복사
  const handleCopyInviteCode = () => {
    if (!myInviteCode) return;
    navigator.clipboard.writeText(myInviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // D-day 계산
  const dday = weddingDate
    ? Math.ceil(
        (new Date(weddingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      )
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* 프로필 카드 */}
      <Card>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-gold text-xl text-white">
            {role === "bride" ? "👰" : role === "groom" ? "🤵" : "💍"}
          </div>
          <div className="flex-1">
            <p className="text-base font-medium text-noir-800">
              {user?.email || "사용자"}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded-full bg-rose-glow px-2.5 py-0.5 text-xs font-medium text-rose-500">
                {role === "bride" ? "신부" : role === "groom" ? "신랑" : "미설정"}
              </span>
              {dday !== null && (
                <span className="text-xs text-taupe-400">
                  {dday > 0 ? `D-${dday}` : dday === 0 ? "D-Day" : `D+${Math.abs(dday)}`}
                </span>
              )}
              {isLinked && (
                <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                  <Link2 className="h-3 w-3" />
                  커플 연동됨
                </span>
              )}
            </div>
          </div>
        </div>
        {/* 파트너 정보 */}
        {partnerInfo && (
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-ivory-50 p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-lg">
              {partnerInfo.role === "bride" ? "👰" : "🤵"}
            </div>
            <div>
              <p className="text-sm font-medium text-noir-800">
                {partnerInfo.name || partnerInfo.email || "파트너"}
              </p>
              <p className="text-xs text-taupe-400">
                {partnerInfo.role === "bride" ? "신부" : "신랑"}
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* 웨딩 정보 */}
      <Card padding="none">
        <div className="border-b border-platinum px-6 py-4">
          <h2 className="text-sm font-medium text-noir-800">웨딩 정보</h2>
        </div>

        {/* 결혼식 날짜 */}
        <button
          onClick={() => setShowDateModal(true)}
          className="flex w-full items-center justify-between px-6 py-4 transition-colors hover:bg-ivory-50"
        >
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-rose-500" />
            <div className="text-left">
              <p className="text-sm text-noir-800">결혼식 날짜</p>
              <p className="text-xs text-taupe-400">
                {weddingDate
                  ? new Date(weddingDate).toLocaleDateString("ko-KR", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })
                  : "설정되지 않음"}
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-taupe-400" />
        </button>

        {/* 역할 설정 */}
        <div className="flex items-center justify-between border-t border-platinum px-6 py-4">
          <div className="flex items-center gap-3">
            <Heart className="h-5 w-5 text-rose-500" />
            <p className="text-sm text-noir-800">역할</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleRoleChange("bride")}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                role === "bride"
                  ? "bg-rose-500 text-white"
                  : "bg-ivory-100 text-taupe-500 hover:bg-ivory-200"
              }`}
            >
              신부
            </button>
            <button
              onClick={() => handleRoleChange("groom")}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                role === "groom"
                  ? "bg-rose-500 text-white"
                  : "bg-ivory-100 text-taupe-500 hover:bg-ivory-200"
              }`}
            >
              신랑
            </button>
          </div>
        </div>
      </Card>

      {/* 커플 연동 */}
      <Card padding="none">
        <div className="border-b border-platinum px-6 py-4">
          <h2 className="text-sm font-medium text-noir-800">커플 연동</h2>
        </div>

        {isLinked ? (
          <div className="px-6 py-4">
            <div className="flex items-center gap-3 rounded-xl bg-green-50 p-4">
              <Check className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm font-medium text-green-800">커플 연동 완료</p>
                <p className="text-xs text-green-600">
                  {partnerInfo?.name || partnerInfo?.email || "파트너"}님과 연동되었습니다
                </p>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCoupleModal(true)}
            className="flex w-full items-center justify-between px-6 py-4 transition-colors hover:bg-ivory-50"
          >
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-blue-500" />
              <div className="text-left">
                <p className="text-sm text-noir-800">상대방 초대하기</p>
                <p className="text-xs text-taupe-400">
                  초대 코드를 공유하여 커플 연동
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-taupe-400" />
          </button>
        )}
      </Card>

      {/* 계정 관리 */}
      <Card padding="none">
        <div className="border-b border-platinum px-6 py-4">
          <h2 className="text-sm font-medium text-noir-800">계정</h2>
        </div>

        {/* 데이터 초기화 */}
        <button
          onClick={() => setShowResetModal(true)}
          className="flex w-full items-center justify-between px-6 py-4 transition-colors hover:bg-ivory-50"
        >
          <div className="flex items-center gap-3">
            <Trash2 className="h-5 w-5 text-red-500" />
            <p className="text-sm text-red-500">데이터 초기화</p>
          </div>
          <ChevronRight className="h-4 w-4 text-taupe-400" />
        </button>

        {/* 로그아웃 */}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 border-t border-platinum px-6 py-4 transition-colors hover:bg-ivory-50"
        >
          <LogOut className="h-5 w-5 text-taupe-500" />
          <p className="text-sm text-taupe-500">로그아웃</p>
        </button>
      </Card>

      {/* 앱 정보 */}
      <Card>
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-gold text-sm font-semibold text-white font-display">
            한
          </div>
          <p className="text-sm font-medium text-noir-800">웨딩한방</p>
          <p className="mt-0.5 text-xs text-taupe-400">v1.0.0</p>
          <p className="mt-2 text-xs text-taupe-400">
            © 2025 hanbang.ai. All rights reserved.
          </p>
        </div>
      </Card>

      {/* 날짜 설정 모달 */}
      <Modal
        isOpen={showDateModal}
        onClose={() => setShowDateModal(false)}
        title="결혼식 날짜 설정"
      >
        <div className="space-y-4">
          <Input
            label="결혼식 날짜"
            type="date"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowDateModal(false)}>
              취소
            </Button>
            <Button onClick={handleDateChange}>저장</Button>
          </div>
        </div>
      </Modal>

      {/* 초기화 확인 모달 */}
      <Modal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        title="데이터 초기화"
      >
        <div className="space-y-4">
          <p className="text-sm text-taupe-500">
            모든 데이터(일정, 예산, 채팅 기록 등)가 삭제됩니다.
            <br />이 작업은 되돌릴 수 없습니다.
          </p>
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => setShowResetModal(false)}
            >
              취소
            </Button>
            <Button variant="danger" onClick={handleReset}>
              초기화
            </Button>
          </div>
        </div>
      </Modal>

      {/* 커플 연동 모달 */}
      <Modal
        isOpen={showCoupleModal}
        onClose={() => {
          setShowCoupleModal(false);
          setCoupleError(null);
          setJoinSuccess(false);
        }}
        title="커플 연동"
      >
        <div className="space-y-6">
          {/* 성공 메시지 */}
          {joinSuccess && (
            <div className="flex items-center gap-3 rounded-xl bg-green-50 p-4">
              <Check className="h-5 w-5 text-green-500" />
              <p className="text-sm font-medium text-green-800">
                커플 연동이 완료되었습니다!
              </p>
            </div>
          )}

          {/* 에러 메시지 */}
          {coupleError && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
              {coupleError}
            </div>
          )}

          {!joinSuccess && (
            <>
              {/* 내 초대 코드 */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-noir-800">
                  내 초대 코드
                </h3>
                {myInviteCode ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 rounded-xl bg-ivory-100 px-4 py-3 text-center font-mono text-lg font-semibold tracking-wider text-noir-800">
                        {myInviteCode}
                      </div>
                      <Button variant="outline" onClick={handleCopyInviteCode}>
                        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                    {copied && (
                      <p className="mt-1 text-xs text-green-500">복사되었습니다!</p>
                    )}
                  </>
                ) : (
                  <Button
                    fullWidth
                    variant="outline"
                    onClick={handleCreateCouple}
                    isLoading={coupleLoading}
                    disabled={!role}
                  >
                    <Users className="mr-2 h-4 w-4" />
                    초대 코드 생성하기
                  </Button>
                )}
                {!role && (
                  <p className="mt-2 text-xs text-red-400">
                    역할(신부/신랑)을 먼저 설정해주세요
                  </p>
                )}
                <p className="mt-2 text-xs text-taupe-400">
                  이 코드를 상대방에게 공유하세요
                </p>
              </div>

              {/* 코드 입력 */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-noir-800">
                  상대방 코드 입력
                </h3>
                <div className="flex gap-2">
                  <Input
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    placeholder="초대 코드 입력"
                  />
                  <Button
                    onClick={handleJoinCouple}
                    disabled={!inviteCode || !role}
                    isLoading={coupleLoading}
                  >
                    연동
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
