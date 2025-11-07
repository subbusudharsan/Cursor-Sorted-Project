#!/bin/sh
echo "🔧 Setting up Sorted project (minimal mode)..."

echo "📁 Loading .env..."
export $(grep -v '^#' .env | xargs 2>/dev/null)

echo "🔐 Logging into Netlify..."
npx netlify login --auth "$NETLIFY_AUTH_TOKEN" >/dev/null 2>&1 || true

echo "🧹 Cleaning project..."
rm -rf node_modules package-lock.json dist

echo "📦 Installing dependencies..."
npm install
npx expo install --fix
npm install netlify-cli --save-dev

echo "🌐 Building web..."
npx expo export --platform web

echo "📁 Copying redirects (if any)..."
cp _redirects dist/_redirects 2>/dev/null || true

echo "🔗 Linking Netlify site..."
npx netlify link --id "$NETLIFY_SITE_ID" >/dev/null 2>&1 || true

echo "🚀 Deploying..."
npx netlify deploy --prod --dir=dist --auth "$NETLIFY_AUTH_TOKEN" --site "$NETLIFY_SITE_ID" --message "Auto deploy"

echo "✅ Setup and deployment complete!"
