"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/lib/db";
import { AUDIT_ACTIONS, AVATAR_COLORS, ROLES } from "@/lib/constants";
import { recordAudit } from "@/lib/audit/record";
import { checkPassword, hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  currentIp,
  destroySession,
  getCurrentUser,
  sweepExpiredSessions,
} from "@/lib/auth/session";

export interface AuthState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const signInSchema = z.object({
  email: z.string().trim().min(1, "Enter your email address").email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

/**
 * A failed sign-in never says which half was wrong — telling an attacker that
 * an address exists is a free account enumeration.
 */
export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const email = parsed.data.email.toLowerCase();
  const user = await db.user.findUnique({ where: { email } });

  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: "Email or password is incorrect." };
  }

  if (!user.isActive) {
    return { error: "This account has been deactivated. Ask an administrator to restore it." };
  }

  await createSession(user.id);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAudit({
    actor: { id: user.id, name: user.name, role: user.role },
    action: AUDIT_ACTIONS.USER_SIGNED_IN,
    entityType: "Session",
    entityId: user.id,
    entityLabel: user.email,
    summary: `${user.name} signed in`,
    ipAddress: await currentIp(),
  });

  // Cheap housekeeping on an action that already writes.
  await sweepExpiredSessions();

  const next = String(formData.get("next") ?? "");
  // Only same-origin paths — an open redirect here would be a phishing gift.
  const destination = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  redirect(user.onboardingCompletedAt ? destination : "/onboarding");
}

const signUpSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name"),
    email: z.string().trim().min(1, "Enter your email address").email("Enter a valid email address"),
    password: z.string().min(1, "Choose a password"),
    confirm: z.string().min(1, "Re-enter your password"),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const strength = checkPassword(parsed.data.password);
  if (!strength.ok) {
    return { fieldErrors: { password: strength.problems[0]! } };
  }

  const email = parsed.data.email.toLowerCase();
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    return { fieldErrors: { email: "An account with this email already exists" } };
  }

  // The first person through the door runs the place; everyone after starts as
  // a clerk and an administrator promotes them. Nobody self-assigns approval
  // rights — that would defeat the whole separation-of-duties story.
  const isFirstUser = (await db.user.count()) === 0;

  const user = await db.user.create({
    data: {
      email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
      role: isFirstUser ? ROLES.ADMIN : ROLES.CLERK,
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!,
    },
  });

  await createSession(user.id);
  await recordAudit({
    actor: { id: user.id, name: user.name, role: user.role },
    action: AUDIT_ACTIONS.USER_CREATED,
    entityType: "User",
    entityId: user.id,
    entityLabel: user.email,
    summary: `${user.name} created an account as ${user.role.toLowerCase()}`,
    ipAddress: await currentIp(),
  });

  redirect("/onboarding");
}

export async function signOut(): Promise<void> {
  const user = await getCurrentUser();

  if (user) {
    await recordAudit({
      actor: { id: user.id, name: user.name, role: user.role },
      action: AUDIT_ACTIONS.USER_SIGNED_OUT,
      entityType: "Session",
      entityId: user.id,
      entityLabel: user.email,
      summary: `${user.name} signed out`,
      ipAddress: await currentIp(),
    });
  }

  await destroySession();
  redirect("/login");
}

/** Flattens a Zod error into `{ field: firstMessage }`. */
function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (!result[field]) result[field] = issue.message;
  }
  return result;
}
