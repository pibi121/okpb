import { resumeStuckQuickVideoRuns } from "../src/lib/quick-video";

const n = await resumeStuckQuickVideoRuns();
console.log(`Resumed ${n} quick-video run(s). GPU jobs running in this process — leave it open.`);

// Keep process alive while GPU queue drains.
await new Promise(() => {});
