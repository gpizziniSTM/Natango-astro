import type { APIRoute } from 'astro';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const prerender = false;

const LOG_PATH = 'data/pixel-debug.local.json';

export const POST: APIRoute = async ({ request }) => {
  const payload = await request.json().catch(() => ({}));
  const event = {
    eventName: payload.eventName || 'unknown',
    href: payload.href || null,
    createdAt: new Date().toISOString(),
  };

  mkdirSync('data', { recursive: true });

  const events = (() => {
    try {
      return JSON.parse(readFileSync(LOG_PATH, 'utf8'));
    } catch {
      return [];
    }
  })();

  events.unshift(event);
  writeFileSync(LOG_PATH, `${JSON.stringify(events.slice(0, 50), null, 2)}\n`);

  return Response.json({ ok: true });
};
