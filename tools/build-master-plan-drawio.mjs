// Builds design/diagrams/master-plan.drawio: the whole Vela foundation as a multi-page, editable Draw.io map.
// Run: node tools/build-master-plan-drawio.mjs
// Pages live in tools/mp/*.mjs by section. Edit the data there, re-run, commit.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { overview } from "./mp/overview.mjs";
import { foundation } from "./mp/foundation.mjs";
import { research } from "./mp/research.mjs";
import { product } from "./mp/product.mjs";
import { architecture } from "./mp/architecture.mjs";
import { business } from "./mp/business.mjs";
import { gtm } from "./mp/gtm.mjs";
import { plan } from "./mp/plan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "design", "diagrams", "master-plan.drawio");

const sections = [foundation(), research(), product(), architecture(), business(), gtm(), plan()];
const pages = [overview(sections), ...sections.flat()];
const file = `<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" agent="Vela generator" version="24.0.0">${pages.map((p) => p.xml()).join("")}</mxfile>`;
writeFileSync(OUT, file, "utf8");
console.log(`wrote ${OUT} · ${pages.length} pages · ${(file.length / 1024).toFixed(0)} KB`);
