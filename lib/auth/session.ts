import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/constants";
import { assertCan, can, type Action, type Subject } from "./permissions";

const SESSION_DAYS = 14;

/**
 * The cookie carries a raw random token; the database stores only its SHA-256
 * digest. A leaked database therefore yields no usable sessions. Sessions are
 * rows rather than JWTs so signing out everywhere is a delete, not a wait.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const headerList = await headers();

  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      userAgent: headerList.get("user-agent")?.slice(0, 255) ?? null,
      ipAddress: clientIp(headerList),
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  cookieStore.delete(SESSION_COOKIE);
}

/** Ends every other session for this user. Used after a password change. */
export async function destroyOtherSessions(userId: string): Promise<number> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const result = await db.session.deleteMany({
    where: {
      userId,
      ...(token ? { NOT: { tokenHash: hashToken(token) } } : {}),
    },
  });
  return result.count;
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  title: string | null;
  avatarColor: string;
  isActive: boolean;
  onboardingCompletedAt: Date | null;
  tourCompletedAt: Date | null;
};

/**
 * Resolves the signed-in user, or null. Wrapped in `cache` so the several
 * components that ask during one render share a single query.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          title: true,
          avatarColor: true,
          isActive: true,
          onboardingCompletedAt: true,
          tourCompletedAt: true,
        },
      },
    },
  });

  if (!session) return null;

  // An expired row is left for the sweeper rather than deleted here: reads
  // happen on every request and should not write.
  if (session.expiresAt < new Date()) return null;
  if (!session.user.isActive) return null;

  return session.user;
});

/** Redirects to sign-in when there is no session. */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
  }
  return user;
}

/**
 * Requires a session *and* a capability. Sends an authenticated but
 * unauthorized user to the dashboard rather than the sign-in page — they are
 * signed in, so a login form would be a lie about what went wrong.
 */
export async function requireAction(action: Action, subject?: Subject): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, action, subject)) redirect("/dashboard?denied=1");
  return user;
}

/** For route handlers, which should answer 403 rather than redirect. */
export async function requireActionOrThrow(
  action: Action,
  subject?: Subject,
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  assertCan(user, action, subject);
  return user;
}

export class UnauthenticatedError extends Error {
  readonly status = 401;
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}

/** Best-effort client IP for the audit trail. */
export function clientIp(headerList: Headers): string | null {
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headerList.get("x-real-ip");
}

export async function currentIp(): Promise<string | null> {
  return clientIp(await headers());
}

/** Removes expired rows. Called opportunistically on sign-in. */
export async function sweepExpiredSessions(): Promise<void> {
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
