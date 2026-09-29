import { PrismaClient } from "@prisma/client";

/**
 * Next.js dev-mode hot reload re-evaluates modules on every change. Without a
 * global cache each reload opens another connection pool until SQLite starts
 * refusing them, so the client is stashed on globalThis outside production.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
