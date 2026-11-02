import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { liveHub } from '@/lib/live';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Server-Sent Events stream of PostgreSQL LISTEN/NOTIFY events (ambulances, bed holds, bed status, admissions). */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;

  const hub = liveHub();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string, event?: string) => {
        try {
          controller.enqueue(encoder.encode(`${event ? `event: ${event}\n` : ''}data: ${data}\n\n`));
        } catch {
          cleanup();
        }
      };
      send(JSON.stringify({ channel: 'mediresource_live', role: auth.role }), 'ready');
      const onEvent = (payload: string) => send(payload);
      hub.emitter.on('event', onEvent);
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          cleanup();
        }
      }, 20000);
      cleanup = () => {
        hub.emitter.off('event', onEvent);
        clearInterval(ping);
      };
      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
