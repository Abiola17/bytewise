import type { FastifyInstance } from "fastify";
import {
  dashboardSummarySchema,
  testOutcomesQuerySchema,
  testOutcomesSchema,
} from "@bytewise/shared";
import type { DashboardService } from "../services/dashboard.service";

export function dashboardRoutes(deps: { dashboardService: DashboardService }) {
  const { dashboardService } = deps;

  return async (app: FastifyInstance) => {
    app.get("/dashboard/summary", async () => {
      return dashboardSummarySchema.parse(dashboardService.summary());
    });

    app.get("/dashboard/test-outcomes", async (request) => {
      const { days, tzOffsetMinutes } = testOutcomesQuerySchema.parse(request.query);
      return testOutcomesSchema.parse(dashboardService.testOutcomes(days, tzOffsetMinutes));
    });
  };
}
