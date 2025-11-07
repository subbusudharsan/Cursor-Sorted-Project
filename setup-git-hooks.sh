#!/usr/bin/env sh
set -e

echo "🔧 Installing Git hooks (Bolt-safe mode)…"

HOOKS_DIR=".githooks"
mkdir -p "$HOOKS_DIR"

# post-checkout
echo '#!/usr/bin/env sh' > "$HOOKS_DIR/post-checkout"
echo 'echo "📦 post-checkout: syncing secrets"' >> "$HOOKS_DIR/post-checkout"
echo '[ -f sync-secrets.mjs ] && node sync-secrets.mjs || true' >> "$HOOKS_DIR/post-checkout"
echo 'exit 0' >> "$HOOKS_DIR/post-checkout"

# post-merge
echo '#!/usr/bin/env sh' > "$HOOKS_DIR/post-merge"
echo 'echo "📦 post-merge: syncing secrets"' >> "$HOOKS_DIR/post-merge"
echo '[ -f sync-secrets.mjs ] && node sync-secrets.mjs || true' >> "$HOOKS_DIR/post-merge"
echo 'exit 0' >> "$HOOKS_DIR/post-merge"

# pre-push
echo '#!/usr/bin/env sh' > "$HOOKS_DIR/pre-push"
echo 'if [ -z "$SUPABASE_PROJECT_ID" ] || [ -z "$SUPABASE_ACCESS_TOKEN" ]; then' >> "$HOOKS_DIR/pre-push"
echo '  echo "❌ Missing SUPABASE_PROJECT_ID or SUPABASE_ACCESS_TOKEN in env when pushing."' >> "$HOOKS_DIR/pre-push"
echo '  echo "   Add them to .env and your CI secrets."' >> "$HOOKS_DIR/pre-push"
echo '  exit 0' >> "$HOOKS_DIR/pre-push"
echo 'fi' >> "$HOOKS_DIR/pre-push"
echo 'exit 0' >> "$HOOKS_DIR/pre-push"

chmod +x "$HOOKS_DIR/"*

git config core.hooksPath .githooks

echo "✅ Git hooks installed."
echo "   - post-checkout (sync secrets)"
echo "   - post-merge    (sync secrets)"
echo "   - pre-push      (env sanity check)"
