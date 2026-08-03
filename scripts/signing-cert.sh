#!/usr/bin/env bash
# Produce and check the signing certificate CI needs.
#
#   ./scripts/signing-cert.sh --export        export the Developer ID identity
#   ./scripts/signing-cert.sh some.p12        check one exported by hand
#
# CI reports a bad certificate as "SecKeychainItemImport: Unknown format in
# import" after a five-minute build, having said nothing useful about why.
# Everything it depends on is checkable here in a second — including the import
# itself, which is done into a throwaway keychain.
#
# The private key never leaves this machine and is never printed. The base64 is
# written to a file so it does not reach a terminal transcript, a chat window or
# a shell history.
set -euo pipefail

cd "$(dirname "$0")/.."
WANT="Developer ID Application"

# `security export -t identities` takes the whole keychain and has no way to
# select one identity, so the extra ones are dropped afterwards with openssl.
# Keychain Access can select one, but its .p12 option greys out unless the row
# with the private key under it is the one selected, which is easy to miss.
export_identity() {
  local out="$1" tmp all pem pass
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  all="$tmp/all.p12"
  pem="$tmp/all.pem"
  pass="dcmd-temporary"

  echo "Exporting identities from the login keychain."
  echo "macOS will ask permission for each private key — Allow."
  echo
  security export -k login.keychain-db -t identities -f pkcs12 \
    -P "$pass" -o "$all" || {
      echo "Export failed. Is the login keychain unlocked?" >&2
      return 1
    }

  # -legacy: OpenSSL 3 writes PKCS#12 with algorithms that macOS `security
  # import` cannot read, which fails as "Unknown format" — the very error this
  # script exists to prevent.
  openssl pkcs12 -in "$all" -passin "pass:$pass" -nodes -legacy \
    -out "$pem" 2>/dev/null \
    || openssl pkcs12 -in "$all" -passin "pass:$pass" -nodes -out "$pem"

  python3 - "$pem" "$tmp" "$WANT" <<'PY'
import re, sys
pem, tmp, want = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(pem).read()

# Each bag is preceded by its attributes, including friendlyName, which is how
# a certificate is matched to the key belonging to it.
blocks = re.findall(
    r"(Bag Attributes.*?friendlyName: ([^\n]*).*?)(-----BEGIN ([A-Z ]+)-----.*?-----END \4-----)",
    text, re.S)

cert = key = None
for _, name, body, kind in blocks:
    if want not in name:
        continue
    if "CERTIFICATE" in kind and cert is None:
        cert = body
    elif "KEY" in kind and key is None:
        key = body

if not cert or not key:
    sys.exit(f"no complete '{want}' identity in the keychain export")

open(f"{tmp}/cert.pem", "w").write(cert + "\n")
open(f"{tmp}/key.pem", "w").write(key + "\n")
PY

  echo
  read -r -s -p "Choose an export password (this becomes APPLE_CERTIFICATE_PASSWORD): " newpass
  echo

  # Same reason as above: written so macOS can read it back.
  openssl pkcs12 -export -legacy \
    -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
    -passout "pass:$newpass" -out "$out" 2>/dev/null \
    || openssl pkcs12 -export -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES \
         -macalg SHA1 -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
         -passout "pass:$newpass" -out "$out"

  printf '%s' "$newpass" > "$tmp/pass"
  CHOSEN_PASS=$(cat "$tmp/pass")
}

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
  security find-identity -v -p codesigning | grep "$WANT" \
    || echo "  none — see docs/releasing.md"
  cat <<'MSG'

  ./scripts/signing-cert.sh --export     export the Developer ID identity
  ./scripts/signing-cert.sh some.p12     check one exported by hand
MSG
  exit 1
fi

if [ "$1" = "--export" ]; then
  P12="dcmd-signing.p12"
  export_identity "$P12"
  PASS="$CHOSEN_PASS"
  echo "Exported $P12"
else
  P12="$1"
  [ -f "$P12" ] || fail "no such file: $P12"
  read -r -s -p "Export password: " PASS
  echo
fi
echo

openssl pkcs12 -in "$P12" -nokeys -passin "pass:$PASS" >/dev/null 2>&1 \
  || fail "not a readable PKCS#12, or the password is wrong.
  A .cer exported from the 'Certificates' view looks exactly like this to CI."

openssl pkcs12 -in "$P12" -nocerts -noout -passin "pass:$PASS" \
  -passout "pass:$PASS" >/dev/null 2>&1 \
  || fail "no private key inside — this is a certificate only."

count=$(openssl pkcs12 -in "$P12" -nokeys -passin "pass:$PASS" 2>/dev/null \
  | grep -c "BEGIN CERTIFICATE" || true)
subject=$(openssl pkcs12 -in "$P12" -nokeys -passin "pass:$PASS" 2>/dev/null \
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

identity=$(security find-identity -v -p codesigning | grep "$WANT" | head -1 \
  | sed -E 's/.*"(.*)".*/\1/' || true)

cat <<MSG

All checks passed, including the import macOS itself performs.

  APPLE_SIGNING_IDENTITY       ${identity:-<the $WANT string>}
  APPLE_CERTIFICATE            pbcopy < $OUT
  APPLE_CERTIFICATE_PASSWORD   the export password

Paste the base64 into the GitHub secret field only. Do not echo it and do not
paste it into a chat or an issue — it is your private key.

Afterwards:  rm -f "$P12" "$OUT"
MSG
