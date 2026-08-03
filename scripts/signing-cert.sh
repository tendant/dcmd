#!/usr/bin/env bash
# Check that an exported signing certificate is what CI expects, and encode it.
#
#   ./scripts/signing-cert.sh path/to/DeveloperID.p12
#
# CI reports a bad certificate as "SecKeychainItemImport: Unknown format in
# import", after a five-minute build, having said nothing useful about why.
# Everything it depends on is checkable here in a second.
#
# The export itself is not done here. `security export -t identities` takes the
# whole keychain — every Apple Development certificate and any revoked ones
# along with the one wanted — and offers no way to select a single identity.
# Keychain Access can, so that is where the export belongs.
#
# The private key never leaves this machine and is never printed. The base64 is
# written to a file so it does not end up in a terminal transcript, a chat
# window or a shell history.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -lt 1 ]; then
  echo "Certificates that can sign for distribution:"
  security find-identity -v -p codesigning | grep "Developer ID Application" \
    || echo "  none — see docs/releasing.md"
  cat <<'MSG'

Export one of them, then pass the file to this script:

  Keychain Access -> My Certificates -> right-click the
  "Developer ID Application" entry -> Export -> .p12

"My Certificates", not "Certificates": only that view exports the private key.
The other produces a .cer, which encodes and uploads perfectly and then fails
at import — that is the error above.

Select the single certificate before exporting. With several selected the file
holds them all, and the development ones have no business leaving the machine.

  ./scripts/signing-cert.sh ~/Desktop/DeveloperID.p12
MSG
  exit 1
fi

P12="$1"
[ -f "$P12" ] || { echo "No such file: $P12" >&2; exit 1; }

read -r -s -p "Export password: " pass
echo
echo

fail() { echo "FAILED: $*" >&2; exit 1; }

# 1. Is it a PKCS#12 at all? This is the check CI fails on.
openssl pkcs12 -in "$P12" -nokeys -passin "pass:$pass" >/dev/null 2>&1 \
  || fail "not a readable PKCS#12, or the password is wrong.
  A .cer exported from the 'Certificates' view looks exactly like this to CI."

# 2. Does it carry a private key? A certificate alone cannot sign.
openssl pkcs12 -in "$P12" -nocerts -noout -passin "pass:$pass" \
  -passout "pass:$pass" >/dev/null 2>&1 \
  || fail "no private key inside — this is a certificate only."

# 3. Which certificates are in it? With several identities in a keychain it is
#    easy to export the wrong one, or all of them.
subjects=$(openssl pkcs12 -in "$P12" -nokeys -passin "pass:$pass" 2>/dev/null \
  | openssl x509 -noout -subject 2>/dev/null || true)
all=$(openssl pkcs12 -in "$P12" -nokeys -passin "pass:$pass" 2>/dev/null \
  | grep -c "BEGIN CERTIFICATE" || true)
unset pass

echo "Certificates in the file: $all"
[ -n "$subjects" ] && echo "  first: $subjects"

if ! printf '%s' "$subjects" | grep -q "Developer ID Application"; then
  echo
  echo "WARNING: the first certificate is not a Developer ID Application one."
  echo "Only that kind can sign for distribution, and only it can be notarised."
  echo "If this file holds several, check you exported the right entry."
fi

if [ "${all:-0}" -gt 2 ]; then
  echo
  echo "NOTE: $all certificates here. That still imports, and"
  echo "APPLE_SIGNING_IDENTITY decides which one signs — but exporting a single"
  echo "identity keeps development keys off the runner entirely."
fi

# 4. The round trip is what CI actually depends on.
OUT="${P12%.p12}.base64"
base64 -i "$P12" -o "$OUT"
base64 -D -i "$OUT" | cmp -s - "$P12" \
  || fail "the base64 does not decode back to the same bytes."

identity=$(security find-identity -v -p codesigning \
  | grep "Developer ID Application" | head -1 | sed -E 's/.*"(.*)".*/\1/' || true)

cat <<MSG

Checks passed: a readable PKCS#12, a private key inside, and base64 that
decodes back byte for byte.

  APPLE_SIGNING_IDENTITY       ${identity:-<the Developer ID Application string>}
  APPLE_CERTIFICATE            pbcopy < $OUT
  APPLE_CERTIFICATE_PASSWORD   the export password

Paste the base64 into the GitHub secret field only. Do not echo it and do not
paste it into a chat or an issue — it is your private key.

Afterwards:  rm -f "$P12" "$OUT"
MSG
