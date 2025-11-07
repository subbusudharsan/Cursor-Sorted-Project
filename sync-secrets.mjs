import "dotenv/config";
import fetch from "node-fetch";

console.log("🔐 Syncing Supabase Edge Function Secrets...");

const SUPABASE_PROJECT_ID = process.env.SUPABASE_PROJECT_ID;
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const API_BASE = "https://api.supabase.io/v1/projects";

const REQUIRED_SECRETS = {
  CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
  PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};


if (!SUPABASE_PROJECT_ID || !SUPABASE_ACCESS_TOKEN) {
  console.error("❌ Missing SUPABASE_PROJECT_ID or SUPABASE_ACCESS_TOKEN in .env");
  console.error("   Please ensure these variables are set before syncing secrets.");
  process.exit(1);
}

async function validateSecrets() {
  console.log("\n📋 Validating required secrets in .env file...");
  const missing = [];

  for (const [key, value] of Object.entries(REQUIRED_SECRETS)) {
    if (!value) {
      missing.push(key);
      console.error(`   ❌ ${key} is missing or empty`);
    } else {
      console.log(`   ✅ ${key} is set`);
    }
  }

  if (missing.length > 0) {
    console.error(`\n❌ Missing ${missing.length} required secret(s). Please add them to your .env file.`);
    console.error("   Missing secrets:", missing.join(", "));
    return false;
  }

  console.log("\n✅ All required secrets are present in .env file");
  return true;
}

async function getExistingSecrets() {
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
      const errorText = await response.text();
      console.warn(`⚠️  Could not fetch existing secrets: ${response.status}`);
      console.warn(`   Response: ${errorText}`);
      return [];
    }

    const secrets = await response.json();
    return secrets.map(s => s.name);
  } catch (error) {
    console.warn(`⚠️  Error fetching existing secrets: ${error.message}`);
    return [];
  }
}

async function syncSecrets() {
  console.log("\n🔄 Syncing secrets to Supabase...");

  const existingSecrets = await getExistingSecrets();
  console.log(`\n📦 Found ${existingSecrets.length} existing secrets in Supabase`);

  const secretsToSync = Object.entries(REQUIRED_SECRETS)
    .filter(([_, value]) => value)
    .map(([name, value]) => ({ name, value }));

  let successCount = 0;
  let errorCount = 0;

  for (const { name, value } of secretsToSync) {
    try {
      const isUpdate = existingSecrets.includes(name);

      const response = await fetch(
        `${API_BASE}/${SUPABASE_PROJECT_ID}/secrets`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([
            {
              name,
              value,
            },
          ]),
        }
      );

      if (response.ok) {
        console.log(`   ✅ ${name} ${isUpdate ? 'updated' : 'created'} successfully`);
        successCount++;
      } else {
        const errorText = await response.text();
        console.error(`   ❌ Failed to sync ${name}: ${response.status}`);
        console.error(`      Response: ${errorText}`);
        errorCount++;
      }
    } catch (error) {
      console.error(`   ❌ Error syncing ${name}: ${error.message}`);
      errorCount++;
    }
  }

  console.log(`\n📊 Sync Summary:`);
  console.log(`   ✅ Successfully synced: ${successCount}`);
  if (errorCount > 0) {
    console.log(`   ❌ Failed: ${errorCount}`);
  }

  return errorCount === 0;
}

async function verifySecrets() {
  console.log("\n🔍 Verifying secrets are accessible in Supabase...");

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
      console.error("   ❌ Could not verify secrets");
      return false;
    }

    const secrets = await response.json();
    const secretNames = secrets.map(s => s.name);

    let allPresent = true;
    for (const requiredSecret of Object.keys(REQUIRED_SECRETS)) {
      if (secretNames.includes(requiredSecret)) {
        console.log(`   ✅ ${requiredSecret} is accessible`);
      } else {
        console.error(`   ❌ ${requiredSecret} is NOT accessible`);
        allPresent = false;
      }
    }

    return allPresent;
  } catch (error) {
    console.error(`   ❌ Error verifying secrets: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log("=" .repeat(60));
  console.log("🔐 Supabase Edge Function Secrets Synchronization");
  console.log("=" .repeat(60));

  const isValid = await validateSecrets();
  if (!isValid) {
    process.exit(1);
  }

  const syncSuccess = await syncSecrets();
  if (!syncSuccess) {
    console.error("\n❌ Secret synchronization completed with errors");
    process.exit(1);
  }

  const verifySuccess = await verifySecrets();
  if (!verifySuccess) {
    console.error("\n❌ Secret verification failed");
    process.exit(1);
  }

  console.log("\n✅ All secrets synchronized and verified successfully!");
  console.log("=" .repeat(60));
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
