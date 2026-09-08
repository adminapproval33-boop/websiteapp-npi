import { createApp } from "./app";
import { env } from "./lib/env";
import { startBackupScheduler } from "./modules/backup/backupScheduler";

const app = createApp();
startBackupScheduler();

const server = app.listen(env.port, () => {
  console.log(`Websiteapp NPI API berjalan di http://localhost:${env.port}`);
});

// Import Master Data (file besar, jutaan baris) bisa makan waktu beberapa
// menit -- naikkan timeout bawaan Node (default 5 menit sebenarnya sudah
// cukup, tapi dibuat eksplisit & lebih longgar demi aman).
server.requestTimeout = 30 * 60 * 1000; // 30 menit
server.headersTimeout = 30 * 60 * 1000 + 5000;
