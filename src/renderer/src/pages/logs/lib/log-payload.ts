export interface PayloadChip {
  key: string;
  value: string;
}

export interface LogPayloadPreview {
  chips: PayloadChip[];
  hiddenCount: number;
  isEmpty: boolean;
  summary: string;
}

export interface LogPayloadView extends LogPayloadPreview {
  pretty: string;
}

const MAX_CHIPS = 3;
const MAX_VALUE_LENGTH = 28;
const MAX_SUMMARY_LENGTH = 88;
const PAYLOAD_VIEW_CACHE_LIMIT = 600;
const previewCache = new Map<string, LogPayloadPreview>();
const viewCache = new Map<string, LogPayloadView>();

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return truncate(value, MAX_VALUE_LENGTH);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'object') return '{…}';
  return String(value);
}

function getCacheKey(payloadJson: string | null): string {
  return payloadJson === null ? 'null:payload' : `json:${payloadJson}`;
}

function setCachedValue<T>(cache: Map<string, T>, key: string, value: T): T {
  cache.set(key, value);
  if (cache.size > PAYLOAD_VIEW_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  return value;
}

function buildObjectPreview(value: Record<string, unknown>): LogPayloadPreview {
  const entries = Object.entries(value);
  const chips = entries.slice(0, MAX_CHIPS).map(([key, item]) => ({
    key,
    value: formatValue(item),
  }));

  return {
    chips,
    hiddenCount: Math.max(entries.length - chips.length, 0),
    isEmpty: entries.length === 0,
    summary:
      entries.length === 0
        ? '-'
        : truncate(
            entries.map(([key, item]) => `${key}=${formatValue(item)}`).join(' · '),
            MAX_SUMMARY_LENGTH,
          ),
  };
}

function buildPayloadPreviewUncached(payloadJson: string | null): LogPayloadPreview {
  if (!payloadJson) {
    return {
      chips: [],
      hiddenCount: 0,
      isEmpty: true,
      summary: '-',
    };
  }

  try {
    const parsed = JSON.parse(payloadJson) as unknown;

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return buildObjectPreview(parsed as Record<string, unknown>);
    }

    if (Array.isArray(parsed)) {
      return {
        chips: [],
        hiddenCount: 0,
        isEmpty: parsed.length === 0,
        summary: `Array(${parsed.length})`,
      };
    }

    const summary = formatValue(parsed);
    return {
      chips: [],
      hiddenCount: 0,
      isEmpty: false,
      summary,
    };
  } catch {
    return {
      chips: [],
      hiddenCount: 0,
      isEmpty: false,
      summary: truncate(payloadJson, MAX_SUMMARY_LENGTH),
    };
  }
}

export function buildLogPayloadPreview(payloadJson: string | null): LogPayloadPreview {
  const cacheKey = getCacheKey(payloadJson);
  const cached = previewCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  return setCachedValue(previewCache, cacheKey, buildPayloadPreviewUncached(payloadJson));
}

export function buildLogPayloadView(payloadJson: string | null): LogPayloadView {
  const cacheKey = getCacheKey(payloadJson);
  const cached = viewCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const preview = buildLogPayloadPreview(payloadJson);
  if (!payloadJson) {
    return setCachedValue(viewCache, cacheKey, { ...preview, pretty: '-' });
  }

  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return setCachedValue(viewCache, cacheKey, {
      ...preview,
      pretty: JSON.stringify(parsed, null, 2),
    });
  } catch {
    return setCachedValue(viewCache, cacheKey, {
      ...preview,
      pretty: payloadJson,
    });
  }
}
