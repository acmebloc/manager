const CHOSUNG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
]

function toChosung(char) {
  const code = char.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return char // not a complete Hangul syllable — pass through
  return CHOSUNG[Math.floor(code / 588)]
}

export function chosungOf(text) {
  return [...text].map(toChosung).join('')
}

// True when `query` matches `text` either as a plain substring (so an email
// like "jhwonjh" still matches) or, when `query` is entirely chosung
// (e.g. "ㄱㄴ"), as a substring of `text`'s chosung sequence.
export function matchesKoreanQuery(text, query) {
  if (!text) return false
  if (!query) return true // bare '@' shows everyone, then narrows as you type
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  if (lowerText.includes(lowerQuery)) return true
  const isAllChosung = [...query].every((c) => CHOSUNG.includes(c))
  return isAllChosung && chosungOf(text).includes(query)
}
