import { hashPassword } from "../services/password.js";

// In-memory user store. Passwords are stored as salted scrypt hashes.
const seedUsers = [
  { id: "u_1", email: "ada@example.com", name: "Ada Lovelace", password: "analytical-engine" },
  { id: "u_2", email: "grace@example.com", name: "Grace Hopper", password: "cobol-forever" },
];

const users = seedUsers.map(({ password, ...user }) => ({
  ...user,
  passwordHash: hashPassword(password),
}));

export function findUserByEmail(email) {
  const normalized = email.trim().toLowerCase();
  return users.find((user) => user.email === normalized) ?? null;
}
