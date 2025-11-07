import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const PID_FILE = path.join(process.cwd(), "watcher.pid");
const LOG_FILE = path.join(process.cwd(), "logs", "watcher.log");

// Ensure logs directory exists
fs.mkdirSync("logs", { recursive: true });

function isWatcherRunning() {
  if (!fs.existsSync(PID_FILE)) return false;

  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"));
    process.kill(pid, 0);
    return true;
  } catch {
    fs.unlinkSync(PID_FILE);
    return false;
  }
}

if (isWatcherRunning()) {
  console.log("✅ Watcher is already running");
  process.exit(0);
}

console.log("🚀 Starting watcher in detached mode...");

// Create/truncate log file
fs.writeFileSync(LOG_FILE, `[${new Date().toISOString()}] Starting watcher...\n`);

const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

const watcher = spawn("node", ["deploy-functions.mjs"], {
  detached: true,
  stdio: ["ignore", logStream, logStream],
  cwd: process.cwd()
});

watcher.unref();

fs.writeFileSync(PID_FILE, watcher.pid.toString());

console.log(`✅ Watcher started with PID: ${watcher.pid}`);
console.log(`📝 Logs: ${LOG_FILE}`);
console.log("💡 To stop: npm run watcher:stop");

setTimeout(() => {
  process.exit(0);
}, 1000);
