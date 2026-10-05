/** A catalog, compiled from its .po file by Lingui's Metro transformer as the app is bundled. */
declare module "*.po" {
  import type { Messages } from "@lingui/core";
  export const messages: Messages;
}
