"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/authStore";
import { useInvitationStore } from "@/stores/invitationStore";
import {
  Plus,
  Mail,
  Eye,
  Users,
  ExternalLink,
  Trash2,
  Edit3,
  BarChart3,
  Copy,
  Check,
} from "lucide-react";

export default function InvitationsPage() {
  const { couple } = useAuthStore();
  const { invitations, invitationsLoading, loadInvitations, deleteInvitation } = useInvitationStore();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  useEffect(() => {
    if (couple?.id) loadInvitations(couple.id);
  }, [couple?.id, loadInvitations]);

  const handleCopyLink = (slug: string) => {
    const url = `${window.location.origin}/invite/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const handleDelete = async (id: string) => {
    await deleteInvitation(id);
    setDeleteConfirm(null);
  };

  if (invitationsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#795252] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[800px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif-kr text-4xl font-light text-[#1A1A1F] tracking-tight">모바일 청첩장</h1>
          <p className="text-base text-[#B5ADA3] mt-2 font-light">나만의 청첩장을 만들고 공유하세요</p>
        </div>
        <Link
          href="/invitations/templates"
          className="inline-flex items-center gap-2 px-6 py-3.5 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-xl text-base font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)] transition-all"
        >
          <Plus className="w-5 h-5" />
          새 청첩장 만들기
        </Link>
      </div>

      {/* 빈 상태 */}
      {invitations.length === 0 && (
        <div className="text-center py-20 bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <Mail className="w-14 h-14 text-[#B5ADA3] mx-auto mb-4" />
          <h2 className="font-serif-kr text-2xl font-light text-[#1A1A1F] mb-2">아직 청첩장이 없습니다</h2>
          <p className="text-base text-[#504444] mb-6 font-light">
            30가지 디자인 중 마음에 드는 템플릿을 선택해<br />나만의 모바일 청첩장을 만들어보세요.
          </p>
          <Link
            href="/invitations/templates"
            className="inline-flex items-center gap-2 px-6 py-3.5 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-xl text-base font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)] transition-all"
          >
            <Plus className="w-5 h-5" />
            청첩장 만들기
          </Link>
        </div>
      )}

      {/* 청첩장 목록 */}
      <div className="flex flex-col gap-4">
        {invitations.map((inv) => (
          <div
            key={inv.id}
            className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 hover:shadow-[0_12px_40px_rgb(0,0,0,0.06)] transition-shadow"
          >
            <div className="flex items-start gap-4">
              {/* 썸네일 */}
              <div className="w-[90px] h-[120px] rounded-xl bg-[#F6F3F2] flex items-center justify-center flex-shrink-0 overflow-hidden">
                {inv.template?.thumbnail_url ? (
                  <img src={inv.template.thumbnail_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Mail className="w-10 h-10 text-[#B5ADA3]" />
                )}
              </div>

              {/* 정보 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-serif-kr text-xl font-light text-[#1A1A1F] truncate">
                    {inv.title}
                  </h3>
                  {inv.is_published ? (
                    <span className="px-2.5 py-0.5 bg-[#795252]/10 text-[#795252] text-sm rounded-full font-medium">
                      공개
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 bg-[#F6F3F2] text-[#B5ADA3] text-sm rounded-full font-medium">
                      비공개
                    </span>
                  )}
                </div>

                <p className="text-sm text-[#B5ADA3] mb-3 font-light">
                  {inv.template?.name} · {new Date(inv.created_at).toLocaleDateString("ko-KR")}
                </p>

                {/* 통계 미니 */}
                <div className="flex items-center gap-4 text-base text-[#504444]">
                  <span className="flex items-center gap-1">
                    <Eye className="w-4 h-4" />
                    {inv.view_count}회
                  </span>
                  {inv.groom_name && inv.bride_name && (
                    <span className="flex items-center gap-1">
                      <Users className="w-4 h-4" />
                      {inv.groom_name} & {inv.bride_name}
                    </span>
                  )}
                </div>
              </div>

              {/* 액션 */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {inv.is_published && (
                  <button
                    onClick={() => handleCopyLink(inv.slug)}
                    className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[#F6F3F2] transition-colors text-[#504444] hover:text-[#795252]"
                    title="링크 복사"
                  >
                    {copiedSlug === inv.slug ? (
                      <Check className="w-5 h-5 text-[#795252]" />
                    ) : (
                      <Copy className="w-5 h-5" />
                    )}
                  </button>
                )}
                {inv.is_published && (
                  <Link
                    href={`/invite/${inv.slug}`}
                    target="_blank"
                    className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[#F6F3F2] transition-colors text-[#504444] hover:text-[#795252]"
                    title="미리보기"
                  >
                    <ExternalLink className="w-5 h-5" />
                  </Link>
                )}
                <Link
                  href={`/invitations/${inv.id}/stats`}
                  className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[#F6F3F2] transition-colors text-[#504444] hover:text-[#795252]"
                  title="통계"
                >
                  <BarChart3 className="w-5 h-5" />
                </Link>
                <Link
                  href={`/invitations/${inv.id}/edit`}
                  className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[#F6F3F2] transition-colors text-[#504444] hover:text-[#795252]"
                  title="편집"
                >
                  <Edit3 className="w-5 h-5" />
                </Link>
                <button
                  onClick={() => setDeleteConfirm(inv.id)}
                  className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors text-[#B5ADA3] hover:text-red-500"
                  title="삭제"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* 삭제 확인 */}
            {deleteConfirm === inv.id && (
              <div className="mt-3 p-4 bg-red-50 rounded-xl flex items-center justify-between">
                <span className="text-base text-red-600">정말 삭제하시겠습니까?</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="px-4 py-2 text-sm text-[#504444] hover:text-[#1A1A1F]"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => handleDelete(inv.id)}
                    className="px-4 py-2 bg-red-500 text-white text-sm rounded-lg"
                  >
                    삭제
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
