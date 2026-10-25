import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";
import Purchases, { type PurchasesPackage } from "react-native-purchases";
import { apiConfigured } from "../api/client.ts";
import { accountsConfigured, useAccount } from "../auth/clerk.tsx";
import { demoDataAllowed } from "../data/live-state.ts";
import { useCapabilities } from "../data/useCapabilities.ts";
import {
  billingAvailable,
  lightPaid,
  PARENT_ATTRIBUTE,
  type StorePlan,
  storePlans,
} from "./plans.ts";

/**
 * The public RevenueCat key for iPhone; never a secret. The App Store key (`appl_…`) goes in the
 * build profiles once the founder has connected the App Store; the practice key (`test_…`) works
 * only in a development build (`expo run:ios`), as RevenueCat closes a finished app that has one.
 */
const STORE_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;

let configuredFor: string | null | undefined;

/**
 * Sets the store up once, for this reader: RevenueCat knows them only by their account id, a
 * random string, never a name, email or anything the family wrote.
 */
function configure(userId: string | null): void {
  if (configuredFor === userId || STORE_KEY === undefined) return;
  if (configuredFor === undefined) {
    Purchases.configure({ apiKey: STORE_KEY, appUserID: userId });
  } else if (userId !== null) {
    void Purchases.logIn(userId);
  }
  configuredFor = userId;
}

export interface Billing {
  /** False wherever nothing can be bought: the web, the pilot, a build with no store key. */
  available: boolean;
  plans: StorePlan[];
  loading: boolean;
  paid: boolean;
  buy(planId: string): void;
  buying: boolean;
  /** The reader closed Apple's sheet; nothing was bought and nothing needs saying. */
  cancelled: boolean;
  failed: boolean;
  restore(): void;
  restoring: boolean;
  /** Restore finished and found nothing to bring back. */
  nothingToRestore: boolean;
}

/** Vela Light from the App Store for one parent, `memberId`, through RevenueCat. */
export function useBilling(memberId: string | undefined): Billing {
  const account = useAccount();
  const caps = useCapabilities();
  const queries = useQueryClient();
  const available = billingAvailable({
    platform: Platform.OS,
    key: STORE_KEY,
    serverSells: caps.capabilities?.billing === true,
    demo: demoDataAllowed(apiConfigured(), accountsConfigured()),
    development: __DEV__,
  });
  if (available) configure(account.userId);

  const store = useQuery({
    queryKey: ["billing", account.userId],
    enabled: available,
    queryFn: async () => {
      const [offerings, info] = await Promise.all([
        Purchases.getOfferings(),
        Purchases.getCustomerInfo(),
      ]);
      const packages = offerings.current?.availablePackages ?? [];
      return { packages, plans: storePlans(packages), paid: lightPaid(info) };
    },
  });

  const buy = useMutation({
    mutationFn: async (planId: string) => {
      const chosen: PurchasesPackage | undefined = store.data?.packages.find(
        (item) => item.identifier === planId,
      );
      if (chosen === undefined) throw new Error("plan_missing");
      // Which parent the plan is for, so the server can keep her light on (her member id only).
      if (memberId !== undefined) Purchases.setAttributes({ [PARENT_ATTRIBUTE]: memberId });
      try {
        const result = await Purchases.purchasePackage(chosen);
        return { paid: lightPaid(result.customerInfo), cancelled: false };
      } catch (error) {
        if ((error as { userCancelled?: boolean }).userCancelled === true) {
          return { paid: false, cancelled: true };
        }
        throw error;
      }
    },
    onSuccess: async () => {
      await queries.invalidateQueries({ queryKey: ["billing"] });
      await queries.invalidateQueries({ queryKey: ["family"] });
    },
  });

  const restore = useMutation({
    mutationFn: async () => lightPaid(await Purchases.restorePurchases()),
    onSuccess: async () => {
      await queries.invalidateQueries({ queryKey: ["billing"] });
      await queries.invalidateQueries({ queryKey: ["family"] });
    },
  });

  return {
    available,
    plans: store.data?.plans ?? [],
    loading: available && store.isLoading,
    paid: store.data?.paid === true || buy.data?.paid === true || restore.data === true,
    buy: (planId) => buy.mutate(planId),
    buying: buy.isPending,
    cancelled: buy.data?.cancelled === true,
    failed: buy.isError || restore.isError || store.isError,
    restore: () => restore.mutate(),
    restoring: restore.isPending,
    nothingToRestore: restore.isSuccess && restore.data === false,
  };
}
