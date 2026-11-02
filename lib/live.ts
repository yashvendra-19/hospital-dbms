import { Client } from 'pg';
import { EventEmitter } from 'events';
import { poolConfig } from '@/lib/db';

/**
 * One dedicated PostgreSQL connection runs LISTEN mediresource_live and fans the
 * notifications out to every open browser (Server-Sent Events in app/api/live).
 * Payloads come from trg_fn_live_notify() and never contain patient names.
 */
interface LiveHub {
  emitter: EventEmitter;
  client: Client | null;
  connecting: Promise<void> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __liveHub: LiveHub | undefined;
}

export function liveHub(): LiveHub {
  if (!global.__liveHub) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(500);
    global.__liveHub = { emitter, client: null, connecting: null };
  }
  const hub = global.__liveHub;
  if (!hub.client && !hub.connecting) {
    hub.connecting = (async () => {
      const client = new Client({ ...poolConfig, max: undefined } as any);
      client.on('notification', (msg) => {
        if (msg.payload) hub.emitter.emit('event', msg.payload);
      });
      const drop = () => {
        hub.client = null;
      };
      client.on('error', drop);
      client.on('end', drop);
      await client.connect();
      await client.query('LISTEN mediresource_live');
      hub.client = client;
    })()
      .catch((err) => console.error('[live] LISTEN failed:', err?.message))
      .finally(() => {
        hub.connecting = null;
      });
  }
  return hub;
}
