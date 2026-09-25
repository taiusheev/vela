import { I18nProvider, type TransRenderProps } from "@lingui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getLocales } from "expo-localization";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, Text } from "react-native";
import { ApiError, apiConfigured, fetchMe, updateAccount } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";
import { readSetting, readSettingNow, writeSetting } from "../storage/flags.ts";
import { activate, i18n } from "./i18n.ts";
import { type AppLocale, fromDevice, fromLang, isAppLocale } from "./locale.ts";

/** Kept as `vela.locale`: the language the account last gave, or the reader last chose. */
const SETTING = "locale";

/**
 * The language before anything renders, so the first screen already has its words: what this web
 * page remembers, or the device's own. A phone reads what it remembers a moment later, under the
 * splash screen (`settled`).
 */
function initialLocale(): AppLocale {
  const remembered = readSettingNow(SETTING);
  return isAppLocale(remembered) ? remembered : fromDevice(getLocales());
}

activate(initialLocale());

function currentLocale(): AppLocale {
  return isAppLocale(i18n.locale) ? i18n.locale : "en";
}

export interface AppLocaleState {
  locale: AppLocale;
  /** False until a phone has read the remembered language; the splash screen stays until then. */
  settled: boolean;
  /**
   * The reader's choice. Signed in with an account, it changes the account's language and the app
   * follows once the account has it, so a refusal never flips the screen back and forth; with no
   * account yet it applies at once and is remembered on this device.
   */
  choose(next: AppLocale): void;
  /** The account is being changed; the choices wait for it. */
  choosing: boolean;
  /** The last change did not go through, so the language is still the one shown. */
  refused: boolean;
}

const LocaleContext = createContext<AppLocaleState>({
  locale: currentLocale(),
  settled: true,
  choose: activate,
  choosing: false,
  refused: false,
});

export function useAppLocale(): AppLocaleState {
  return useContext(LocaleContext);
}

/**
 * A `<Trans>` that ends up outside a `Text` would crash a phone, which draws no bare strings; this
 * wraps it in one. Inside a `Text` it inherits that text's style, as nested text does.
 */
function PlainText({ children }: TransRenderProps) {
  return <Text>{children}</Text>;
}

/**
 * The app's language: the account's once `GET /v1/me` has said, before that the one this device
 * remembers, and before anything the device's own (build plan 3.1). Switching re-renders every
 * reader of `useLingui` in place, so navigation and what was typed are kept.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const queries = useQueryClient();
  const keyFor = useIdempotencyKey("language");
  const [locale, setLocale] = useState<AppLocale>(currentLocale);
  const [settled, setSettled] = useState(Platform.OS === "web");
  // Once the account has given its language, a remembered one read late must not undo it.
  const fromAccount = useRef(false);

  const apply = useCallback((next: AppLocale, remember: boolean) => {
    activate(next);
    setLocale(next);
    if (remember) void writeSetting(SETTING, next);
  }, []);

  useEffect(() => {
    let current = true;
    void readSetting(SETTING).then((remembered) => {
      if (!current) return;
      if (isAppLocale(remembered) && !fromAccount.current) apply(remembered, false);
      setSettled(true);
    });
    return () => {
      current = false;
    };
  }, [apply]);

  // The same query as Today's, so react-query makes the one request for both.
  const enabled = apiConfigured() && account.ready && account.signedIn;
  const me = useQuery({
    queryKey: ["me"],
    enabled,
    queryFn: async () => fetchMe(await account.token()),
  });
  const language = me.data?.user.language;
  useEffect(() => {
    if (language === undefined) return;
    fromAccount.current = true;
    apply(fromLang(language), true);
  }, [language, apply]);

  const patch = useMutation({
    mutationFn: async (next: AppLocale) =>
      updateAccount({ language: next }, keyFor({ language: next }), await account.token()),
    onSuccess: async () => {
      await queries.invalidateQueries({ queryKey: ["me"] });
    },
  });
  // Only a 404 means there is no account yet, which onboarding then makes in this language. While
  // /v1/me is loading or has failed, the account still exists: a change goes to it, and a failure
  // says so, instead of a switch on this device that the next answer from the account would undo.
  const noAccountYet = me.error instanceof ApiError && me.error.status === 404;
  const viaAccount = enabled && !noAccountYet;
  const { mutate } = patch;
  const choose = useCallback(
    (next: AppLocale) => {
      if (next === locale) return;
      if (viaAccount) mutate(next);
      else apply(next, true);
    },
    [locale, viaAccount, mutate, apply],
  );

  const value = useMemo<AppLocaleState>(
    () => ({ locale, settled, choose, choosing: patch.isPending, refused: patch.isError }),
    [locale, settled, choose, patch.isPending, patch.isError],
  );
  return (
    <LocaleContext.Provider value={value}>
      <I18nProvider i18n={i18n} defaultComponent={PlainText}>
        {children}
      </I18nProvider>
    </LocaleContext.Provider>
  );
}
