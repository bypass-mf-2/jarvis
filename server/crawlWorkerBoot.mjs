// Bootstrap: registers tsx ESM loader then loads the actual worker
import { register } from "tsx/esm/api";
register();
await import("./crawlWorker.ts");
