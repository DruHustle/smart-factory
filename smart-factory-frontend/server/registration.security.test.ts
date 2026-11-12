import { expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

it("production signup cannot grant public access to factory data", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const caller = appRouter.createCaller({
      user: null,
      req: { headers: {}, protocol: "https" },
      res: {},
    } as TrpcContext);
    expect(await caller.auth.registrationPolicy()).toEqual({
      enabled: false,
      requiresApproval: true,
    });
    await expect(caller.auth.login({ email: "customer@example.test", password: "synthetic-password" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.auth.requestRegistration({ email: "customer@example.test", name: "Synthetic User",
      organization: "Test workspace", password: "Strong-password-123!" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.auth.register({
        email: "stranger@example.com",
        password: "Strong-password-123!",
        name: "Stranger",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally {
    process.env.NODE_ENV = previous;
  }
});
