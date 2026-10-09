import type { Character } from "@/lib/weddingCode/likert/types";

export interface CharacterPortraitProps {
  character: Character;
  className?: string;
}

// Existing design tokens only. These illustration colours do not encode response strength.
const toneClasses: Record<Character["color"], string> = {
  rose: "fill-[var(--rose-pale)]",
  sage: "fill-[var(--sage-pale)]",
  gold: "fill-[var(--gold-light)]",
  blue: "fill-[var(--hb-chat-sky-line)]",
};
const cream = "fill-[var(--ivory-50)]";
const warm = "fill-[var(--ivory-deep)]";
const ink = "fill-[var(--hb-text-strong)]";
const softInk = "fill-[var(--hb-text-body)]";
const blush = "fill-[var(--rose-light)]";

function Eyes({ x = 120, y = 109, spread = 18 }: { x?: number; y?: number; spread?: number }) {
  return <g stroke="none">
    <circle cx={x - spread} cy={y} r="3.4" className={ink} />
    <circle cx={x + spread} cy={y} r="3.4" className={ink} />
    <circle cx={x - spread + 0.9} cy={y - 1.1} r="1" className={cream} />
    <circle cx={x + spread + 0.9} cy={y - 1.1} r="1" className={cream} />
  </g>;
}

function Cheeks({ x = 120, y = 124, spread = 31 }: { x?: number; y?: number; spread?: number }) {
  return <g stroke="none" className={`${blush} opacity-60`}>
    <ellipse cx={x - spread} cy={y} rx="8" ry="4" />
    <ellipse cx={x + spread} cy={y} rx="8" ry="4" />
  </g>;
}

function Smile({ x = 120, y = 126 }: { x?: number; y?: number }) {
  return <path d={`M${x - 9} ${y} Q${x} ${y + 9} ${x + 9} ${y}`} fill="none" />;
}

function Flower({ x, y }: { x: number; y: number }) {
  return <g stroke="none" className={blush}>
    <ellipse cx={x} cy={y - 5} rx="3.5" ry="5" />
    <ellipse cx={x} cy={y + 5} rx="3.5" ry="5" />
    <ellipse cx={x - 5} cy={y} rx="5" ry="3.5" />
    <ellipse cx={x + 5} cy={y} rx="5" ry="3.5" />
    <circle cx={x} cy={y} r="3" className="fill-[var(--gold)]" />
  </g>;
}

function AnimalArtwork({ animal, tone }: { animal: string; tone: string }) {
  switch (animal) {
    case "수달":
      return <g data-animal-art="otter">
        <path d="M148 169 Q207 169 197 195 Q192 209 164 202" className={tone} />
        <ellipse cx="118" cy="158" rx="45" ry="49" className={tone} />
        <ellipse cx="117" cy="170" rx="27" ry="31" className={cream} stroke="none" />
        <ellipse cx="91" cy="202" rx="18" ry="9" className={tone} />
        <ellipse cx="143" cy="202" rx="18" ry="9" className={tone} />
        <circle cx="80" cy="83" r="15" className={tone} />
        <circle cx="156" cy="83" r="15" className={tone} />
        <circle cx="80" cy="83" r="8" className={warm} stroke="none" />
        <circle cx="156" cy="83" r="8" className={warm} stroke="none" />
        <path d="M73 104 Q72 68 118 68 Q164 68 163 104 Q167 142 118 149 Q68 142 73 104Z" className={tone} />
        <path d="M89 115 Q100 102 118 114 Q135 102 148 115 Q147 138 118 140 Q88 138 89 115Z" className={cream} stroke="none" />
        <Eyes x={118} y={103} />
        <Cheeks x={118} y={120} spread={32} />
        <path d="M112 116 Q118 112 124 116 L118 122Z" className={ink} stroke="none" />
        <path d="M118 122V127 M118 127Q109 135 102 127 M118 127Q127 135 134 127" fill="none" />
        <path d="M79 164 Q91 156 104 169 M157 164 Q145 156 132 169" fill="none" />
        <path d="M102 169 Q118 153 134 169 L129 184 Q118 190 107 184Z" className={cream} />
        <path d="M118 160V184 M110 164L114 185 M126 164L122 185" className="stroke-[var(--gold)]" />
      </g>;
    case "비버":
      return <g data-animal-art="beaver">
        <path d="M148 163 Q185 139 201 163 Q211 186 181 205 L151 184Z" className={warm} />
        <path d="M166 156L192 183 M157 171L180 194 M176 153L156 181 M193 162L173 198" className="stroke-[var(--taupe-400)]" />
        <ellipse cx="113" cy="158" rx="46" ry="44" className={tone} />
        <ellipse cx="91" cy="202" rx="19" ry="8" className={tone} />
        <ellipse cx="139" cy="202" rx="19" ry="8" className={tone} />
        <circle cx="77" cy="82" r="14" className={tone} />
        <circle cx="150" cy="82" r="14" className={tone} />
        <circle cx="77" cy="82" r="7" className={warm} stroke="none" />
        <circle cx="150" cy="82" r="7" className={warm} stroke="none" />
        <path d="M65 113 Q63 72 113 69 Q166 71 162 113 Q160 149 114 152 Q69 149 65 113Z" className={tone} />
        <ellipse cx="113" cy="126" rx="29" ry="20" className={cream} stroke="none" />
        <Eyes x={113} y={106} spread={21} />
        <Cheeks x={113} y={122} spread={35} />
        <ellipse cx="113" cy="119" rx="7" ry="5" className={ink} stroke="none" />
        <path d="M113 124V128 M113 128Q104 135 96 129 M113 128Q122 135 130 129" fill="none" />
        <path d="M105 133H121V145Q113 150 105 145Z" className={cream} />
        <path d="M113 134V146 M80 163Q97 151 102 169 M149 163Q132 151 127 169" fill="none" />
        <path d="M104 172L116 164L127 176L115 188Z" className="fill-[var(--rose-pale)]" />
      </g>;
    case "사슴":
      return <g data-animal-art="deer">
        <path d="M89 73L85 43L77 29 M85 49L66 41 M85 43L96 31 M150 73L155 43L163 29 M155 49L174 41 M155 43L144 31" fill="none" className="stroke-[var(--gold)]" strokeWidth="5" />
        <path d="M88 79Q60 53 54 70Q59 94 88 101 M151 79Q180 53 186 70Q181 94 151 101" className={tone} />
        <path d="M78 86L63 74 M162 86L177 74" className="stroke-[var(--rose-light)]" />
        <ellipse cx="120" cy="168" rx="34" ry="39" className={tone} />
        <path d="M91 188L88 207H105L109 188 M131 188L135 207H152L149 188" className={tone} />
        <path d="M87 102Q82 75 120 73Q158 75 153 102L148 126Q143 153 120 156Q97 153 92 126Z" className={tone} />
        <ellipse cx="120" cy="135" rx="21" ry="14" className={cream} stroke="none" />
        <Eyes y={111} spread={19} />
        <Cheeks y={124} spread={26} />
        <path d="M114 130Q120 126 126 130L120 135Z" className={ink} stroke="none" />
        <Smile y={138} />
        <g className={cream} stroke="none"><circle cx="96" cy="97" r="3" /><circle cx="145" cy="98" r="3" /><circle cx="105" cy="166" r="3" /><circle cx="135" cy="160" r="3" /><circle cx="131" cy="177" r="3" /></g>
        <path d="M118 165Q100 175 105 191 M122 165Q140 175 135 191" fill="none" />
        <Flower x={120} y={181} />
      </g>;
    case "기러기":
      return <g data-animal-art="goose">
        <path d="M159 174L191 157Q193 176 172 189" className={tone} />
        <ellipse cx="143" cy="170" rx="47" ry="32" className={cream} />
        <path d="M101 172Q86 158 89 133L89 110Q69 101 76 82Q83 65 103 68Q126 71 121 93Q117 107 111 115L116 149" className={cream} />
        <path d="M82 91L60 100L80 108Z" className="fill-[var(--gold-light)]" />
        <Eyes x={101} y={89} spread={0} />
        <Cheeks x={99} y={103} spread={0} />
        <path d="M130 152Q157 137 172 161Q167 186 137 180Q151 175 153 167Q145 175 131 172" className={tone} />
        <path d="M118 193V205L104 211 M152 195V206L168 211" fill="none" className="stroke-[var(--gold)]" strokeWidth="4" />
        <path d="M89 129Q100 135 112 128" className="stroke-[var(--rose-light)]" strokeWidth="6" />
        <Flower x={109} y={133} />
      </g>;
    case "고슴도치":
      return <g data-animal-art="hedgehog">
        <path d="M56 179L43 161L51 144L43 125L61 115L57 94L77 92L83 73L101 81L116 64L130 81L149 70L159 89L180 87L182 108L200 118L190 136L198 154L183 170L183 188Z" className={tone} />
        <path d="M69 109L79 118 M84 88L94 101 M115 81L119 97 M155 91L147 107 M183 117L168 121 M189 152L175 148" className="stroke-[var(--taupe-400)]" />
        <ellipse cx="125" cy="154" rx="58" ry="45" className={cream} />
        <circle cx="86" cy="119" r="11" className={cream} />
        <circle cx="158" cy="119" r="11" className={cream} />
        <circle cx="86" cy="119" r="5" className={blush} stroke="none" />
        <circle cx="158" cy="119" r="5" className={blush} stroke="none" />
        <ellipse cx="95" cy="198" rx="14" ry="8" className={warm} />
        <ellipse cx="153" cy="198" rx="14" ry="8" className={warm} />
        <Eyes x={123} y={142} spread={21} />
        <Cheeks x={123} y={156} spread={34} />
        <path d="M116 155L130 155L123 163Z" className={ink} stroke="none" />
        <Smile x={123} y={168} />
        <path d="M96 179Q105 170 113 181 M151 179Q142 170 134 181" fill="none" />
        <Flower x={125} y={189} />
      </g>;
    case "다람쥐":
      return <g data-animal-art="squirrel">
        <path d="M143 183Q195 186 199 128Q203 73 177 68Q150 64 154 94Q157 113 178 111Q165 108 165 94Q181 90 183 111Q189 153 149 158" className={tone} />
        <path d="M171 129Q181 146 161 166" fill="none" className="stroke-[var(--ivory-50)]" strokeWidth="7" />
        <ellipse cx="111" cy="165" rx="36" ry="39" className={tone} />
        <ellipse cx="111" cy="172" rx="20" ry="26" className={cream} stroke="none" />
        <ellipse cx="89" cy="204" rx="16" ry="7" className={tone} />
        <ellipse cx="134" cy="204" rx="16" ry="7" className={tone} />
        <path d="M80 91Q65 79 74 50Q89 56 96 84 M130 85Q141 52 151 55Q158 79 141 94" className={tone} />
        <path d="M70 113Q67 79 110 79Q152 79 150 113Q149 145 111 150Q72 145 70 113Z" className={tone} />
        <ellipse cx="111" cy="127" rx="24" ry="17" className={cream} stroke="none" />
        <Eyes x={111} y={109} spread={18} />
        <Cheeks x={111} y={123} spread={29} />
        <path d="M106 121L116 121L111 126Z" className={ink} stroke="none" />
        <Smile x={111} y={132} />
        <path d="M83 160Q93 158 101 173 M139 160Q127 158 121 173" fill="none" />
        <path d="M100 176Q99 194 111 200Q123 194 122 176Z" className={warm} />
        <path d="M97 177Q111 162 125 177Z" className="fill-[var(--gold-light)]" />
        <path d="M111 166V160" fill="none" />
      </g>;
    case "곰":
      return <g data-animal-art="bear">
        <ellipse cx="120" cy="164" rx="46" ry="43" className={tone} />
        <ellipse cx="120" cy="171" rx="27" ry="26" className={cream} stroke="none" />
        <ellipse cx="88" cy="203" rx="21" ry="9" className={tone} />
        <ellipse cx="153" cy="203" rx="21" ry="9" className={tone} />
        <circle cx="78" cy="75" r="19" className={tone} />
        <circle cx="162" cy="75" r="19" className={tone} />
        <circle cx="78" cy="75" r="10" className={warm} stroke="none" />
        <circle cx="162" cy="75" r="10" className={warm} stroke="none" />
        <path d="M67 104Q64 63 120 62Q175 63 173 104Q175 146 120 150Q65 147 67 104Z" className={tone} />
        <ellipse cx="120" cy="127" rx="27" ry="18" className={cream} stroke="none" />
        <Eyes y={105} spread={22} />
        <Cheeks y={121} spread={36} />
        <ellipse cx="120" cy="121" rx="8" ry="5" className={ink} stroke="none" />
        <path d="M120 126V131 M120 131Q109 139 104 131 M120 131Q131 139 136 131" fill="none" />
        <path d="M78 160Q89 171 108 174 M162 160Q151 171 132 174" fill="none" />
        <path d="M119 171Q111 163 107 171Q102 181 120 190Q138 181 133 171Q129 163 121 171" className="fill-[var(--rose-pale)]" />
      </g>;
    case "펭귄":
      return <g data-animal-art="penguin">
        <path d="M80 132Q50 141 63 182Q80 177 89 157 M160 132Q190 141 177 182Q160 177 151 157" className={tone} />
        <path d="M71 131Q65 74 120 69Q175 74 169 131L166 175Q160 205 120 207Q80 205 74 175Z" className={tone} />
        <path d="M85 126Q78 100 97 94Q114 90 120 109Q126 90 143 94Q162 100 155 126L151 178Q149 195 120 197Q91 195 89 178Z" className={cream} stroke="none" />
        <Eyes y={115} spread={20} />
        <Cheeks y={133} spread={29} />
        <path d="M111 127L129 127L120 139Z" className="fill-[var(--gold-light)]" />
        <path d="M81 206Q89 190 106 205L101 214H78Z M134 205Q151 190 159 206L162 214H139Z" className="fill-[var(--gold-light)]" />
        <path d="M87 150Q120 163 153 150" fill="none" className="stroke-[var(--rose-light)]" strokeWidth="7" />
        <path d="M132 157L141 180L151 176L143 155" className="fill-[var(--rose-pale)]" />
      </g>;
    case "토끼":
      return <g data-animal-art="rabbit">
        <ellipse cx="120" cy="168" rx="38" ry="38" className={cream} />
        <circle cx="157" cy="179" r="15" className={cream} />
        <ellipse cx="93" cy="205" rx="19" ry="8" className={cream} />
        <ellipse cx="145" cy="205" rx="19" ry="8" className={cream} />
        <path d="M87 90Q70 64 80 30Q88 18 97 34Q111 61 103 94 M137 91Q135 62 151 30Q165 20 167 39Q169 69 153 99" className={cream} />
        <path d="M89 42Q84 62 95 82 M156 42Q157 64 147 82" fill="none" className="stroke-[var(--rose-light)]" strokeWidth="7" />
        <path d="M74 117Q70 82 120 82Q168 82 166 117Q166 153 120 155Q74 153 74 117Z" className={cream} />
        <Eyes y={115} spread={21} />
        <Cheeks y={132} spread={31} />
        <path d="M115 128Q120 125 125 128L120 134Z" className={blush} stroke="none" />
        <path d="M120 134V138 M120 138Q112 145 106 138 M120 138Q128 145 134 138" fill="none" />
        <path d="M87 171Q100 162 110 177 M153 171Q140 162 130 177" fill="none" />
        <path d="M112 177Q105 172 106 180L120 190L134 180Q135 172 128 177L120 181Z" className={tone} />
        <Flower x={156} y={92} />
      </g>;
    case "돌고래":
      return <g data-animal-art="dolphin">
        <path d="M65 171Q48 196 24 190Q33 168 54 159Q32 149 33 128Q55 132 70 150" className={tone} />
        <path d="M62 166Q70 86 137 72Q175 61 192 91L208 111Q227 112 221 124Q209 136 181 124Q172 166 115 181Q83 187 62 166Z" className={tone} />
        <path d="M113 83Q127 51 148 47L151 74" className={tone} />
        <path d="M154 140Q155 162 176 177Q182 151 166 133" className={tone} />
        <path d="M77 163Q111 173 144 156Q169 145 181 124Q164 160 126 173Q96 184 77 163Z" className={cream} stroke="none" />
        <circle cx="174" cy="105" r="3.5" className={ink} stroke="none" />
        <circle cx="175" cy="104" r="1" className={cream} stroke="none" />
        <ellipse cx="177" cy="119" rx="7" ry="4" className={`${blush} opacity-60`} stroke="none" />
        <path d="M182 126Q197 132 208 123" fill="none" />
        <path d="M99 191Q110 184 121 191 M139 197Q150 189 161 197" fill="none" className="stroke-[var(--hb-chat-sky-line)]" />
        <circle cx="197" cy="72" r="4" className={cream} />
        <circle cx="210" cy="58" r="6" className={cream} />
      </g>;
    case "부엉이":
      return <g data-animal-art="owl">
        <path d="M77 88L74 56L105 73 M136 73L166 56L163 89" className={tone} />
        <path d="M71 116Q62 72 120 71Q178 72 169 116L168 165Q163 203 120 208Q77 203 72 165Z" className={tone} />
        <path d="M82 133Q70 145 80 181Q94 176 101 151 M158 133Q170 145 160 181Q146 176 139 151" className={warm} />
        <path d="M83 115Q76 84 99 86Q114 84 120 100Q126 84 141 86Q164 84 157 115Q151 140 120 151Q89 140 83 115Z" className={cream} stroke="none" />
        <circle cx="100" cy="109" r="14" fill="none" className="stroke-[var(--ivory-deep)]" />
        <circle cx="140" cy="109" r="14" fill="none" className="stroke-[var(--ivory-deep)]" />
        <Eyes y={109} spread={20} />
        <Cheeks y={130} spread={27} />
        <path d="M114 124L126 124L120 135Z" className="fill-[var(--gold-light)]" />
        <path d="M105 158Q111 166 117 158 M123 158Q129 166 135 158 M105 178Q111 186 117 178 M123 178Q129 186 135 178" fill="none" className="stroke-[var(--gold)]" />
        <path d="M102 203L98 212 M107 203V213 M112 203L116 212 M128 203L124 212 M133 203V213 M138 203L142 212" fill="none" />
      </g>;
    case "제비":
      return <g data-animal-art="swallow">
        <path d="M106 152Q71 147 35 107Q53 94 97 122L92 80Q117 106 124 133 M139 132Q173 101 206 98Q202 126 166 149" className={tone} />
        <path d="M106 175L83 213L121 196L148 215L143 173" className={tone} />
        <path d="M89 122Q88 82 123 80Q161 82 158 121L157 154Q151 184 124 187Q96 184 90 154Z" className={tone} />
        <path d="M105 122Q123 111 143 122L142 160Q140 176 124 178Q107 175 106 159Z" className={cream} stroke="none" />
        <Eyes x={123} y={113} spread={17} />
        <Cheeks x={123} y={127} spread={24} />
        <path d="M117 123L129 123L123 132Z" className="fill-[var(--gold-light)]" />
        <path d="M105 137Q122 148 142 137" fill="none" className="stroke-[var(--rose-light)]" strokeWidth="6" />
        <path d="M60 116L85 133 M177 124L157 137" fill="none" className="stroke-[var(--ivory-50)]" />
        <Flower x={168} y={76} />
      </g>;
    case "고양이":
      return <g data-animal-art="cat">
        <path d="M157 181Q199 190 196 155Q193 134 178 138Q165 146 178 155" className={tone} />
        <ellipse cx="119" cy="166" rx="40" ry="39" className={tone} />
        <ellipse cx="119" cy="175" rx="22" ry="25" className={cream} stroke="none" />
        <ellipse cx="94" cy="204" rx="18" ry="8" className={tone} />
        <ellipse cx="143" cy="204" rx="18" ry="8" className={tone} />
        <path d="M76 105L71 59L105 78Q120 73 135 78L168 59L163 105Q175 149 120 153Q64 149 76 105Z" className={tone} />
        <path d="M81 78L84 96L99 86 M158 78L155 96L141 86" className="fill-[var(--rose-light)]" stroke="none" />
        <Eyes y={111} spread={22} />
        <Cheeks y={128} spread={30} />
        <path d="M115 124L125 124L120 130Z" className={ink} stroke="none" />
        <path d="M120 130V135 M120 135Q110 143 104 135 M120 135Q130 143 136 135 M81 124L61 119 M82 132L60 134 M159 124L179 119 M158 132L180 134" fill="none" />
        <path d="M113 80L117 89 M126 80L123 89" fill="none" className="stroke-[var(--sage-500)]" />
        <path d="M103 167Q119 177 135 167" fill="none" className="stroke-[var(--rose-light)]" strokeWidth="6" />
      </g>;
    case "여우":
      return <g data-animal-art="fox">
        <path d="M151 184Q189 168 197 128Q221 173 197 198Q171 219 149 200" className={tone} />
        <path d="M197 128Q211 149 210 166L193 157L186 163Q194 145 197 128Z" className={cream} stroke="none" />
        <ellipse cx="114" cy="168" rx="38" ry="36" className={tone} />
        <path d="M99 140Q112 162 128 139L139 183Q116 208 90 183Z" className={cream} stroke="none" />
        <ellipse cx="88" cy="204" rx="17" ry="7" className={tone} />
        <ellipse cx="139" cy="204" rx="17" ry="7" className={tone} />
        <path d="M72 107L70 51L101 78Q115 73 130 78L160 51L160 108L173 119L146 139L115 158L84 139L57 119Z" className={tone} />
        <path d="M81 73L83 96L96 86 M149 73L146 96L134 86" className={warm} stroke="none" />
        <path d="M66 119Q90 115 114 139Q138 115 164 119L141 135L114 151L88 135Z" className={cream} stroke="none" />
        <Eyes x={115} y={110} spread={22} />
        <Cheeks x={115} y={127} spread={33} />
        <path d="M108 136Q115 131 122 136L115 142Z" className={ink} stroke="none" />
        <Smile x={115} y={145} />
        <Flower x={94} y={168} />
      </g>;
    case "판다":
      return <g data-animal-art="panda">
        <ellipse cx="120" cy="167" rx="47" ry="41" className={cream} />
        <ellipse cx="83" cy="165" rx="15" ry="25" className={softInk} />
        <ellipse cx="156" cy="165" rx="15" ry="25" className={softInk} />
        <ellipse cx="89" cy="203" rx="20" ry="10" className={softInk} />
        <ellipse cx="151" cy="203" rx="20" ry="10" className={softInk} />
        <circle cx="78" cy="76" r="19" className={softInk} />
        <circle cx="163" cy="76" r="19" className={softInk} />
        <path d="M65 109Q61 65 120 64Q179 65 175 109Q177 152 120 155Q63 152 65 109Z" className={cream} />
        <ellipse cx="97" cy="111" rx="15" ry="20" transform="rotate(22 97 111)" className={softInk} stroke="none" />
        <ellipse cx="144" cy="111" rx="15" ry="20" transform="rotate(-22 144 111)" className={softInk} stroke="none" />
        <g stroke="none" className={cream}><circle cx="99" cy="109" r="4" /><circle cx="142" cy="109" r="4" /></g>
        <g stroke="none" className={ink}><circle cx="100" cy="110" r="2.4" /><circle cx="141" cy="110" r="2.4" /></g>
        <Cheeks y={133} spread={31} />
        <path d="M113 128Q120 123 127 128L120 135Z" className={ink} stroke="none" />
        <Smile y={139} />
        <path d="M105 172Q120 184 136 172" fill="none" className="stroke-[var(--rose-light)]" strokeWidth="7" />
        <Flower x={146} y={168} />
      </g>;
    case "코알라":
      return <g data-animal-art="koala">
        <path d="M164 202L177 115" fill="none" className="stroke-[var(--sage-500)]" strokeWidth="4" />
        <path d="M175 135Q190 115 198 120Q195 137 175 135 M170 165Q151 151 157 142Q174 148 170 165 M174 146Q193 140 199 151Q190 161 174 146" className="fill-[var(--sage-pale)] stroke-[var(--sage-500)]" />
        <ellipse cx="118" cy="167" rx="39" ry="38" className={tone} />
        <ellipse cx="118" cy="175" rx="21" ry="24" className={cream} stroke="none" />
        <ellipse cx="90" cy="204" rx="17" ry="8" className={tone} />
        <ellipse cx="141" cy="204" rx="17" ry="8" className={tone} />
        <path d="M85 164Q82 182 108 184 M147 166Q153 181 171 174" fill="none" />
        <path d="M74 70Q53 54 46 73L40 73L41 90L35 96L45 108L44 117L62 120Q84 123 92 100 M158 70Q179 54 186 73L192 73L191 90L197 96L187 108L188 117L170 120Q148 123 140 100" className={tone} />
        <ellipse cx="64" cy="92" rx="13" ry="20" className={cream} stroke="none" />
        <ellipse cx="168" cy="92" rx="13" ry="20" className={cream} stroke="none" />
        <path d="M72 112Q68 70 117 69Q166 70 161 112Q166 151 117 156Q68 151 72 112Z" className={tone} />
        <Eyes x={117} y={111} spread={23} />
        <Cheeks x={117} y={132} spread={32} />
        <path d="M109 109Q117 102 125 109L128 127Q127 138 117 138Q107 138 106 127Z" className={softInk} stroke="none" />
        <Smile x={117} y={142} />
      </g>;
    default:
      return null;
  }
}

/** Original local vector artwork. The adjacent visible character name supplies its meaning. */
export function CharacterPortrait({ character, className }: CharacterPortraitProps) {
  return <svg
    viewBox="0 0 240 240"
    aria-hidden="true"
    focusable="false"
    data-character-portrait={character.code}
    className={`block shrink-0 text-[var(--hb-text-strong)] ${className ?? "h-40 w-40"}`}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="120" cy="120" r="105" className="fill-[var(--hb-summary-surface)]" stroke="none" />
    <circle cx="188" cy="46" r="12" className="fill-[var(--ivory-50)] opacity-70" stroke="none" />
    <circle cx="44" cy="159" r="7" className="fill-[var(--ivory-50)] opacity-70" stroke="none" />
    <path d="M44 69V81 M38 75H50 M192 175V185 M187 180H197" className="stroke-[var(--gold)]" strokeWidth="1.8" />
    <ellipse cx="121" cy="212" rx="59" ry="6" className="fill-[var(--hb-summary-line)] opacity-50" stroke="none" />
    <AnimalArtwork animal={character.animal} tone={toneClasses[character.color]} />
  </svg>;
}

export default CharacterPortrait;
