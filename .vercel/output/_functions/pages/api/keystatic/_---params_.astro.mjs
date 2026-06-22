import { makeGenericAPIRouteHandler } from '@keystatic/core/api/generic';
import { parseString } from 'set-cookie-parser';
import { config as config$1, collection, fields, singleton } from '@keystatic/core';
export { renderers } from '../../../renderers.mjs';

function makeHandler(_config) {
  return async function keystaticAPIRoute(context) {
    var _context$locals, _ref, _config$clientId, _ref2, _config$clientSecret, _ref3, _config$secret;
    const envVarsForCf = (_context$locals = context.locals) === null || _context$locals === void 0 || (_context$locals = _context$locals.runtime) === null || _context$locals === void 0 ? void 0 : _context$locals.env;
    const handler = makeGenericAPIRouteHandler({
      ..._config,
      clientId: (_ref = (_config$clientId = _config.clientId) !== null && _config$clientId !== void 0 ? _config$clientId : envVarsForCf === null || envVarsForCf === void 0 ? void 0 : envVarsForCf.KEYSTATIC_GITHUB_CLIENT_ID) !== null && _ref !== void 0 ? _ref : tryOrUndefined(() => {
        return undefined                                          ;
      }),
      clientSecret: (_ref2 = (_config$clientSecret = _config.clientSecret) !== null && _config$clientSecret !== void 0 ? _config$clientSecret : envVarsForCf === null || envVarsForCf === void 0 ? void 0 : envVarsForCf.KEYSTATIC_GITHUB_CLIENT_SECRET) !== null && _ref2 !== void 0 ? _ref2 : tryOrUndefined(() => {
        return undefined                                              ;
      }),
      secret: (_ref3 = (_config$secret = _config.secret) !== null && _config$secret !== void 0 ? _config$secret : envVarsForCf === null || envVarsForCf === void 0 ? void 0 : envVarsForCf.KEYSTATIC_SECRET) !== null && _ref3 !== void 0 ? _ref3 : tryOrUndefined(() => {
        return undefined                                ;
      })
    }, {
      slugEnvName: "PUBLIC_KEYSTATIC_GITHUB_APP_SLUG"
    });
    const {
      body,
      headers,
      status
    } = await handler(context.request);
    let headersInADifferentStructure = /* @__PURE__ */ new Map();
    if (headers) {
      if (Array.isArray(headers)) {
        for (const [key, value] of headers) {
          if (!headersInADifferentStructure.has(key.toLowerCase())) {
            headersInADifferentStructure.set(key.toLowerCase(), []);
          }
          headersInADifferentStructure.get(key.toLowerCase()).push(value);
        }
      } else if (typeof headers.entries === "function") {
        for (const [key, value] of headers.entries()) {
          headersInADifferentStructure.set(key.toLowerCase(), [value]);
        }
        if ("getSetCookie" in headers && typeof headers.getSetCookie === "function") {
          const setCookieHeaders2 = headers.getSetCookie();
          if (setCookieHeaders2 !== null && setCookieHeaders2 !== void 0 && setCookieHeaders2.length) {
            headersInADifferentStructure.set("set-cookie", setCookieHeaders2);
          }
        }
      } else {
        for (const [key, value] of Object.entries(headers)) {
          headersInADifferentStructure.set(key.toLowerCase(), [value]);
        }
      }
    }
    const setCookieHeaders = headersInADifferentStructure.get("set-cookie");
    headersInADifferentStructure.delete("set-cookie");
    if (setCookieHeaders) {
      for (const setCookieValue of setCookieHeaders) {
        var _options$sameSite;
        const {
          name,
          value,
          ...options
        } = parseString(setCookieValue);
        const sameSite = (_options$sameSite = options.sameSite) === null || _options$sameSite === void 0 ? void 0 : _options$sameSite.toLowerCase();
        context.cookies.set(name, value, {
          domain: options.domain,
          expires: options.expires,
          httpOnly: options.httpOnly,
          maxAge: options.maxAge,
          path: options.path,
          sameSite: sameSite === "lax" || sameSite === "strict" || sameSite === "none" ? sameSite : void 0
        });
      }
    }
    return new Response(body, {
      status,
      headers: [...headersInADifferentStructure.entries()].flatMap(([key, val]) => val.map((x) => [key, x]))
    });
  };
}
function tryOrUndefined(fn) {
  try {
    return fn();
  } catch {
    return void 0;
  }
}

const config = config$1({
  storage: process.env.NODE_ENV === "production" ? { kind: "github", repo: "giupizzini/Natango-astro" } : { kind: "local" },
  singletons: {
    settings: singleton({
      label: "Impostazioni Generali",
      path: "src/content/settings/general",
      schema: {
        siteName: fields.text({ label: "Nome del Sito", defaultValue: "Accademia Natango" }),
        heroTitle: fields.text({
          label: "Titolo Hero",
          defaultValue: "Scopri il mondo del tango argentino e immergiti in un’esperienza fatta di armonia, abbraccio e passione.",
          multiline: true
        }),
        heroSubtitle: fields.text({
          label: "Sottotitolo Hero",
          defaultValue: "costruisci il tuo stile attraverso studio, eleganza e una didattica professionale pensata per valorizzare ogni ballerino.",
          multiline: true
        }),
        email: fields.text({ label: "Email di contatto", defaultValue: "info@natango.org" }),
        phone: fields.text({ label: "Telefono", defaultValue: "+39 339 273 7619" }),
        whatsappText: fields.text({
          label: "Testo preimpostato WhatsApp",
          defaultValue: "Ciao Natango, vorrei informazioni sui corsi"
        }),
        facebookUrl: fields.url({
          label: "Link Facebook",
          defaultValue: "https://www.facebook.com/natangoroma"
        }),
        instagramUrl: fields.url({
          label: "Link Instagram",
          defaultValue: "https://www.instagram.com/natangoroma/"
        }),
        youtubeUrl: fields.url({
          label: "Link YouTube",
          defaultValue: "https://www.youtube.com/@delbuonofrancesca"
        })
      }
    }),
    schedule: singleton({
      label: "Tabella Orari e Corsi",
      path: "src/content/schedule/table",
      format: { data: "json" },
      schema: {
        lessons: fields.array(
          fields.object({
            day: fields.select({
              label: "Giorno",
              options: [
                { label: "Lunedì", value: "Lunedì" },
                { label: "Martedì", value: "Martedì" },
                { label: "Mercoledì", value: "Mercoledì" },
                { label: "Giovedì", value: "Giovedì" },
                { label: "Venerdì", value: "Venerdì" },
                { label: "Sabato", value: "Sabato" },
                { label: "Domenica", value: "Domenica" }
              ],
              defaultValue: "Lunedì"
            }),
            time: fields.text({ label: "Orario (es. 20:00 - 21:15)", defaultValue: "20:00 - 21:15" }),
            courseName: fields.text({ label: "Nome Corso / Livello", defaultValue: "Principianti" }),
            teacher: fields.text({ label: "Maestro/i", defaultValue: "Francesca Del Buono" }),
            location: fields.select({
              label: "Sede",
              options: [
                { label: "Mandrione", value: "Mandrione" },
                { label: "Tuscolana", value: "Tuscolana" },
                { label: "Entrambe / Online", value: "Entrambe" }
              ],
              defaultValue: "Mandrione"
            }),
            info: fields.text({ label: "Note extra (es. Lezione di prova)", defaultValue: "" })
          }),
          {
            label: "Lezioni",
            itemLabel: (item) => `${item.fields.day.value} - ${item.fields.time.value}: ${item.fields.courseName.value}`
          }
        )
      }
    })
  },
  collections: {
    courses: collection({
      label: "Presentazione Corsi",
      slugField: "title",
      path: "src/content/courses/*",
      format: { contentField: "content" },
      schema: {
        title: fields.slug({ name: { label: "Titolo del Corso" } }),
        summary: fields.text({ label: "Breve riassunto", multiline: true }),
        content: fields.markdoc({ label: "Descrizione Completa" })
      }
    }),
    locations: collection({
      label: "Sedi dell'Accademia",
      slugField: "name",
      path: "src/content/locations/*",
      format: { contentField: "description" },
      schema: {
        name: fields.slug({ name: { label: "Nome Sede (es. Mandrione)" } }),
        address: fields.text({ label: "Indirizzo completo" }),
        mapsLink: fields.url({ label: "Link Google Maps" }),
        description: fields.markdoc({ label: "Dettagli Sede" })
      }
    })
  }
});

const all = makeHandler({ config });
const ALL = all;

const prerender = false;

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  ALL,
  all,
  prerender
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
