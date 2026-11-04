import { buildApp } from "./app";
import { loadConfig } from "./config/env";

const config = loadConfig();
const app = await buildApp(config);

if (!config.modelProvider.configured) {
  app.log.warn(
    `No API key set for MODEL_PROVIDER="${config.modelProvider.name}". AI features will be unavailable.`,
  );
}

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.env.SERVER_PORT, host: config.env.SERVER_HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
