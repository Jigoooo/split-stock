import { createHashHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { routeTree } from '../routeTree.gen';

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export const AppRouterProvider = (): ReactElement => <RouterProvider router={router} />;
