import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import { Database, RefreshCw } from 'lucide-react';
import type { ReactElement } from 'react';
import { toast } from 'sonner';

/**
 * DART corp_code 매핑 캐시 관리 패널 — AI 탭 하위.
 *
 * - status query 로 isAvailable / isStale 표시
 * - "갱신" 버튼: ai.syncDartCorpCodes mutation 호출
 * - 매핑이 적재되어 있으면 strategy 추천 시 자동으로 공시 컨텍스트 활성화 (별도 입력 X)
 * - 키 미설정(빌드 임베드 누락) 환경에서는 disabled + 안내
 */
export const DartCorpCodeSection = (): ReactElement => {
  const utils = trpc.useUtils();
  const status = trpc.ai.getDartCorpCodeStatus.useQuery(undefined, { staleTime: 30_000 });

  const sync = trpc.ai.syncDartCorpCodes.useMutation({
    onSuccess: (res) => {
      void utils.ai.getDartCorpCodeStatus.invalidate();
      if (res.inserted > 0) {
        toast.success(`DART 매핑 ${res.inserted.toLocaleString()}건 갱신 완료`);
      } else {
        toast.error(`DART 매핑 갱신 실패: ${res.reason ?? '원인 불명'}`);
      }
    },
    onError: (err) => {
      toast.error(`DART 매핑 갱신 실패: ${err.message}`);
    },
  });

  const available = status.data?.available ?? false;
  const stale = status.data?.stale ?? true;

  let statusLabel: string;
  let statusTitle: string | undefined;
  let statusTone: 'ok' | 'warn' | 'off';
  if (!available) {
    statusLabel = '기능 비활성 — 관리자 설정 필요';
    statusTitle =
      'OpenDART API 키가 빌드 시점에 임베드되어야 합니다. 시스템 관리자에게 문의하세요.';
    statusTone = 'off';
  } else if (stale) {
    statusLabel = '갱신 필요 (없음 또는 30일 이상 경과)';
    statusTone = 'warn';
  } else {
    statusLabel = '최신 (30일 이내)';
    statusTone = 'ok';
  }

  const tonePalette = {
    ok: { color: 'var(--up, #16a34a)', bg: 'rgba(22,163,74,0.08)' },
    warn: { color: 'var(--warn, #D97757)', bg: 'rgba(217,119,87,0.10)' },
    off: { color: 'var(--fg-2)', bg: 'var(--bg-2, rgba(0,0,0,0.04))' },
  } as const;
  const tone = tonePalette[statusTone];

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
          <Database size={14} aria-hidden />
          DART 공시 매핑
        </span>
        <Button
          variant="ghost"
          dense
          iconLeading={<RefreshCw size={14} />}
          disabled={!available || sync.isPending}
          onClick={() => sync.mutate()}
        >
          {sync.isPending ? '갱신 중...' : '매핑 갱신'}
        </Button>
      </div>
      <div className="panel__body" style={{ display: 'grid', gap: '0.6rem' }}>
        <div className="muted" style={{ fontSize: '1.1rem', lineHeight: 1.6 }}>
          종목별 strategy AI 추천 시 OpenDART 의 최근 공시를 컨텍스트로 사용하려면 stock_code →
          corp_code 매핑이 필요합니다. 한 번 갱신하면 30일간 캐시 유지.
        </div>
        <span
          className="chip"
          style={{
            color: tone.color,
            backgroundColor: tone.bg,
            border: `0.1rem solid ${tone.color}`,
            alignSelf: 'flex-start',
          }}
          {...(statusTitle ? { title: statusTitle } : {})}
        >
          {statusLabel}
        </span>
      </div>
    </div>
  );
};
