/**
 * LOCAL TEST HARNESS FOR PREGENERATED TURNS
 * Run with:  npx tsx test-pregenerated-turns.ts
 */

console.log("🟦 Starting local Pregenerated Turns Test Harness...");

// ============================================================================
// MOCK DATA
// ============================================================================
const MOCK_CHAT_ID = "8cda406f-ae82-45ff-a9b4-e7f2361752e7";
const MOCK_USER_A_ID = "c8ddf704-b8f8-4c6d-a622-24be04c25c81";
const MOCK_USER_B_ID = "cbcae6a7-19bd-4132-ac22-94fac7aacb89";
const MOCK_CONTACT_NAME = "John Doe";

// Mock chat data
const mockChatData = {
  id: MOCK_CHAT_ID,
  user_id: MOCK_USER_A_ID,
  contact_id: MOCK_USER_B_ID,
  context_data: {
    summary_shared_neutral:
      "User A wants to discuss a misunderstanding from the office party",
    thoughts_a:
      "I was genuinely happy for User B's achievements and didn't mean to come across as jealous",
    thoughts_b: "",
    hint_from_b: "",
  },
};

// Mock messages history
const mockMessages = [
  {
    id: "msg-1",
    sender_id: MOCK_USER_A_ID,
    content: "Hi, I wanted to talk about what happened at the office party.",
    created_at: new Date().toISOString(),
  },
  {
    id: "msg-2",
    sender_id: MOCK_USER_B_ID,
    content: "Sure, I'm listening.",
    created_at: new Date().toISOString(),
  },
  {
    id: "msg-3",
    sender_id: MOCK_USER_A_ID,
    content: "I was genuinely happy for your achievements.",
    created_at: new Date().toISOString(),
  },
];

// Mock Anthropic AI response (3 turns)
const mockAnthropicResponse = {
  content: [
    {
      text: JSON.stringify({
        turns: [
          {
            role: "A",
            options: [
              "I wanted to talk to you about what happened at the office party...",
              "Can we discuss the misunderstanding from the party?",
              "I hope we can have an open conversation about that day.",
            ],
            finalClosureDetected: false,
          },
          {
            role: "B",
            options: [
              "I appreciate you bringing this up.",
              "I'm listening. Tell me more.",
              "I'm sorry if I misunderstood.",
            ],
            finalClosureDetected: false,
          },
          {
            role: "A",
            options: [
              "I was truly excited for your success.",
              "I genuinely wanted to celebrate you.",
              "😊",
            ],
            finalClosureDetected: true,
          },
        ],
      }),
    },
  ],
};

// ============================================================================
// MOCK SUPABASE CLIENT
// ============================================================================

class MockSupabaseClient {
  private pregeneratedTurns = [];
  private chats = [mockChatData];
  private messages = mockMessages;

  from(table: string) {
    return {
      select: (_cols: string) => ({
        eq: (col: string, val: any) => ({
          single: async () => {
            if (table === "chats") {
              const chat = this.chats.find((c) => c[col] === val);
              return { data: chat, error: null };
            }
            return { data: null, error: null };
          },
          order: (_c: string, _o: any) => ({
            limit: async (n: number) => {
              if (table === "messages") {
                return { data: this.messages.slice(0, n), error: null };
              }
              return { data: [], error: null };
            },
          }),
        }),
      }),
      insert: async (rows: any[]) => {
        if (table === "pregenerated_turns") {
          this.pregeneratedTurns.push(...rows);
          return { data: rows, error: null };
        }
        return { data: null, error: null };
      },
    };
  }

  getPregeneratedTurns() {
    return this.pregeneratedTurns;
  }
}

// ============================================================================
// FRONTEND LOGIC
// ============================================================================

async function fetchPregeneratedTurn(
  supabase: MockSupabaseClient,
  chatId: string,
  userId: string,
  messages: any[]
) {
  const userMessages = messages.filter((m) => m.sender_id === userId);
  const turnNumber = userMessages.length;

  const turn = supabase
    .getPregeneratedTurns()
    .find(
      (t) =>
        t.chat_id === chatId &&
        t.recipient_id === userId &&
        t.turn_number === turnNumber
    );

  return turn || null;
}

// ============================================================================
// EDGE FUNCTION LOGIC (SIMPLIFIED)
// ============================================================================

async function generatePregeneratedTurns(supabase: MockSupabaseClient, chatId: string) {
  const rows = [];

  for (let i = 0; i < 3; i++) {
    const turn = mockAnthropicResponse.content[0].text;
    const parsed = JSON.parse(turn).turns[i];

    rows.push({
      chat_id: chatId,
      turn_number: i,
      recipient_id: parsed.role === "A" ? MOCK_USER_A_ID : MOCK_USER_B_ID,
      role: parsed.role === "A" ? "User A" : "User B",
      options: parsed.options,
      used_at: null,
    });
  }

  await supabase.from("pregenerated_turns").insert(rows);
  return { success: true, stored: 3 };
}

// ============================================================================
// TEST RUNNER
// ============================================================================

async function runTests() {
  console.log("🔧 Running tests...\n");

  const supabase = new MockSupabaseClient();

  // Generate turns
  await generatePregeneratedTurns(supabase, MOCK_CHAT_ID);

  // Show results
  console.log("📦 Stored Turns:", supabase.getPregeneratedTurns());

  // Fetch for A
  const aTurn = await fetchPregeneratedTurn(
    supabase,
    MOCK_CHAT_ID,
    MOCK_USER_A_ID,
    mockMessages
  );
  console.log("\n👤 User A receives:", aTurn);

  // Fetch for B
  const bTurn = await fetchPregeneratedTurn(
    supabase,
    MOCK_CHAT_ID,
    MOCK_USER_B_ID,
    mockMessages
  );
  console.log("\n👤 User B receives:", bTurn);

  console.log("\n🎉 Test complete!\n");
}

// Run test
runTests();
