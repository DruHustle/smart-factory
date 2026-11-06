import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { installRequest, packageSelection } from "../../shared/node-red";
import { demoOnlyRead } from "../demoData";
import { demonstrationOnly } from "../../shared/access-policy";
import { safeNodeRedError } from "./configuration";
import { nodeRedPackages } from "./service";

const packageAdmin = adminProcedure.use(({ ctx, next }) => {
  if (demoOnlyRead() || demonstrationOnly(ctx.user) || ctx.user.disabledAt)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Node-RED package management requires an active individual administrator using the live workspace.",
    });
  return next({ ctx });
});
async function safe<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: safeNodeRedError(error),
    });
  }
}
export const nodeRedRouter = router({
  status: packageAdmin.query(({ ctx }) => nodeRedPackages.status(ctx.user.id)),
  review: packageAdmin
    .input(packageSelection)
    .mutation(({ ctx, input }) =>
      safe(() => nodeRedPackages.review(ctx.user.id, input)),
    ),
  install: packageAdmin
    .input(installRequest)
    .mutation(({ ctx, input }) =>
      safe(() => nodeRedPackages.install(ctx.user.id, input)),
    ),
  reconcile: packageAdmin.mutation(({ ctx }) =>
    safe(() => nodeRedPackages.reconcile(ctx.user.id)),
  ),
});
