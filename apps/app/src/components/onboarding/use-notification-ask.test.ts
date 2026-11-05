import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationAsk } from "./use-notification-ask.ts";

const mocks = vi.hoisted(() => ({
  pushSent: false,
  pushEnabled: true,
  available: true,
  phone: { permission: "undetermined", canAskAgain: true },
  ask: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("../../api/client.ts", () => ({ apiConfigured: () => true }));
vi.mock("../../data/useToday.ts", () => ({ useToday: () => ({ pushSent: mocks.pushSent }) }));
vi.mock("../../data/useCapabilities.ts", () => ({
  useCapabilities: () => ({ capabilities: { push: mocks.pushEnabled } }),
}));
vi.mock("../../push/provider.tsx", () => ({
  usePush: () => ({
    phone: mocks.phone,
    availability: { available: mocks.available },
    asking: false,
    ask: mocks.ask,
    openSettings: mocks.settings,
  }),
}));
let renderer: ReactTestRenderer | undefined;
let current: ReturnType<typeof useNotificationAsk>;
function Probe() {
  current = useNotificationAsk();
  return null;
}
async function mount() {
  await act(async () => {
    renderer = create(createElement(Probe));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.pushSent = false;
  mocks.pushEnabled = true;
  mocks.available = true;
  mocks.phone = { permission: "undetermined", canAskAgain: true };
  mocks.ask.mockClear();
  mocks.settings.mockClear();
});
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
});
describe("notification setup while the family awaits approval", () => {
  it("offers permission using public capabilities while the account read is blocked", async () => {
    await mount();
    expect(current.offered).toBe(true);
    expect(mocks.ask).not.toHaveBeenCalled();
    await current.ask();
    expect(mocks.ask).toHaveBeenCalledOnce();
  });
  it.each(["push-off", "unsupported", "already-granted"])(
    "does not offer an unnecessary prompt: %s",
    async (reason) => {
      if (reason === "push-off") mocks.pushEnabled = false;
      if (reason === "unsupported") mocks.available = false;
      if (reason === "already-granted") mocks.phone.permission = "granted";
      await mount();
      expect(current.offered).toBe(false);
      expect(mocks.ask).not.toHaveBeenCalled();
    },
  );
  it("offers Settings when the phone refuses another system prompt", async () => {
    mocks.phone = { permission: "denied", canAskAgain: false };
    await mount();
    await current.ask();
    expect(mocks.settings).toHaveBeenCalledOnce();
    expect(mocks.ask).not.toHaveBeenCalled();
  });
});
