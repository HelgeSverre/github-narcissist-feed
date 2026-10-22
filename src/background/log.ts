/** The one logger for the service worker: every module imports this so all lines carry the same prefix. */
export const log = (...a: unknown[]) => console.info("[narcissist-feed]", new Date().toISOString().slice(11, 19), ...a);
