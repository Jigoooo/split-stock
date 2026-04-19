import { trpc } from '@renderer/shared/api/trpc';
import { useState } from 'react';

export interface DuplicatePathFormProps {
  onPathSelected?: (path: string) => void;
}

export function DuplicatePathForm({ onPathSelected }: DuplicatePathFormProps) {
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

  const handlePickFolder = () => {
    pickFolderMutation.mutate();
  };

  const handleConfirmPath = () => {
    if (!selectedPath) {
      setMessage('폴더를 선택해주세요.');
      return;
    }
    setPathMutation.mutate({ path: selectedPath });
  };

  const handleClearPath = async () => {
    if (!getDuplicatePath.data?.path) {
      setMessage('설정된 경로가 없습니다.');
      return;
    }
    // 경로 삭제는 빈 문자열로 설정 (또는 settings에서 직접 delete 호출)
    // 여기서는 UI만 표시하고 실제 삭제는 사용자가 settings에서 수동으로 처리
    setMessage('경로 삭제 기능은 설정 페이지에서 직접 관리하세요.');
  };

  const currentPath = getDuplicatePath.data?.path;

  return (
    <div className="flex flex-col gap-4 p-4 border rounded bg-gray-50">
      <div>
        <h3 className="font-semibold text-sm mb-2">2중 백업 외부 드라이브 경로</h3>

        {/* 현재 설정된 경로 표시 */}
        {currentPath && (
          <div className="mb-3 p-2 bg-white border border-green-200 rounded text-xs">
            <span className="text-gray-600">현재 경로: </span>
            <span className="font-mono text-green-700">{currentPath}</span>
          </div>
        )}

        {/* 선택된 경로 (미확정) 표시 */}
        {selectedPath && !setPathMutation.isPending && (
          <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
            <span className="text-gray-600">선택된 경로: </span>
            <span className="font-mono text-blue-700">{selectedPath}</span>
          </div>
        )}

        {/* 메시지 표시 */}
        {message && (
          <div
            className={`mb-3 p-2 rounded text-xs font-mono ${
              message.includes('실패') || message.includes('없습니다')
                ? 'bg-red-50 text-red-700 border border-red-200'
                : 'bg-green-50 text-green-700 border border-green-200'
            }`}
          >
            {message}
          </div>
        )}
      </div>

      {/* 버튼 그룹 */}
      <div className="flex gap-2">
        <button
          onClick={handlePickFolder}
          disabled={
            pickFolderMutation.isPending || setPathMutation.isPending || getDuplicatePath.isLoading
          }
          className="flex-1 px-3 py-2 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {pickFolderMutation.isPending ? '폴더 선택 중...' : '폴더 선택'}
        </button>

        {selectedPath && (
          <button
            onClick={handleConfirmPath}
            disabled={setPathMutation.isPending}
            className="flex-1 px-3 py-2 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {setPathMutation.isPending ? '설정 중...' : '경로 설정'}
          </button>
        )}

        {currentPath && (
          <button
            onClick={handleClearPath}
            disabled={getDuplicatePath.isLoading}
            className="px-3 py-2 bg-gray-400 text-white text-xs rounded hover:bg-gray-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            정보
          </button>
        )}
      </div>

      {/* 안내 텍스트 */}
      <div className="text-xs text-gray-600 mt-2">
        <p>
          외부 드라이브 경로를 선택하면 백업 시 기본 경로와 동시에 2중으로 저장됩니다. SHA-256
          검증으로 파일 일치 여부를 확인합니다.
        </p>
      </div>
    </div>
  );
}
