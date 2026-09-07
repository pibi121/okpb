import { runTgBootstrapNow } from "../src/lib/tg/tg-bootstrap";

runTgBootstrapNow()
  .then((counts) => {
    console.log("[seed-tg-catalog]", counts);
    process.exit(0);
  })
  .catch((e) => {
    console.error("[seed-tg-catalog]", e);
    process.exit(1);
  });
