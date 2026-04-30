import { publicProcedure, router } from '../trpc-core';

export const bootRouter = router({
  getStatus: publicProcedure.query(({ ctx }) => ctx.bootStatus.getSnapshot()),
});
