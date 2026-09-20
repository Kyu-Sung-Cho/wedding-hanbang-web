import { WEDDING_CODE_V06_AXES, type WeddingCodeV06Question, type WeddingCodeQuestionKey } from "./weddingCodeV06";

/** 문항별로 실제 구분되는 2~4개 선택만 남긴 공개 대화 도구. 이전 판의 뜻은 바꾸지 않는다.
 * 문항·집계·카피 gate: docs/wedding-code/2026-09-19_v12_question_revision.md
 * 선택 한 번은 한 장면으로 센다. 보기 노출 수의 균형이나 심리적 타당도를 주장하지 않는다.
 */
export const WEDDING_CODE_V12_VERSION = "v1.2-code";
export const WEDDING_CODE_V12_AXES = WEDDING_CODE_V06_AXES.map((axis) =>
  axis.key === "decisionCriteria" ? {
    ...axis,
    labelKo: "정할 때 살펴볼 것",
    left: { ...axis.left, labelKo: "비용·조건" },
    right: { ...axis.right, labelKo: "분위기·경험" },
  } : axis.key === "coordinationScope" ? { ...axis, labelKo: "누구와 함께 정하나" } : axis,
);

export const WEDDING_CODE_V12_QUESTIONS = [
  {
    "key": "A1",
    "axis": "decisionCriteria",
    "scene": "촬영 업체가 보낸 견적서와 사진을 상대와 보고 있다. 견적서에는 ‘촬영 250만원, 원본 사진 파일 30만원 별도’라고 쓰여 있다.",
    "question": "나라면 어떤 얘기부터 꺼낼까요?",
    "options": [
      {
        "value": "A",
        "label": "원본까지 받으면 280만원이네. 우리 예산이랑 맞나 보자",
        "weights": [
          {
            "construct": "costRisk",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "사진은 몇 장 받고, 보정은 몇 장 해주는 거지?",
        "weights": [
          {
            "construct": "evidenceDecision",
            "value": 2
          }
        ]
      },
      {
        "value": "C",
        "label": "이 사진 색감 좋다. 우리도 이런 느낌으로 찍고 싶어",
        "weights": [
          {
            "construct": "aestheticMood",
            "value": 2
          }
        ]
      },
      {
        "value": "D",
        "label": "나중에 둘이 꺼내 볼 사진인데, 어떤 순간을 남기면 좋을까?",
        "weights": [
          {
            "construct": "experienceMeaning",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "A2",
    "axis": "decisionCriteria",
    "scene": "둘 다 마음에 든 결혼식장을 보고 왔다. 그런데 정해 둔 예산보다 300만원이 비싸다. 아직 계약할지는 정하지 않았다.",
    "question": "나라면 집에 와서 어떤 얘기부터 할까요?",
    "options": [
      {
        "value": "A",
        "label": "예산보다 300만원 비싸네. 이 돈을 더 써도 괜찮을까?",
        "weights": [
          {
            "construct": "costRisk",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "아까 거기 있으니까 우리 진짜 결혼하는구나 싶더라",
        "weights": [
          {
            "construct": "experienceMeaning",
            "value": 2
          }
        ]
      },
      {
        "value": "C",
        "label": "견적에 어떤 서비스가 들어 있는지 다시 보자",
        "weights": [
          {
            "construct": "evidenceDecision",
            "value": 2
          }
        ]
      },
      {
        "value": "D",
        "label": "그 홀 조명이 계속 생각나. 분위기가 참 좋았어",
        "weights": [
          {
            "construct": "aestheticMood",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "A3",
    "axis": "decisionCriteria",
    "scene": "사진 촬영은 하기로 했다. 직원이 결혼식 영상도 남길 수 있다며 예시를 보여준다. 영상은 150만원이 추가된다.",
    "question": "나라면 상대에게 먼저 뭐라고 할까요?",
    "options": [
      {
        "value": "A",
        "label": "나중에 사진뿐 아니라 우리 목소리도 다시 듣고 싶어",
        "weights": [
          {
            "construct": "experienceMeaning",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "영상 분위기가 좋다. 우리도 저런 느낌이면 좋겠어",
        "weights": [
          {
            "construct": "aestheticMood",
            "value": 2
          }
        ]
      },
      {
        "value": "C",
        "label": "150만원에 몇 시간 찍고 어떤 영상을 주는지 물어보자",
        "weights": [
          {
            "construct": "evidenceDecision",
            "value": 2
          }
        ]
      },
      {
        "value": "D",
        "label": "사진도 찍으니까 영상에 150만원을 더 쓸지는 계산해 보자",
        "weights": [
          {
            "construct": "costRisk",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "A4",
    "axis": "decisionCriteria",
    "scene": "사진이 마음에 드는 촬영 업체를 찾았다. 예약하기 전에 업체 정보를 좀 더 살펴보려 한다.",
    "question": "나라면 무엇을 가장 자세히 볼까요?",
    "options": [
      {
        "value": "A",
        "label": "여러 커플의 사진을 보며 표정과 색감이 내 취향인지 본다",
        "weights": [
          {
            "construct": "aestheticMood",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "약속한 날 사진을 잘 받았다는 후기가 있는지 본다",
        "weights": [
          {
            "construct": "evidenceDecision",
            "value": 2
          }
        ]
      },
      {
        "value": "C",
        "label": "촬영 후기를 보며 둘이 편하게 즐기고 올 수 있을지 본다",
        "weights": [
          {
            "construct": "experienceMeaning",
            "value": 2
          }
        ]
      },
      {
        "value": "D",
        "label": "예약을 취소하면 예약금을 얼마나 돌려받는지 본다",
        "weights": [
          {
            "construct": "costRisk",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "A5",
    "axis": "decisionCriteria",
    "scene": "결혼식장 상담에서 식사 공간 사진과 견적서를 보고 있다. 식사는 한 사람에 7만원이고, 하객이 덜 와도 200명분은 내야 한다. 이 금액은 둘이 정한 예산 안에 든다.",
    "question": "나라면 무엇을 먼저 물어볼까요?",
    "options": [
      {
        "value": "A",
        "label": "음료값까지 합치면 200명 기준으로 총 얼마예요?",
        "weights": [
          {
            "construct": "costRisk",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "당일에 실제로 몇 명이 식사했는지는 어떻게 확인해요?",
        "weights": [
          {
            "construct": "evidenceDecision",
            "value": 2
          }
        ]
      },
      {
        "value": "C",
        "label": "식탁이랑 꽃 장식 사진을 더 볼 수 있어요?",
        "weights": [
          {
            "construct": "aestheticMood",
            "value": 2
          }
        ]
      },
      {
        "value": "D",
        "label": "식이 끝나고 손님들과 인사 나눌 시간은 얼마나 있어요?",
        "weights": [
          {
            "construct": "experienceMeaning",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "B1",
    "axis": "preparationMode",
    "scene": "상대가 둘이 원하는 조건에 맞는 결혼식장 10곳을 표로 보내왔다. 이번 주말에 가 볼 세 곳을 정하려고 한다.",
    "question": "나라면 가 볼 세 곳을 어떻게 정할까요?",
    "options": [
      {
        "value": "A",
        "label": "둘이 표를 같이 보고 세 곳을 고른다",
        "weights": [
          {
            "construct": "coPreparation",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "표를 보고 세 곳은 내가 혼자 고른다",
        "weights": [
          {
            "construct": "roleOwnership",
            "value": 2
          }
        ]
      },
      {
        "value": "C",
        "label": "표를 정리한 상대에게 세 곳을 골라 달라고 한다",
        "weights": [
          {
            "construct": "roleOwnership",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "B2",
    "axis": "preparationMode",
    "scene": "이번 주에 결혼식장과 촬영 업체 상담이 잡혀 있다. 둘 다 두 상담에 참석할 수 있고, 상담 내용은 나중에 서로 공유하기로 했다.",
    "question": "나라면 두 상담을 어떻게 받을까요?",
    "options": [
      {
        "value": "A",
        "label": "두 상담 모두 둘이 같이 듣는다",
        "weights": [
          {
            "construct": "coPreparation",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "상담을 하나씩 맡아서 각자 듣는다",
        "weights": [
          {
            "construct": "roleOwnership",
            "value": 2
          }
        ]
      },
      {
        "value": "C",
        "label": "두 상담 모두 내가 혼자 다녀온다",
        "weights": [
          {
            "construct": "roleOwnership",
            "value": 2
          }
        ]
      },
      {
        "value": "D",
        "label": "두 상담 모두 상대가 혼자 다녀온다",
        "weights": [
          {
            "construct": "roleOwnership",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "B3",
    "axis": "preparationMode",
    "scene": "상대가 알아본 신혼여행지 두 곳을 보여준다. 둘 다 예산에 맞고 마음에 든다. 이제 한 곳만 고르면 된다.",
    "question": "나라면 마지막 한 곳을 어떻게 고를까요?",
    "options": [
      {
        "value": "A",
        "label": "두 곳을 둘이 같이 비교하고, 갈 곳을 함께 정한다",
        "weights": [
          {
            "construct": "coPreparation",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "두 곳을 비교해서 내가 혼자 한 곳을 고른다",
        "weights": [
          {
            "construct": "roleOwnership",
            "value": 2
          }
        ]
      },
      {
        "value": "C",
        "label": "두 곳 중 하나를 고르는 건 상대에게 맡긴다",
        "weights": [
          {
            "construct": "roleOwnership",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "B4",
    "axis": "preparationMode",
    "scene": "둘이 정한 날짜와 예산에 맞는 비행기편이 몇 개 있다. 이 안에서는 한 사람이 골라 사도 괜찮다고 얘기했고, 이번 주 안에 사기로 했다.",
    "question": "나라면 살 표를 어떻게 고를까요?",
    "options": [
      {
        "value": "A",
        "label": "둘이 항공편을 비교하고 살 표를 함께 고른다",
        "weights": [
          {
            "construct": "coPreparation",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "내가 혼자 비교해서 살 표를 고른다",
        "weights": [
          {
            "construct": "roleOwnership",
            "value": 2
          }
        ]
      },
      {
        "value": "C",
        "label": "살 표는 상대가 비교해서 고르도록 맡긴다",
        "weights": [
          {
            "construct": "roleOwnership",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "B5",
    "axis": "preparationMode",
    "scene": "둘 다 괜찮은 날짜가 두 개다. 누가 골라도 좋다고 얘기해 뒀는데, 식장에서 오늘 오후 6시까지 확정해 달란다. 상대와는 점심에 연락할 수 있다.",
    "question": "나라면 두 날짜 중 하나를 어떻게 고를까요?",
    "options": [
      {
        "value": "A",
        "label": "둘이 한 번 더 얘기해서 날짜를 함께 고른다",
        "weights": [
          {
            "construct": "coPreparation",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "어느 날로 할지 내가 정한다",
        "weights": [
          {
            "construct": "roleOwnership",
            "value": 2
          }
        ]
      },
      {
        "value": "C",
        "label": "어느 날로 할지 상대가 정하도록 맡긴다",
        "weights": [
          {
            "construct": "roleOwnership",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "C1",
    "axis": "coordinationScope",
    "scene": "둘이 마음에 든 결혼식장이 있다. 부모님은 주차가 불편할까 걱정하신다. 주차 조건은 부모님과 함께 확인했고, 다른 후보도 하나 있다.",
    "question": "어느 곳으로 계약할지, 나라면 어떻게 정할까요?",
    "options": [
      {
        "value": "A",
        "label": "둘이 두 곳을 비교해 정하고 부모님께 말씀드린다",
        "weights": [
          {
            "construct": "coupleAutonomy",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "부모님과 두 곳을 비교하면서 함께 정한다",
        "weights": [
          {
            "construct": "familyIntegration",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "C2",
    "axis": "coordinationScope",
    "scene": "식이 끝난 뒤 부모님께 따로 인사드리는 방식을 얘기하고 있다. 부모님은 한복을 입고 큰절을 드리는 자리를 원하시고, 둘은 짧게 감사 인사를 드리고 싶다.",
    "question": "인사 방식은 어떻게 정하고 싶나요?",
    "options": [
      {
        "value": "A",
        "label": "둘이 원하는 인사 방식을 정한 뒤 부모님께 말씀드린다",
        "weights": [
          {
            "construct": "coupleAutonomy",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "부모님과 서로 원하는 방식을 얘기하고 함께 정한다",
        "weights": [
          {
            "construct": "familyIntegration",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "C3",
    "axis": "coordinationScope",
    "scene": "부모님 쪽 손님은 30명으로 정했다. 부모님이 우리 둘도 아는 분들 40명의 명단을 보내주시며, 둘이 골라도 좋다고 하신다.",
    "question": "최종 30명은 어떻게 정하고 싶나요?",
    "options": [
      {
        "value": "A",
        "label": "둘이 30명을 골라 부모님께 명단을 알려드린다",
        "weights": [
          {
            "construct": "coupleAutonomy",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "부모님과 명단을 보면서 함께 30명을 정한다",
        "weights": [
          {
            "construct": "familyIntegration",
            "value": 2
          }
        ]
      },
      {
        "value": "C",
        "label": "부모님께 꼭 모시고 싶은 30명을 골라 달라고 한다",
        "weights": [
          {
            "construct": "familyIntegration",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "C4",
    "axis": "coordinationScope",
    "scene": "양쪽 부모님과 처음 함께 식사할 날짜는 정했다. 못 드시는 음식과 이동 거리를 확인해 식당 두 곳을 추렸다.",
    "question": "마지막 한 곳은 어떻게 정하고 싶나요?",
    "options": [
      {
        "value": "A",
        "label": "둘이 한 곳을 정해 부모님께 장소를 알려드린다",
        "weights": [
          {
            "construct": "coupleAutonomy",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "부모님께 두 곳을 보여드리고 함께 고른다",
        "weights": [
          {
            "construct": "familyIntegration",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "C5",
    "axis": "coordinationScope",
    "scene": "부모님이 결혼 비용을 보태 주셨다. 따로 바라시는 용도는 없고, 아직 어디에 쓸지 정하지 않았다.",
    "question": "쓸 곳은 어떻게 정하고 싶나요?",
    "options": [
      {
        "value": "A",
        "label": "둘이 필요한 곳을 정한 뒤 부모님께 말씀드린다",
        "weights": [
          {
            "construct": "coupleAutonomy",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "부모님과 필요한 곳을 얘기하고 함께 정한다",
        "weights": [
          {
            "construct": "familyIntegration",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "D1",
    "axis": "supportOrder",
    "scene": "하객 명단을 정리하다가 누구까지 불러야 할지 고민이 많아졌다. 상대에게 명단 정리가 좀 버겁다고 말했다.",
    "question": "이럴 때 상대가 먼저 어떻게 도와주면 좋겠어요?",
    "options": [
      {
        "value": "A",
        "label": "내가 왜 힘든지, 얘기를 좀 들어줬으면 해",
        "weights": [
          {
            "construct": "emotionalSupport",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "명단을 같이 보면서 부를 사람을 추려줬으면 해",
        "weights": [
          {
            "construct": "executionSupport",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "D2",
    "axis": "supportOrder",
    "scene": "준비할 일을 얘기하다가 서로 말투가 날카로워졌다. 잠깐 쉬고 다시 앉았다.",
    "question": "대화를 다시 시작할 때, 나라면 뭐라고 할까요?",
    "options": [
      {
        "value": "A",
        "label": "오늘 정할 건 하나만 골라서 얘기하자",
        "weights": [
          {
            "construct": "executionSupport",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "아까 내가 한 말 중에 마음 상한 게 있었어?",
        "weights": [
          {
            "construct": "emotionalSupport",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "D3",
    "axis": "supportOrder",
    "scene": "계약서를 읽던 상대가 ‘놓치는 게 있을까 봐 걱정돼’라고 한다. 오늘 서명하지 않아도 된다.",
    "question": "옆에서 먼저 뭐라고 말하겠어요?",
    "options": [
      {
        "value": "A",
        "label": "계약서를 나랑 처음부터 하나씩 읽어보자",
        "weights": [
          {
            "construct": "executionSupport",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "걱정되지. 오늘 꼭 정하지 않아도 되니까 서두르지 말자",
        "weights": [
          {
            "construct": "emotionalSupport",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "D4",
    "axis": "supportOrder",
    "scene": "오늘 계약하면 30만원 할인된다는 말에 상대가 ‘놓치면 아까울 것 같아서 마음이 급해져’라고 한다. 잠깐 밖에서 얘기하기로 했다.",
    "question": "밖으로 나와서 먼저 뭐라고 하겠어요?",
    "options": [
      {
        "value": "A",
        "label": "마음 급해지겠다. 잠깐 숨 좀 돌리고 얘기하자",
        "weights": [
          {
            "construct": "emotionalSupport",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "할인 빼고도 좋은 조건인지 견적부터 다시 보자",
        "weights": [
          {
            "construct": "executionSupport",
            "value": 2
          }
        ]
      }
    ]
  },
  {
    "key": "D5",
    "axis": "supportOrder",
    "scene": "이번 주는 결혼 준비할 일이 많아 지쳤다. 아직 할 일도 남아 있다. 주말에 상대와 얘기할 시간이 생겼다.",
    "question": "상대가 어떤 말부터 해주면 좋겠어요?",
    "options": [
      {
        "value": "A",
        "label": "이번 주 뭐가 제일 힘들었어? 얘기 좀 해봐",
        "weights": [
          {
            "construct": "emotionalSupport",
            "value": 2
          }
        ]
      },
      {
        "value": "B",
        "label": "남은 일 중에 내가 뭘 맡아주면 좋을까?",
        "weights": [
          {
            "construct": "executionSupport",
            "value": 2
          }
        ]
      }
    ]
  }
] as const satisfies readonly WeddingCodeV06Question[];

export const WEDDING_CODE_V12_NEXT_STEPS = {
  "A1": "각자 남기고 싶은 사진을 한 장씩 골라 보세요. 견적을 비교할 때는 원본 파일을 받는 비용과 보정해 주는 사진 수까지 함께 적어 두면 편해요.",
  "A2": "이 홀에서 좋았던 점을 하나씩 말해 보세요. 포함된 서비스를 확인한 뒤, 300만원을 더 써도 괜찮은지 같은 견적서를 놓고 얘기해 보세요.",
  "A3": "나중에 다시 보고 싶은 순간을 하나씩 말해 보세요. 영상을 넣고 싶다면 촬영 시간, 받는 영상, 추가금이 적힌 안내를 받아 같이 살펴보세요.",
  "A4": "사진에서 마음에 든 점과 원하는 촬영 분위기를 함께 얘기해 보세요. 예약 전에는 취소할 때 돌려받는 금액과 사진을 받는 날짜도 글로 확인해 두세요.",
  "A5": "예상 하객 수에 맞는 좌석 배치와, 최소 200명분 조건을 반영한 식사비 견적을 받아 보세요. 실제 식사 인원을 확인하는 방법과 손님들과 인사할 시간도 함께 물어보세요.",
  "B1": "꼭 가 보고 싶은 곳이나 빼고 싶은 곳이 있다면 추리기 전에 말해 두세요. 세 곳을 고른 뒤에는 누가 방문 예약을 할지도 정해 보세요.",
  "B2": "각 상담에 누가 가면 좋을지 하나씩 정해 보세요. 혼자 다녀오는 상담이 있다면, 미리 서로 궁금한 점을 모아 주세요.",
  "B3": "두 곳 중 마음이 더 가는 곳이 있다면 먼저 말해 보세요. 선택을 맡길 때는 꼭 하고 싶은 일정이나 피하고 싶은 조건도 함께 알려 주세요.",
  "B4": "이번 표는 함께 고를지, 한 사람이 골라줄지 얘기해 보세요. 한 사람이 맡는다면 누가 고를지와 결제 전에 서로 알려줄 것을 정해 두세요.",
  "B5": "점심에 연락할 때, 이번 날짜는 함께 고를지 한 사람이 정할지 맞춰 보세요. 그다음 정한 날짜를 오후 6시 전에 누가 식장에 알릴지도 정해 두세요.",
  "C1": "주차 조건은 확인했으니, 마지막 선택을 둘이 할지 부모님과 함께 할지 얘기해 보세요. 서로 그 방식을 원하는 이유도 하나씩 말해 보세요.",
  "C2": "부모님은 그 인사에서 어떤 점을 중요하게 생각하시는지, 둘은 어떤 방식이 편한지 말해 보세요. 정한 인사 방식은 식장 담당자에게도 알려두세요.",
  "C3": "최종 30명은 둘이 고를지, 부모님과 함께 고를지, 부모님께 맡길지 얘기해 보세요. 명단이 정해지면 청첩장을 보내기 전에 한 번 맞춰 보세요.",
  "C4": "음식과 이동 조건은 확인했으니, 마지막 식당 선택은 둘이 할지 부모님과 함께 할지 얘기해 보세요. 식당을 고른 뒤에는 누가 예약하고 양쪽 부모님께 알려드릴지도 정해 두세요.",
  "C5": "지원금을 어디에 쓸지 둘이 정할지, 부모님과 함께 정할지 먼저 얘기해 보세요. 그다음 필요한 곳과 금액을 적어 보세요.",
  "D1": "지금은 얘기를 들어주는 것과 명단을 같이 정리하는 것 중 어느 쪽이 더 필요한지 알려주세요. 상대도 같은 도움을 원하는지 물어보세요.",
  "D2": "다시 얘기할 때 아직 마음에 걸리는 말이 있는지 확인해 보세요. 둘 다 괜찮다면 오늘 정할 일 하나와 대화를 마칠 시간을 정해 보세요.",
  "D3": "상대가 걱정을 더 얘기하고 싶은지, 계약서를 같이 보고 싶은지 물어보세요. 모르는 내용은 업체에 확인하고 이해한 뒤에 서명하세요.",
  "D4": "할인을 빼고도 여기로 정하고 싶은지 각자 말해 보세요. 마음이 다르면 더 확인할 것과 다시 얘기할 시간을 정해 보세요.",
  "D5": "이번 주 힘들었던 일과 남은 일 중에 도움받고 싶은 일을 하나씩 말해 보세요. 들어줬으면 하는 얘기와 함께 해줬으면 하는 일을 구분해서 알려주면 좋아요."
} as const satisfies Readonly<Record<WeddingCodeQuestionKey, string>>;
