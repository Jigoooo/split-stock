import { useGetDisplaySettings } from '@renderer/entities/display-settings';
import { createQueryClient } from '@renderer/shared/api/query-client';
import { trpc } from '@renderer/shared/api/trpc';
import { DialogProvider } from '@renderer/shared/ui';
import { QueryClientProvider } from '@tanstack/react-query';
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
        <Toaster position="top-right" theme="light" />
        <DialogProvider />
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
};
