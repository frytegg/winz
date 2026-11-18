/// <reference lib="webworker" />
import {
  CacheFirst,
  ExpirationPlugin,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type SerwistGlobalConfig,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * The service worker caches static assets only: the build's own files, the brand and sport images,
 * fonts. It never touches `/api`, a page or a payment: those always go to the network, so a ticket,
 * an odds figure or a payment status is never stale. There is no offline page on purpose.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "next-static",
        plugins: [new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 60 * 60 * 24 * 30 })],
      }),
    },
    {
      matcher: ({ request, sameOrigin, url }) =>
        sameOrigin && !url.pathname.startsWith("/api/") && request.destination === "image",
      handler: new StaleWhileRevalidate({
        cacheName: "images",
        plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 })],
      }),
    },
    {
      matcher: ({ request }) => request.destination === "font",
      handler: new CacheFirst({
        cacheName: "fonts",
        plugins: [new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 })],
      }),
    },
  ],
});

serwist.addEventListeners();
