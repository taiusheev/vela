import { apiBaseUrl } from "./client.ts";

/** Public contact and notice destinations; these identifiers are never translated. */
export const PRODUCTION_NOTICE_ORIGIN = "https://vela.vela-light.workers.dev";
/** The real Vela's public pages live on its own address, so a family never sees a worker host. */
export const PUBLIC_SITE_ORIGIN = "https://vela-light.com";
export const SUPPORT_EMAIL = "support@vela-light.com";
export const SUPPORT_URL =
  "mailto:support@vela-light.com?subject=Vela%20help%20or%20data%20request";

/**
 * Where a notice page opens: the test copy shows its own pages, and the real Vela, or a build with no
 * server, shows them on vela-light.com, which serves the same notice.
 */
export function noticeUrl(path: string, api: string | undefined = apiBaseUrl): string {
  const origin =
    api === undefined || api === "" || api === PRODUCTION_NOTICE_ORIGIN ? PUBLIC_SITE_ORIGIN : api;
  return `${origin}${path}`;
}
