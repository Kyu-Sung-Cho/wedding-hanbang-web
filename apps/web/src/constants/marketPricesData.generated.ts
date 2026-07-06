/**
 * 자동 생성 파일 — 직접 수정 금지.
 * 생성: scripts/update-market-prices.mjs (npm run update:market-prices)
 * 출처: 한국소비자원 참가격 결혼서비스 가격조사 (price.go.kr)
 * 수집 시각: 2026-07-06T11:54:16.476Z
 * 포함 기간: 202504 ~ 202605 (14개)
 */

export const GEN_PRICE_PERIODS = [
  {
    "id": "202504",
    "label": "2025년 4월",
    "year": 2025,
    "month": 4
  },
  {
    "id": "202505",
    "label": "2025년 5월",
    "year": 2025,
    "month": 5
  },
  {
    "id": "202506",
    "label": "2025년 6월",
    "year": 2025,
    "month": 6
  },
  {
    "id": "202507",
    "label": "2025년 7월",
    "year": 2025,
    "month": 7
  },
  {
    "id": "202508",
    "label": "2025년 8월",
    "year": 2025,
    "month": 8
  },
  {
    "id": "202509",
    "label": "2025년 9월",
    "year": 2025,
    "month": 9
  },
  {
    "id": "202510",
    "label": "2025년 10월",
    "year": 2025,
    "month": 10
  },
  {
    "id": "202511",
    "label": "2025년 11월",
    "year": 2025,
    "month": 11
  },
  {
    "id": "202512",
    "label": "2025년 12월",
    "year": 2025,
    "month": 12
  },
  {
    "id": "202601",
    "label": "2026년 1월",
    "year": 2026,
    "month": 1
  },
  {
    "id": "202602",
    "label": "2026년 2월",
    "year": 2026,
    "month": 2
  },
  {
    "id": "202603",
    "label": "2026년 3월",
    "year": 2026,
    "month": 3
  },
  {
    "id": "202604",
    "label": "2026년 4월",
    "year": 2026,
    "month": 4
  },
  {
    "id": "202605",
    "label": "2026년 5월",
    "year": 2026,
    "month": 5
  }
] as const;

export const GEN_NATIONAL_TOTALS: Record<string, { meal: number; sdm: number; rental: number; decoration: number }> = {
  "202504": {
    "meal": 1321.6,
    "sdm": 309.4,
    "rental": 368.5,
    "decoration": 101.8
  },
  "202505": {
    "meal": 1307.1,
    "sdm": 310,
    "rental": 371,
    "decoration": 99.5
  },
  "202506": {
    "meal": 1298.9,
    "sdm": 309.1,
    "rental": 367.5,
    "decoration": 98.8
  },
  "202507": {
    "meal": 1308,
    "sdm": 311.8,
    "rental": 387.1,
    "decoration": 92.5
  },
  "202508": {
    "meal": 1332.5,
    "sdm": 318.6,
    "rental": 409.6,
    "decoration": 99.5
  },
  "202509": {
    "meal": 1313.9,
    "sdm": 323,
    "rental": 405.7,
    "decoration": 98.4
  },
  "202510": {
    "meal": 1288.1,
    "sdm": 323.2,
    "rental": 390.8,
    "decoration": 83.9
  },
  "202511": {
    "meal": 1304.6,
    "sdm": 323.9,
    "rental": 396.6,
    "decoration": 81.2
  },
  "202512": {
    "meal": 1290.7,
    "sdm": 322.7,
    "rental": 389.1,
    "decoration": 88.8
  },
  "202601": {
    "meal": 1281,
    "sdm": 314.6,
    "rental": 406.8,
    "decoration": 85.5
  },
  "202602": {
    "meal": 1311.8,
    "sdm": 322.3,
    "rental": 428.7,
    "decoration": 76.5
  },
  "202603": {
    "meal": 1314.4,
    "sdm": 314.3,
    "rental": 432.4,
    "decoration": 75.1
  },
  "202604": {
    "meal": 1315.6,
    "sdm": 319.3,
    "rental": 436.1,
    "decoration": 70.1
  },
  "202605": {
    "meal": 1317.9,
    "sdm": 318.6,
    "rental": 436.2,
    "decoration": 69.4
  }
};

export const GEN_MEAL_DATA: Record<string, number[]> = {
  "202504": [
    2150.1,
    1677.7,
    681.3,
    1154.6,
    1247.3,
    1147.6,
    1189.8,
    1136.1,
    1193.8,
    1015.6,
    1123.4,
    1045.1,
    758.1,
    1273.4
  ],
  "202505": [
    2115.4,
    1610.7,
    685.4,
    1093.3,
    1207.5,
    1122.1,
    1104.1,
    1141.9,
    1184.3,
    1182.1,
    1124.4,
    1042.4,
    736.5,
    1313.4
  ],
  "202506": [
    2099.6,
    1628.9,
    686.9,
    1090.3,
    1229.9,
    1118,
    1098.9,
    1145.6,
    1202.7,
    1175,
    1094.2,
    1033.5,
    699.8,
    1313.8
  ],
  "202507": [
    2172.6,
    1600.4,
    680.7,
    1104.7,
    1209,
    1139.4,
    1104.7,
    1122.4,
    1201.9,
    1217.3,
    1077.7,
    1041,
    707.3,
    1137.6
  ],
  "202508": [
    2158.7,
    1546.8,
    706.9,
    1058.9,
    1212.1,
    1114.9,
    1048.7,
    1053.2,
    1161.7,
    1105.4,
    1166.1,
    1058.2,
    729.9,
    1008.8
  ],
  "202509": [
    2132.3,
    1573.7,
    687.2,
    1080.3,
    1237.9,
    1114.2,
    1041.4,
    1085.4,
    1148.9,
    1030.1,
    1177,
    1085.9,
    763,
    992.2
  ],
  "202510": [
    2148.3,
    1578.1,
    694.1,
    1049.8,
    1184.6,
    1112,
    1082,
    1143.6,
    1126.4,
    1096.4,
    1105.4,
    1078.9,
    762.3,
    1065.4
  ],
  "202511": [
    2190.2,
    1563.1,
    706.5,
    1043.4,
    1190,
    1115.5,
    1083.3,
    1122.8,
    1124,
    1114.8,
    1135,
    1087.9,
    752.2,
    1066.4
  ],
  "202512": [
    2205.8,
    1567.1,
    727.3,
    1038.9,
    1134.8,
    1071,
    969.6,
    1169.6,
    1151.8,
    1106.8,
    1114.9,
    1082.9,
    764.7,
    1013.5
  ],
  "202601": [
    2064.8,
    1629.7,
    830,
    1041.6,
    1003.2,
    1103.3,
    1025.2,
    1029.1,
    1153,
    1044.1,
    1022,
    1006.9,
    749.8,
    1207.6
  ],
  "202602": [
    2053.5,
    1722.8,
    810.7,
    1057.1,
    1004.8,
    1206.3,
    1021,
    1030.6,
    1212.5,
    1159.1,
    1031.6,
    1034.9,
    827,
    1265.6
  ],
  "202603": [
    2025.5,
    1758.5,
    759.9,
    1024.8,
    1011.2,
    1168.7,
    1074.8,
    1025.2,
    1231.6,
    1189.8,
    1007.5,
    1045,
    850,
    1343.2
  ],
  "202604": [
    1993.3,
    1767.8,
    772.3,
    1059.3,
    1003.3,
    1177.9,
    1041.6,
    1104.5,
    1223,
    1165.3,
    1003.1,
    1029.1,
    840.8,
    1394.3
  ],
  "202605": [
    2015.4,
    1763.1,
    757.6,
    1041.6,
    1005.9,
    1176.7,
    1076.5,
    1091.6,
    1248.9,
    1178.4,
    998.2,
    1037.8,
    801.8,
    1402.3
  ]
};

export const GEN_SDM_DATA: Record<string, number[]> = {
  "202504": [
    360.6,
    324.5,
    341.4,
    272.5,
    221.6,
    334,
    266.4,
    265.5,
    246.6,
    249.1,
    254.4,
    339.1,
    242.7,
    107.8
  ],
  "202505": [
    360,
    311.5,
    350.7,
    272.7,
    223.4,
    343.1,
    264.4,
    263.7,
    243.3,
    251.7,
    256.9,
    340.6,
    239.1,
    115.7
  ],
  "202506": [
    355.5,
    300.2,
    349.4,
    263.4,
    228.4,
    343.6,
    287.2,
    265.6,
    244.3,
    252.8,
    259.5,
    341.1,
    241,
    129.5
  ],
  "202507": [
    367.9,
    289,
    350.8,
    266.1,
    227.5,
    345.2,
    277.8,
    251.7,
    249.8,
    252.3,
    256,
    342.2,
    227.8,
    129.7
  ],
  "202508": [
    388.5,
    314.2,
    342.1,
    260.2,
    239.7,
    346.3,
    289.7,
    244.8,
    259.7,
    259.9,
    260.3,
    328.6,
    223.1,
    149.4
  ],
  "202509": [
    403.4,
    303.1,
    350.2,
    260.8,
    245.3,
    341.9,
    289.7,
    241.7,
    253.5,
    256.3,
    274.4,
    330.5,
    241.4,
    181.1
  ],
  "202510": [
    397.2,
    289.5,
    371,
    269.7,
    273.4,
    343.7,
    279.4,
    242.5,
    242.2,
    252.1,
    284.3,
    330,
    235.2,
    153.9
  ],
  "202511": [
    405.9,
    299.2,
    357.7,
    275.3,
    243.5,
    340.8,
    293.4,
    240.2,
    248.4,
    245,
    272.1,
    325.5,
    232.4,
    147.8
  ],
  "202512": [
    401.4,
    266.7,
    358.7,
    274.5,
    250.6,
    341.4,
    290.1,
    244.2,
    243,
    245,
    273.9,
    323.3,
    228.2,
    148.7
  ],
  "202601": [
    379.1,
    296.3,
    331.5,
    295.1,
    248.5,
    314.2,
    280,
    224.2,
    241.3,
    233.4,
    267.1,
    318.1,
    217.8,
    147.1
  ],
  "202602": [
    399,
    364.6,
    346.1,
    292.2,
    247.5,
    322.4,
    282.5,
    222,
    240.9,
    231.5,
    260.5,
    309,
    205.8,
    146
  ],
  "202603": [
    395.3,
    411,
    310.7,
    262.8,
    219.1,
    331.1,
    282.1,
    205.9,
    245.3,
    231.3,
    259.2,
    310.5,
    208,
    148.6
  ],
  "202604": [
    398.7,
    484,
    287.5,
    267.3,
    227,
    333.7,
    282.3,
    222,
    249.1,
    232.9,
    276.7,
    318.4,
    211.9,
    149.3
  ],
  "202605": [
    406.5,
    506.8,
    278.9,
    266.6,
    225.4,
    335.5,
    280.8,
    226,
    254.7,
    231.5,
    282.8,
    318.5,
    211.5,
    141.4
  ]
};

export const GEN_RENTAL_DATA: Record<string, number[]> = {
  "202504": [
    637.3,
    549.8,
    203.5,
    200.4,
    321.7,
    164.3,
    178.1,
    391.2,
    370.6,
    345,
    356.8,
    271.1,
    206.7,
    91.3
  ],
  "202505": [
    640.9,
    534.4,
    200.3,
    188.1,
    297.1,
    180,
    190.8,
    405.2,
    382.4,
    333.1,
    348.2,
    273.5,
    215.3,
    100
  ],
  "202506": [
    638,
    530.6,
    198.7,
    190.4,
    307.9,
    183,
    204.4,
    407.3,
    378.7,
    333.3,
    337.4,
    276.3,
    209,
    96.6
  ],
  "202507": [
    678.8,
    552.3,
    187.4,
    195.1,
    311.2,
    207.4,
    204.8,
    398.5,
    387.2,
    348.4,
    338.8,
    272.2,
    235,
    114.9
  ],
  "202508": [
    681.4,
    561.8,
    171.4,
    187.7,
    357.2,
    189.6,
    217,
    347.7,
    393.7,
    305,
    332.6,
    296.7,
    227.6,
    88.1
  ],
  "202509": [
    692.5,
    573.9,
    179.3,
    196.3,
    371,
    190.1,
    225.5,
    314.3,
    395.5,
    271.2,
    343,
    318.6,
    236,
    113.6
  ],
  "202510": [
    716.2,
    559.6,
    190.1,
    198.4,
    326.6,
    188.9,
    219.6,
    386.4,
    375.9,
    285.2,
    320.6,
    311.6,
    228.1,
    126.3
  ],
  "202511": [
    676.1,
    588.2,
    190.1,
    196.5,
    329.3,
    190.8,
    219.7,
    388,
    370.5,
    300.6,
    321.1,
    319.1,
    229.2,
    117.5
  ],
  "202512": [
    681.4,
    572.9,
    199,
    185.8,
    328.7,
    159.1,
    211.7,
    388.9,
    363.5,
    300.6,
    324.5,
    329.6,
    233.4,
    124.3
  ],
  "202601": [
    693.5,
    609.7,
    221,
    195.6,
    295.4,
    198.9,
    263.6,
    271.5,
    396,
    315.2,
    362.3,
    324.7,
    227.2,
    124.6
  ],
  "202602": [
    722,
    686.2,
    213.7,
    192.5,
    271,
    237.4,
    279.1,
    282.4,
    406.9,
    354.7,
    359.7,
    329.4,
    250.1,
    122.1
  ],
  "202603": [
    704,
    716.4,
    192.3,
    199.7,
    275.7,
    222.9,
    267.6,
    326.1,
    415,
    322.5,
    365.6,
    324.2,
    263.5,
    148.6
  ],
  "202604": [
    713.6,
    704.7,
    193.4,
    211.7,
    283,
    246.4,
    258.9,
    406.5,
    413.3,
    319,
    366.2,
    321.1,
    266.4,
    149.7
  ],
  "202605": [
    718.6,
    699.5,
    195.6,
    201.9,
    279.2,
    242.7,
    289.7,
    365.5,
    416.5,
    310.9,
    365.2,
    320.3,
    258.4,
    115.4
  ]
};

export const GEN_DECO_DATA: Record<string, number[]> = {
  "202504": [
    260.7,
    262.8,
    0.7,
    17.5,
    43.2,
    9.2,
    62.2,
    3.7,
    64.3,
    16.8,
    0,
    6.2,
    1.5,
    70.5
  ],
  "202505": [
    234.7,
    244.3,
    0.6,
    41.1,
    52,
    6.9,
    58.8,
    4.2,
    52.7,
    23.1,
    0,
    6.5,
    4.2,
    66.9
  ],
  "202506": [
    242.8,
    243.6,
    0,
    42.5,
    53,
    4.3,
    66.6,
    5.2,
    55.1,
    24.3,
    0,
    7.4,
    3.1,
    69.3
  ],
  "202507": [
    216.3,
    200.9,
    0,
    42.3,
    50.8,
    5.5,
    78.1,
    6.5,
    66.5,
    15,
    0,
    9.1,
    8.9,
    20.1
  ],
  "202508": [
    280.1,
    165.4,
    0,
    36.7,
    51,
    4.1,
    79.1,
    0,
    47,
    2.2,
    0,
    9.4,
    0,
    38.1
  ],
  "202509": [
    282.6,
    178.6,
    0,
    43.9,
    58.6,
    4.1,
    75.9,
    0,
    44.5,
    5.8,
    0,
    20.7,
    0,
    17.2
  ],
  "202510": [
    238.3,
    165.3,
    0,
    40.1,
    40.5,
    2.2,
    74.1,
    0,
    57.9,
    4.5,
    0,
    20.8,
    5.2,
    18.4
  ],
  "202511": [
    287,
    109.8,
    0,
    38,
    33,
    1.9,
    74.7,
    0,
    60.4,
    13.8,
    0,
    23,
    2.5,
    37.1
  ],
  "202512": [
    310.2,
    123.8,
    0,
    41.3,
    38.6,
    2.3,
    110.4,
    0,
    67.4,
    20.8,
    4.8,
    26,
    2,
    38.7
  ],
  "202601": [
    276.4,
    151.6,
    0,
    38.4,
    13.8,
    1.5,
    87.7,
    16.2,
    46.5,
    47,
    13.2,
    16.3,
    2.4,
    51.2
  ],
  "202602": [
    291.5,
    118,
    0,
    37.4,
    13.8,
    3.6,
    45,
    17,
    49.1,
    41.8,
    12.5,
    15,
    1,
    45.2
  ],
  "202603": [
    257.3,
    129.6,
    2,
    39.2,
    16.2,
    3.5,
    43.8,
    32,
    55.5,
    26.6,
    13.8,
    12.5,
    0.9,
    43
  ],
  "202604": [
    232.9,
    121.9,
    2,
    40.6,
    16.8,
    1.5,
    43.4,
    7.2,
    54.8,
    24.7,
    13.2,
    10.4,
    0.9,
    51
  ],
  "202605": [
    234.1,
    113.7,
    0,
    36.7,
    16.6,
    1.5,
    60.5,
    8.5,
    48.4,
    41.6,
    13.6,
    13.3,
    0.5,
    48.2
  ]
};

export const GEN_VENUE_NECESSARY = [
  {
    "periodId": "202504",
    "scope": "national",
    "rental": 300,
    "minGuests": 200,
    "perPersonMeal": 5.8,
    "totalFood": 1182.5
  },
  {
    "periodId": "202504",
    "scope": "seoul",
    "rental": 600,
    "minGuests": 220,
    "perPersonMeal": 7.7,
    "totalFood": 1760
  },
  {
    "periodId": "202505",
    "scope": "national",
    "rental": 300,
    "minGuests": 200,
    "perPersonMeal": 5.8,
    "totalFood": 1180
  },
  {
    "periodId": "202505",
    "scope": "seoul",
    "rental": 600,
    "minGuests": 200,
    "perPersonMeal": 7.5,
    "totalFood": 1700
  },
  {
    "periodId": "202506",
    "scope": "national",
    "rental": 300,
    "minGuests": 200,
    "perPersonMeal": 5.8,
    "totalFood": 1180
  },
  {
    "periodId": "202506",
    "scope": "seoul",
    "rental": 600,
    "minGuests": 200,
    "perPersonMeal": 7.55,
    "totalFood": 1701
  },
  {
    "periodId": "202507",
    "scope": "national",
    "rental": 300,
    "minGuests": 200,
    "perPersonMeal": 5.9,
    "totalFood": 1200
  },
  {
    "periodId": "202507",
    "scope": "seoul",
    "rental": 600,
    "minGuests": 200,
    "perPersonMeal": 7.6,
    "totalFood": 1725
  },
  {
    "periodId": "202508",
    "scope": "national",
    "rental": 350,
    "minGuests": 200,
    "perPersonMeal": 6,
    "totalFood": 1200
  },
  {
    "periodId": "202508",
    "scope": "seoul",
    "rental": 600,
    "minGuests": 200,
    "perPersonMeal": 7.7,
    "totalFood": 1625
  },
  {
    "periodId": "202509",
    "scope": "national",
    "rental": 330,
    "minGuests": 200,
    "perPersonMeal": 5.9,
    "totalFood": 1200
  },
  {
    "periodId": "202509",
    "scope": "seoul",
    "rental": 600,
    "minGuests": 200,
    "perPersonMeal": 7.8,
    "totalFood": 1640
  },
  {
    "periodId": "202510",
    "scope": "national",
    "rental": 300,
    "minGuests": 200,
    "perPersonMeal": 5.8,
    "totalFood": 1144
  },
  {
    "periodId": "202510",
    "scope": "seoul",
    "rental": 600,
    "minGuests": 200,
    "perPersonMeal": 7.7,
    "totalFood": 1650
  },
  {
    "periodId": "202511",
    "scope": "national",
    "rental": 300,
    "minGuests": 200,
    "perPersonMeal": 5.8,
    "totalFood": 1151
  },
  {
    "periodId": "202511",
    "scope": "seoul",
    "rental": 600,
    "minGuests": 200,
    "perPersonMeal": 7.9,
    "totalFood": 1655
  },
  {
    "periodId": "202512",
    "scope": "national",
    "rental": 300,
    "minGuests": 200,
    "perPersonMeal": 5.8,
    "totalFood": 1140
  },
  {
    "periodId": "202512",
    "scope": "seoul",
    "rental": 600,
    "minGuests": 200,
    "perPersonMeal": 7.9,
    "totalFood": 1700
  },
  {
    "periodId": "202601",
    "scope": "national",
    "rental": 350,
    "minGuests": 200,
    "perPersonMeal": 5.9,
    "totalFood": 1125
  },
  {
    "periodId": "202601",
    "scope": "seoul",
    "rental": 600,
    "minGuests": 200,
    "perPersonMeal": 8,
    "totalFood": 1625
  },
  {
    "periodId": "202602",
    "scope": "national",
    "rental": 350,
    "minGuests": 200,
    "perPersonMeal": 5.9,
    "totalFood": 1140
  },
  {
    "periodId": "202602",
    "scope": "seoul",
    "rental": 630,
    "minGuests": 200,
    "perPersonMeal": 8,
    "totalFood": 1600
  },
  {
    "periodId": "202603",
    "scope": "national",
    "rental": 350,
    "minGuests": 200,
    "perPersonMeal": 5.9,
    "totalFood": 1140
  },
  {
    "periodId": "202603",
    "scope": "seoul",
    "rental": 650,
    "minGuests": 200,
    "perPersonMeal": 8,
    "totalFood": 1625
  },
  {
    "periodId": "202604",
    "scope": "national",
    "rental": 350,
    "minGuests": 200,
    "perPersonMeal": 5.9,
    "totalFood": 1140
  },
  {
    "periodId": "202604",
    "scope": "seoul",
    "rental": 700,
    "minGuests": 200,
    "perPersonMeal": 8,
    "totalFood": 1600
  },
  {
    "periodId": "202605",
    "scope": "national",
    "rental": 340,
    "minGuests": 200,
    "perPersonMeal": 5.9,
    "totalFood": 1140
  },
  {
    "periodId": "202605",
    "scope": "seoul",
    "rental": 630,
    "minGuests": 200,
    "perPersonMeal": 8,
    "totalFood": 1600
  }
];

export const GEN_VENUE_OPT_NATIONAL: Record<string, number[]> = {
  "202504": [
    225,
    27,
    30,
    30,
    16,
    30,
    10,
    17,
    28,
    85,
    51,
    14,
    40,
    37,
    30,
    37,
    15
  ],
  "202505": [
    225,
    25,
    30,
    30,
    16,
    30,
    10,
    18,
    28,
    80,
    50,
    14,
    40,
    37,
    30,
    38,
    15
  ],
  "202506": [
    200,
    25,
    30,
    30,
    16,
    30,
    10,
    18,
    28,
    80,
    50,
    13,
    40,
    37,
    30,
    38,
    15
  ],
  "202507": [
    200,
    25,
    30,
    30,
    16,
    30,
    10,
    16.6,
    27.5,
    80,
    50,
    13.5,
    40,
    37,
    30,
    38,
    15
  ],
  "202508": [
    262,
    25,
    30,
    30,
    16,
    30,
    10,
    17,
    28,
    80,
    50,
    13,
    40,
    37,
    30,
    38,
    15
  ],
  "202509": [
    275,
    25,
    30,
    30,
    16,
    30,
    10,
    17,
    28,
    80,
    50,
    15,
    40,
    37,
    30,
    38,
    15
  ],
  "202510": [
    250,
    25,
    30,
    30,
    16,
    30,
    10,
    18,
    26,
    80,
    50,
    15,
    40,
    37,
    30,
    38,
    15
  ],
  "202511": [
    250,
    25,
    30,
    30,
    16,
    30,
    10,
    16.55,
    25.13,
    80,
    50,
    15,
    40,
    37,
    30,
    38,
    15
  ],
  "202512": [
    262,
    25,
    30,
    30,
    16,
    30,
    10,
    15,
    26,
    80,
    50.5,
    15,
    40,
    37,
    29.25,
    38,
    15
  ],
  "202601": [
    275,
    25,
    30,
    30,
    16,
    30,
    10,
    14,
    25,
    80,
    50,
    15,
    40,
    37,
    28,
    38,
    15
  ],
  "202602": [
    280,
    25,
    30,
    30,
    16,
    30,
    11,
    14.5,
    25,
    77,
    50,
    13.5,
    40,
    37,
    27.25,
    38,
    15
  ],
  "202603": [
    275,
    25,
    30,
    30,
    16,
    30,
    10.5,
    15,
    25,
    77,
    50,
    13.5,
    40,
    37,
    27.5,
    38,
    15
  ],
  "202604": [
    262,
    25,
    30,
    30,
    16,
    30,
    10,
    15,
    25,
    77,
    50,
    14,
    40,
    37,
    27.5,
    38,
    15
  ],
  "202605": [
    237.5,
    25,
    30,
    30,
    16,
    30,
    10,
    15,
    25,
    77,
    50,
    15,
    40,
    37,
    27.5,
    38,
    15
  ]
};

export const GEN_VENUE_OPT_SEOUL: Record<string, number[]> = {
  "202504": [
    501,
    39,
    33,
    32,
    20,
    38,
    17,
    17,
    29,
    85,
    51,
    21,
    45,
    35,
    33,
    41,
    32
  ],
  "202505": [
    501,
    39,
    33,
    30,
    20,
    36,
    16,
    18,
    29,
    85,
    51,
    21,
    45,
    37,
    33,
    44,
    34
  ],
  "202506": [
    501,
    39,
    33,
    30,
    20,
    37,
    17,
    18,
    29,
    85,
    51,
    21,
    45,
    37,
    33,
    44,
    37
  ],
  "202507": [
    501,
    33,
    30,
    30,
    20,
    37,
    15,
    18.7,
    29,
    85,
    51,
    21,
    44.5,
    37,
    33,
    44,
    34
  ],
  "202508": [
    501,
    33,
    33,
    30,
    20,
    39,
    17,
    19,
    29,
    85,
    51,
    21,
    44,
    35,
    33,
    45,
    30
  ],
  "202509": [
    501,
    35,
    33,
    30,
    20,
    39,
    17,
    19,
    29,
    85,
    51,
    22,
    44,
    35,
    33,
    45,
    30
  ],
  "202510": [
    501,
    35,
    33,
    30,
    20,
    39,
    17,
    18,
    29,
    85,
    51,
    22,
    45,
    36,
    33,
    45,
    32
  ],
  "202511": [
    501,
    33,
    33,
    30,
    20,
    37.75,
    15.75,
    18,
    29,
    85,
    51,
    22,
    45,
    36,
    33,
    44.5,
    32
  ],
  "202512": [
    501,
    33,
    33,
    30,
    20,
    38.5,
    16.75,
    16.5,
    29,
    85,
    51,
    22,
    45,
    37,
    33,
    45,
    30
  ],
  "202601": [
    550,
    30,
    34,
    30,
    20,
    38.75,
    15,
    14.25,
    29,
    85,
    50,
    22,
    50,
    37,
    33,
    45,
    25.75
  ],
  "202602": [
    540,
    30,
    33,
    30,
    20,
    37,
    15,
    16.5,
    29,
    85,
    50,
    22,
    42.5,
    37,
    33,
    44,
    32
  ],
  "202603": [
    500.5,
    31.5,
    33,
    30,
    20,
    37.75,
    15,
    16.5,
    29,
    85,
    50,
    22,
    45,
    37,
    33,
    44,
    34
  ],
  "202604": [
    500.5,
    30,
    30,
    30,
    20,
    36,
    15,
    16.5,
    29,
    85,
    50,
    22,
    42.5,
    37,
    33,
    44,
    32
  ],
  "202605": [
    500,
    30,
    30,
    30,
    20,
    36,
    15,
    16.5,
    29,
    85,
    50,
    22,
    40,
    37,
    33,
    44,
    34
  ]
};

export const GEN_SDM_PACKAGES = [
  {
    "periodId": "202504",
    "region": "전체",
    "packageMedian": 290,
    "dmPackageMedian": 140,
    "studioBasic": 135
  },
  {
    "periodId": "202504",
    "region": "서울",
    "packageMedian": 295,
    "dmPackageMedian": 97,
    "studioBasic": 150
  },
  {
    "periodId": "202504",
    "region": "경기/인천",
    "packageMedian": 228,
    "dmPackageMedian": 150,
    "studioBasic": 125
  },
  {
    "periodId": "202504",
    "region": "5대광역시",
    "packageMedian": 307,
    "dmPackageMedian": 150,
    "studioBasic": 140
  },
  {
    "periodId": "202504",
    "region": "기타지역",
    "packageMedian": 285,
    "dmPackageMedian": 129,
    "studioBasic": 110
  },
  {
    "periodId": "202505",
    "region": "전체",
    "packageMedian": 291,
    "dmPackageMedian": 138,
    "studioBasic": 132
  },
  {
    "periodId": "202505",
    "region": "서울",
    "packageMedian": 297,
    "dmPackageMedian": 79,
    "studioBasic": 150
  },
  {
    "periodId": "202505",
    "region": "경기/인천",
    "packageMedian": 234,
    "dmPackageMedian": 148,
    "studioBasic": 120
  },
  {
    "periodId": "202505",
    "region": "5대광역시",
    "packageMedian": 307,
    "dmPackageMedian": 152,
    "studioBasic": 140
  },
  {
    "periodId": "202505",
    "region": "기타지역",
    "packageMedian": 285,
    "dmPackageMedian": 125,
    "studioBasic": 115
  },
  {
    "periodId": "202506",
    "region": "전체",
    "packageMedian": 292,
    "dmPackageMedian": 140,
    "studioBasic": 132
  },
  {
    "periodId": "202506",
    "region": "서울",
    "packageMedian": 299,
    "dmPackageMedian": 80,
    "studioBasic": 150
  },
  {
    "periodId": "202506",
    "region": "경기/인천",
    "packageMedian": 233,
    "dmPackageMedian": 139,
    "studioBasic": 120
  },
  {
    "periodId": "202506",
    "region": "5대광역시",
    "packageMedian": 305,
    "dmPackageMedian": 150,
    "studioBasic": 140
  },
  {
    "periodId": "202506",
    "region": "기타지역",
    "packageMedian": 290,
    "dmPackageMedian": 140,
    "studioBasic": 115
  },
  {
    "periodId": "202507",
    "region": "전체",
    "packageMedian": 291,
    "dmPackageMedian": 150,
    "studioBasic": 132
  },
  {
    "periodId": "202507",
    "region": "서울",
    "packageMedian": 304,
    "dmPackageMedian": 140,
    "studioBasic": 150
  },
  {
    "periodId": "202507",
    "region": "경기/인천",
    "packageMedian": 237,
    "dmPackageMedian": 140,
    "studioBasic": 120
  },
  {
    "periodId": "202507",
    "region": "5대광역시",
    "packageMedian": 299,
    "dmPackageMedian": 152,
    "studioBasic": 140
  },
  {
    "periodId": "202507",
    "region": "기타지역",
    "packageMedian": 282,
    "dmPackageMedian": 150,
    "studioBasic": 115
  },
  {
    "periodId": "202508",
    "region": "전체",
    "packageMedian": 293,
    "dmPackageMedian": 150,
    "studioBasic": 132
  },
  {
    "periodId": "202508",
    "region": "서울",
    "packageMedian": 313,
    "dmPackageMedian": 130,
    "studioBasic": 150
  },
  {
    "periodId": "202508",
    "region": "경기/인천",
    "packageMedian": 250,
    "dmPackageMedian": 138,
    "studioBasic": 120
  },
  {
    "periodId": "202508",
    "region": "5대광역시",
    "packageMedian": 295,
    "dmPackageMedian": 150,
    "studioBasic": 140
  },
  {
    "periodId": "202508",
    "region": "기타지역",
    "packageMedian": 280,
    "dmPackageMedian": 160,
    "studioBasic": 112
  },
  {
    "periodId": "202509",
    "region": "전체",
    "packageMedian": 295,
    "dmPackageMedian": 150,
    "studioBasic": 132
  },
  {
    "periodId": "202509",
    "region": "서울",
    "packageMedian": 320,
    "dmPackageMedian": 190,
    "studioBasic": 150
  },
  {
    "periodId": "202509",
    "region": "경기/인천",
    "packageMedian": 244,
    "dmPackageMedian": 130,
    "studioBasic": 120
  },
  {
    "periodId": "202509",
    "region": "5대광역시",
    "packageMedian": 293,
    "dmPackageMedian": 140,
    "studioBasic": 139
  },
  {
    "periodId": "202509",
    "region": "기타지역",
    "packageMedian": 280,
    "dmPackageMedian": 160,
    "studioBasic": 115
  },
  {
    "periodId": "202510",
    "region": "전체",
    "packageMedian": 290,
    "dmPackageMedian": 150,
    "studioBasic": 139
  },
  {
    "periodId": "202510",
    "region": "서울",
    "packageMedian": 300,
    "dmPackageMedian": 180,
    "studioBasic": 150
  },
  {
    "periodId": "202510",
    "region": "경기/인천",
    "packageMedian": 258,
    "dmPackageMedian": 104,
    "studioBasic": 120
  },
  {
    "periodId": "202510",
    "region": "5대광역시",
    "packageMedian": 290,
    "dmPackageMedian": 160,
    "studioBasic": 140
  },
  {
    "periodId": "202510",
    "region": "기타지역",
    "packageMedian": 290,
    "dmPackageMedian": 148,
    "studioBasic": 112
  },
  {
    "periodId": "202511",
    "region": "전체",
    "packageMedian": 292,
    "dmPackageMedian": 160,
    "studioBasic": 135.25
  },
  {
    "periodId": "202511",
    "region": "서울",
    "packageMedian": 325,
    "dmPackageMedian": 195,
    "studioBasic": 150
  },
  {
    "periodId": "202511",
    "region": "경기/인천",
    "packageMedian": 243,
    "dmPackageMedian": 130,
    "studioBasic": 119.75
  },
  {
    "periodId": "202511",
    "region": "5대광역시",
    "packageMedian": 300,
    "dmPackageMedian": 160,
    "studioBasic": 140
  },
  {
    "periodId": "202511",
    "region": "기타지역",
    "packageMedian": 274,
    "dmPackageMedian": 160,
    "studioBasic": 112
  },
  {
    "periodId": "202512",
    "region": "전체",
    "packageMedian": 293,
    "dmPackageMedian": 160,
    "studioBasic": 139
  },
  {
    "periodId": "202512",
    "region": "서울",
    "packageMedian": 317,
    "dmPackageMedian": 180,
    "studioBasic": 150
  },
  {
    "periodId": "202512",
    "region": "경기/인천",
    "packageMedian": 247,
    "dmPackageMedian": 130,
    "studioBasic": 119.5
  },
  {
    "periodId": "202512",
    "region": "5대광역시",
    "packageMedian": 300,
    "dmPackageMedian": 150,
    "studioBasic": 140
  },
  {
    "periodId": "202512",
    "region": "기타지역",
    "packageMedian": 278,
    "dmPackageMedian": 160,
    "studioBasic": 111.5
  },
  {
    "periodId": "202601",
    "region": "전체",
    "packageMedian": 290,
    "dmPackageMedian": 157,
    "studioBasic": 139
  },
  {
    "periodId": "202601",
    "region": "서울",
    "packageMedian": 335,
    "dmPackageMedian": 150,
    "studioBasic": 150
  },
  {
    "periodId": "202601",
    "region": "경기/인천",
    "packageMedian": 240,
    "dmPackageMedian": 140,
    "studioBasic": 119.75
  },
  {
    "periodId": "202601",
    "region": "5대광역시",
    "packageMedian": 300,
    "dmPackageMedian": 170,
    "studioBasic": 140
  },
  {
    "periodId": "202601",
    "region": "기타지역",
    "packageMedian": 270,
    "dmPackageMedian": 160,
    "studioBasic": 111.5
  },
  {
    "periodId": "202602",
    "region": "전체",
    "packageMedian": 294,
    "dmPackageMedian": 170,
    "studioBasic": 137.25
  },
  {
    "periodId": "202602",
    "region": "서울",
    "packageMedian": 350,
    "dmPackageMedian": 180,
    "studioBasic": 150
  },
  {
    "periodId": "202602",
    "region": "경기/인천",
    "packageMedian": 230,
    "dmPackageMedian": 150,
    "studioBasic": 120
  },
  {
    "periodId": "202602",
    "region": "5대광역시",
    "packageMedian": 294,
    "dmPackageMedian": 175,
    "studioBasic": 140
  },
  {
    "periodId": "202602",
    "region": "기타지역",
    "packageMedian": 270,
    "dmPackageMedian": 160,
    "studioBasic": 111
  },
  {
    "periodId": "202603",
    "region": "전체",
    "packageMedian": 289,
    "dmPackageMedian": 160,
    "studioBasic": 139
  },
  {
    "periodId": "202603",
    "region": "서울",
    "packageMedian": 350,
    "dmPackageMedian": 150,
    "studioBasic": 150
  },
  {
    "periodId": "202603",
    "region": "경기/인천",
    "packageMedian": 230,
    "dmPackageMedian": 175,
    "studioBasic": 120
  },
  {
    "periodId": "202603",
    "region": "5대광역시",
    "packageMedian": 278,
    "dmPackageMedian": 150,
    "studioBasic": 140
  },
  {
    "periodId": "202603",
    "region": "기타지역",
    "packageMedian": 274,
    "dmPackageMedian": 170,
    "studioBasic": 112
  },
  {
    "periodId": "202604",
    "region": "전체",
    "packageMedian": 294,
    "dmPackageMedian": 180,
    "studioBasic": 136.25
  },
  {
    "periodId": "202604",
    "region": "서울",
    "packageMedian": 350,
    "dmPackageMedian": 185,
    "studioBasic": 150
  },
  {
    "periodId": "202604",
    "region": "경기/인천",
    "packageMedian": 230,
    "dmPackageMedian": 133,
    "studioBasic": 120
  },
  {
    "periodId": "202604",
    "region": "5대광역시",
    "packageMedian": 281,
    "dmPackageMedian": 180,
    "studioBasic": 140
  },
  {
    "periodId": "202604",
    "region": "기타지역",
    "packageMedian": 280,
    "dmPackageMedian": 180,
    "studioBasic": 112
  },
  {
    "periodId": "202605",
    "region": "전체",
    "packageMedian": 292,
    "dmPackageMedian": 180,
    "studioBasic": 139
  },
  {
    "periodId": "202605",
    "region": "서울",
    "packageMedian": 350,
    "dmPackageMedian": 180,
    "studioBasic": 150
  },
  {
    "periodId": "202605",
    "region": "경기/인천",
    "packageMedian": 240,
    "dmPackageMedian": 133,
    "studioBasic": 120
  },
  {
    "periodId": "202605",
    "region": "5대광역시",
    "packageMedian": 278,
    "dmPackageMedian": 180,
    "studioBasic": 140
  },
  {
    "periodId": "202605",
    "region": "기타지역",
    "packageMedian": 280,
    "dmPackageMedian": 180,
    "studioBasic": 115
  }
];

export const GEN_DRESS_PRICES = [
  {
    "periodId": "202504",
    "scope": "national",
    "photoShoot": 155,
    "ceremony": 143,
    "secondDress": 140
  },
  {
    "periodId": "202504",
    "scope": "seoul",
    "photoShoot": 198,
    "ceremony": 167,
    "secondDress": 165
  },
  {
    "periodId": "202505",
    "scope": "national",
    "photoShoot": 151,
    "ceremony": 140,
    "secondDress": 140
  },
  {
    "periodId": "202505",
    "scope": "seoul",
    "photoShoot": 160,
    "ceremony": 145,
    "secondDress": 140
  },
  {
    "periodId": "202506",
    "scope": "national",
    "photoShoot": 151,
    "ceremony": 140,
    "secondDress": 139
  },
  {
    "periodId": "202506",
    "scope": "seoul",
    "photoShoot": 160,
    "ceremony": 144,
    "secondDress": 140
  },
  {
    "periodId": "202507",
    "scope": "national",
    "photoShoot": 155,
    "ceremony": 143,
    "secondDress": 140
  },
  {
    "periodId": "202507",
    "scope": "seoul",
    "photoShoot": 176,
    "ceremony": 154,
    "secondDress": 145
  },
  {
    "periodId": "202508",
    "scope": "national",
    "photoShoot": 155,
    "ceremony": 145,
    "secondDress": 140
  },
  {
    "periodId": "202508",
    "scope": "seoul",
    "photoShoot": 180,
    "ceremony": 158,
    "secondDress": 150
  },
  {
    "periodId": "202509",
    "scope": "national",
    "photoShoot": 155,
    "ceremony": 145,
    "secondDress": 142
  },
  {
    "periodId": "202509",
    "scope": "seoul",
    "photoShoot": 176,
    "ceremony": 157,
    "secondDress": 150
  },
  {
    "periodId": "202510",
    "scope": "national",
    "photoShoot": 155,
    "ceremony": 145,
    "secondDress": 143
  },
  {
    "periodId": "202510",
    "scope": "seoul",
    "photoShoot": 166,
    "ceremony": 154,
    "secondDress": 150
  },
  {
    "periodId": "202511",
    "scope": "national",
    "photoShoot": 156,
    "ceremony": 145,
    "secondDress": 143
  },
  {
    "periodId": "202511",
    "scope": "seoul",
    "photoShoot": 172,
    "ceremony": 154,
    "secondDress": 150
  },
  {
    "periodId": "202512",
    "scope": "national",
    "photoShoot": 159.75,
    "ceremony": 145,
    "secondDress": 143
  },
  {
    "periodId": "202512",
    "scope": "seoul",
    "photoShoot": 175.5,
    "ceremony": 158,
    "secondDress": 150
  },
  {
    "periodId": "202601",
    "scope": "national",
    "photoShoot": 159,
    "ceremony": 145,
    "secondDress": 142.75
  },
  {
    "periodId": "202601",
    "scope": "seoul",
    "photoShoot": 172,
    "ceremony": 150.5,
    "secondDress": 150
  },
  {
    "periodId": "202602",
    "scope": "national",
    "photoShoot": 159.75,
    "ceremony": 145,
    "secondDress": 140
  },
  {
    "periodId": "202602",
    "scope": "seoul",
    "photoShoot": 173.5,
    "ceremony": 154,
    "secondDress": 150
  },
  {
    "periodId": "202603",
    "scope": "national",
    "photoShoot": 160,
    "ceremony": 145,
    "secondDress": 140.5
  },
  {
    "periodId": "202603",
    "scope": "seoul",
    "photoShoot": 176,
    "ceremony": 156,
    "secondDress": 150
  },
  {
    "periodId": "202604",
    "scope": "national",
    "photoShoot": 160,
    "ceremony": 145,
    "secondDress": 140
  },
  {
    "periodId": "202604",
    "scope": "seoul",
    "photoShoot": 177,
    "ceremony": 158,
    "secondDress": 150
  },
  {
    "periodId": "202605",
    "scope": "national",
    "photoShoot": 160,
    "ceremony": 145,
    "secondDress": 141
  },
  {
    "periodId": "202605",
    "scope": "seoul",
    "photoShoot": 179,
    "ceremony": 158,
    "secondDress": 150
  }
];

export const GEN_MAKEUP_PRICES = [
  {
    "periodId": "202504",
    "scope": "national",
    "photoShoot": 76,
    "ceremony": 68,
    "rehearsal": 61
  },
  {
    "periodId": "202504",
    "scope": "seoul",
    "photoShoot": 96,
    "ceremony": 91,
    "rehearsal": 81
  },
  {
    "periodId": "202505",
    "scope": "national",
    "photoShoot": 73,
    "ceremony": 66,
    "rehearsal": 56
  },
  {
    "periodId": "202505",
    "scope": "seoul",
    "photoShoot": 96,
    "ceremony": 88,
    "rehearsal": 77
  },
  {
    "periodId": "202506",
    "scope": "national",
    "photoShoot": 73,
    "ceremony": 66,
    "rehearsal": 59
  },
  {
    "periodId": "202506",
    "scope": "seoul",
    "photoShoot": 95,
    "ceremony": 83,
    "rehearsal": 77
  },
  {
    "periodId": "202507",
    "scope": "national",
    "photoShoot": 76,
    "ceremony": 66,
    "rehearsal": 60
  },
  {
    "periodId": "202507",
    "scope": "seoul",
    "photoShoot": 96,
    "ceremony": 86,
    "rehearsal": 77
  },
  {
    "periodId": "202508",
    "scope": "national",
    "photoShoot": 77,
    "ceremony": 68,
    "rehearsal": 62
  },
  {
    "periodId": "202508",
    "scope": "seoul",
    "photoShoot": 96,
    "ceremony": 84,
    "rehearsal": 77
  },
  {
    "periodId": "202509",
    "scope": "national",
    "photoShoot": 77,
    "ceremony": 69,
    "rehearsal": 62
  },
  {
    "periodId": "202509",
    "scope": "seoul",
    "photoShoot": 96,
    "ceremony": 84,
    "rehearsal": 77
  },
  {
    "periodId": "202510",
    "scope": "national",
    "photoShoot": 77,
    "ceremony": 69,
    "rehearsal": 62
  },
  {
    "periodId": "202510",
    "scope": "seoul",
    "photoShoot": 96,
    "ceremony": 84,
    "rehearsal": 77
  },
  {
    "periodId": "202511",
    "scope": "national",
    "photoShoot": 77,
    "ceremony": 68,
    "rehearsal": 62
  },
  {
    "periodId": "202511",
    "scope": "seoul",
    "photoShoot": 96,
    "ceremony": 84,
    "rehearsal": 77
  },
  {
    "periodId": "202512",
    "scope": "national",
    "photoShoot": 78,
    "ceremony": 69,
    "rehearsal": 62
  },
  {
    "periodId": "202512",
    "scope": "seoul",
    "photoShoot": 96,
    "ceremony": 84,
    "rehearsal": 77
  },
  {
    "periodId": "202601",
    "scope": "national",
    "photoShoot": 78,
    "ceremony": 69,
    "rehearsal": 63
  },
  {
    "periodId": "202601",
    "scope": "seoul",
    "photoShoot": 96,
    "ceremony": 84,
    "rehearsal": 77
  },
  {
    "periodId": "202602",
    "scope": "national",
    "photoShoot": 79,
    "ceremony": 72,
    "rehearsal": 65.5
  },
  {
    "periodId": "202602",
    "scope": "seoul",
    "photoShoot": 96,
    "ceremony": 83,
    "rehearsal": 76.5
  },
  {
    "periodId": "202603",
    "scope": "national",
    "photoShoot": 81,
    "ceremony": 73,
    "rehearsal": 67
  },
  {
    "periodId": "202603",
    "scope": "seoul",
    "photoShoot": 96,
    "ceremony": 84,
    "rehearsal": 77
  },
  {
    "periodId": "202604",
    "scope": "national",
    "photoShoot": 82,
    "ceremony": 73,
    "rehearsal": 66
  },
  {
    "periodId": "202604",
    "scope": "seoul",
    "photoShoot": 96,
    "ceremony": 84,
    "rehearsal": 77
  },
  {
    "periodId": "202605",
    "scope": "national",
    "photoShoot": 80.5,
    "ceremony": 72.5,
    "rehearsal": 66
  },
  {
    "periodId": "202605",
    "scope": "seoul",
    "photoShoot": 97,
    "ceremony": 84,
    "rehearsal": 77
  }
];

export const GEN_OPTION_PRICES = [
  {
    "category": "studio",
    "name": "앨범페이지 추가",
    "nationalPrice": 3.3,
    "seoulPrice": 3.3
  },
  {
    "category": "studio",
    "name": "드레스 추가",
    "nationalPrice": 11,
    "seoulPrice": 11
  },
  {
    "category": "studio",
    "name": "드레스 외 의상 추가",
    "nationalPrice": 11.5,
    "seoulPrice": 11
  },
  {
    "category": "studio",
    "name": "수정비용",
    "nationalPrice": 5,
    "seoulPrice": 5
  },
  {
    "category": "studio",
    "name": "액자변경",
    "nationalPrice": 25,
    "seoulPrice": 24.75
  },
  {
    "category": "studio",
    "name": "촬영시간 추가",
    "nationalPrice": 11,
    "seoulPrice": 11
  },
  {
    "category": "studio",
    "name": "선수정본",
    "nationalPrice": 5.5,
    "seoulPrice": 5.5
  },
  {
    "category": "studio",
    "name": "컨펌비",
    "nationalPrice": 8.25,
    "seoulPrice": 8.25
  },
  {
    "category": "studio",
    "name": "담당자 지정",
    "nationalPrice": 17.5,
    "seoulPrice": 16.5
  },
  {
    "category": "studio",
    "name": "야외촬영",
    "nationalPrice": 15,
    "seoulPrice": 11
  },
  {
    "category": "studio",
    "name": "야간촬영",
    "nationalPrice": 15,
    "seoulPrice": 11
  },
  {
    "category": "studio",
    "name": "촬영 출장비",
    "nationalPrice": 20,
    "seoulPrice": 20
  },
  {
    "category": "studio",
    "name": "서브 스냅",
    "nationalPrice": 16.5,
    "seoulPrice": 16.5
  },
  {
    "category": "studio",
    "name": "소품 활용",
    "nationalPrice": 51,
    "seoulPrice": 60
  },
  {
    "category": "studio",
    "name": "들러리 촬영",
    "nationalPrice": 7,
    "seoulPrice": 16.5
  },
  {
    "category": "studio",
    "name": "반려동물 촬영",
    "nationalPrice": 8,
    "seoulPrice": 13.75
  },
  {
    "category": "studio",
    "name": "원본구매비",
    "nationalPrice": 30,
    "seoulPrice": 38.5
  },
  {
    "category": "studio",
    "name": "수정본구매비",
    "nationalPrice": 16.5,
    "seoulPrice": 13.75
  },
  {
    "category": "studio",
    "name": "모바일 사진 제공",
    "nationalPrice": 8.25,
    "seoulPrice": 8.25
  },
  {
    "category": "studio",
    "name": "얼리스타트비",
    "nationalPrice": 5,
    "seoulPrice": 6.25
  },
  {
    "category": "dress",
    "name": "헬퍼(촬영)",
    "nationalPrice": 25,
    "seoulPrice": 25
  },
  {
    "category": "dress",
    "name": "헬퍼(본식)",
    "nationalPrice": 25,
    "seoulPrice": 25
  },
  {
    "category": "dress",
    "name": "기본 피팅비",
    "nationalPrice": 5.5,
    "seoulPrice": 5.5
  },
  {
    "category": "dress",
    "name": "추가 피팅비",
    "nationalPrice": 5.5,
    "seoulPrice": 5.5
  },
  {
    "category": "dress",
    "name": "재가봉비",
    "nationalPrice": 10,
    "seoulPrice": 10
  },
  {
    "category": "dress",
    "name": "가봉스냅",
    "nationalPrice": 75,
    "seoulPrice": 75
  },
  {
    "category": "dress",
    "name": "드레스 지정비",
    "nationalPrice": 88,
    "seoulPrice": 78.75
  },
  {
    "category": "dress",
    "name": "디자인 추가",
    "nationalPrice": 115,
    "seoulPrice": 110
  },
  {
    "category": "dress",
    "name": "웨딩슈즈 대여",
    "nationalPrice": 0,
    "seoulPrice": 1.5
  },
  {
    "category": "dress",
    "name": "2부 드레스",
    "nationalPrice": 42,
    "seoulPrice": 50
  },
  {
    "category": "dress",
    "name": "퍼스트웨어",
    "nationalPrice": 110,
    "seoulPrice": 110
  },
  {
    "category": "dress",
    "name": "야외 예식",
    "nationalPrice": 15,
    "seoulPrice": 15
  },
  {
    "category": "dress",
    "name": "턱시도 대여",
    "nationalPrice": 21.25,
    "seoulPrice": 25
  },
  {
    "category": "dress",
    "name": "액세서리 대여",
    "nationalPrice": 0,
    "seoulPrice": 0
  },
  {
    "category": "makeup",
    "name": "담당자 지정",
    "nationalPrice": 5.5,
    "seoulPrice": 5.5
  },
  {
    "category": "makeup",
    "name": "촬영 출장비",
    "nationalPrice": 20,
    "seoulPrice": 15
  },
  {
    "category": "makeup",
    "name": "휴무일 진행비",
    "nationalPrice": 16.5,
    "seoulPrice": 16.5
  },
  {
    "category": "makeup",
    "name": "신랑 메이크업",
    "nationalPrice": 5,
    "seoulPrice": 5
  },
  {
    "category": "makeup",
    "name": "신랑헤어",
    "nationalPrice": 5,
    "seoulPrice": 5.5
  },
  {
    "category": "makeup",
    "name": "신부 커트",
    "nationalPrice": 7.5,
    "seoulPrice": 6.6
  },
  {
    "category": "makeup",
    "name": "가발",
    "nationalPrice": 10,
    "seoulPrice": 11
  },
  {
    "category": "makeup",
    "name": "흑채",
    "nationalPrice": 3.3,
    "seoulPrice": 3.3
  },
  {
    "category": "makeup",
    "name": "헤어변형",
    "nationalPrice": 35,
    "seoulPrice": 35
  },
  {
    "category": "makeup",
    "name": "헤어피스 구매",
    "nationalPrice": 16,
    "seoulPrice": 16
  },
  {
    "category": "makeup",
    "name": "헤어피스 보증금",
    "nationalPrice": 10,
    "seoulPrice": 10
  },
  {
    "category": "makeup",
    "name": "헤어피스 시술",
    "nationalPrice": 11,
    "seoulPrice": 11
  },
  {
    "category": "makeup",
    "name": "남성혼주 헤어&메이크업",
    "nationalPrice": 8.5,
    "seoulPrice": 8.8
  },
  {
    "category": "makeup",
    "name": "여성혼주 헤어&메이크업",
    "nationalPrice": 26.4,
    "seoulPrice": 29.7
  },
  {
    "category": "makeup",
    "name": "레이트 스타트비",
    "nationalPrice": 8.25,
    "seoulPrice": 8.25
  },
  {
    "category": "makeup",
    "name": "얼리스타트비",
    "nationalPrice": 12.62,
    "seoulPrice": 13.75
  }
];

export const GEN_SEASONAL_DATA = [
  {
    "periodId": "202504",
    "peak": 1620,
    "offPeak": 1170,
    "savings": 450
  },
  {
    "periodId": "202505",
    "peak": 1620,
    "offPeak": 1120,
    "savings": 500
  },
  {
    "periodId": "202506",
    "peak": 1630,
    "offPeak": 1150,
    "savings": 480
  },
  {
    "periodId": "202507",
    "peak": 1650,
    "offPeak": 1111,
    "savings": 539
  },
  {
    "periodId": "202508",
    "peak": 1662,
    "offPeak": 1295,
    "savings": 367
  },
  {
    "periodId": "202509",
    "peak": 1696,
    "offPeak": 1175,
    "savings": 521
  },
  {
    "periodId": "202510",
    "peak": 1630,
    "offPeak": 1175,
    "savings": 455
  },
  {
    "periodId": "202511",
    "peak": 1640,
    "offPeak": 1170,
    "savings": 470
  },
  {
    "periodId": "202512",
    "peak": 1610,
    "offPeak": 1155,
    "savings": 455
  },
  {
    "periodId": "202601",
    "peak": 1630,
    "offPeak": 1250,
    "savings": 380
  },
  {
    "periodId": "202602",
    "peak": 1610,
    "offPeak": 1400,
    "savings": 210
  },
  {
    "periodId": "202603",
    "peak": 1550,
    "offPeak": 1418,
    "savings": 132
  },
  {
    "periodId": "202604",
    "peak": 1575,
    "offPeak": 1400,
    "savings": 175
  },
  {
    "periodId": "202605",
    "peak": 1550,
    "offPeak": 1400,
    "savings": 150
  }
];
