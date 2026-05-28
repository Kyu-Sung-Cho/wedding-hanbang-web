"use client";

import { useState } from "react";
import { X, Copy, Download, Check } from "lucide-react";

interface GuestbookQRModalProps {
  url: string;
  onClose: () => void;
}

export default function GuestbookQRModal({ url, onClose }: GuestbookQRModalProps) {
  const [copied, setCopied] = useState(false);
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // noop
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-8 shadow-2xl relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-[#B5ADA3] hover:text-[#1A1A1F] transition"
          aria-label="닫기"
        >
          <X className="w-5 h-5" />
        </button>

        <h2
          className="font-serif text-2xl font-medium text-[#1A1A1F] mb-2 text-center"
          style={{ fontFamily: "'Noto Serif KR', serif" }}
        >
          방명록 QR 코드
        </h2>
        <p className="text-sm text-[#878680] text-center mb-6">
          하객들에게 공유하거나 청첩장에 인쇄하세요.
        </p>

        <div className="flex justify-center mb-5">
          <div className="p-4 bg-white border border-[#F0EFED] rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="QR Code" width={240} height={240} />
          </div>
        </div>

        <p className="text-xs text-[#B5ADA3] text-center break-all mb-5">{url}</p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-white border border-[#F0EFED] text-[#1A1A1F] rounded-xl py-2.5 px-4 text-sm hover:border-[#36534E] transition"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "복사됨" : "복사하기"}
          </button>
          <a
            href={qrSrc}
            download="guestbook-qr.png"
            target="_blank"
            rel="noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-2 bg-[#36534E] text-white rounded-xl py-2.5 px-4 text-sm font-medium hover:bg-[#2B423E] transition"
          >
            <Download className="w-4 h-4" />
            다운로드
          </a>
        </div>
      </div>
    </div>
  );
}
