"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { InvitationAccount } from "@/types/invitation.types";
import { Copy, Check, ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  accounts: InvitationAccount[];
  colors: string[];
}

export default function InviteAccount({ accounts, colors }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedSide, setExpandedSide] = useState<string | null>(null);

  const groomAccounts = accounts.filter((a) => a.side === "groom");
  const brideAccounts = accounts.filter((a) => a.side === "bride");

  const handleCopy = (account: InvitationAccount) => {
    navigator.clipboard.writeText(account.account_number);
    setCopiedId(account.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const renderGroup = (title: string, side: string, list: InvitationAccount[]) => {
    if (list.length === 0) return null;
    const isExpanded = expandedSide === side;

    return (
      <div className="mb-3">
        <button
          onClick={() => setExpandedSide(isExpanded ? null : side)}
          className="w-full flex items-center justify-between p-4 rounded-xl transition-colors"
          style={{ background: `${colors[0]}08` }}
        >
          <span className="text-[14px] font-medium">{title}</span>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 opacity-40" />
          ) : (
            <ChevronDown className="w-4 h-4 opacity-40" />
          )}
        </button>

        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-1 flex flex-col gap-1"
          >
            {list.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between p-3 rounded-xl bg-white border border-black/[0.04]">
                <div>
                  <p className="text-[12px] opacity-50 mb-0.5">{acc.label}</p>
                  <p className="text-[13px] font-medium">
                    {acc.bank} {acc.account_number}
                  </p>
                  <p className="text-[11px] opacity-40">{acc.holder}</p>
                </div>
                <button
                  onClick={() => handleCopy(acc)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors flex items-center gap-1"
                  style={{
                    borderColor: copiedId === acc.id ? "#22c55e" : `${colors[0]}40`,
                    color: copiedId === acc.id ? "#22c55e" : colors[0],
                  }}
                >
                  {copiedId === acc.id ? (
                    <><Check className="w-3 h-3" /> 복사됨</>
                  ) : (
                    <><Copy className="w-3 h-3" /> 복사</>
                  )}
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </div>
    );
  };

  return (
    <section className="py-12 px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      >
        <h3 className="text-center text-[11px] tracking-[0.2em] uppercase mb-6" style={{ color: colors[0] }}>
          축의금 계좌
        </h3>

        {renderGroup("신랑 측 계좌", "groom", groomAccounts)}
        {renderGroup("신부 측 계좌", "bride", brideAccounts)}
      </motion.div>
    </section>
  );
}
