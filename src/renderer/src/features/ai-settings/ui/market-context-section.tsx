import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import { Activity, RefreshCw } from 'lucide-react';
import type { ReactElement } from 'react';
import { toast } from 'sonner';

interface SourceStatus {
  isAvailable: boolean;
  isStale: boolean;
  lastSuccessAt: number | null;
  lastError: string | null;
}

export const MarketContextSection = (): ReactElement => {
  const utils = trpc.useUtils();
  const status = trpc.ai.getMarketContextStatus.useQuery(undefined, { staleTime: 30_000 });
  const refresh = trpc.ai.refreshMarketContext.useMutation({
    onSuccess: (res) => {
      void utils.ai.getMarketContextStatus.invalidate();
      toast.success(
        `시장 컨텍스트 갱신 완료: KRX ${res.krxInserted.toLocaleString()}건, ECOS ${res.ecosInserted.toLocaleString()}건`,
      );
    },
    onError: (err) => {
      toast.error(`시장 컨텍스트 갱신 실패: ${err.message}`);
    },
  });

  const krx = status.data?.krx;
  const ecos = status.data?.ecos;

  return (
    <div className="panel">
      <div
        className="panel__title"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.8rem',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <Activity size={14} aria-hidden />
          KRX/ECOS 컨텍스트
        </span>
        <Button
          variant="ghost"
          dense
          iconLeading={<RefreshCw size={14} />}
          disabled={refresh.isPending}
          onClick={() => refresh.mutate({})}
        >
          {refresh.isPending ? '갱신 중...' : '상태 갱신'}
        </Button>
      </div>
      <div className="panel__body" style={{ display: 'grid', gap: '0.6rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <StatusChip label="KRX" status={krx} />
          <StatusChip label="ECOS" status={ecos} />
        </div>
        <div className="muted" style={{ fontSize: '1.1rem', lineHeight: 1.6 }}>
          종목 추천은 KRX 종가/시가총액과 ECOS 기본 지표를 캐시된 보조 사실로만 사용합니다. 앱 실행
          시 매일 자동 갱신하고, 오류가 남아 있으면 자동 재시도합니다.
        </div>
      </div>
    </div>
  );
};

function StatusChip({ label, status }: { label: string; status: SourceStatus | undefined }) {
  const tone = statusTone(status);
  const palette = {
    ok: { color: 'var(--up, #16a34a)', bg: 'rgba(22,163,74,0.08)' },
    warn: { color: 'var(--warn, #D97757)', bg: 'rgba(217,119,87,0.10)' },
    off: { color: 'var(--fg-2)', bg: 'var(--bg-2, rgba(0,0,0,0.04))' },
  } as const;
  const p = palette[tone];
  const text = statusLabel(status);
  const title = status?.lastError ?? undefined;

  return (
    <span
      className="chip"
      title={title}
      style={{
        color: p.color,
        backgroundColor: p.bg,
        border: `0.1rem solid ${p.color}`,
      }}
    >
      {label} · {text}
    </span>
  );
}

function statusTone(status: SourceStatus | undefined): 'ok' | 'warn' | 'off' {
  if (!status?.isAvailable) return 'off';
  if (status.lastError || status.isStale) return 'warn';
  return 'ok';
}

function statusLabel(status: SourceStatus | undefined): string {
  if (!status) return '확인 중';
  if (!status.isAvailable) return '키 없음';
  if (status.lastError) return '오류';
  if (status.isStale) return '갱신 필요';
  if (status.lastSuccessAt) return `최신 ${new Date(status.lastSuccessAt).toLocaleDateString()}`;
  return '대기';
}
