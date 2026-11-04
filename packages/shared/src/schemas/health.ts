import { z } from "zod";
import { MODEL_PROVIDERS } from "../constants/index";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  database: z.enum(["ok", "error"]),
  modelProvider: z.object({
    name: z.enum(MODEL_PROVIDERS),
    // Whether a credential is present for the selected provider. Says nothing
    // about whether the credential is valid — that is only known after a call.
    configured: z.boolean(),
    model: z.string(),
  }),
  time: z.string().datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
