import React from 'react';

// Matches "มัดจำ" followed by an amount, e.g. "มัดจำ 2000", "มัดจำ2000",
// "มัดจำ 2,000", "มัดจำ 2,000 บาท", "มัดจำ: 2000". Kept permissive but
// simple — no attempt to parse currency formats beyond digits/commas/decimals.
const DEPOSIT_REGEX = /มัดจำ\s*[:\-]?\s*[\d,]+(?:\.\d+)?\s*(?:บาท)?/g;

/**
 * Splits remark text into plain strings and highlighted <mark> fragments
 * around any "มัดจำ <amount>" match, so deposit notes stand out wherever
 * remark is rendered read-only (print templates, detail views).
 *
 * Returns the original string unchanged when there's no match, so callers
 * can render the result directly (e.g. `{highlightDeposit(remark)}`)
 * without any extra branching.
 */
export function highlightDeposit(text) {
  if (!text) return text;

  const parts = [];
  let lastIndex = 0;
  let match;
  DEPOSIT_REGEX.lastIndex = 0;

  while ((match = DEPOSIT_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <mark key={match.index} className="deposit-highlight">{match[0]}</mark>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex === 0) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
