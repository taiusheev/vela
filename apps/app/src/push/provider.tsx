import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import type { PushData } from "@vela/contracts";
import { randomUUID } from "expo-crypto";
import type { NotificationResponse } from "expo-notifications";
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
import { AppState, Linking, Platform } from "react-native";
import { apiConfigured, registerPushDevice, removePushDevice } from "../api/client.ts";
import { type Account, useAccount } from "../auth/clerk.tsx";
import type { PushAvailability } from "./availability.ts";
import {
  forgetPendingRemoval,
  forgetRegistered,
  installationId,
  knownInstallationId,
  readPendingRemoval,
  readRegistered,
  writePendingRemoval,
  writeRegistered,
} from "./device.ts";
import {
  type ChannelWords,
  currentAvailability,
  ensureChannels,
  loadNotifications,
  type NotificationsModule,
  quietChannelBlocked,
} from "./notifications.ts";
import {
  type DeviceState,
  mayRegister,
  type PhonePermission,
  phonePermission,
  registrationNeeded,
  reportedPermission,
  reusableExpoToken,
} from "./registration.ts";
import { pushDataOf } from "./taps.ts";

/**
 * Push on this phone (ADR-34, build plan 3.8): what the phone allows, asking for it when the reader
 * chooses to, keeping the API told about this phone, the phone let go at sign-out, and the
 * notification the reader tapped. Nothing here asks at launch: permission is asked only from a
 * button the reader pressed (onboarding's last step, after a first ask, You). Where the build
 * cannot receive pushes (`currentAvailability`), all of it stands still and You says so.
 */

export interface PhoneState {
  permission: PhonePermission;
  /** False once the phone will not ask again: only its settings can turn notifications on. */
  canAskAgain: boolean;
  /** Android: the reader blocked the quiet channel in the phone's settings. */
  quietChannelBlocked: boolean;
}

export interface PushView {
  availability: PushAvailability;
  /** What the phone allows, or null until it has been read (and always where push is unavailable). */
  phone: PhoneState | null;
  /** The phone's prompt is open. */
  asking: boolean;
  /** The last registration did not reach the API; the next start or return to the app tries again. */
  trouble: boolean;
  /** Ask the phone for notifications (alert and sound; no badge, never provisional), then register. */
  ask(): Promise<void>;
  /** The phone's settings for this app, where a refusal it will not ask about again is undone. */
  openSettings(): void;
  /** Let this phone go from the account, then sign out (A5). */
  signOut(): Promise<void>;
  /** The notification the reader tapped, until it has been opened. */
  tapped: PushData | null;
  /** The tapped notification has been opened: forget it, here and in expo-notifications. */
  tapOpened(): void;
}

const unavailable: PushView = {
  availability: { available: false, reason: "web" },
  phone: null,
  asking: false,
  trouble: false,
  ask: async () => {},
  openSettings: () => {},
  signOut: async () => {},
  tapped: null,
  tapOpened: () => {},
};

const PushContext = createContext<PushView>(unavailable);

export function usePush(): PushView {
  return useContext(PushContext);
}

/** How long sign-out waits for the API to take the phone off the account before going on. */
const REMOVAL_WAIT_MS = 5_000;

/** One registration at a time: a start, a return to the app and a sign-in can all ask at once. */
let queue: Promise<void> = Promise.resolve();
function serially(work: () => Promise<void>): Promise<void> {
  queue = queue.then(work, work);
  return queue;
}

let channelsMade: Promise<void> | undefined;
/** The channels exist before anything asks permission or a token; made once, then renamed. */
function channelsFirst(notifications: NotificationsModule, words: ChannelWords): Promise<void> {
  channelsMade ??= ensureChannels(notifications, words).catch((error: unknown) => {
    channelsMade = undefined;
    throw error;
  });
  return channelsMade;
}

function writeKey(kind: string): string {
  return `${kind}:${randomUUID()}`;
}

async function readPhone(notifications: NotificationsModule): Promise<PhoneState> {
  const reading = await notifications.getPermissionsAsync();
  return {
    permission: phonePermission(reading),
    canAskAgain: reading.canAskAgain,
    quietChannelBlocked: await quietChannelBlocked(notifications),
  };
}

/** A removal sign-out could not finish: done now for its own account, dropped for any other. */
async function finishPendingRemoval(account: Account): Promise<void> {
  const pending = await readPendingRemoval();
  if (pending === null) return;
  if (pending.accountId === account.userId) {
    await removePushDevice(pending.installationId, writeKey("push-remove"), await account.token());
  }
  // Another account's phone moves to this one when it registers, and sign-out already told the
  // phone's push service to stop, so the old account's next push finds it gone.
  await forgetPendingRemoval();
}

/** Tells the API about this phone when something it holds would change (`registrationNeeded`). */
async function register(
  notifications: NotificationsModule,
  account: Account,
  phone: PhoneState,
  projectId: string,
): Promise<boolean> {
  if (!apiConfigured() || !account.ready || !account.signedIn || account.userId === null) {
    return false;
  }
  await finishPendingRemoval(account);
  const last = await readRegistered();
  if (!mayRegister(phone.permission, last, account.userId)) return false;
  const now = Date.now();
  let token: string;
  let deviceToken: string;
  if (phone.permission === "granted") {
    const device = await notifications.getDevicePushTokenAsync();
    deviceToken = String(device.data);
    token =
      reusableExpoToken(last, deviceToken, now) ??
      (await notifications.getExpoPushTokenAsync({ projectId, devicePushToken: device })).data;
  } else if (last !== null) {
    // Not allowed any more: the API hears so under the token it knows, and stops counting it.
    token = last.token;
    deviceToken = last.deviceToken;
  } else {
    return false;
  }
  const current: DeviceState = {
    accountId: account.userId,
    installationId: await installationId(),
    token,
    platform: Platform.OS === "ios" ? "ios" : "android",
    permission: reportedPermission(phone.permission),
    quietChannelBlocked: phone.quietChannelBlocked,
  };
  if (!registrationNeeded(current, last, now)) return false;
  await registerPushDevice(
    {
      installation_id: current.installationId,
      token: current.token,
      platform: current.platform,
      permission: current.permission,
      quiet_channel_blocked: current.quietChannelBlocked,
    },
    writeKey("push-device"),
    await account.token(),
  );
  await writeRegistered({ ...current, at: Date.now(), deviceToken });
  return true;
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error("timed out")), ms);
  });
}

export function PushProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const queries = useQueryClient();
  const { t } = useLingui();
  const availability = currentAvailability();
  // The channels' names are what the phone's settings show, so they are in the app's language and
  // are set again when it changes (`t` changes with it).
  const words = useMemo<ChannelWords>(
    () => ({
      quiet: {
        name: t`When a morning goes quiet`,
        description: t`If her morning stays quiet past her usual time, and when it is settled.`,
      },
      daily: {
        name: t`One moment a day`,
        description: t`When she answers what you asked, and the evening before your turn.`,
      },
    }),
    [t],
  );
  const wordsNow = useRef(words);
  wordsNow.current = words;
  const [phone, setPhone] = useState<PhoneState | null>(null);
  const [asking, setAsking] = useState(false);
  const [trouble, setTrouble] = useState(false);
  const [tapped, setTapped] = useState<PushData | null>(null);
  // The latest account, for work that finishes after the render that started it.
  const accountNow = useRef(account);
  accountNow.current = account;

  /** Reads the phone again and registers for `who` if anything changed; never throws. */
  const refresh = useCallback(
    (who: Account) =>
      serially(async () => {
        if (!availability.available) return;
        const notifications = await loadNotifications();
        if (notifications === null) return;
        try {
          await channelsFirst(notifications, wordsNow.current);
          const read = await readPhone(notifications);
          setPhone(read);
          const changed = await register(notifications, who, read, availability.projectId);
          setTrouble(false);
          // How an organiser is told (You) may have changed with this phone.
          if (changed) await queries.invalidateQueries({ queryKey: ["family"] });
        } catch (error) {
          // Never the token: the error names what failed, and the next start tries again.
          console.warn("[push] this phone could not be registered", error);
          setTrouble(true);
        }
      }),
    [availability, queries],
  );

  // On start, on every sign-in or change of account, and whenever the reader comes back to the app,
  // since notifications may have been turned off or on in the phone's settings meanwhile.
  useEffect(() => {
    if (!account.ready) return;
    void refresh(account);
  }, [account, refresh]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh(accountNow.current);
    });
    return () => subscription.remove();
  }, [refresh]);

  // The channels are named again whenever the language changes.
  useEffect(() => {
    if (!availability.available) return;
    void loadNotifications().then(async (notifications) => {
      if (notifications === null) return;
      try {
        await channelsFirst(notifications, words);
        await ensureChannels(notifications, words);
      } catch (error) {
        console.warn("[push] the notification channels could not be set", error);
      }
    });
  }, [availability, words]);

  // Taps: the one that opened the app, read once, and every one after it while the app runs. Each
  // is taken once, by its id, and held until Root can open it.
  useEffect(() => {
    if (!availability.available) return;
    let current = true;
    let subscription: { remove(): void } | undefined;
    const seen = new Set<string>();
    void loadNotifications().then((notifications) => {
      if (notifications === null || !current) return;
      const take = (response: NotificationResponse) => {
        if (response.actionIdentifier !== notifications.DEFAULT_ACTION_IDENTIFIER) return;
        const id = response.notification.request.identifier;
        if (seen.has(id)) return;
        seen.add(id);
        const data = pushDataOf(response.notification.request.content.data);
        if (data !== null) setTapped(data);
      };
      const launching = notifications.getLastNotificationResponse();
      if (launching !== null) take(launching);
      subscription = notifications.addNotificationResponseReceivedListener(take);
    });
    return () => {
      current = false;
      subscription?.remove();
    };
  }, [availability]);

  const ask = useCallback(async () => {
    if (!availability.available) return;
    const notifications = await loadNotifications();
    if (notifications === null) return;
    setAsking(true);
    try {
      await channelsFirst(notifications, wordsNow.current);
      await notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      });
    } catch (error) {
      console.warn("[push] the phone's prompt did not open", error);
    } finally {
      setAsking(false);
    }
    await refresh(accountNow.current);
  }, [availability, refresh]);

  const openSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  const signOut = useCallback(async () => {
    const who = accountNow.current;
    if (availability.available) {
      await serially(async () => {
        const id = await knownInstallationId();
        const last = await readRegistered();
        if (id !== null && last !== null && who.userId !== null && apiConfigured()) {
          // Kept first, so a removal that does not arrive is finished when this account is back.
          await writePendingRemoval({ accountId: who.userId, installationId: id });
          try {
            await Promise.race([
              removePushDevice(id, writeKey("push-remove"), await who.token()),
              timeout(REMOVAL_WAIT_MS),
            ]);
            await forgetPendingRemoval();
          } catch (error) {
            console.warn("[push] this phone could not be taken off the account yet", error);
          }
        }
        await forgetRegistered();
        // A phone handed to someone else must stop showing this account's notifications even if
        // the API was not reached: the push service forgets the phone, and the next push to it is
        // refused as gone, which deletes it on the API.
        const notifications = await loadNotifications();
        try {
          await notifications?.unregisterForNotificationsAsync();
        } catch (error) {
          console.warn("[push] the phone's push service could not be told", error);
        }
      });
    }
    await who.signOut();
  }, [availability]);

  const tapOpened = useCallback(() => {
    setTapped(null);
    void loadNotifications().then((notifications) => {
      notifications?.clearLastNotificationResponse();
    });
  }, []);

  const value = useMemo<PushView>(
    () => ({
      availability,
      phone,
      asking,
      trouble,
      ask,
      openSettings,
      signOut,
      tapped,
      tapOpened,
    }),
    [availability, phone, asking, trouble, ask, openSettings, signOut, tapped, tapOpened],
  );
  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}
