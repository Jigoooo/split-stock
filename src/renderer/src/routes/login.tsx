import { LoginRoutePage } from '@renderer/app/router-layout';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/login')({
  component: LoginRoutePage,
});
