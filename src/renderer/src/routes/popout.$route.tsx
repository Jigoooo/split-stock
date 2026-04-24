import { PopoutRoutePage } from '@renderer/app/router-layout';
import { createFileRoute } from '@tanstack/react-router';

const PopoutRouteComponent = (): ReturnType<typeof PopoutRoutePage> => {
  const { route } = Route.useParams();
  return <PopoutRoutePage route={route} />;
};

export const Route = createFileRoute('/popout/$route')({
  component: PopoutRouteComponent,
});
