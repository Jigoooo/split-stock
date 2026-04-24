import { IndexRoutePage } from '@renderer/app/router-layout';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: IndexRoutePage,
});
