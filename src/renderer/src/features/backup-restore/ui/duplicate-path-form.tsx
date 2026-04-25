import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useState } from 'react';

export interface DuplicatePathFormProps {
  onPathSelected?: (path: string) => void;
}

/**
 * 2중 백업 외부 드라이브 경로 설정 폼.
 * - 자동/수동 백업 시 1차 경로와 함께 외부 드라이브에 동시에 sha256 검증 저장.
 */
export function DuplicatePathForm({ onPathSelected }: DuplicatePathFormProps): ReactElement {
  const utils = trpc.useUtils();
  const [message, setMessage] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const getDuplicatePath = trpc.backup.getDuplicatePath.useQuery();

  const pickFolderMutation = trpc.backup.pickDuplicateFolder.useMutation({
    onSuccess: (result) => {
      if (result.canceled) {
        setMessage('폴더 선택이 취소되었습니다.');
        return;
      }
      setSelectedPath(result.path);
      setMessage(null);
    },
    onError: (error) => {
      setMessage(`폴더 선택 실패: ${error.message}`);
    },
  });

  const setPathMutation = trpc.backup.setDuplicatePath.useMutation({
    onSuccess: async (result) => {
      setMessage(`2중 백업 경로 설정 완료: ${result.path}`);
      setSelectedPath(null);
      await utils.backup.getDuplicatePath.invalidate();
      onPathSelected?.(result.path);
    },
    onError: (error) => {
      setMessage(`경로 설정 실패: ${error.message}`);
    },
  });

  const handlePickFolder = (): void => {
    pickFolderMutation.mutate();
  };

  const handleConfirmPath = (): void => {
    if (!selectedPath) {
      setMessage('폴더를 먼저 선택해 주세요.');
      return;
    }
    setPathMutation.mutate({ path: selectedPath });
  };

  const currentPath = getDuplicatePath.data?.path;
  const busy = pickFolderMutation.isPending || setPathMutation.isPending;
  const isError = message !== null && (message.includes('실패') || message.includes('주세요'));

  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      {currentPath ? (
        <div className="muted" style={{ fontSize: '0.85em' }}>
          현재 경로: <code style={{ fontFamily: 'monospace' }}>{currentPath}</code>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: '0.85em' }}>
          2중 백업 경로가 설정되어 있지 않습니다.
        </div>
      )}

      {selectedPath ? (
        <div className="muted" style={{ fontSize: '0.85em' }}>
          선택된 경로: <code style={{ fontFamily: 'monospace' }}>{selectedPath}</code>
        </div>
      ) : null}

      {message ? <span className={isError ? 'chip chip--down' : 'chip'}>{message}</span> : null}

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Button onClick={handlePickFolder} disabled={busy} dense>
          {pickFolderMutation.isPending ? '폴더 선택 중…' : '폴더 선택'}
        </Button>
        {selectedPath ? (
          <Button variant="primary" onClick={handleConfirmPath} disabled={busy} dense>
            {setPathMutation.isPending ? '설정 중…' : '경로 적용'}
          </Button>
        ) : null}
      </div>

      <div className="muted" style={{ fontSize: '0.8em' }}>
        외부 드라이브 경로를 설정하면 자동/수동 백업 시 1차 경로와 함께 동시에 저장되며, SHA-256
        해시로 일치 여부를 검증합니다.
      </div>
    </div>
  );
}
