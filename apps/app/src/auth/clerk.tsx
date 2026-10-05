import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { sessionRequests } from "../api/request-session.ts";
import { clearAudioCache } from "../audio/cache.ts";
import { clearPhotoCache } from "../data/photos.ts";
import { activatePrivateSession, clearSessionDrafts } from "../storage/drafts.ts";

/**
 * Sign-in is Clerk's (build plan 3.1). The key is public by design and arrives through the
 * environment, so a checkout without one still runs: the app then has no account, reads its
 * fixtures, and never pretends someone is signed in.
 */
export const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export function accountsConfigured(): boolean {
  return typeof publishableKey === "string" && publishableKey.length > 0;
}

export interface Account {
  /** Whether Clerk has finished loading; without a key there is nothing to load. */
  ready: boolean;
  signedIn: boolean;
  /** The account id Clerk knows this person by; the seed and Clerk’s own Users page use it. */
  userId: string | null;
  /** Development-only identifier for the private staging load runner; never a bearer token. */
  sessionId?: string | null;
  /**
   * The bearer token for the API, or null when there is no session. Clerk hands back the token it
   * holds while it is still good; `fresh` asks Clerk for a new one, for a retry after the API has
   * refused the one held (401).
   */
  token(options?: { fresh?: boolean }): Promise<string | null>;
  signOut(): Promise<void>;
}

const noAccount: Account = {
  ready: true,
  signedIn: false,
  userId: null,
  sessionId: null,
  token: async () => null,
  signOut: async () => {},
};

const AccountContext = createContext<Account>(noAccount);

/** Inside the provider, so Clerk's own hook is the only thing that reads its state. */
function ClerkAccount({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, sessionId, getToken, signOut } = useAuth();
  const scope = `${userId ?? "unknown"}:${sessionId ?? "session"}`;
  const account = useMemo<Account>(
    () => ({
      ready: isLoaded,
      signedIn: isSignedIn === true,
      userId: userId ?? null,
      sessionId: sessionId ?? null,
      token: (options) =>
        sessionRequests.runInScope(scope, () =>
          getToken(options?.fresh === true ? { skipCache: true } : undefined),
        ),
      signOut: async () => {
        sessionRequests.end(scope);
        clearPhotoCache();
        void clearAudioCache().catch(() => {});
        await clearSessionDrafts(scope);
        try {
          await signOut();
        } catch (error) {
          // A failed provider sign-out leaves this identity active, but never resumes old work.
          if (sessionRequests.resume(scope)) activatePrivateSession(scope);
          throw error;
        }
      },
    }),
    [isLoaded, isSignedIn, userId, sessionId, getToken, signOut, scope],
  );
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  if (!accountsConfigured() || publishableKey === undefined) {
    return <AccountContext.Provider value={noAccount}>{children}</AccountContext.Provider>;
  }
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ClerkAccount>{children}</ClerkAccount>
    </ClerkProvider>
  );
}

export function useAccount(): Account {
  return useContext(AccountContext);
}
