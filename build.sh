#!/bin/bash
set -e

APP_NAME="Kubectl UI"
BUNDLE_ID="com.kubectl-ui.app"

echo "🔨 Building ${APP_NAME}..."
echo ""

# 1. Install frontend dependencies
echo "📦 Installing npm dependencies..."
npm install

# 2. Build Tauri app (includes frontend build)
echo "🦀 Building Tauri app (release mode)..."
npm run tauri build

# 3. Find the .app bundle
APP_PATH="src-tauri/target/release/bundle/macos/${APP_NAME}.app"

if [ ! -d "$APP_PATH" ]; then
  echo "❌ Build failed — .app not found at: $APP_PATH"
  exit 1
fi

echo ""
echo "✅ Build successful!"
echo "📁 App: $APP_PATH"

# 4. Copy to /Applications
echo ""
echo "🚀 Installing to /Applications..."

# Remove old version if exists
if [ -d "/Applications/${APP_NAME}.app" ]; then
  echo "   Removing old version..."
  rm -rf "/Applications/${APP_NAME}.app"
fi

cp -R "$APP_PATH" "/Applications/${APP_NAME}.app"

echo "✅ Installed: /Applications/${APP_NAME}.app"
echo ""
echo "🎉 Done! You can now open '${APP_NAME}' from Applications or Spotlight."
