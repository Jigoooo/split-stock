import { trpc } from '@renderer/shared/api/trpc';
import { Button, Switch } from '@renderer/shared/ui';
import { type ReactElement, useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * Sentry DSN 입력 폼.
 *
 * 백엔드 monitoring-router 에서 settings 'sentry.dsn' 키로 영구 저장.
 * dev 환경에서는 'sentry.enableInDev' 가 true 일 때만 실제 init.
 * 빈 문자열 저장 시 DSN 삭제 + Sentry 비활성.
 *
 * 적용 시점: 다음 앱 재시작 (initSentryFromSettings 는 부팅 시 1회 호출).
 */
export const SentrySettingsForm = (): ReactElement => {
  const utils = trpc.useUtils();
  const query = trpc.monitoring.getDsn.useQuery();
  const setDsn = trpc.monitoring.setDsn.useMutation({
    onSuccess: () => {
      void utils.monitoring.getDsn.invalidate();
      toast.success('Sentry DSN 이 저장되었습니다 (다음 재시작에 적용)');
    },
    onError: (err) => {
      toast.error(`Sentry DSN 저장 실패: ${err.message}`);
    },
  });
  const setEnableInDev = trpc.monitoring.setEnableInDev.useMutation({
    onSuccess: () => {
      void utils.monitoring.getDsn.invalidate();
    },
  });

  const [dsnDraft, setDsnDraft] = useState<string>('');
  useEffect(() => {
    if (query.data) setDsnDraft(query.data.dsn ?? '');
  }, [query.data]);

  if (query.isPending) {
    return <div className="muted">Sentry 설정 로드 중…</div>;
  }
  if (query.error) {
    return <span className="chip chip--down">{query.error.message}</span>;
  }

  const enableInDev = query.data?.enableInDev ?? false;
  const dsnSaved = query.data?.dsn ?? '';
  const isDirty = dsnDraft !== dsnSaved;

  return (
    <section aria-label="Sentry 에러 보고 설정" style={{ display: 'grid', gap: '0.8rem' }}>
      <div className="muted" style={{ fontSize: '1rem' }}>
        Sentry DSN 을 입력하면 main / renderer 의 처리되지 않은 예외가 자동으로 보고됩니다. 빈
        문자열로 저장하면 비활성화. PII (자격증명·계좌번호 등) 는 자동 스크럽됩니다.
      </div>
      <label style={{ display: 'grid', gap: '0.4rem' }}>
        <span style={{ fontSize: '1rem' }}>Sentry DSN (https://...)</span>
        <input
          type="text"
          className="hts-input hts-input--dense"
          value={dsnDraft}
          onChange={(e) => setDsnDraft(e.target.value)}
          placeholder="https://<key>@sentry.io/<project>"
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
        <Switch
          checked={enableInDev}
          onChange={(next) => setEnableInDev.mutate({ enabled: next })}
          aria-label="dev 환경에서도 Sentry 활성"
          disabled={setEnableInDev.isPending}
        />
        <span style={{ fontSize: '1rem' }}>
          개발 환경에서도 활성 (배포된 앱은 항상 활성, 이 옵션은 dev 빌드용)
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
        <Button dense disabled={!isDirty || setDsn.isPending} onClick={() => setDsnDraft(dsnSaved)}>
          되돌리기
        </Button>
        <Button
          variant="primary"
          dense
          disabled={!isDirty || setDsn.isPending}
          onClick={() => setDsn.mutate({ dsn: dsnDraft.trim() })}
        >
          저장
        </Button>
      </div>
    </section>
  );
};
