import { createHmac, randomUUID } from "node:crypto";
import { config } from "../config.js";

/** Issues a signed session token: `<payload>.<signature>`. */
export function createSessionToken(user) {
  const payload = Buffer.from(
    JSON.stringify({
      sid: randomUUID(),
      sub: user.id,
      exp: Math.floor(Date.now() / 1000) + config.sessionTtlSeconds,
    }),
  ).toString("base64url");

  const signature = createHmac("sha256", config.secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
