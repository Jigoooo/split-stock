import { useGetDisplaySettings } from '@renderer/entities/display-settings';
import { createQueryClient } from '@renderer/shared/api/query-client';
import { trpc } from '@renderer/shared/api/trpc';
import { DialogProvider } from '@renderer/shared/ui';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import superjson from 'superjson';
import { ipcLink } from 'trpc-electron/renderer';

const DisplaySettingsRuntime = (): null => {
  const { settings } = useGetDisplaySettings();
  const rowHeightPx = settings?.grid.rowHeightPx ?? 26;

  useEffect(() => {
    document.documentElement.style.setProperty('--hts-row-height', `${rowHeightPx}px`);
  }, [rowHeightPx]);

  return null;
};

/**
 * 다른 창에서 발생한 설정 변경(매매/보호/시간대/자동감시/안전/백업 등)을 받아 query invalidate.
 * popout 윈도우는 독립 React 트리이므로 tRPC invalidate 가 자동 전파되지 않는 점을 보완한다.
 */
const SettingsSyncRuntime = (): null => {
  const qc = useQueryClient();

  useEffect(() => {
    const shell = window.appShell;
    if (!shell?.onSettingsChanged) return;
    return shell.onSettingsChanged(() => {
      void qc.invalidateQueries();
    });
  }, [qc]);

  return null;
};

export const AppProviders = ({ children }: PropsWithChildren): ReactElement => {
  const [queryClient] = useState(() => createQueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      // tRPC v11: transformer를 link 레벨에서 지정
      links: [ipcLink({ transformer: superjson })],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <DisplaySettingsRuntime />
        <SettingsSyncRuntime />
        <Toaster
          position="top-right"
          theme="light"
          toastOptions={{ closeButton: true, duration: 3000 }}
        />
        <DialogProvider />
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
};
