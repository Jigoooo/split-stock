import { alertDialog } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useCredentialsReentry } from '../model/use-credentials-reentry';

/**
 * 복원 후 credentials 재입력 안내 배너.
 * - needsCredentialsReentry=true일 때만 표시
 * - 사용자가 credentials를 다시 저장하면 main에서 clearImportedFlag 호출로 사라짐
 *   (현재 구현은 renderer에서 명시적 확인 후 닫기)
 */
export const CredentialsReentryBanner = (): ReactElement | null => {
  const { clear, clearPending, needsReentry } = useCredentialsReentry();

  if (!needsReentry) return null;

  return (
    <div className="panel" role="alert">
      <div className="panel__title">🔐 credentials 재입력 안내</div>
      <div className="panel__body">
        <p>
          최근 DB를 복원했습니다. credentials는 OS 사용자 키로 암호화되어 있어 이전 환경의 값을
          복호화할 수 없을 수 있습니다.
        </p>
        <p>설정 → 로그아웃 후 App Key/Secret을 다시 입력하세요.</p>
        <button
          type="button"
          className="hts-btn"
          disabled={clearPending}
          onClick={() => {
            void (async () => {
              const confirmed = await alertDialog.confirm({
                title: '배너 숨김',
                message: '재입력을 완료했다면 이 배너를 숨길 수 있습니다. 계속할까요?',
                confirmText: '숨기기',
                cancelText: '취소',
              });
              if (confirmed) clear();
            })();
          }}
        >
          배너 숨김
        </button>
      </div>
    </div>
  );
};
