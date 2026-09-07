import { resumeStuckQuickVideoRuns } from "../src/lib/quick-video.ts";

const n = await resumeStuckQuickVideoRuns();
console.log(`Resumed ${n} quick-video run(s)`);
