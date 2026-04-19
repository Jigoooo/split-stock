import type { CSSProperties, ReactNode } from 'react';
import { createKoreanSearchRegex } from './korean-search';
import { highlightLiteralMatches } from './literal-search';

type HighlightMode = 'fuzzy' | 'exact';

export function highlightMatches(
  text: string,
  query: string,
  highlightStyle?: CSSProperties,
  mode: HighlightMode = 'fuzzy',
): ReactNode {
  if (!query || !text) return text;

  const trimmed = query.trim();
  if (!trimmed) return text;

  if (mode === 'exact') {
    return highlightLiteralMatches(text, trimmed, highlightStyle);
  }

  try {
    const base = createKoreanSearchRegex(trimmed);
    if (!base.source || base.source === '(?:)') return text;
    const globalRegex = new RegExp(base.source, 'gi');

    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let key = 0;

    for (const match of text.matchAll(globalRegex)) {
      const idx = match.index ?? 0;
      if (match[0].length === 0) continue;
      if (idx > lastIndex) parts.push(text.slice(lastIndex, idx));
      parts.push(
        <mark
          key={key++}
          style={{
            backgroundColor: 'rgba(250, 204, 21, 0.4)',
            color: 'inherit',
            borderRadius: '2px',
            padding: '0 1px',
            ...highlightStyle,
          }}
        >
          {match[0]}
        </mark>,
      );
      lastIndex = idx + match[0].length;
    }

    if (parts.length === 0) return text;
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return <>{parts}</>;
  } catch {
    return text;
  }
}
