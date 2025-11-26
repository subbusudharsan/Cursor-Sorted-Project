import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import chokidar from "chokidar";
import fetch from "node-fetch";
import FormData from "form-data";
import archiver from "archiver";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const timestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);
const log = (msg) => console.log(`[${timestamp()}] ${msg}`);

log("⚙️  Supabase Edge Functions Auto-Deploy System v2.0 Starting...");

const SUPABASE_PROJECT_ID = process.env.SUPABASE_PROJECT_ID;
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const FUNCTIONS_DIR = "./supabase/functions";
const BACKUP_DIR = "./safe_backups";
const LOGS_DIR = "./logs";
const API_BASE = "https://api.supabase.com/v1/projects";

const DEBOUNCE_MS = 2000;
const deployQueue = new Map();
const fileHashes = new Map();
const activeDeployments = new Set();
let watcherStartTime = Date.now();
let totalDeployments = 0;
let successfulDeployments = 0;
let failedDeployments = 0;

if (!SUPABASE_PROJECT_ID || !SUPABASE_ACCESS_TOKEN) {
  log("❌ Missing SUPABASE_PROJECT_ID or SUPABASE_ACCESS_TOKEN in .env");
  log("   Run: npm run init:watcher to set up the system");
  process.exit(1);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });

async function syncSecretsAsync() {
  log("🔐 Synchronizing secrets (non-blocking)...");
  try {
    await execAsync("node sync-secrets.mjs", { timeout: 30000 });
    log("✅ Secrets synchronized successfully");
    return true;
  } catch (error) {
    log(`⚠️  Failed to sync secrets: ${error.message}`);
    log("⚠️  Continuing with deployment, but functions may fail at runtime");
    return false;
  }
}

function calculateFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (error) {
    log(`⚠️  Error calculating hash for ${filePath}: ${error.message}`);
    return null;
  }
}

function hasFileChanged(fnName) {
  const indexPath = path.join(FUNCTIONS_DIR, fnName, 'index.ts');
  if (!fs.existsSync(indexPath)) {
    log(`⚠️  File not found: ${indexPath}`);
    return false;
  }

  const currentHash = calculateFileHash(indexPath);
  if (!currentHash) return false;

  const previousHash = fileHashes.get(fnName);

  if (currentHash !== previousHash) {
    fileHashes.set(fnName, currentHash);
    log(`🔄 File content changed for ${fnName} (hash: ${currentHash.substring(0, 8)}...)`);
    return true;
  }

  log(`⏭️  No content change detected for ${fnName} (hash: ${currentHash.substring(0, 8)}...)`);
  return false;
}

async function zipFunction(fnName) {
  return new Promise((resolve, reject) => {
    const fnDir = path.join(FUNCTIONS_DIR, fnName);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipPath = path.join(BACKUP_DIR, `${fnName}`, `index_${timestamp}.ts`);

    try {
      fs.mkdirSync(path.dirname(zipPath), { recursive: true });

      const indexPath = path.join(fnDir, 'index.ts');
      if (fs.existsSync(indexPath)) {
        fs.copyFileSync(indexPath, zipPath);
        log(`💾 Backup created: ${zipPath}`);
      }

      const finalZipPath = path.join(BACKUP_DIR, `${fnName}.zip`);
      const output = fs.createWriteStream(finalZipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", () => {
        log(`📦 Zip created: ${finalZipPath} (${archive.pointer()} bytes)`);
        resolve(finalZipPath);
      });
      archive.on("error", (err) => {
        log(`❌ Archive error: ${err.message}`);
        reject(err);
      });

      archive.pipe(output);
      archive.directory(fnDir, false);
      archive.finalize();
    } catch (error) {
      log(`❌ Backup error for ${fnName}: ${error.message}`);
      reject(error);
    }
  });
}

async function deployFunction(fnName) {
  if (activeDeployments.has(fnName)) {
    log(`⏭️  Skipping ${fnName} - deployment already in progress`);
    return;
  }

  activeDeployments.add(fnName);
  totalDeployments++;

  try {
    log(`🚀 Deploying ${fnName} (attempt #${totalDeployments})...`);
    const startTime = Date.now();

    // Create backup
    await zipFunction(fnName);

    const fnDir = path.join(FUNCTIONS_DIR, fnName);
    const indexPath = path.join(fnDir, 'index.ts');

    if (!fs.existsSync(indexPath)) {
      throw new Error(`index.ts not found for function ${fnName}`);
    }

    const sourceCode = fs.readFileSync(indexPath, 'utf8');
    const sizeKB = (sourceCode.length / 1024).toFixed(2);

    log(`📦 Preparing ${fnName}: ${sourceCode.length} bytes (${sizeKB} KB)`);

    const form = new FormData();
    form.append('metadata', JSON.stringify({
      entrypoint_path: 'index.ts',
      name: fnName,
      verify_jwt: false  // always disable JWT requirement
    }));
    form.append('file', sourceCode, {
      filename: 'index.ts',
      contentType: 'application/typescript'
    });

    const res = await fetch(`${API_BASE}/${SUPABASE_PROJECT_ID}/functions/deploy?slug=${fnName}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        ...form.getHeaders()
      },
      body: form
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (res.ok) {
      successfulDeployments++;
      log(`✅ ${fnName} deployed successfully in ${duration}s`);
      log(`📊 Stats: ${successfulDeployments}/${totalDeployments} successful`);

      const logEntry = `[${timestamp()}] ✅ ${fnName} - Success (${duration}s, ${sizeKB}KB)\n`;
      fs.appendFileSync(path.join(LOGS_DIR, 'deployments.log'), logEntry);
    } else {
      failedDeployments++;
      const errorText = await res.text();
      log(`❌ Failed to deploy ${fnName}: ${res.status} - ${errorText}`);
      log(`📊 Stats: ${successfulDeployments}/${totalDeployments} successful, ${failedDeployments} failed`);

      const logEntry = `[${timestamp()}] ❌ ${fnName} - Failed: ${res.status} - ${errorText}\n`;
      fs.appendFileSync(path.join(LOGS_DIR, 'deployments.log'), logEntry);
    }
  } catch (err) {
    failedDeployments++;
    log(`⚠️  Error deploying ${fnName}: ${err.message}`);
    log(`📊 Stats: ${successfulDeployments}/${totalDeployments} successful, ${failedDeployments} failed`);

    const logEntry = `[${timestamp()}] ⚠️  ${fnName} - Error: ${err.message}\n`;
    fs.appendFileSync(path.join(LOGS_DIR, 'deployments.log'), logEntry);
  } finally {
    activeDeployments.delete(fnName);
  }
}

function scheduleDeployment(fnName) {
  if (!hasFileChanged(fnName)) {
    return;
  }

  if (deployQueue.has(fnName)) {
    clearTimeout(deployQueue.get(fnName));
    log(`🔄 Rescheduling ${fnName} deployment (debouncing)`);
  }

  log(`📝 Change detected in ${fnName} - scheduling deployment in ${DEBOUNCE_MS}ms`);

  const timeoutId = setTimeout(async () => {
    deployQueue.delete(fnName);
    await deployFunction(fnName);
  }, DEBOUNCE_MS);

  deployQueue.set(fnName, timeoutId);
}

async function deployAll() {
  log("🌍 Initial deployment of all functions...");

  if (!fs.existsSync(FUNCTIONS_DIR)) {
    log(`❌ Functions directory not found: ${FUNCTIONS_DIR}`);
    return;
  }

  const dirs = fs.readdirSync(FUNCTIONS_DIR).filter((f) =>
    fs.lstatSync(path.join(FUNCTIONS_DIR, f)).isDirectory()
  );

  log(`📦 Found ${dirs.length} function(s) to deploy`);

  for (const fn of dirs) {
    const indexPath = path.join(FUNCTIONS_DIR, fn, 'index.ts');
    if (fs.existsSync(indexPath)) {
      const hash = calculateFileHash(indexPath);
      fileHashes.set(fn, hash);
      await deployFunction(fn);
    } else {
      log(`⏭️  Skipping ${fn} - no index.ts found`);
    }
  }

  log("🎉 Initial deployment complete!");
  log(`📊 Final stats: ${successfulDeployments}/${totalDeployments} successful`);
}

function watchAndDeploy() {
  log("👀 Starting file watcher for Supabase functions...");
  log(`📂 Watching: ${path.resolve(FUNCTIONS_DIR)}`);

  let watcherActive = false;
  let lastEventTime = Date.now();
  let eventCount = 0;

  const watcher = chokidar.watch(FUNCTIONS_DIR, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });

  watcher.on("change", (filePath) => {
    const fnName = path.basename(path.dirname(filePath));
    const fileName = path.basename(filePath);

    if (fileName === 'index.ts') {
      lastEventTime = Date.now();
      eventCount++;
      log(`📝 File change detected (#${eventCount}): ${fnName}/index.ts`);
      scheduleDeployment(fnName);
    }
  });

  watcher.on("add", (filePath) => {
    const fnName = path.basename(path.dirname(filePath));
    const fileName = path.basename(filePath);

    if (fileName === 'index.ts') {
      lastEventTime = Date.now();
      eventCount++;
      log(`➕ New file added (#${eventCount}): ${fnName}/index.ts`);
      scheduleDeployment(fnName);
    }
  });

  watcher.on("error", (error) => {
    log(`❌ Watcher error: ${error.message}`);
    watcherActive = false;
  });

  watcher.on("ready", () => {
    watcherActive = true;
    log("✅ Watcher is ready and monitoring for changes");
    log("💡 Edit any function file to trigger auto-deployment");
    log("💡 Press Ctrl+C to stop the watcher gracefully");

    // Health check every 60 seconds
    setInterval(() => {
      const uptimeSeconds = Math.floor((Date.now() - watcherStartTime) / 1000);
      const uptimeMinutes = Math.floor(uptimeSeconds / 60);
      const secondsSinceLastEvent = Math.floor((Date.now() - lastEventTime) / 1000);
      
      log(`💓 Health: ${watcherActive ? '✅ ACTIVE' : '❌ INACTIVE'} | Uptime: ${uptimeMinutes}m | Events: ${eventCount} | Last event: ${secondsSinceLastEvent}s ago | Deployments: ${successfulDeployments}/${totalDeployments}`);
    }, 60000);
  });

  const cleanup = () => {
    log("\n🛑 Shutting down watcher gracefully...");
    watcherActive = false;
    watcher.close();
    deployQueue.forEach((timeoutId) => clearTimeout(timeoutId));
    
    const uptimeSeconds = Math.floor((Date.now() - watcherStartTime) / 1000);
    const uptimeMinutes = Math.floor(uptimeSeconds / 60);
    log(`📊 Session summary:`);
    log(`   Uptime: ${uptimeMinutes} minutes`);
    log(`   Total deployments: ${totalDeployments}`);
    log(`   Successful: ${successfulDeployments}`);
    log(`   Failed: ${failedDeployments}`);
    log(`   Events detected: ${eventCount}`);
    log("👋 Watcher stopped");
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);

  return watcher;
}

async function main() {
  log("=".repeat(70));
  log("🚀 Supabase Edge Functions Auto-Deploy System v2.0");
  log("=".repeat(70));
  log("");
  log("Configuration:");
  log(`  Project ID: ${SUPABASE_PROJECT_ID.substring(0, 8)}...`);
  log(`  Functions Dir: ${path.resolve(FUNCTIONS_DIR)}`);
  log(`  Backup Dir: ${path.resolve(BACKUP_DIR)}`);
  log(`  Debounce: ${DEBOUNCE_MS}ms`);
  log("");

  await syncSecretsAsync();
  log("");

  await deployAll();
  log("");

  watchAndDeploy();
}

main().catch((error) => {
  log(`❌ Fatal error: ${error.message}`);
  log(error.stack);
  process.exit(1);
});
