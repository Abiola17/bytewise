import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { MODEL_PROVIDERS } from "@bytewise/shared";

/** Repository root — the single `.env` file lives here. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const envSchema = z.object({
  MODEL_PROVIDER: z.enum(MODEL_PROVIDERS).default("meta"),
  META_API_KEY: z.string().trim().optional(),
  BASETEN_API_KEY: z.string().trim().optional(),
  META_BASE_URL: z.string().url().default("https://api.meta.ai/v1"),
  // Muse Spark 1.3 is Meta's coding/agentic model; the API has no separate "Muse Code" model.
  META_MODEL: z.string().default("muse-spark-1.3"),
  BASETEN_BASE_URL: z.string().url().default("https://inference.baseten.co/v1"),
  BASETEN_MODEL: z.string().default("meta-models/muse-spark-open"),
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(120_000),
  VERIFICATION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(1_800_000).default(120_000),
  VERIFICATION_MAX_OUTPUT_CHARS: z.coerce.number().int().min(1_000).max(1_000_000).default(64_000),
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  SERVER_HOST: z.string().default("127.0.0.1"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_PATH: z.string().default(".data/bytewise.db"),
  SCREENSHOTS_DIR: z.string().default(".data/screenshots"),
  PROJECTS_DIR: z.string().default("examples"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  env: Env;
  /** Absolute path to the SQLite file, or ":memory:". */
  databasePath: string;
  /** Absolute path of the only directory projects may be registered from. */
  projectsDir: string;
  /** Absolute path where uploaded screenshots are stored. */
  screenshotsDir: string;
  modelProvider: {
    name: Env["MODEL_PROVIDER"];
    configured: boolean;
    model: string;
  };
}

export function loadConfig(overrides: Partial<Record<keyof Env, string>> = {}): AppConfig {
  loadDotenv({ path: path.join(REPO_ROOT, ".env"), quiet: true });

  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server configuration: ${issues}`);
  }
  const env = parsed.data;

  const apiKey = env.MODEL_PROVIDER === "meta" ? env.META_API_KEY : env.BASETEN_API_KEY;

  return {
    env,
    databasePath:
      env.DATABASE_PATH === ":memory:" ? ":memory:" : path.resolve(REPO_ROOT, env.DATABASE_PATH),
    projectsDir: path.resolve(REPO_ROOT, env.PROJECTS_DIR),
    screenshotsDir: path.resolve(REPO_ROOT, env.SCREENSHOTS_DIR),
    modelProvider: {
      name: env.MODEL_PROVIDER,
      configured: Boolean(apiKey),
      model: env.MODEL_PROVIDER === "meta" ? env.META_MODEL : env.BASETEN_MODEL,
    },
  };
}
