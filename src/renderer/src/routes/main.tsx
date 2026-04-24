import { MainRoutePage } from '@renderer/app/router-layout';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/main')({
  component: MainRoutePage,
});
