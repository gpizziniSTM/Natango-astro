import 'piccolore';
import { k as decodeKey } from './chunks/astro/server_BW0iEjuq.mjs';
import 'clsx';
import { N as NOOP_MIDDLEWARE_FN } from './chunks/astro-designed-error-pages_nFH6iWL6.mjs';
import 'es-module-lexer';

function sanitizeParams(params) {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => {
      if (typeof value === "string") {
        return [key, value.normalize().replace(/#/g, "%23").replace(/\?/g, "%3F")];
      }
      return [key, value];
    })
  );
}
function getParameter(part, params) {
  if (part.spread) {
    return params[part.content.slice(3)] || "";
  }
  if (part.dynamic) {
    if (!params[part.content]) {
      throw new TypeError(`Missing parameter: ${part.content}`);
    }
    return params[part.content];
  }
  return part.content.normalize().replace(/\?/g, "%3F").replace(/#/g, "%23").replace(/%5B/g, "[").replace(/%5D/g, "]");
}
function getSegment(segment, params) {
  const segmentPath = segment.map((part) => getParameter(part, params)).join("");
  return segmentPath ? "/" + segmentPath : "";
}
function getRouteGenerator(segments, addTrailingSlash) {
  return (params) => {
    const sanitizedParams = sanitizeParams(params);
    let trailing = "";
    if (addTrailingSlash === "always" && segments.length) {
      trailing = "/";
    }
    const path = segments.map((segment) => getSegment(segment, sanitizedParams)).join("") + trailing;
    return path || "/";
  };
}

function deserializeRouteData(rawRouteData) {
  return {
    route: rawRouteData.route,
    type: rawRouteData.type,
    pattern: new RegExp(rawRouteData.pattern),
    params: rawRouteData.params,
    component: rawRouteData.component,
    generate: getRouteGenerator(rawRouteData.segments, rawRouteData._meta.trailingSlash),
    pathname: rawRouteData.pathname || void 0,
    segments: rawRouteData.segments,
    prerender: rawRouteData.prerender,
    redirect: rawRouteData.redirect,
    redirectRoute: rawRouteData.redirectRoute ? deserializeRouteData(rawRouteData.redirectRoute) : void 0,
    fallbackRoutes: rawRouteData.fallbackRoutes.map((fallback) => {
      return deserializeRouteData(fallback);
    }),
    isIndex: rawRouteData.isIndex,
    origin: rawRouteData.origin
  };
}

function deserializeManifest(serializedManifest) {
  const routes = [];
  for (const serializedRoute of serializedManifest.routes) {
    routes.push({
      ...serializedRoute,
      routeData: deserializeRouteData(serializedRoute.routeData)
    });
    const route = serializedRoute;
    route.routeData = deserializeRouteData(serializedRoute.routeData);
  }
  const assets = new Set(serializedManifest.assets);
  const componentMetadata = new Map(serializedManifest.componentMetadata);
  const inlinedScripts = new Map(serializedManifest.inlinedScripts);
  const clientDirectives = new Map(serializedManifest.clientDirectives);
  const serverIslandNameMap = new Map(serializedManifest.serverIslandNameMap);
  const key = decodeKey(serializedManifest.key);
  return {
    // in case user middleware exists, this no-op middleware will be reassigned (see plugin-ssr.ts)
    middleware() {
      return { onRequest: NOOP_MIDDLEWARE_FN };
    },
    ...serializedManifest,
    assets,
    componentMetadata,
    inlinedScripts,
    clientDirectives,
    routes,
    serverIslandNameMap,
    key
  };
}

const manifest = deserializeManifest({"hrefRoot":"file:///Users/gius/Documents/Antigravity/NATANGO/","cacheDir":"file:///Users/gius/Documents/Antigravity/NATANGO/node_modules/.astro/","outDir":"file:///Users/gius/Documents/Antigravity/NATANGO/dist/","srcDir":"file:///Users/gius/Documents/Antigravity/NATANGO/src/","publicDir":"file:///Users/gius/Documents/Antigravity/NATANGO/public/","buildClientDir":"file:///Users/gius/Documents/Antigravity/NATANGO/dist/client/","buildServerDir":"file:///Users/gius/Documents/Antigravity/NATANGO/dist/server/","adapterName":"@astrojs/vercel","routes":[{"file":"","links":[],"scripts":[],"styles":[],"routeData":{"type":"page","component":"_server-islands.astro","params":["name"],"segments":[[{"content":"_server-islands","dynamic":false,"spread":false}],[{"content":"name","dynamic":true,"spread":false}]],"pattern":"^\\/_server-islands\\/([^/]+?)\\/?$","prerender":false,"isIndex":false,"fallbackRoutes":[],"route":"/_server-islands/[name]","origin":"internal","_meta":{"trailingSlash":"ignore"}}},{"file":"index.html","links":[],"scripts":[],"styles":[{"type":"external","src":"/_astro/index.CDs1MPyX.css"}],"routeData":{"route":"/","isIndex":true,"type":"page","pattern":"^\\/$","segments":[],"params":[],"component":"src/pages/index.astro","pathname":"/","prerender":true,"fallbackRoutes":[],"distURL":[],"origin":"project","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[],"routeData":{"type":"endpoint","isIndex":false,"route":"/_image","pattern":"^\\/_image\\/?$","segments":[[{"content":"_image","dynamic":false,"spread":false}]],"params":[],"component":"node_modules/astro/dist/assets/endpoint/generic.js","pathname":"/_image","prerender":false,"fallbackRoutes":[],"origin":"internal","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[],"routeData":{"type":"endpoint","isIndex":false,"route":"/api/keystatic/[...params]","pattern":"^\\/api\\/keystatic(?:\\/(.*?))?\\/?$","segments":[[{"content":"api","dynamic":false,"spread":false}],[{"content":"keystatic","dynamic":false,"spread":false}],[{"content":"...params","dynamic":true,"spread":true}]],"params":["...params"],"component":"node_modules/@keystatic/astro/internal/keystatic-api.js","prerender":false,"fallbackRoutes":[],"distURL":[],"origin":"external","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[],"routeData":{"type":"page","isIndex":false,"route":"/keystatic/[...params]","pattern":"^\\/keystatic(?:\\/(.*?))?\\/?$","segments":[[{"content":"keystatic","dynamic":false,"spread":false}],[{"content":"...params","dynamic":true,"spread":true}]],"params":["...params"],"component":"node_modules/@keystatic/astro/internal/keystatic-astro-page.astro","prerender":false,"fallbackRoutes":[],"distURL":[],"origin":"external","_meta":{"trailingSlash":"ignore"}}}],"base":"/","trailingSlash":"ignore","compressHTML":true,"componentMetadata":[["/Users/gius/Documents/Antigravity/NATANGO/src/pages/index.astro",{"propagation":"in-tree","containsHead":true}],["\u0000astro:content",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/src/components/Accordion.astro",{"propagation":"in-tree","containsHead":false}],["\u0000@astro-page:src/pages/index@_@astro",{"propagation":"in-tree","containsHead":false}],["\u0000@astrojs-ssr-virtual-entry",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/src/components/CoursesSection.astro",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/node_modules/@astrojs/markdoc/components/Renderer.astro",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/node_modules/@astrojs/markdoc/components/index.ts",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/src/content/courses/corsi-gruppali.mdoc",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/src/content/courses/corsi-gruppali.mdoc?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/.astro/content-modules.mjs",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/node_modules/astro/dist/content/runtime.js",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/src/content/courses/lezioni-private.mdoc",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/src/content/courses/lezioni-private.mdoc?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/src/content/courses/tecnica-femminile.mdoc",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/src/content/courses/tecnica-femminile.mdoc?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/src/content/locations/mandrione.mdoc",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/src/content/locations/mandrione.mdoc?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/src/content/locations/tuscolana.mdoc",{"propagation":"in-tree","containsHead":false}],["/Users/gius/Documents/Antigravity/NATANGO/src/content/locations/tuscolana.mdoc?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}]],"renderers":[],"clientDirectives":[["idle","(()=>{var l=(n,t)=>{let i=async()=>{await(await n())()},e=typeof t.value==\"object\"?t.value:void 0,s={timeout:e==null?void 0:e.timeout};\"requestIdleCallback\"in window?window.requestIdleCallback(i,s):setTimeout(i,s.timeout||200)};(self.Astro||(self.Astro={})).idle=l;window.dispatchEvent(new Event(\"astro:idle\"));})();"],["load","(()=>{var e=async t=>{await(await t())()};(self.Astro||(self.Astro={})).load=e;window.dispatchEvent(new Event(\"astro:load\"));})();"],["media","(()=>{var n=(a,t)=>{let i=async()=>{await(await a())()};if(t.value){let e=matchMedia(t.value);e.matches?i():e.addEventListener(\"change\",i,{once:!0})}};(self.Astro||(self.Astro={})).media=n;window.dispatchEvent(new Event(\"astro:media\"));})();"],["only","(()=>{var e=async t=>{await(await t())()};(self.Astro||(self.Astro={})).only=e;window.dispatchEvent(new Event(\"astro:only\"));})();"],["visible","(()=>{var a=(s,i,o)=>{let r=async()=>{await(await s())()},t=typeof i.value==\"object\"?i.value:void 0,c={rootMargin:t==null?void 0:t.rootMargin},n=new IntersectionObserver(e=>{for(let l of e)if(l.isIntersecting){n.disconnect(),r();break}},c);for(let e of o.children)n.observe(e)};(self.Astro||(self.Astro={})).visible=a;window.dispatchEvent(new Event(\"astro:visible\"));})();"]],"entryModules":{"\u0000@astro-page:node_modules/@keystatic/astro/internal/keystatic-api@_@js":"pages/api/keystatic/_---params_.astro.mjs","\u0000@astro-page:node_modules/@keystatic/astro/internal/keystatic-astro-page@_@astro":"pages/keystatic/_---params_.astro.mjs","\u0000@astro-page:node_modules/astro/dist/assets/endpoint/generic@_@js":"pages/_image.astro.mjs","\u0000@astro-page:src/pages/index@_@astro":"pages/index.astro.mjs","\u0000@astrojs-ssr-virtual-entry":"entry.mjs","\u0000@astro-renderers":"renderers.mjs","\u0000noop-middleware":"_noop-middleware.mjs","\u0000virtual:astro:actions/noop-entrypoint":"noop-entrypoint.mjs","\u0000@astrojs-ssr-adapter":"_@astrojs-ssr-adapter.mjs","\u0000@astrojs-manifest":"manifest_D5mTkJ8I.mjs","/Users/gius/Documents/Antigravity/NATANGO/node_modules/astro/dist/assets/services/sharp.js":"chunks/sharp_NkO7mWhU.mjs","/Users/gius/Documents/Antigravity/NATANGO/.astro/content-assets.mjs":"chunks/content-assets_DleWbedO.mjs","/Users/gius/Documents/Antigravity/NATANGO/.astro/content-modules.mjs":"chunks/content-modules_CGTkKp9-.mjs","\u0000astro:data-layer-content":"chunks/_astro_data-layer-content_DCIXa3aj.mjs","/Users/gius/Documents/Antigravity/NATANGO/src/content/courses/corsi-gruppali.mdoc?astroPropagatedAssets":"chunks/corsi-gruppali_BUmETvZQ.mjs","/Users/gius/Documents/Antigravity/NATANGO/src/content/courses/lezioni-private.mdoc?astroPropagatedAssets":"chunks/lezioni-private_BZT5kgzu.mjs","/Users/gius/Documents/Antigravity/NATANGO/src/content/courses/tecnica-femminile.mdoc?astroPropagatedAssets":"chunks/tecnica-femminile_-f3LfUCw.mjs","/Users/gius/Documents/Antigravity/NATANGO/src/content/locations/mandrione.mdoc?astroPropagatedAssets":"chunks/mandrione_CTXdhRmu.mjs","/Users/gius/Documents/Antigravity/NATANGO/src/content/locations/tuscolana.mdoc?astroPropagatedAssets":"chunks/tuscolana_DpwGU6Wj.mjs","/Users/gius/Documents/Antigravity/NATANGO/src/content/courses/corsi-gruppali.mdoc":"chunks/corsi-gruppali_Bx1pF22k.mjs","/Users/gius/Documents/Antigravity/NATANGO/src/content/courses/lezioni-private.mdoc":"chunks/lezioni-private_D4NJXxSu.mjs","/Users/gius/Documents/Antigravity/NATANGO/src/content/courses/tecnica-femminile.mdoc":"chunks/tecnica-femminile_ceRanGeJ.mjs","/Users/gius/Documents/Antigravity/NATANGO/src/content/locations/mandrione.mdoc":"chunks/mandrione_DJzDcYny.mjs","/Users/gius/Documents/Antigravity/NATANGO/src/content/locations/tuscolana.mdoc":"chunks/tuscolana_CMrwI8DK.mjs","/Users/gius/Documents/Antigravity/NATANGO/node_modules/@keystatic/astro/internal/keystatic-page.js":"_astro/keystatic-page.Cxg-BQdd.js","@astrojs/react/client.js":"_astro/client.Cyb2CMGr.js","/Users/gius/Documents/Antigravity/NATANGO/src/components/Header.astro?astro&type=script&index=0&lang.ts":"_astro/Header.astro_astro_type_script_index_0_lang.Bf3vvRcd.js","/Users/gius/Documents/Antigravity/NATANGO/src/layouts/Layout.astro?astro&type=script&index=0&lang.ts":"_astro/Layout.astro_astro_type_script_index_0_lang.C5AWcFGh.js","/Users/gius/Documents/Antigravity/NATANGO/src/pages/index.astro?astro&type=script&index=0&lang.ts":"_astro/index.astro_astro_type_script_index_0_lang.EHljd0jt.js","astro:scripts/before-hydration.js":""},"inlinedScripts":[["/Users/gius/Documents/Antigravity/NATANGO/src/components/Header.astro?astro&type=script&index=0&lang.ts","const e=document.getElementById(\"menuToggle\"),t=document.getElementById(\"navMenu\"),s=document.querySelector(\".main-header\");e?.addEventListener(\"click\",()=>{e.classList.toggle(\"active\"),t?.classList.toggle(\"active\"),document.body.classList.toggle(\"no-scroll\")});const l=document.querySelectorAll(\".nav-menu a\");l.forEach(c=>{c.addEventListener(\"click\",()=>{e?.classList.remove(\"active\"),t?.classList.remove(\"active\"),document.body.classList.remove(\"no-scroll\")})});window.addEventListener(\"scroll\",()=>{window.scrollY>50?s?.classList.add(\"scrolled\"):s?.classList.remove(\"scrolled\")});"],["/Users/gius/Documents/Antigravity/NATANGO/src/layouts/Layout.astro?astro&type=script&index=0&lang.ts","const o=document.getElementById(\"back-to-top\");window.addEventListener(\"scroll\",()=>{window.scrollY>300?o?.classList.add(\"show\"):o?.classList.remove(\"show\")});o?.addEventListener(\"click\",()=>{window.scrollTo({top:0,behavior:\"smooth\"})});"],["/Users/gius/Documents/Antigravity/NATANGO/src/pages/index.astro?astro&type=script&index=0&lang.ts","const d=document.getElementById(\"openVideoBtn\"),i=document.getElementById(\"closeVideoBtn\"),e=document.getElementById(\"videoDialog\"),t=document.getElementById(\"promoVideoIframe\"),l=\"1Ltt80bq-8Y\";d?.addEventListener(\"click\",()=>{e&&t&&(t.src=`https://www.youtube.com/embed/${l}?autoplay=1`,e.showModal(),document.body.classList.add(\"no-scroll\"))});const s=()=>{e&&t&&(t.src=\"\",e.close(),document.body.classList.remove(\"no-scroll\"))};i?.addEventListener(\"click\",s);e?.addEventListener(\"click\",o=>{o.target===e&&s()});const r={root:null,rootMargin:\"0px\",threshold:.1},a=new IntersectionObserver((o,c)=>{o.forEach(n=>{n.isIntersecting&&(n.target.classList.add(\"is-visible\"),c.unobserve(n.target))})},r),m=document.querySelectorAll(\".animate-on-scroll\");m.forEach(o=>a.observe(o));"]],"assets":["/_astro/index.CDs1MPyX.css","/favicon.ico","/favicon.svg","/_astro/client.Cyb2CMGr.js","/_astro/index.BcRtWIxf.js","/_astro/keystatic-page.Cxg-BQdd.js","/index.html"],"buildFormat":"directory","checkOrigin":true,"allowedDomains":[],"actionBodySizeLimit":1048576,"serverIslandNameMap":[],"key":"bdMT67E7bqK4ueoPOall4g3LUQHqZZh5HxpwLcIZtRk="});
if (manifest.sessionConfig) manifest.sessionConfig.driverModule = null;

export { manifest };
