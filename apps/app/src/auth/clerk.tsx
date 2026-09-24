import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import { createContext, type ReactNode, useContext, useMemo } from "react";

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
  /** The bearer token for the API, or null when there is no session. */
  token(): Promise<string | null>;
  signOut(): Promise<void>;
}

const noAccount: Account = {
  ready: true,
  signedIn: false,
  userId: null,
  token: async () => null,
  signOut: async () => {},
};

const AccountContext = createContext<Account>(noAccount);

/** Inside the provider, so Clerk's own hook is the only thing that reads its state. */
function ClerkAccount({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useAuth();
  const account = useMemo<Account>(
    () => ({
      ready: isLoaded,
      signedIn: isSignedIn === true,
      userId: userId ?? null,
      token: () => getToken(),
      signOut: () => signOut(),
    }),
    [isLoaded, isSignedIn, userId, getToken, signOut],
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
