import { findUserByEmail } from "../data/users.js";
import { verifyPassword } from "./password.js";
import { createSessionToken } from "./session.js";

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password.");
    this.name = "InvalidCredentialsError";
  }
}

export function authenticate(email, password) {
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new InvalidCredentialsError();
  }

  const token = createSessionToken(user);
  return { token, user: { id: user.id, email: user.email, name: user.name } };
}
