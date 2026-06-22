import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request } = context;

  // Intercettiamo i path relativi a Keystatic GitHub OAuth per correggere il redirect_uri
  if (url.pathname.includes('/api/keystatic/github')) {
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto = request.headers.get('x-forwarded-proto');

    if (forwardedHost && forwardedProto) {
      const correctUrl = new URL(url.toString());
      correctUrl.protocol = forwardedProto;
      correctUrl.host = forwardedHost;

      // Crea una copia della richiesta con la URL corretta
      const newRequest = new Request(correctUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
        // @ts-ignore
        duplex: 'half',
      });

      // Sovrascriviamo le proprietà di sola lettura del contesto per Astro e Keystatic
      Object.defineProperty(context, 'url', { value: correctUrl, writable: false });
      Object.defineProperty(context, 'request', { value: newRequest, writable: false });
    }
  }

  return next();
});
