import bcrypt from "bcryptjs";

/** Work factor. 12 costs ~250ms on typical hardware — slow enough to matter. */
const ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface PasswordCheck {
  ok: boolean;
  problems: string[];
  /** 0–4, for the strength meter on the sign-up form. */
  score: number;
}

/**
 * Password rules, shared by the sign-up form and the server action so the
 * client meter and the server verdict can never disagree.
 */
export function checkPassword(password: string): PasswordCheck {
  const problems: string[] = [];

  if (password.length < 10) problems.push("Use at least 10 characters");
  if (!/[a-z]/.test(password)) problems.push("Add a lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("Add an uppercase letter");
  if (!/[0-9]/.test(password)) problems.push("Add a number");

  const variety =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/[0-9]/.test(password)) +
    Number(/[^A-Za-z0-9]/.test(password));

  const lengthPoints = password.length >= 16 ? 2 : password.length >= 12 ? 1 : 0;
  const score = Math.min(4, Math.max(0, variety - 1 + lengthPoints));

  return { ok: problems.length === 0, problems, score };
}
