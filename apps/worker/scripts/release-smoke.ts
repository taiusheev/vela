import { releaseSmoke } from "./release-smoke-checks.ts";

const environment = process.argv[2];
if (process.argv.length !== 3 || (environment !== "staging" && environment !== "production")) {
  console.error("Usage: node scripts/release-smoke.ts staging|production");
  process.exitCode = 1;
} else {
  const result = await releaseSmoke(environment);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.passed ? 0 : 1;
}
