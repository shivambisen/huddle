#!/bin/bash
# Install Huddle on a Mac:
#   curl -fsSL https://huddle-seven-kappa.vercel.app/install.sh | bash
#
# Downloads the latest Huddle from GitHub releases, puts it in /Applications
# (or ~/Applications if that isn't writable) and starts it quietly in the
# background. Huddle isn't signed with an Apple Developer certificate yet, and a
# browser download of an unsigned app is blocked by macOS ("damaged" / "corrupted");
# a download made here with curl isn't, so this is the reliable way to install it.
set -euo pipefail

say() { printf '\033[1m◐ Huddle:\033[0m %s\n' "$1"; }
fail() { printf '\033[31m✕ %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer is for macOS. On Windows, download Huddle-win-x64.exe from https://github.com/shivambisen/huddle/releases/latest"

case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) fail "Unsupported Mac ($(uname -m))." ;;
esac

URL="https://github.com/shivambisen/huddle/releases/latest/download/Huddle-mac-${ARCH}.zip"
DEST=/Applications
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

say "Downloading Huddle for $( [ "$ARCH" = arm64 ] && echo 'Apple Silicon' || echo 'Intel' ) Macs…"
curl -fL --progress-bar -o "$TMP/Huddle.zip" "$URL" || fail "Download failed. Check your connection and try again."

say "Unpacking…"
ditto -x -k "$TMP/Huddle.zip" "$TMP/app" || fail "Couldn't unpack the download."
[ -d "$TMP/app/Huddle.app" ] || fail "The download didn't contain Huddle.app."

if pgrep -xq Huddle; then
  say "Closing the Huddle that's running…"
  osascript -e 'quit app "Huddle"' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -xq Huddle || break; sleep 1; done
  pgrep -xq Huddle && fail "Huddle is still running. Quit it from the ◐ menu-bar icon, then run this again."
fi

say "Installing to $DEST…"
rm -rf "$DEST/Huddle.app"
ditto "$TMP/app/Huddle.app" "$DEST/Huddle.app"
xattr -dr com.apple.quarantine "$DEST/Huddle.app" 2>/dev/null || true
# Make sure huddle:// links open this copy.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST/Huddle.app" >/dev/null 2>&1 || true

say "Starting Huddle in the background (look for ◐ in the menu bar)…"
open -g -a "$DEST/Huddle.app" --args --background

VERSION=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$DEST/Huddle.app/Contents/Info.plist" 2>/dev/null || echo '')
say "Installed Huddle ${VERSION}. Open Claude Code: the Huddle row appears above your prompt."
echo "   Add it to Claude Code (once):  claude plugin marketplace add shivambisen/huddle && claude plugin install huddle@huddle"
