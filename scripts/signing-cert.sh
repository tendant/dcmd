#!/usr/bin/env bash
# Export the Developer ID certificate for CI, and prove it is what CI expects.
#
# The manual route — export from Keychain Access, base64 it, paste into a
# secret — fails silently: the wrong export produces a .cer with no private key,
# and CI only says "SecKeychainItemImport: Unknown format in import" long after
# the fact. Everything here is checked before it can be pasted anywhere.
#
# The private key never leaves this machine and is never printed. The base64 is
# written to a file for `pbcopy` precisely so it does not end up in a terminal
# transcript, a chat window or a shell history.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT_P12="dcmd-signing.p12"
OUT_B64="dcmd-signing.p12.base64"

identity=$(security find-identity -v -p codesigning \
  | grep "Developer ID Application" | head -1 || true)

if [ -z "$identity" ]; then
  cat >&2 <<'MSG'
No "Developer ID Application" certificate found.

An "Apple Development" certificate is not a substitute: it signs for your own
registered devices, cannot be used for distribution, and Apple will not
notarise it. See docs/releasing.md for how to create the right one.
MSG
  exit 1
fi

# The full string between the quotes is what APPLE_SIGNING_IDENTITY must be.
name=$(printf '%s' "$identity" | sed -E 's/.*"(.*)".*/\1/')
echo "Found: $name"
echo

echo "Choose an export password. CI needs it as APPLE_CERTIFICATE_PASSWORD."
echo "Keychain may also ask permission to export the private key."
echo
# -T with no argument still prompts; letting `security` handle the password
# keeps it out of this script's arguments, where `ps` could see it.
security export -k login.keychain-db -t identities -f pkcs12 -o "$OUT_P12" 2>/dev/null || {
  echo "Export failed. Run it yourself if the prompt did not appear:" >&2
  echo "  security export -k login.keychain-db -t identities -f pkcs12 -o $OUT_P12" >&2
  exit 1
}

echo
echo "Checking the export is a PKCS#12 with a private key in it..."
read -r -s -p "Re-enter the export password to verify: " pass
echo
if ! openssl pkcs12 -in "$OUT_P12" -nokeys -passin "pass:$pass" >/dev/null 2>&1; then
  echo "FAILED: not a readable PKCS#12, or the password is wrong." >&2
  echo "This is exactly what CI reports as 'Unknown format in import'." >&2
  rm -f "$OUT_P12"
  exit 1
fi
if ! openssl pkcs12 -in "$OUT_P12" -nocerts -noout -passin "pass:$pass" \
     -passout "pass:$pass" >/dev/null 2>&1; then
  echo "FAILED: no private key inside. A .cer export looks like this —" >&2
  echo "export from Keychain Access' 'My Certificates', not 'Certificates'." >&2
  rm -f "$OUT_P12"
  exit 1
fi
unset pass

base64 -i "$OUT_P12" -o "$OUT_B64"

# The round trip is the thing CI actually depends on: whatever is pasted must
# decode back to these exact bytes.
if ! base64 -D -i "$OUT_B64" | cmp -s - "$OUT_P12"; then
  echo "FAILED: the base64 does not decode back to the same file." >&2
  exit 1
fi

cat <<MSG

Both checks passed: a valid PKCS#12 containing a private key, and base64 that
decodes back to it byte for byte.

Set these three secrets:

  APPLE_SIGNING_IDENTITY   $name
  APPLE_CERTIFICATE        pbcopy < $OUT_B64
  APPLE_CERTIFICATE_PASSWORD   the password you just chose

Paste the base64 into the GitHub secret field only. Do not echo it, and do not
paste it into a chat or an issue — it is your private key.

When the secrets are in place:

  rm -f $OUT_P12 $OUT_B64

Both are gitignored, but they should not linger.
MSG
