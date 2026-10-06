/** Original local vector illustration; decorative because the animal name is visible beside it. */
export function CharacterPortrait({ index }: {
    index: number;
}) {
    const long = [8, 10].includes(index);
    const round = [3, 9, 10, 13, 14].includes(index);
    return <svg viewBox="0 0 160 160" width="160" height="160" aria-hidden="true" className="h-28 w-28 shrink-0" fill="none" stroke="var(--hb-text-strong)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
  <circle cx="80" cy="80" r="72" fill="var(--hb-surface-hover)" stroke="none"/>
  {index === 15 ? <><ellipse cx="40" cy="77" rx="24" ry="32" fill="var(--hb-surface-page)"/><ellipse cx="120" cy="77" rx="24" ry="32" fill="var(--hb-surface-page)"/></> : <><path d={long ? "M44 62 Q20 7 44 16 Q65 28 61 65" : round ? "M42 62 C15 56 22 28 42 33 C60 37 60 56 59 64" : "M37 68 L29 28 L65 54"} fill="var(--hb-surface-page)"/><path d={long ? "M116 62 Q140 7 116 16 Q95 28 99 65" : round ? "M118 62 C145 56 138 28 118 33 C100 37 100 56 101 64" : "M123 68 L131 28 L95 54"} fill="var(--hb-surface-page)"/></>}
  <ellipse cx="80" cy="86" rx="48" ry="43" fill="var(--hb-surface-page)"/>
  {index === 14 || index === 13 ? <><ellipse cx="60" cy="78" rx="13" ry="15" fill="var(--hb-hairline)"/><ellipse cx="100" cy="78" rx="13" ry="15" fill="var(--hb-hairline)"/></> : null}
  <circle cx="61" cy="79" r="3" fill="var(--hb-text-strong)"/><circle cx="99" cy="79" r="3" fill="var(--hb-text-strong)"/>
  {index === 15 ? <path d="M75 93 V116 Q94 131 99 110"/> : <><path d="M74 94 Q80 89 86 94 L80 100 Z" fill="var(--hb-text-strong)"/><path d="M80 100 Q68 113 61 101 M80 100 Q92 113 99 101"/></>}
  {index === 1 ? <path d="M72 110 V121 H87 V110 M80 111 V121"/> : null}
  {index === 0 || index === 4 || index === 5 || index === 12 || index === 13 ? <path d="M44 94 L24 89 M44 100 L22 103 M116 94 L136 89 M116 100 L138 103"/> : null}
  {index === 2 ? <><path d="M65 92 L80 110 L95 92 Z" fill="var(--hb-accent)"/><path d="M40 85 Q48 47 80 50 Q112 47 120 85" strokeWidth="7"/></> : null}
  {index === 6 ? <><path d="M48 47 L43 21 M44 30 L28 25 M44 27 L54 16 M112 47 L117 21 M116 30 L132 25 M116 27 L106 16"/><circle cx="46" cy="91" r="3"/><circle cx="114" cy="91" r="3"/></> : null}
  {index === 7 ? <><path d="M31 120 L17 124 M129 120 L143 124 M57 123 L51 140 M103 123 L109 140"/><path d="M62 126 L80 113 L98 126 L94 141 L66 141 Z" fill="var(--hb-hairline)"/></> : null}
  {index === 9 ? <><path d="M35 88 Q6 109 26 123 L45 112 M125 88 Q154 109 134 123 L115 112"/><path d="M64 102 Q80 113 102 98"/></> : null}
  {index === 10 ? <><path d="M44 104 L51 137 Q80 148 109 137 L116 104"/><path d="M61 55 Q57 39 71 42 Q77 27 85 42 Q100 39 99 55" fill="var(--hb-surface-page)"/></> : null}
  {index === 11 ? <><path d="M38 58 Q10 64 22 108 Q38 120 46 91 M122 58 Q150 64 138 108 Q122 120 114 91" fill="var(--hb-hairline)"/><ellipse cx="100" cy="78" rx="12" ry="17" stroke="none" fill="var(--hb-hairline)"/></> : null}
  {index === 12 ? <><path d="M45 55 Q25 40 35 22 Q59 34 61 56 M115 55 Q135 40 125 22 Q101 34 99 56"/><path d="M125 115 Q150 75 142 57 Q128 45 125 71" strokeWidth="9"/></> : null}
  {index === 5 ? <path d="M35 92 L59 104 L80 120 L101 104 L125 92" strokeWidth="5"/> : null}
  {index === 3 ? <ellipse cx="80" cy="101" rx="23" ry="16" strokeWidth="2"/> : null}
  <path d="M58 135 Q80 125 102 135" stroke="var(--hb-accent)"/>
 </svg>;
}
