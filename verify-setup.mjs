import fs from "fs";
import path from "path";

console.log("🔍 Verifying Auto-Deploy System Setup...\n");

const checks = {
  passed: 0,
  failed: 0,
  warnings: 0
};

function pass(msg) {
  console.log(`✅ ${msg}`);
  checks.passed++;
}

function fail(msg) {
  console.log(`❌ ${msg}`);
  checks.failed++;
}

function warn(msg) {
  console.log(`⚠️  ${msg}`);
  checks.warnings++;
}

console.log("📦 Checking Required Files:");
console.log("─".repeat(60));

const requiredFiles = [
  'deploy-functions.mjs',
  'start-watcher.mjs',
  'stop-watcher.mjs',
  'sync-secrets.mjs',
  'check-secrets.mjs',
  'setup-git-hooks.sh',
  '.env.example'
];

requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    pass(`${file}`);
  } else {
    fail(`${file} not found`);
  }
});

console.log("\n📁 Checking Directories:");
console.log("─".repeat(60));

const requiredDirs = [
  'supabase/functions',
  '.githooks',
  'safe_backups'
];

requiredDirs.forEach(dir => {
  if (fs.existsSync(dir)) {
    pass(`${dir}/`);
  } else {
    fail(`${dir}/ not found`);
  }
});

if (!fs.existsSync('logs')) {
  warn("logs/ will be created on first run");
}

console.log("\n🪝 Checking Git Hooks:");
console.log("─".repeat(60));

const hooks = ['post-checkout', 'post-merge', 'pre-push'];

hooks.forEach(hook => {
  const hookPath = path.join('.githooks', hook);
  if (fs.existsSync(hookPath)) {
    const stats = fs.statSync(hookPath);
    if (stats.mode & fs.constants.S_IXUSR) {
      pass(`${hook} (executable)`);
    } else {
      warn(`${hook} exists but not executable`);
    }
  } else {
    fail(`${hook} not found`);
  }
});

console.log("\n📝 Checking package.json Scripts:");
console.log("─".repeat(60));

try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const requiredScripts = [
    'start:watcher',
    'stop:watcher',
    'sync:secrets',
    'check:secrets',
    'deploy:functions'
  ];

  requiredScripts.forEach(script => {
    if (pkg.scripts[script]) {
      pass(`npm run ${script}`);
    } else {
      fail(`npm run ${script} not configured`);
    }
  });

  if (pkg.scripts.dev && pkg.scripts.dev.includes('start-watcher')) {
    pass("'npm run dev' includes watcher auto-start");
  } else {
    warn("'npm run dev' doesn't auto-start watcher");
  }

} catch (error) {
  fail(`Error reading package.json: ${error.message}`);
}

console.log("\n🔐 Checking Environment:");
console.log("─".repeat(60));

const envVars = [
  'SUPABASE_PROJECT_ID',
  'SUPABASE_ACCESS_TOKEN',
  'CLAUDE_API_KEY',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
];

envVars.forEach(envVar => {
  if (process.env[envVar]) {
    pass(`${envVar} is set`);
  } else {
    warn(`${envVar} not set in environment`);
  }
});

console.log("\n🎯 Checking Function Files:");
console.log("─".repeat(60));

const functionsDir = 'supabase/functions';
if (fs.existsSync(functionsDir)) {
  const functions = fs.readdirSync(functionsDir).filter(f => 
    fs.lstatSync(path.join(functionsDir, f)).isDirectory()
  );
  
  if (functions.length > 0) {
    pass(`Found ${functions.length} function(s)`);
    
    functions.forEach(fn => {
      const indexPath = path.join(functionsDir, fn, 'index.ts');
      if (fs.existsSync(indexPath)) {
        pass(`  ${fn}/index.ts`);
      } else {
        warn(`  ${fn}/ missing index.ts`);
      }
    });
  } else {
    warn("No functions found in supabase/functions/");
  }
} else {
  fail("supabase/functions/ directory not found");
}

console.log("\n" + "=".repeat(60));
console.log("📊 Summary:");
console.log("─".repeat(60));
console.log(`  ✅ Passed:   ${checks.passed}`);
console.log(`  ⚠️  Warnings: ${checks.warnings}`);
console.log(`  ❌ Failed:   ${checks.failed}`);
console.log("=".repeat(60));

if (checks.failed === 0 && checks.warnings === 0) {
  console.log("\n🎉 Perfect! System is ready for auto-deployment!");
  console.log("\n💡 Next steps:");
  console.log("   1. Run: npm run sync:secrets");
  console.log("   2. Run: npm run dev");
  console.log("   3. Edit any function file and watch it deploy!");
  process.exit(0);
} else if (checks.failed === 0) {
  console.log("\n✅ System is functional but has warnings");
  console.log("   Review warnings above and fix if needed");
  process.exit(0);
} else {
  console.log("\n❌ System has errors that need to be fixed");
  console.log("   Review failed checks above");
  process.exit(1);
}
