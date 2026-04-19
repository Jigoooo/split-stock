import type { CSSProperties, ReactNode } from 'react';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeLiteralQuery(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function containsLiteralQuery(text: string, query: string): boolean {
  const normalizedQuery = normalizeLiteralQuery(query);
  if (!normalizedQuery) return true;
  return text.toLocaleLowerCase().includes(normalizedQuery);
}

export function highlightLiteralMatches(
  text: string,
  query: string,
  highlightStyle?: CSSProperties,
): ReactNode {
  const normalizedQuery = normalizeLiteralQuery(query);
  if (!text || !normalizedQuery) return text;

  const regex = new RegExp(escapeRegex(normalizedQuery), 'gi');
  const normalizedText = text.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of normalizedText.matchAll(regex)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      parts.push(text.slice(lastIndex, idx));
    }
    const endIndex = idx + match[0].length;
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
        {text.slice(idx, endIndex)}
      </mark>,
    );
    lastIndex = endIndex;
  }

  if (parts.length === 0) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return <>{parts}</>;
}
