#!/usr/bin/env node
/**
 * Watcher System Initializer
 * Run this once to set up the auto-deployment system
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

console.log("🎬 Initializing Supabase Edge Functions Auto-Deploy System...\n");

// 1. Create required directories
const dirs = ["logs", "safe_backups"];
dirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✅ Created directory: ${dir}`);
  } else {
    console.log(`✓  Directory exists: ${dir}`);
  }
});

// 2. Verify .env file
console.log("\n📋 Checking .env file...");
if (!fs.existsSync(".env")) {
  console.error("❌ .env file not found!");
  console.error("   Please create a .env file with the required variables.");
  process.exit(1);
}

const envContent = fs.readFileSync(".env", "utf8");
const requiredVars = [
  "SUPABASE_PROJECT_ID",
  "SUPABASE_ACCESS_TOKEN",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CLAUDE_API_KEY",
];

let allPresent = true;
requiredVars.forEach((varName) => {
  if (envContent.includes(`${varName}=`)) {
    console.log(`   ✅ ${varName}`);
  } else {
    console.error(`   ❌ ${varName} is missing`);
    allPresent = false;
  }
});

if (!allPresent) {
  console.error("\n❌ Missing required environment variables");
  process.exit(1);
}

// 3. Verify supabase/functions directory
console.log("\n📂 Checking functions directory...");
if (!fs.existsSync("supabase/functions")) {
  console.error("❌ supabase/functions directory not found!");
  process.exit(1);
}

const functions = fs
  .readdirSync("supabase/functions")
  .filter((f) => {
    const stat = fs.statSync(path.join("supabase/functions", f));
    return stat.isDirectory();
  });

console.log(`   ✅ Found ${functions.length} function(s):`);
functions.forEach((fn) => {
  const indexPath = path.join("supabase/functions", fn, "index.ts");
  if (fs.existsSync(indexPath)) {
    console.log(`      - ${fn}`);
  }
});

// 4. Test Supabase API connectivity
console.log("\n🔌 Testing Supabase API connectivity...");
try {
  execSync("node check-secrets.mjs", { stdio: "inherit" });
} catch (error) {
  console.warn("⚠️  API test had issues, but continuing...");
}

// 5. Sync secrets
console.log("\n🔐 Syncing secrets to Supabase...");
try {
  execSync("node sync-secrets.mjs", { stdio: "inherit" });
} catch (error) {
  console.error("❌ Failed to sync secrets");
  process.exit(1);
}

// 6. Clean up old watcher
console.log("\n🧹 Cleaning up old watcher instances...");
if (fs.existsSync("watcher.pid")) {
  try {
    const oldPid = fs.readFileSync("watcher.pid", "utf8");
    process.kill(parseInt(oldPid), 0);
    console.log(`   ⚠️  Found running watcher (PID: ${oldPid}), stopping it...`);
    execSync("node stop-watcher.mjs");
  } catch {
    console.log("   ✓  No active watcher found");
  }
  fs.unlinkSync("watcher.pid");
}

// 7. Start fresh watcher
console.log("\n🚀 Starting watcher...");
try {
  execSync("node ensure-watcher.mjs", { stdio: "inherit" });
} catch (error) {
  console.error("❌ Failed to start watcher");
  process.exit(1);
}

console.log("\n" + "=".repeat(60));
console.log("✅ Auto-Deploy System Initialized Successfully!");
console.log("=".repeat(60));
console.log("\n📝 Next steps:");
console.log("   1. Run: npm run dev");
console.log("   2. Edit any file in supabase/functions/");
console.log("   3. Save (Ctrl+S) - deployment happens automatically!");
console.log("\n💡 Useful commands:");
console.log("   - npm run watcher:status   (check if running)");
console.log("   - npm run watcher:logs     (view deployment logs)");
console.log("   - npm run watcher:restart  (restart if needed)");
console.log("\n📖 Read README-WATCHER.md for full documentation");
