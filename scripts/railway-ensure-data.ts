/**
 * Ensure persistent Railway volume dirs exist before Prisma / gallery writes.
 */
import { ensureDataDirs } from "../src/lib/paths";

ensureDataDirs();
console.log("[railway] data dirs OK:", process.env.DATABASE_URL || "(default)");
