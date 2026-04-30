import type { DataQuality, EvidenceRef } from '../magic-split-facts';
import { LenientStrategySuggestionSchema, type StrategySuggestion } from './schema';

export function normalizeSuggestion(
  raw: StrategySuggestion,
  dataQuality: DataQuality,
  fallbackEvidenceRefs: ReadonlyArray<EvidenceRef>,
): StrategySuggestion {
  const sortedBuy = [...raw.buyRules].sort((a, b) => a.nth - b.nth);
  const sortedSell = [...raw.sellRules].sort((a, b) => a.nth - b.nth);
  if (sortedBuy.length > 0) {
    const first = sortedBuy[0];
    if (first) sortedBuy[0] = { ...first, nth: 1, triggerDropPct: null };
  }
  for (let i = 0; i < sortedBuy.length; i++) {
    const item = sortedBuy[i];
    if (item) sortedBuy[i] = { ...item, nth: i + 1 };
  }
  for (let i = 0; i < sortedSell.length; i++) {
    const item = sortedSell[i];
    if (item) sortedSell[i] = { ...item, nth: i + 1 };
  }

  const maxStages = Math.min(
    dataQuality === 'limited' ? 3 : raw.maxStages,
    raw.maxStages,
    sortedBuy.length,
    sortedSell.length,
  );
  const buyRules = sortedBuy.slice(0, maxStages).map((rule, index) => {
    if (dataQuality !== 'limited' || index === 0) return rule;
    return {
      ...rule,
      triggerDropPct:
        rule.triggerDropPct === null ? 0.02 : Math.max(0.02, Math.min(0.035, rule.triggerDropPct)),
      amountKrw: Math.min(
        rule.amountKrw,
        Math.round((sortedBuy[0]?.amountKrw ?? rule.amountKrw) * 1.5),
      ),
    };
  });
  const sellRules = sortedSell
    .slice(0, maxStages)
    .map((rule) =>
      dataQuality === 'limited'
        ? { ...rule, targetProfitPct: Math.max(0.015, Math.min(0.04, rule.targetProfitPct)) }
        : rule,
    );
  return {
    maxStages,
    buyRules,
    sellRules,
    reasoning: raw.reasoning,
    stageRationales: normalizeStageRationales(raw.stageRationales, maxStages, fallbackEvidenceRefs),
    globalRisks: raw.globalRisks.slice(0, 8),
    evidenceRefs: normalizeEvidenceRefs(raw.evidenceRefs, fallbackEvidenceRefs),
    analysisConfidence: dataQuality === 'limited' ? 'low' : raw.analysisConfidence,
    dataQuality,
  };
}

export function parseStrategySuggestionLenient(text: string): {
  suggestion: StrategySuggestion | null;
  issues: string[];
} {
  const issues: string[] = [];
  const candidates = extractJsonCandidates(text);
  if (candidates.length === 0) return { suggestion: null, issues: ['no-json-candidate'] };

  for (const candidate of candidates) {
    let json: unknown;
    try {
      json = JSON.parse(candidate);
    } catch (cause) {
      issues.push(`json-parse: ${cause instanceof Error ? cause.message : String(cause)}`);
      continue;
    }
    const parsed = LenientStrategySuggestionSchema.safeParse(json);
    if (parsed.success) return { suggestion: parsed.data, issues };
    issues.push(
      ...parsed.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return { suggestion: null, issues: dedupeStrings(issues).slice(0, 12) };
}

export function previewForLog(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function normalizeEvidenceRefs(
  rawRefs: ReadonlyArray<EvidenceRef>,
  fallbackRefs: ReadonlyArray<EvidenceRef>,
): EvidenceRef[] {
  const fallbackById = new Map(fallbackRefs.map((ref) => [ref.id, ref]));
  const grounded = rawRefs
    .map((ref) => fallbackById.get(ref.id))
    .filter((ref): ref is EvidenceRef => ref !== undefined);
  return grounded.length > 0 ? dedupeEvidenceRefs(grounded) : [...fallbackRefs];
}

function normalizeStageRationales(
  rawRationales: StrategySuggestion['stageRationales'],
  maxStages: number,
  fallbackRefs: ReadonlyArray<EvidenceRef>,
): StrategySuggestion['stageRationales'] {
  const knownIds = new Set(fallbackRefs.map((ref) => ref.id));
  return rawRationales.slice(0, maxStages).map((item, index) => ({
    ...item,
    nth: index + 1,
    evidenceRefs: item.evidenceRefs.filter((id) => knownIds.has(id)),
  }));
}

function dedupeEvidenceRefs(refs: ReadonlyArray<EvidenceRef>): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push(ref);
  }
  return out;
}

function extractJsonCandidates(text: string): string[] {
  const stripped = stripCodeFence(text).trim();
  const fenced = text.match(/```(?:json|JSON)?\s*\n([\s\S]*?)\n?```/)?.[1]?.trim();
  const extracted = extractJsonValues(stripped);
  return dedupeStrings(
    [fenced, ...extracted, stripped].filter((value): value is string => !!value),
  );
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const firstNewline = trimmed.indexOf('\n');
  const lastFence = trimmed.lastIndexOf('```');
  if (firstNewline === -1 || lastFence <= firstNewline) return trimmed;
  return trimmed.slice(firstNewline + 1, lastFence).trim();
}

function extractJsonValues(text: string): string[] {
  const starts = [text.indexOf('{'), text.indexOf('[')]
    .filter((index) => index !== -1)
    .sort((a, b) => a - b);
  return dedupeStrings(
    starts
      .map((start) => extractJsonValueAt(text, start))
      .filter((value): value is string => value !== null),
  );
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

function dedupeStrings(values: ReadonlyArray<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
