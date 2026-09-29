import "server-only";

/**
 * In-process publish/subscribe feeding the SSE stream.
 *
 * Every mutation that changes something another open tab is looking at
 * publishes here; `app/api/events/route.ts` turns each subscriber into a
 * server-sent event stream.
 *
 * Scope: one Node process. That suits the single-instance deployment this
 * build targets. Behind more than one instance, this module is the seam to
 * swap for Redis pub/sub — the publish and subscribe signatures would not
 * change, only what sits between them.
 */

export type AppEvent =
  | {
      type: "invoice.changed";
      invoiceId: string;
      invoiceNumber: string;
      status: string;
      /** Who caused it, so a client can skip echoing the actor's own change. */
      actorId: string;
      summary: string;
    }
  | {
      type: "payment.changed";
      paymentId: string;
      paymentNumber: string;
      status: string;
      actorId: string;
      summary: string;
    }
  | {
      type: "notification.created";
      /** Only this user's tabs should react. */
      userId: string;
      title: string;
    };

type Subscriber = (event: AppEvent) => void;

/**
 * Held on globalThis: dev-mode hot reload re-evaluates modules, and a fresh
 * Set each time would orphan every open SSE connection's listener.
 */
const globalForBus = globalThis as unknown as { apolloBus?: Set<Subscriber> };
const subscribers: Set<Subscriber> = (globalForBus.apolloBus ??= new Set());

export function publish(event: AppEvent): void {
  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch {
      // A dead connection must not take down the request that published.
    }
  }
}

/** Returns the unsubscribe function; the stream calls it on close. */
export function subscribe(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function subscriberCount(): number {
  return subscribers.size;
}
