import { check } from "k6";
import http from "k6/http";
import { Counter, Rate } from "k6/metrics";

const contentDecoded = new Rate("content_decoded");
const tokenAvailable = new Rate("token_available");
const velaRequests = new Counter("vela_requests");

const STAGING_ORIGIN = "https://vela.vela-light-staging.workers.dev";
const BASELINE_REQUESTS_PER_MINUTE = Number(
  __ENV.EXPECTED_PEAK_REQUESTS_PER_MINUTE ?? "10",
);
const SCALE = 10;
const STAGING_READ_LIMIT_PER_MINUTE = 120;
const RATE_PER_MINUTE = Math.ceil(BASELINE_REQUESTS_PER_MINUTE * SCALE);
const FAMILY_ID = __ENV.LOAD_TEST_FAMILY_ID ?? "";
const TOKEN_BRIDGE = __ENV.LOAD_TEST_TOKEN_BRIDGE ?? "";
const TOKEN_CAPABILITY = __ENV.LOAD_TEST_TOKEN_CAPABILITY ?? "";
// Match the guarded staging fixture helper; actual family words never qualify as test content.
const ASK = "Synthetic ADR38 test: what colour is the sample garden?";
const ANSWER = "Synthetic ADR38 test: the sample garden is green.";
const REPLY = "Synthetic ADR38 test: the sample reply is recorded.";

if (
  !Number.isFinite(BASELINE_REQUESTS_PER_MINUTE) ||
  BASELINE_REQUESTS_PER_MINUTE <= 0
) {
  throw new Error("EXPECTED_PEAK_REQUESTS_PER_MINUTE must be a positive number");
}
if (RATE_PER_MINUTE >= STAGING_READ_LIMIT_PER_MINUTE) {
  throw new Error(
    `10x load would reach ${RATE_PER_MINUTE}/min; ` +
      `staging's API_IP_LIMIT is ${STAGING_READ_LIMIT_PER_MINUTE}/min`,
  );
}
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    FAMILY_ID,
  )
) {
  throw new Error("LOAD_TEST_FAMILY_ID must be a UUID for a synthetic staging family");
}
if (!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/session-token$/.test(TOKEN_BRIDGE) ||
  !/^[A-Za-z0-9_-]{43}$/.test(TOKEN_CAPABILITY)) {
  throw new Error("Start this check with the private Node launcher; no session token is entered into k6");
}

export const options = {
  // URL tags would retain private family identifiers; route names are the metric labels.
  systemTags: ["status", "method", "name", "group", "check", "scenario", "expected_response"],
  scenarios: {
    sealed_content_reads: {
      executor: "constant-arrival-rate",
      rate: RATE_PER_MINUTE,
      timeUnit: "1m",
      duration: "5m",
      preAllocatedVUs: 10,
      maxVUs: 30,
    },
  },
  thresholds: {
    content_decoded: ["rate==1"],
    token_available: ["rate==1"],
    vela_requests: [`count>=${RATE_PER_MINUTE * 5}`],
    checks: ["rate>0.99"],
    dropped_iterations: ["count==0"],
    "http_req_duration{service:vela-load}": ["p(95)<1000"],
    "http_req_failed{service:vela-load}": ["rate<0.01"],
    "http_req_failed{service:token-bridge}": ["rate==0"],
  },
};

const url = `${STAGING_ORIGIN}/v1/families/${FAMILY_ID}/exchanges?limit=50`;

function currentToken() {
  const response = http.get(TOKEN_BRIDGE, {
    headers: { Authorization: `Bearer ${TOKEN_CAPABILITY}` }, redirects: 0, timeout: "2s",
    tags: { name: "Local verified-session bridge", service: "token-bridge", test: "adr38-content-read" },
  });
  let token = null;
  if (response.status === 200) {
    try {
      const result = response.json();
      if (typeof result.jwt === "string" && result.jwt.length <= 8192 &&
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(result.jwt) &&
        Number.isSafeInteger(result.expires_at) && result.expires_at > Date.now() / 1000 + 5) token = result.jwt;
    } catch { token = null; }
  }
  tokenAvailable.add(token !== null);
  return token;
}

function readExchangePage(name, service) {
  const token = currentToken();
  if (token === null) return null;
  const response = http.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirects: 0,
    timeout: "10s",
    tags: { name, service, test: "adr38-content-read" },
  });
  if (service === "vela-load") velaRequests.add(1);
  return response;
}

function hasDecodedFixture(exchangePage) {
  if (!Array.isArray(exchangePage.exchanges) || exchangePage.exchanges.length !== 1 ||
    exchangePage.next_cursor !== null) return false;
  const exchange = exchangePage.exchanges[0];
  return exchange?.ask === ASK && exchange.answer?.text === ANSWER &&
    Array.isArray(exchange.replies) && exchange.replies.length === 1 &&
    exchange.replies[0]?.text === REPLY;
}

export function setup() {
  const response = readExchangePage("ADR-38 synthetic-fixture preflight", "vela-preflight");
  let decoded = false;
  if (response?.status === 200) {
    try {
      decoded = hasDecodedFixture(response.json());
    } catch {
      decoded = false;
    }
  }
  if (!decoded) {
    throw new Error(
      "Preflight failed; verify the staging session, family access, and synthetic fixture. No response data was printed.",
    );
  }
}

export default function () {
  const response = readExchangePage("GET /v1/families/:familyId/exchanges", "vela-load");

  let decoded = false;
  if (response?.status === 200) {
    try {
      decoded = hasDecodedFixture(response.json());
    } catch {
      decoded = false;
    }
  }

  contentDecoded.add(decoded);
  check(response, {
    "staging returns HTTP 200": (res) => res?.status === 200,
    "synthetic ask, answer, and reply were decoded": () => decoded,
  });
}
