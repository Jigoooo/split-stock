export type KisRealtimeFrame =
  | {
      kind: 'cni';
      tr: 'H0STCNI0' | 'H0STCNI9';
      payload: string;
      encrypted: boolean;
    }
  | {
      kind: 'realtime';
      tr: string;
      code: string;
      seq: number;
    };

export function parseKisRealtimeFrame(raw: string): KisRealtimeFrame | null {
  const parts = raw.split('|');
  if (parts.length < 4) return null;

  const [encryptFlag, trId, , payload] = parts;
  if (!trId || !payload) return null;
  if (trId === 'H0STCNI0' || trId === 'H0STCNI9') {
    return {
      kind: 'cni',
      tr: trId,
      payload,
      encrypted: encryptFlag === '1' || encryptFlag === 'Y',
    };
  }

  const firstRecord = payload.split('^');
  const code = firstRecord[0] ?? '';
  const seqRaw = firstRecord[1] ?? '';
  const seq = Number(seqRaw);
  if (!Number.isFinite(seq) || !code) return null;
  return { kind: 'realtime', tr: trId, code, seq };
}
