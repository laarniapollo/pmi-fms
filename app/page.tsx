import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";

/** The root is a router, not a screen: signed in goes to work, signed out signs in. */
export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? "/dashboard" : "/login");
}
