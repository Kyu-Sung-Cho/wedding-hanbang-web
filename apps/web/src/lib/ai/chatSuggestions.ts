export type ChatSuggestionExtraction = {
  cleanText: string;
  suggestions: string[];
};

// 아모라 응답에서 [suggestions] 블록 추출. 백틱으로 감싸진 경우와 일반 태그를 모두 지원한다.
export function extractSuggestions(text: string): ChatSuggestionExtraction {
  const patterns = [
    /```\n?\[suggestions\]\n([\s\S]*?)\[\/suggestions\]\n?```/,
    /\[suggestions\]\n([\s\S]*?)\[\/suggestions\]/,
    /```\n?\[suggestion\]\n([\s\S]*?)\[\/suggestion\]\n?```/i,
    /\[suggestion\]\n([\s\S]*?)\[\/suggestion\]/i,
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match) {
      const suggestions = match[1]
        .split("\n")
        .map((suggestion) => suggestion.trim())
        .filter(Boolean);
      const cleanText = stripSuggestionArtifacts(text.replace(regex, "")).trim();
      return { cleanText, suggestions };
    }
  }

  return { cleanText: stripSuggestionArtifacts(text).trim(), suggestions: [] };
}

export function stripSuggestionArtifacts(text: string): string {
  return text
    .replace(/^\s*\[(?:suggestion|suggestions|추천(?:\s*질문|\s*대화)?)\]\s*$/gim, "")
    .replace(/\[(?:\/suggestion|\/suggestions)\]/gi, "");
}
