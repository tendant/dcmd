#!/usr/bin/env bash
# Check the .p12 exported from Keychain Access before it becomes a CI secret.
#
#   ./scripts/signing-cert.sh some.p12
#
# CI reports a bad certificate as "SecKeychainItemImport: Unknown format in
# import" after a five-minute build, having said nothing useful about why.
# Everything it depends on is checkable here in a second — including the import
# itself, which is done into a throwaway keychain.
#
# The private key is never printed. The base64 is written to a file so it does
# not reach a terminal transcript, a chat window or a shell history.
set -euo pipefail

cd "$(dirname "$0")/.."
WANT="Developer ID Application"

fail() { echo "FAILED: $*" >&2; exit 1; }

# The check that matters most: `security import` is exactly what CI runs, so a
# throwaway keychain answers the question directly rather than by proxy.
verify_import() {
  local p12="$1" pass="$2" kc
  kc="$(mktemp -d)/verify.keychain"
  security create-keychain -p verify "$kc" >/dev/null
  if security import "$p12" -k "$kc" -P "$pass" -A >/dev/null 2>&1; then
    security delete-keychain "$kc" >/dev/null 2>&1 || true
    return 0
  fi
  security delete-keychain "$kc" >/dev/null 2>&1 || true
  return 1
}

if [ $# -lt 1 ]; then
  echo "Certificates that can sign for distribution:"
  # One line per identity: a certificate present in more than one keychain is
  # listed once per keychain, under the same hash.
  found=$(security find-identity -v -p codesigning | grep "$WANT" | awk '!seen[$2]++' || true)
  if [ -n "$found" ]; then
    printf '%s\n' "$found"
  else
    echo "  none — see docs/releasing.md"
  fi
  cat <<'MSG'

Export one from Keychain Access, then check it:

  ./scripts/signing-cert.sh some.p12
MSG
  exit 1
fi

P12="$1"
[ -f "$P12" ] || fail "no such file: $P12"
read -r -s -p "Export password: " PASS
echo
echo

# Keychain Access writes PKCS#12 with RC2-40-CBC, which OpenSSL 3 moved out of
# the default provider. Reading such a file without -legacy fails as
# "unsupported ... RC2-40-CBC" — on a file macOS imports perfectly well. Probe
# once and reuse the answer, rather than letting a fallback run twice and
# concatenate its output.
LEGACY=""
if ! openssl pkcs12 -in "$P12" -nokeys -passin "pass:$PASS" >/dev/null 2>&1; then
  if openssl pkcs12 -legacy -in "$P12" -nokeys -passin "pass:$PASS" >/dev/null 2>&1; then
    LEGACY="-legacy"
    echo "Read with OpenSSL's legacy provider, as Keychain Access exports need."
  else
    fail "not a readable PKCS#12, or the password is wrong.
  A .cer exported from the 'Certificates' view looks exactly like this to CI."
  fi
fi

openssl pkcs12 $LEGACY -in "$P12" -nocerts -noout -passin "pass:$PASS" \
  -passout "pass:$PASS" >/dev/null 2>&1 \
  || fail "no private key inside — this is a certificate only.
  Keychain Access offers .p12 only under 'My Certificates', and only when the
  certificate and its key are in the same keychain. See docs/releasing.md."

count=$(openssl pkcs12 $LEGACY -in "$P12" -nokeys -passin "pass:$PASS" 2>/dev/null \
  | grep -c "BEGIN CERTIFICATE" || true)
subject=$(openssl pkcs12 $LEGACY -in "$P12" -nokeys -passin "pass:$PASS" 2>/dev/null \
  | openssl x509 -noout -subject 2>/dev/null || true)

echo "Certificates in the file: $count"
[ -n "$subject" ] && echo "  $subject"
printf '%s' "$subject" | grep -q "$WANT" \
  || echo "WARNING: the first certificate is not a $WANT one."

verify_import "$P12" "$PASS" \
  || fail "macOS could not import it. This is the error CI reports;
  it is now reproduced here rather than after a build."
echo "security import: accepted"

OUT="${P12%.p12}.base64"
base64 -i "$P12" -o "$OUT"
base64 -D -i "$OUT" | cmp -s - "$P12" \
  || fail "the base64 does not decode back to the same bytes."

# The name comes out of the certificate itself, which is the identity codesign
# will look for.
IDENTITY_NAME=$(printf '%s' "$subject" | sed -E 's/.*CN=([^,]*).*/\1/')

cat <<MSG

All checks passed, including the import macOS itself performs.

  APPLE_SIGNING_IDENTITY       ${IDENTITY_NAME:-<the $WANT string>}
  APPLE_CERTIFICATE            pbcopy < $OUT
  APPLE_CERTIFICATE_PASSWORD   the export password

Paste the base64 into the GitHub secret field only. Do not echo it and do not
paste it into a chat or an issue — it is your private key.

Afterwards:  rm -f "$P12" "$OUT"
MSG
