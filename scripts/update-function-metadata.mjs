import "dotenv/config";
import fetch from "node-fetch";

const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.PROJECT_REF || process.env.SUPABASE_PROJECT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;

if (!SUPABASE_ACCESS_TOKEN) {
  console.error("❌ Error: SUPABASE_ACCESS_TOKEN is required in .env file");
  process.exit(1);
}

if (!PROJECT_REF) {
  console.error("❌ Error: PROJECT_REF or SUPABASE_PROJECT_ID is required in .env file");
  process.exit(1);
}

const FUNCTION_NAME = "delete-user-account";
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/${FUNCTION_NAME}`;

console.log("🔧 Updating function metadata...");
console.log(`📡 API URL: ${API_URL}`);
console.log(`📦 Function: ${FUNCTION_NAME}`);
console.log(`🔑 Project Ref: ${PROJECT_REF}`);

const payload = {
  verify_jwt: false
};

try {
  const response = await fetch(API_URL, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (response.ok) {
    const data = await response.json();
    console.log("✅ Successfully updated function metadata");
    console.log("📋 Response:", JSON.stringify(data, null, 2));
    console.log(`✅ verify_jwt is now set to: false`);
  } else {
    const errorText = await response.text();
    console.error(`❌ Failed to update function metadata: ${response.status} ${response.statusText}`);
    console.error(`📋 Error details: ${errorText}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`❌ Error updating function metadata: ${error.message}`);
  console.error(`📋 Stack trace: ${error.stack}`);
  process.exit(1);
}


