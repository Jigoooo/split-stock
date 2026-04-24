import { RootRouteLayout } from '@renderer/app/router-layout';
import { OverlayStackManager } from '@renderer/shared/ui/overlay-stack';
import { createRootRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';

const RootComponent = (): ReactElement => (
  <>
    <RootRouteLayout />
    <OverlayStackManager />
  </>
);

export const Route = createRootRoute({
  component: RootComponent,
});
