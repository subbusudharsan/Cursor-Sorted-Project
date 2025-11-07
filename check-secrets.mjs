import "dotenv/config";
import fetch from "node-fetch";

console.log("🔍 Checking Supabase Edge Function Secrets Health...\n");

const SUPABASE_PROJECT_ID = process.env.SUPABASE_PROJECT_ID;
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const API_BASE = "https://api.supabase.io/v1/projects";

const REQUIRED_SECRETS = [
  "CLAUDE_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const FUNCTIONS_SECRETS_MAP = {
  "invoke-claude": ["CLAUDE_API_KEY"],
  "orchestrate-conversation": ["CLAUDE_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  "generate-contextual-options": ["CLAUDE_API_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY"],
  "analyze-conversation-state": ["CLAUDE_API_KEY"],
  "validate-option-relevance": ["CLAUDE_API_KEY"],
  "evaluate-closure-readiness": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  "validate-context-quality": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
};

async function checkLocalEnv() {
  console.log("📋 Checking Local .env File:");
  console.log("─".repeat(60));

  const localSecrets = {
    CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
    SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  let allPresent = true;
  for (const [key, value] of Object.entries(localSecrets)) {
    if (value) {
      const maskedValue = value.substring(0, 8) + "..." + value.substring(value.length - 4);
      console.log(`   ✅ ${key.padEnd(30)} ${maskedValue}`);
    } else {
      console.log(`   ❌ ${key.padEnd(30)} NOT SET`);
      allPresent = false;
    }
  }

  console.log("");
  return allPresent;
}

async function checkSupabaseSecrets() {
  if (!SUPABASE_PROJECT_ID || !SUPABASE_ACCESS_TOKEN) {
    console.log("⚠️  Cannot check Supabase secrets: Missing SUPABASE_PROJECT_ID or SUPABASE_ACCESS_TOKEN");
    return null;
  }

  console.log("☁️  Checking Supabase Cloud Secrets:");
  console.log("─".repeat(60));

  try {
    const response = await fetch(
      `${API_BASE}/${SUPABASE_PROJECT_ID}/secrets`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.log(`   ❌ Failed to fetch secrets: ${response.status}`);
      return null;
    }

    const secrets = await response.json();
    const secretNames = secrets.map(s => s.name);

    let allPresent = true;
    for (const requiredSecret of REQUIRED_SECRETS) {
      if (secretNames.includes(requiredSecret)) {
        console.log(`   ✅ ${requiredSecret.padEnd(30)} Present`);
      } else {
        console.log(`   ❌ ${requiredSecret.padEnd(30)} MISSING`);
        allPresent = false;
      }
    }

    console.log("");
    return allPresent;
  } catch (error) {
    console.log(`   ❌ Error checking secrets: ${error.message}`);
    return null;
  }
}

async function checkFunctionRequirements() {
  console.log("🔧 Checking Edge Function Requirements:");
  console.log("─".repeat(60));

  if (!SUPABASE_PROJECT_ID || !SUPABASE_ACCESS_TOKEN) {
    console.log("⚠️  Skipping function checks: Missing Supabase credentials");
    return;
  }

  try {
    const response = await fetch(
      `${API_BASE}/${SUPABASE_PROJECT_ID}/secrets`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.log("⚠️  Could not verify function requirements");
      return;
    }

    const secrets = await response.json();
    const secretNames = secrets.map(s => s.name);

    for (const [funcName, requiredSecrets] of Object.entries(FUNCTIONS_SECRETS_MAP)) {
      const missing = requiredSecrets.filter(s => !secretNames.includes(s));

      if (missing.length === 0) {
        console.log(`   ✅ ${funcName.padEnd(30)} All secrets present`);
      } else {
        console.log(`   ⚠️  ${funcName.padEnd(30)} Missing: ${missing.join(", ")}`);
      }
    }

    console.log("");
  } catch (error) {
    console.log(`   ❌ Error checking function requirements: ${error.message}`);
  }
}

async function generateReport() {
  console.log("\n" + "=".repeat(60));
  console.log("📊 HEALTH CHECK SUMMARY");
  console.log("=".repeat(60) + "\n");

  const localOk = await checkLocalEnv();
  const cloudOk = await checkSupabaseSecrets();
  await checkFunctionRequirements();

  console.log("=".repeat(60));
  console.log("📋 Final Status:");
  console.log("─".repeat(60));

  if (localOk) {
    console.log("   ✅ Local .env file: All required secrets present");
  } else {
    console.log("   ❌ Local .env file: Missing required secrets");
  }

  if (cloudOk === null) {
    console.log("   ⚠️  Supabase Cloud: Could not verify");
  } else if (cloudOk) {
    console.log("   ✅ Supabase Cloud: All required secrets present");
  } else {
    console.log("   ❌ Supabase Cloud: Missing required secrets");
  }

  console.log("=".repeat(60));

  if (!localOk) {
    console.log("\n💡 Next Steps:");
    console.log("   1. Add missing secrets to your .env file");
    console.log("   2. Run: npm run sync:secrets");
    return false;
  }

  if (cloudOk === false) {
    console.log("\n💡 Next Steps:");
    console.log("   Run: npm run sync:secrets");
    return false;
  }

  if (localOk && cloudOk) {
    console.log("\n✅ All secrets are properly configured!");
    return true;
  }

  return cloudOk !== false;
}

generateReport().then((success) => {
  process.exit(success ? 0 : 1);
});
