import fs from "fs";
import path from "path";

const PID_FILE = path.join(process.cwd(), "watcher.pid");

if (!fs.existsSync(PID_FILE)) {
  console.log("⚠️  No watcher PID file found");
  process.exit(1);
}

try {
  const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"));
  process.kill(pid, "SIGTERM");
  fs.unlinkSync(PID_FILE);
  console.log(`✅ Watcher stopped (PID: ${pid})`);
} catch (error) {
  console.error(`❌ Failed to stop watcher: ${error.message}`);
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
  process.exit(1);
}
