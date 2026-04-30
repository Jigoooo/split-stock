import type { z } from 'zod';

export function tryParseJson<T>(text: string, schema: z.ZodType<T>): T | null {
  const stripped = stripCodeFence(text).trim();
  if (!stripped) return null;
  const jsonCandidates = extractJsonValues(stripped);
  const fenceMatch = text.match(/```(?:json|JSON)?\s*\n([\s\S]*?)\n?```/);
  const fencedJson = fenceMatch?.[1]?.trim() ?? null;
  const seen = new Set<string>();
  const raw: string[] = [];
  for (const candidate of [...jsonCandidates, fencedJson, stripped]) {
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate);
      raw.push(candidate);
    }
  }
  for (const candidate of raw) {
    try {
      const json = JSON.parse(candidate);
      const parsed = schema.safeParse(json);
      if (parsed.success) return parsed.data;
    } catch {
      // Repair/fallback handles final failure.
    }
  }
  return null;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const firstNewline = trimmed.indexOf('\n');
    const lastFence = trimmed.lastIndexOf('```');
    if (firstNewline !== -1 && lastFence > firstNewline) {
      return trimmed.slice(firstNewline + 1, lastFence).trim();
    }
  }
  return trimmed;
}

function extractJsonValues(text: string): string[] {
  const starts = [text.indexOf('{'), text.indexOf('[')]
    .filter((index) => index !== -1)
    .sort((a, b) => a - b);
  const seen = new Set<string>();
  const values: string[] = [];
  for (const start of starts) {
    const value = extractJsonValueAt(text, start);
    if (value && !seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}

function extractJsonValueAt(text: string, start: number): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      stack.push('}');
      continue;
    }
    if (ch === '[') {
      stack.push(']');
      continue;
    }
    if ((ch === '}' || ch === ']') && stack[stack.length - 1] === ch) {
      stack.pop();
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}
