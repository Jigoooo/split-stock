export type KisControlFrame =
  | { kind: 'pingpong' }
  | {
      kind: 'cni-crypto';
      tr: 'H0STCNI0' | 'H0STCNI9';
      iv: string;
      key: string;
      htsId: string;
    }
  | { kind: 'ignored' };

export type ParseKisControlFrameResult =
  | { ok: true; frame: KisControlFrame }
  | { ok: false; cause: unknown };

export function parseKisControlFrame(raw: string): ParseKisControlFrameResult {
  try {
    const parsed = JSON.parse(raw) as {
      header?: { tr_id?: string; tr_key?: string; encrypt?: string };
      body?: { rt_cd?: string; output?: { iv?: string; key?: string } };
    };
    const trId = parsed.header?.tr_id;
    if (trId === 'PINGPONG') return { ok: true, frame: { kind: 'pingpong' } };
    if (
      (trId === 'H0STCNI0' || trId === 'H0STCNI9') &&
      parsed.body?.rt_cd === '0' &&
      parsed.body.output?.iv &&
      parsed.body.output.key
    ) {
      return {
        ok: true,
        frame: {
          kind: 'cni-crypto',
          tr: trId,
          iv: parsed.body.output.iv,
          key: parsed.body.output.key,
          htsId: parsed.header?.tr_key ?? '',
        },
      };
    }
    return { ok: true, frame: { kind: 'ignored' } };
  } catch (cause) {
    return { ok: false, cause };
  }
}
