import { getCurrentUser } from "@/lib/auth/session";
import { subscribe, type AppEvent } from "@/lib/realtime/bus";

/**
 * Server-sent events.
 *
 * One-directional is all this application needs — the client never pushes
 * anything back over the socket, it posts server actions like everything else
 * — so SSE does the job with a fraction of the machinery of WebSockets, and it
 * reconnects on its own when a connection drops.
 *
 * `notification.created` is addressed to one user and is filtered here rather
 * than in the browser: a client-side filter would still have delivered every
 * user's notifications to every open tab.
 */

export const dynamic = "force-dynamic";
/** Node, not Edge: the event bus is an in-process Set the Edge runtime cannot share. */
export const runtime = "nodejs";

const HEARTBEAT_MS = 25_000;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to receive updates.", { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;

      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false;
        }
      };

      send("ready", { userId: user.id, at: new Date().toISOString() });

      const unsubscribe = subscribe((event: AppEvent) => {
        if (event.type === "notification.created" && event.userId !== user.id) return;
        send(event.type, event);
      });

      // Proxies and load balancers close a stream that goes quiet. A comment
      // line is a valid SSE keep-alive and the browser ignores it.
      const heartbeat = setInterval(() => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          open = false;
        }
      }, HEARTBEAT_MS);

      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells nginx not to buffer, which would otherwise hold events back.
      "X-Accel-Buffering": "no",
    },
  });
}
