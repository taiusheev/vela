/** Compare the same synthetic HTTP responses before and after a change; never prints sessions. */
import { createHash, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const key = createHmac("sha256", process.env.CLOUDFLARE_API_TOKEN ?? "")
  .update("vela-hosted-swarm/control")
  .digest("base64url");
const origin = "https://vela-swarm-20261018.vela-light-staging.workers.dev";
const label = process.argv[2];
if (!["before", "after"].includes(label)) throw new Error("label");
const stable = (v) =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable(v[k])]),
        )
      : v;
const samples = [],
  payloads = [];
for (let index = 0; index < 10; index++) {
  const parts = [
    { alg: "HS256", typ: "JWT" },
    {
      sub: `swarm-${index}`,
      iss: "vela-synthetic-only",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  ].map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"));
  const signature = createHmac("sha256", key).update(parts.join(".")).digest("base64url");
  const headers = { authorization: `Bearer ${parts.join(".")}.${signature}` };
  const me = await fetch(`${origin}/v1/me`, { headers });
  if (!me.ok) throw new Error(`me_${me.status}`);
  const data = await me.json(),
    family = data.memberships[0].family.id;
  for (let repeat = 0; repeat < 3; repeat++) {
    const start = performance.now();
    const r = await fetch(`${origin}/v1/families/${family}/exchanges`, { headers });
    if (!r.ok) throw new Error(`read_${r.status}`);
    const body = await r.json();
    samples.push(performance.now() - start);
    if (repeat === 0)
      payloads.push({
        index,
        cards: body.exchanges.length,
        hash: createHash("sha256")
          .update(JSON.stringify(stable(body)))
          .digest("hex"),
      });
  }
}
samples.sort((a, b) => a - b);
const report = {
  label,
  recordedAt: new Date().toISOString(),
  families: 10,
  requests: samples.length,
  p50Ms: samples[Math.ceil(samples.length * 0.5) - 1],
  p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
  payloads,
};
if (label === "after") {
  const before = JSON.parse(
    await readFile(
      new URL("../../../../infra/load-tests/hosted-swarm-benchmark-before.json", import.meta.url),
      "utf8",
    ),
  );
  report.identicalResponses = JSON.stringify(before.payloads) === JSON.stringify(payloads);
  if (!report.identicalResponses) process.exitCode = 1;
  report.p95ChangePercent = (report.p95Ms / before.p95Ms - 1) * 100;
}
await writeFile(
  new URL(`../../../../infra/load-tests/hosted-swarm-benchmark-${label}.json`, import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    label,
    p50Ms: report.p50Ms,
    p95Ms: report.p95Ms,
    identicalResponses: report.identicalResponses,
    p95ChangePercent: report.p95ChangePercent,
  }),
);
