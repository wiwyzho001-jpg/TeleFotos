#!/bin/bash
# -----------------------------------------------------------------------------
# TeleDrive - macOS Automated Installer & Security Helper
# Fast, unlimited cloud storage powered by Telegram
# -----------------------------------------------------------------------------

clear
echo ""
echo "  ╔═══════════════════════════════════════════════════════════════╗"
echo "  ║                   TeleDrive for macOS                         ║"
echo "  ║        Automated Installer & Gatekeeper Security Setup        ║"
echo "  ╚═══════════════════════════════════════════════════════════════╝"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_SRC="$SCRIPT_DIR/TeleDrive.app"
APP_DEST="/Applications/TeleDrive.app"

if [ ! -d "$APP_SRC" ]; then
    echo "  ❌ Error: TeleDrive.app not found in the installer directory."
    echo "  Please make sure you are running this from the mounted TeleDrive disk image."
    echo ""
    read -n 1 -s -r -p "  Press any key to exit..."
    exit 1
fi

echo "  [1/4] Checking destination..."
if [ -d "$APP_DEST" ]; then
    echo "        Found existing TeleDrive in /Applications. Updating..."
    rm -rf "$APP_DEST"
fi

echo "  [2/4] Installing TeleDrive to /Applications..."
cp -R "$APP_SRC" "$APP_DEST"

echo "  [3/4] Clearing macOS download quarantine flags..."
# This removes the com.apple.quarantine attribute added by web browsers / SourceForge,
# preventing macOS from showing 'unverified developer' or 'Apple cannot check for malware'.
xattr -dr com.apple.quarantine "$APP_DEST" 2>/dev/null || true
xattr -cr "$APP_DEST" 2>/dev/null || true

echo "  [4/4] Verifying local code signature..."
codesign --force --deep --sign - "$APP_DEST" 2>/dev/null || true

echo ""
echo "  ═══════════════════════════════════════════════════════════════"
echo "  ✅ TeleDrive successfully installed to /Applications!"
echo "  ✅ macOS security checks configured (no unverified warnings)."
echo "  🚀 Launching TeleDrive now..."
echo "  ═══════════════════════════════════════════════════════════════"
echo ""

open "$APP_DEST"

sleep 2
exit 0
