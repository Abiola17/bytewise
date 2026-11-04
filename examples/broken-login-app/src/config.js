export const config = {
  port: Number(process.env.PORT ?? 3100),
  sessionSecret: process.env.SESSION_SECRET ?? "dev-only-session-secret",
  sessionTtlSeconds: 60 * 60,
};
