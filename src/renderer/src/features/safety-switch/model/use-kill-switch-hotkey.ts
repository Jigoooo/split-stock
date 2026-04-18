import { trpc } from '@renderer/shared/api/trpc';
import { useEffect } from 'react';

/**
 * Ctrl/Cmd+Shift+K 단축키로 main 프로세스의 킬 스위치를 트리거.
 * main의 globalShortcut 등록이 우선이지만, 렌더러 창이 포커스일 때도
 * 즉시 반응하도록 보조 훅 제공.
 */
export function useKillSwitchHotkey(): void {
  const trigger = trpc.safety.triggerKillSwitch.useMutation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
        e.preventDefault();
        trigger.mutate({ reason: '렌더러 단축키' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [trigger]);
}
