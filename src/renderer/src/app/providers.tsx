import { QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { useState } from 'react';
import { Toaster } from 'sonner';
import superjson from 'superjson';
import { ipcLink } from 'trpc-electron/renderer';
import { createQueryClient } from '../shared/api/query-client';
import { trpc } from '../shared/api/trpc';
import { DialogProvider } from '../shared/ui';

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
        <Toaster position="top-right" theme="light" />
        <DialogProvider />
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
};
