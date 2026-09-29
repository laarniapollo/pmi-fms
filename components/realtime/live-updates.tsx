"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/components/ui/toast";

interface InvoiceChanged {
  type: "invoice.changed";
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  actorId: string;
  summary: string;
}

interface NotificationCreated {
  type: "notification.created";
  userId: string;
  title: string;
}

/**
 * Subscribes to the server's event stream and refreshes what is on screen.
 *
 * Two rules keep this from being irritating:
 *
 *   1. A person's own actions are ignored. They already saw the result of
 *      their click; a toast telling them what they just did is noise.
 *   2. Refreshes are coalesced. A payment run releasing forty invoices fires
 *      forty events, and forty `router.refresh()` calls in a second would
 *      hammer the server to render the same page repeatedly.
 */
export function LiveUpdates({ userId }: { userId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [connected, setConnected] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/events");

    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 400);
    };

    source.addEventListener("ready", () => setConnected(true));

    source.addEventListener("invoice.changed", (event) => {
      const payload = parse<InvoiceChanged>(event);
      if (!payload || payload.actorId === userId) return;
      toast.toast(payload.summary, { variant: "info" });
      scheduleRefresh();
    });

    source.addEventListener("payment.changed", (event) => {
      const payload = parse<InvoiceChanged>(event);
      if (!payload || payload.actorId === userId) return;
      scheduleRefresh();
    });

    source.addEventListener("notification.created", (event) => {
      // The server only sends these to the user they belong to.
      const payload = parse<NotificationCreated>(event);
      if (!payload) return;
      toast.toast(payload.title, { variant: "info", detail: "Opened from your notifications" });
      scheduleRefresh();
    });

    source.onerror = () => {
      // EventSource reconnects by itself; this only tracks the indicator.
      setConnected(false);
    };

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      source.close();
    };
    // `toast` and `router` are stable for the life of the shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <span
      title={connected ? "Live updates connected" : "Reconnecting to live updates"}
      className="inline-flex items-center gap-1.5"
    >
      <span
        aria-hidden="true"
        className={
          connected
            ? "h-1.5 w-1.5 rounded-full bg-accent"
            : "h-1.5 w-1.5 animate-pulse rounded-full bg-line-strong"
        }
      />
      <span className="sr-only" role="status">
        {connected ? "Live updates connected" : "Reconnecting to live updates"}
      </span>
    </span>
  );
}

function parse<T>(event: Event): T | null {
  try {
    return JSON.parse((event as MessageEvent).data) as T;
  } catch {
    return null;
  }
}
