#!/bin/bash

# ==============================================================================
# C-Bound Automated Deployment Script
# ==============================================================================
# This script automates the installation of dependencies, client-side JS 
# obfuscation, and PM2 process daemonization for secure production deployments.
# ==============================================================================

set -e

echo "🚀 Starting C-Bound Deployment Pipeline..."

# 1. Check for .env file
if [ ! -f .env ]; then
    echo "⚠️  WARNING: No .env file found!"
    echo "Creating one from .env.example..."
    cp .env.example .env
    echo "❌ PLEASE EDIT .env WITH YOUR SECRETS THEN RE-RUN THIS SCRIPT."
    exit 1
fi

# 2. Install core Node dependencies
echo "📦 Installing project dependencies..."
npm install

# 3. Ensure PM2 is installed globally
if ! command -v pm2 &> /dev/null; then
    echo "⚙️  PM2 not found. Installing PM2 globally..."
    sudo npm install -g pm2
else
    echo "✅ PM2 is already installed."
fi

# 4. Install PM2 Log Rotation (Silent if already installed)
echo "🔄 Ensuring PM2 logrotate module is installed..."
pm2 install pm2-logrotate &> /dev/null || true

# 5. Build and scramble the client payload verification logic
echo "🛡️  Obfuscating client-side Verification Reflex..."
npm run build

# 6. Stop any existing instance
echo "🛑 Stopping any existing C-Bound instances..."
pm2 stop c-bound &> /dev/null || true
pm2 delete c-bound &> /dev/null || true

# 7. Start the server daemonized
echo "▶️  Starting C-Bound server under PM2..."
pm2 start server.js --name "c-bound"

# 8. Save PM2 state for startup reboots
echo "💾 Saving PM2 state..."
pm2 save

echo "======================================================================"
echo "✅ DEPLOYMENT COMPLETE!"
echo "📡 C-Bound is now running in the background."
echo "📜 To view live verification logs, run: pm2 logs c-bound"
echo "======================================================================"
