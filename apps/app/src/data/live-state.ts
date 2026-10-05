export { sessionScope } from "../auth/session.ts";

/** Live builds never borrow another household's example content while a read is pending. */
export function demoDataAllowed(
  api: boolean,
  accounts: boolean,
  demo = process.env.EXPO_PUBLIC_DEMO_MODE === "true",
): boolean {
  return demo && !api && !accounts;
}
