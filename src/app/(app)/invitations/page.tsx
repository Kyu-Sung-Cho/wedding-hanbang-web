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
        <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1280px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold text-noir-800">모바일 청첩장</h1>
          <p className="text-[13px] text-taupe-500 mt-1">나만의 청첩장을 만들고 공유하세요</p>
        </div>
        <Link
          href="/invitations/templates"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-noir-800 text-white rounded-xl text-[13px] font-medium hover:bg-noir-900 transition-colors"
        >
          <Plus className="w-4 h-4" />
          새 청첩장 만들기
        </Link>
      </div>

      {/* 빈 상태 */}
      {invitations.length === 0 && (
        <div className="text-center py-20 bg-white rounded-2xl border border-black/[0.06]">
          <Mail className="w-12 h-12 text-taupe-400 mx-auto mb-4" />
          <h2 className="text-[16px] font-medium text-noir-800 mb-2">아직 청첩장이 없습니다</h2>
          <p className="text-[13px] text-taupe-500 mb-6">
            30가지 디자인 중 마음에 드는 템플릿을 선택해<br />나만의 모바일 청첩장을 만들어보세요.
          </p>
          <Link
            href="/invitations/templates"
            className="inline-flex items-center gap-2 px-6 py-3 bg-rose-500 text-white rounded-xl text-[14px] font-medium hover:bg-rose-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            청첩장 만들기
          </Link>
        </div>
      )}

      {/* 청첩장 목록 */}
      <div className="flex flex-col gap-4">
        {invitations.map((inv) => (
          <div
            key={inv.id}
            className="bg-white rounded-2xl border border-black/[0.06] p-5 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-start gap-4">
              {/* 썸네일 */}
              <div className="w-[80px] h-[110px] rounded-xl bg-ivory-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                {inv.template?.thumbnail_url ? (
                  <img src={inv.template.thumbnail_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Mail className="w-8 h-8 text-taupe-400" />
                )}
              </div>

              {/* 정보 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-[15px] font-medium text-noir-800 truncate">
                    {inv.title}
                  </h3>
                  {inv.is_published ? (
                    <span className="px-2 py-0.5 bg-green-50 text-green-600 text-[11px] rounded-full font-medium">
                      공개
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-taupe-400/10 text-taupe-500 text-[11px] rounded-full font-medium">
                      비공개
                    </span>
                  )}
                </div>

                <p className="text-[12px] text-taupe-500 mb-3">
                  {inv.template?.name} · {new Date(inv.created_at).toLocaleDateString("ko-KR")}
                </p>

                {/* 통계 미니 */}
                <div className="flex items-center gap-4 text-[12px] text-taupe-500">
                  <span className="flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5" />
                    {inv.view_count}회
                  </span>
                  {inv.groom_name && inv.bride_name && (
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
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
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-ivory-100 transition-colors text-taupe-500"
                    title="링크 복사"
                  >
                    {copiedSlug === inv.slug ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                )}
                {inv.is_published && (
                  <Link
                    href={`/invite/${inv.slug}`}
                    target="_blank"
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-ivory-100 transition-colors text-taupe-500"
                    title="미리보기"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Link>
                )}
                <Link
                  href={`/invitations/${inv.id}/stats`}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-ivory-100 transition-colors text-taupe-500"
                  title="통계"
                >
                  <BarChart3 className="w-4 h-4" />
                </Link>
                <Link
                  href={`/invitations/${inv.id}/edit`}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-ivory-100 transition-colors text-taupe-500"
                  title="편집"
                >
                  <Edit3 className="w-4 h-4" />
                </Link>
                <button
                  onClick={() => setDeleteConfirm(inv.id)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors text-taupe-400 hover:text-red-500"
                  title="삭제"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 삭제 확인 */}
            {deleteConfirm === inv.id && (
              <div className="mt-3 p-3 bg-red-50 rounded-xl border border-red-200 flex items-center justify-between">
                <span className="text-[13px] text-red-600">정말 삭제하시겠습니까?</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="px-3 py-1.5 text-[12px] text-taupe-500 hover:text-noir-800"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => handleDelete(inv.id)}
                    className="px-3 py-1.5 bg-red-500 text-white text-[12px] rounded-lg"
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
