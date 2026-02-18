"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Heart, Banknote, Shirt, UtensilsCrossed, Gift, Users, Camera, MapPin } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

interface GuideItem {
  q: string;
  a: string;
}

interface GuideCategory {
  icon: LucideIcon;
  title: string;
  color: string;
  items: GuideItem[];
}

const guides: GuideCategory[] = [
  {
    icon: Banknote,
    title: "축의금",
    color: "from-rose-500 to-gold",
    items: [
      {
        q: "축의금은 얼마가 적당할까요?",
        a: "일반적으로 친구 5~7만원, 직장 동료 5~10만원, 가까운 친척 10~30만원이 평균입니다. 식사 비용(인당 약 7~10만원)을 고려하면 좋습니다. 관계의 친밀도와 본인의 경제 상황에 맞게 결정하세요.",
      },
      {
        q: "축의금 봉투 작성법은?",
        a: "겉봉에는 '축 결혼' 또는 '축 화혼'을 쓰고, 안쪽에 이름을 적습니다. 신랉측/신부측을 명시하면 더 좋습니다. 새 지폐를 준비하는 것이 예의이며, 홀수 금액(3만, 5만, 7만)을 넣는 것이 전통입니다.",
      },
      {
        q: "화환 대신 축의금을 더 내도 될까요?",
        a: "네, 최근에는 화환 대신 축의금을 추가하는 경우가 많습니다. 다만 직장이나 단체에서 보내는 경우 화환이 관례인 경우도 있으니, 주변에 확인하는 것을 추천합니다.",
      },
    ],
  },
  {
    icon: Shirt,
    title: "복장",
    color: "from-gold to-[#DCC9A0]",
    items: [
      {
        q: "하객 복장은 어떻게 입어야 하나요?",
        a: "포멀한 정장 또는 세미 포멀이 기본입니다. 남성은 정장+넥타이, 여성은 원피스 또는 블라우스+스커트가 무난합니다. 흰색(신부 색상)과 검은색 전신(장례식 연상)은 피하는 것이 좋습니다.",
      },
      {
        q: "하객 복장에서 피해야 할 색상은?",
        a: "순백색은 신부의 색상이므로 피합니다. 전신 블랙도 자제하는 것이 좋지만, 포인트 색상을 더하면 괜찮습니다. 너무 화려하거나 노출이 심한 옷도 피하세요. 파스텔 톤이나 차분한 색상이 무난합니다.",
      },
    ],
  },
  {
    icon: UtensilsCrossed,
    title: "식사 예절",
    color: "from-[#2E7D5A] to-[#4CAF80]",
    items: [
      {
        q: "뷔페 식사 매너는?",
        a: "한 번에 적당량만 덜어오고, 여러 번 가는 것은 괜찮습니다. 음식을 남기지 않도록 주의하세요. 식사 중 너무 시끄럽게 대화하거나 오래 자리를 차지하지 않는 것이 좋습니다. 식사 후에는 깔끔하게 정리해주세요.",
      },
      {
        q: "식사만 하고 가도 되나요?",
        a: "가능하면 예식에 참석한 후 식사하는 것이 예의입니다. 부득이한 경우 축의금을 전달하고 식사하는 것은 괜찮지만, 시간이 된다면 예식 참석을 권합니다.",
      },
    ],
  },
  {
    icon: Gift,
    title: "답례품 & 선물",
    color: "from-rose-500 to-rose-600",
    items: [
      {
        q: "결혼 답례품은 뭐가 좋을까요?",
        a: "실용적인 것이 인기입니다. 고급 타올 세트, 디퓨저, 고급 차/커피, 한과 세트 등이 무난합니다. 하객 수에 맞춰 미리 준비하되, 여유분 10~15%를 더 준비하세요.",
      },
      {
        q: "집들이 선물로 좋은 것은?",
        a: "세제/섬유유연제 세트, 고급 타올, 와인, 관엽식물 등이 인기입니다. 칼이나 가위는 '관계를 끊는다'는 의미가 있어 피하는 것이 전통입니다.",
      },
    ],
  },
  {
    icon: Users,
    title: "양가 상견례",
    color: "from-noir-800 to-noir-soft",
    items: [
      {
        q: "상견례 장소는 어떻게 고르나요?",
        a: "조용하고 프라이빗한 룸이 있는 한정식 또는 고급 레스토랑이 좋습니다. 양가 중간 지점이 배려있는 선택입니다. 예약 시 \"상견례\"라고 말하면 적절한 자리를 안내받을 수 있습니다.",
      },
      {
        q: "상견례 복장과 준비물은?",
        a: "단정한 포멀 복장이 기본입니다. 첫 만남이니 과하지 않은 선물(과일, 건강식품 등)을 준비하면 좋습니다. 식사비는 보통 신랑측에서 부담하는 것이 관례이지만, 양가 합의에 따릅니다.",
      },
    ],
  },
  {
    icon: Camera,
    title: "촬영 예절",
    color: "from-gold to-rose-500",
    items: [
      {
        q: "예식 중 사진 촬영해도 되나요?",
        a: "공식 사진사가 있으므로 플래시 사용은 삼가세요. 입장/퇴장 시 통로에 나와서 찍지 않도록 합니다. 조용히 자리에서 촬영하는 것은 괜찮지만, 사진에 집중하느라 박수를 안 치거나 호응하지 않는 것은 피해주세요.",
      },
    ],
  },
  {
    icon: MapPin,
    title: "예식 당일",
    color: "from-[#2E7D5A] to-gold",
    items: [
      {
        q: "예식장에 몇 분 전에 도착해야 하나요?",
        a: "예식 시작 20~30분 전에 도착하는 것이 좋습니다. 축의금을 전달하고, 방명록을 작성하고, 자리에 앉을 시간을 고려하세요. 늦을 경우 예식 중에 조용히 입장하세요.",
      },
      {
        q: "축가를 부탁받았다면?",
        a: "미리 충분히 연습하고, 결혼식 분위기에 맞는 곡을 선택하세요. 밝고 축하하는 느낌의 곡이 좋습니다. 반주가 필요한 경우 예식장에 미리 확인하세요.",
      },
    ],
  },
];

export default function EtiquettePage() {
  const [openCategory, setOpenCategory] = useState<number>(0);
  const [openItem, setOpenItem] = useState<Record<string, number | null>>({});

  const toggleItem = (catIdx: number, itemIdx: number) => {
    const key = `${catIdx}`;
    setOpenItem((prev) => ({
      ...prev,
      [key]: prev[key] === itemIdx ? null : itemIdx,
    }));
  };

  return (
    <div className="max-w-[900px] mx-auto">
      {/* 인트로 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5 }}
        className="text-center mb-10"
      >
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-rose-500/10 text-rose-500 text-[12px] font-medium mb-4">
          <Heart className="w-3.5 h-3.5" />
          웨딩 예절 가이드
        </div>
        <h1 className="font-serif-kr text-[28px] max-md:text-[22px] font-light text-noir-800 mb-3">
          알아두면 좋은 결혼 예절
        </h1>
        <p className="text-[14px] text-taupe-500 font-light">
          결혼 준비부터 예식 당일까지, 꼭 알아야 할 예절을 정리했어요
        </p>
      </motion.div>

      {/* 카테고리 카드 */}
      <div className="flex flex-col gap-4">
        {guides.map((guide, catIdx) => (
          <motion.div
            key={guide.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: catIdx * 0.05 }}
            className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden"
          >
            {/* 카테고리 헤더 */}
            <button
              onClick={() => setOpenCategory(openCategory === catIdx ? -1 : catIdx)}
              className="w-full px-6 py-5 flex items-center justify-between hover:bg-ivory-50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${guide.color} flex items-center justify-center`}>
                  <guide.icon className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <h3 className="text-[15px] font-medium text-noir-800">{guide.title}</h3>
                  <p className="text-[12px] text-taupe-400">{guide.items.length}개 항목</p>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-taupe-400 transition-transform ${
                  openCategory === catIdx ? "rotate-180" : ""
                }`}
              />
            </button>

            {/* FAQ 아코디언 */}
            <AnimatePresence>
              {openCategory === catIdx && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-black/[0.03] px-6 pb-4">
                    {guide.items.map((item, itemIdx) => (
                      <div key={itemIdx} className="border-b border-black/[0.02] last:border-0">
                        <button
                          onClick={() => toggleItem(catIdx, itemIdx)}
                          className="w-full py-4 flex items-start justify-between text-left"
                        >
                          <span className={`text-[14px] font-medium pr-4 ${
                            openItem[`${catIdx}`] === itemIdx ? "text-rose-500" : "text-noir-800"
                          }`}>
                            {item.q}
                          </span>
                          <ChevronDown
                            className={`w-4 h-4 text-taupe-400 flex-shrink-0 mt-0.5 transition-transform ${
                              openItem[`${catIdx}`] === itemIdx ? "rotate-180" : ""
                            }`}
                          />
                        </button>
                        <AnimatePresence>
                          {openItem[`${catIdx}`] === itemIdx && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <p className="text-[13px] text-charcoal font-light leading-[1.8] pb-4 pl-0">
                                {item.a}
                              </p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
