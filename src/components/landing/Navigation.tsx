"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-[1000] bg-white transition-shadow duration-300 ${
        scrolled ? "shadow-[0_1px_3px_rgba(0,0,0,0.08)]" : ""
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* 로고 */}
        <Link href="/" className="text-xl font-bold tracking-tight text-gray-900">
          웨딩한방
        </Link>

        {/* 데스크톱 네비 */}
        <div className="hidden items-center gap-8 md:flex">
          <a href="#features" className="text-sm text-gray-600 transition-colors hover:text-gray-900">
            기능
          </a>
          <a href="#comparison" className="text-sm text-gray-600 transition-colors hover:text-gray-900">
            비교
          </a>
          <a href="#how" className="text-sm text-gray-600 transition-colors hover:text-gray-900">
            이용방법
          </a>
          <a href="#reviews" className="text-sm text-gray-600 transition-colors hover:text-gray-900">
            후기
          </a>
        </div>

        {/* 데스크톱 CTA */}
        <div className="hidden items-center gap-4 md:flex">
          <Link
            href="/login"
            className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
          >
            로그인
          </Link>
          <Link
            href="/login"
            className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800"
          >
            무료로 시작하기
          </Link>
        </div>

        {/* 모바일 햄버거 */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 md:hidden"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* 모바일 메뉴 */}
      {mobileOpen && (
        <div className="border-t border-gray-100 bg-white px-6 py-4 md:hidden">
          <div className="flex flex-col gap-3">
            <a
              href="#features"
              onClick={() => setMobileOpen(false)}
              className="py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              기능
            </a>
            <a
              href="#comparison"
              onClick={() => setMobileOpen(false)}
              className="py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              비교
            </a>
            <a
              href="#how"
              onClick={() => setMobileOpen(false)}
              className="py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              이용방법
            </a>
            <a
              href="#reviews"
              onClick={() => setMobileOpen(false)}
              className="py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              후기
            </a>
            <div className="mt-2 flex flex-col gap-2 border-t border-gray-100 pt-4">
              <Link
                href="/login"
                className="py-2 text-sm font-medium text-gray-600"
              >
                로그인
              </Link>
              <Link
                href="/login"
                className="rounded-lg bg-gray-900 px-5 py-2.5 text-center text-sm font-medium text-white"
              >
                무료로 시작하기
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
