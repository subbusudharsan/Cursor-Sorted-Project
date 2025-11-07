#!/usr/bin/env node
/**
 * Ensure Watcher - Guarantees the Supabase Edge Functions watcher is always running
 * This script checks if the watcher is running and starts it if needed.
 * It's designed to be called from package.json scripts automatically.
 */

import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";

const PID_FILE = path.join(process.cwd(), "watcher.pid");
const LOG_FILE = path.join(process.cwd(), "logs", "watcher.log");

fs.mkdirSync("logs", { recursive: true });

function isWatcherRunning() {
  if (!fs.existsSync(PID_FILE)) {
    return false;
  }

  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"));
    // Check if process is actually running
    process.kill(pid, 0);
    return true;
  } catch {
    // Process doesn't exist, clean up stale PID file
    try {
      fs.unlinkSync(PID_FILE);
    } catch {}
    return false;
  }
}

function startWatcher() {
  console.log("🚀 Starting Supabase Edge Functions watcher...");

  //const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

 const watcher = spawn("node", ["deploy-functions.mjs"], {
  detached: true,
  stdio: "ignore", // ✅ Bolt.New-safe mode
});

  watcher.unref();

  fs.writeFileSync(PID_FILE, watcher.pid.toString());

  console.log(`✅ Watcher started with PID: ${watcher.pid}`);
  console.log(`📝 Logs: ${LOG_FILE}`);
  console.log("💡 Any changes to /supabase/functions will auto-deploy");
}

function main() {
  if (isWatcherRunning()) {
    console.log("✅ Watcher is already running");
    return;
  }

  console.log("⚠️  Watcher is not running");
  startWatcher();
}

main();
