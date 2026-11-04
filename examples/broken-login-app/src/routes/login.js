import { authenticate, InvalidCredentialsError } from "../services/auth.js";

/** POST /login — body: { email, password } */
export function handleLogin(body) {
  const { email, password } = body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return { status: 400, body: { error: "Email and password are required." } };
  }

  try {
    const session = authenticate(email, password);
    return { status: 200, body: session };
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      return { status: 401, body: { error: error.message } };
    }
    console.error("login failed:", error);
    return { status: 500, body: { error: "Internal server error." } };
  }
}
