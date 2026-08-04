# Releasing

Releases are cut from a tag. Pushing `v*` runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds
four bundles on real runners and collects them into a **draft** GitHub release.
Nothing becomes public until someone presses publish.

Three targets, because only those runners can produce them:

| Target | Runner | Output |
| --- | --- | --- |
| `aarch64-apple-darwin` | `macos-latest` | `.dmg` |
| `x86_64-unknown-linux-gnu` | `ubuntu-22.04` | `.AppImage`, `.deb` |
| `x86_64-pc-windows-msvc` | `windows-latest` | `.msi`, `.exe` |

**macOS is Apple silicon only.** There is no x86_64 `.dmg`. `macos-13` was
retired on 2025-12-08, and the Intel runners that replaced it retire with
`macos-15` in autumn 2027, so the target was on a clock either way. Intel Macs
run the aarch64 build under Rosetta 2 — slower, but it works, and it does not
put a build in the release that quietly stops being produced.

Say so in the release notes. Someone on an Intel Mac who sees one `.dmg` will
assume it is for them, and they are right, but not obviously.

## Cutting a release

1. Bump the version in **three** places, which must agree: `package.json`,
   `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`. Run `cargo check` so
   `Cargo.lock` follows.
2. Update `README.md` if behaviour changed. It has been wrong before — it
   claimed preview was unimplemented for several releases' worth of work.
3. Commit, push, then tag:

   ```sh
   git tag -a v0.2.0 -m "dcmd 0.2.0"
   git push origin v0.2.0
   ```

4. Watch the run. `fail-fast: false`, so one broken target does not hide the
   others.
5. Review the draft, add the notes below, publish.

To try the workflow without tagging, run it from **Actions → Release → Run
workflow**. It builds and uploads artifacts; the publish job is gated on a tag,
so nothing is created.

If the workflow itself needs fixing, delete the tag and re-cut it — nothing is
published until the draft is:

```sh
git tag -d v0.2.0 && git push origin :v0.2.0
```

## Signing and notarising macOS

**Without this, the app is unusable for anyone who did not build it.** Gatekeeper
refuses an unsigned bundle downloaded from the internet, and the message it
shows suggests the app is damaged rather than unsigned. Users read that as a
broken download.

### The certificate is not the one you already have

An **Apple Development** certificate — what you get by default, and what
Xcode installs — signs apps for your own registered devices. It cannot be used
for distribution and Apple will not notarise it.

What is needed is a **Developer ID Application** certificate. It comes with a
paid Apple Developer Program membership and has to be created explicitly, by
the Account Holder.

Check what is actually installed:

```sh
security find-identity -v -p codesigning
```

Only a line beginning `Developer ID Application:` will do.

### Creating it

1. developer.apple.com → Certificates, IDs & Profiles → Certificates → **+** →
   **Developer ID Application**.
2. It asks for a CSR: Keychain Access → Certificate Assistant → *Request a
   Certificate From a Certificate Authority* → save to disk.
3. Upload the CSR, download the `.cer`, double-click to install. That joins it
   to the private key the CSR was made from; the pair is now an *identity*, and
   `security find-identity -v -p codesigning` lists only identities, so anything
   it prints has its key.
4. Export it from Keychain Access, below.

### The credentials CI needs

Keychain Access is no longer in *Utilities* — as of macOS 15 it lives in
CoreServices, and Spotlight does not index it:

```sh
open "/System/Library/CoreServices/Applications/Keychain Access.app"
```

1. Sidebar → **login**, category → **My Certificates**. Not *Certificates*:
   that view shows the same certificate without its key, and exporting from it
   produces a file CI rejects as "Unknown format".
2. Select the `Developer ID Application: …` row — the row itself, not the key
   nested under its disclosure triangle.
3. **File → Export Items…**, File Format **Personal Information Exchange
   (.p12)**, set a password, then authorise with the login password.

Then check the file before it becomes a secret:

```sh
./scripts/signing-cert.sh ~/Desktop/whatever.p12
```

### Telling several certificates apart

Names repeat: every `Apple Development` certificate issued to one person carries
the same one, so the list is several identical rows. The name is not the
identifier — the fingerprint is.

In Keychain Access, ⌘I on a certificate shows its SHA-1 fingerprint, and the
list has an *Expires* column. Both map back to what the command line prints:

```sh
security find-identity -v -p codesigning
```

None of that matters for this export, though. Only one row begins
`Developer ID Application:`, and the repeated names are all `Apple Development`
certificates, which cannot sign for distribution at all.

One thing worth checking before exporting: `find-identity` also lists **revoked**
certificates, marked `CSSMERR_TP_CERT_REVOKED`. They sign without complaint and
fail at notarisation.

### When `.p12` is greyed out

Keychain Access offers `.p12` only for a certificate that has its private key in
the same keychain. Three reasons it will not:

1. **The wrong category** — *Certificates* rather than *My Certificates*.
2. **The wrong row** — the key nested under the disclosure triangle rather than
   the certificate above it.
3. **The certificate and its key are in different keychains.** Double-clicking a
   `.cer` offers a choice of keychain, and *System* is a plausible-looking
   answer; the key created by the CSR is in *login* regardless. Neither half is
   an identity on its own.

The third is invisible from the command line, because `find-identity` searches
every keychain in the list and reports a perfectly valid identity:

```sh
security find-certificate -c "Developer ID Application" -Z ~/Library/Keychains/login.keychain-db
security find-certificate -c "Developer ID Application" -Z /Library/Keychains/System.keychain
```

If only the second prints a hash, that is the split. Put a copy of the
certificate beside its key — importing a certificate needs no password, and the
System copy can stay where it is:

```sh
security import ~/Downloads/developerID_application.cer -k ~/Library/Keychains/login.keychain-db
```

Once the certificate sits beside its key, the `.p12` option is available and
Keychain Access exports the one selected row.

### What the check does

`./scripts/signing-cert.sh some.p12` refuses to hand anything over unless the
file is a readable PKCS#12 **containing a private key**, unless macOS itself can
`security import` it into a throwaway keychain — the same operation CI performs,
so the answer is direct rather than by proxy — and unless the base64 decodes back
to those exact bytes. It also reports how many certificates the file holds and
whether the first is a Developer ID one, which catches exporting the wrong row.
It writes the base64 to a file for `pbcopy` — deliberately to a file, so a
private key does not end up in a terminal transcript or a chat window.

It reads with OpenSSL's `-legacy` provider when needed. Keychain Access writes
PKCS#12 using RC2-40-CBC, which OpenSSL 3 no longer enables by default, so a
plain `openssl pkcs12` rejects an Apple export as `unsupported ... RC2-40-CBC`
— a file `security import` accepts without complaint. Do not read that error as
a bad certificate.

Notarisation needs an **app-specific password**, not the Apple ID password:
appleid.apple.com → Sign-In and Security → App-Specific Passwords.

Under Settings → Secrets and variables → Actions:

| Name | Kind | Value |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | secret | base64 of the `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | secret | the password set when exporting it |
| `APPLE_SIGNING_IDENTITY` | secret | `Developer ID Application: Name (TEAMID)` |
| `APPLE_PASSWORD` | secret | the app-specific password |
| `APPLE_ID` | secret **or** variable | the Apple ID email |
| `APPLE_TEAM_ID` | secret **or** variable | the 10-character team ID |

That page holds secrets and variables on two tabs, and the last two belong on
either — the team ID is embedded in every signed binary, so it is not a secret
in any useful sense. The workflow reads both. Without that, a value entered on
the *Variables* tab and read from `secrets` is not an error: it is the empty
string, and notarisation fails for a reason that names neither.

```sh
gh secret list      # what is where
gh variable list
```

Tauri reads these itself: it imports the certificate into a temporary keychain,
signs with the hardened runtime, and submits for notarisation.

A build with them absent still succeeds, unsigned. Forks have no secrets, and a
missing one should not become a red build whose cause is invisible. The cost is
that a **half-configured** repository looks the same as a fork — read the
`spctl` line in the log rather than the green check.

### When the certificate will not import

```
security: SecKeychainItemImport: Unknown format in import.
failed codesign application: failed to run command security import
```

The bytes in `APPLE_CERTIFICATE` are not a PKCS#12. In order of likelihood:

- **A `.cer` was exported instead of a `.p12`.** Keychain Access shows the same
  certificate under *Certificates* and under *My Certificates*; only the latter
  export includes the private key, and only that can sign. A `.cer` base64s
  perfectly well and fails exactly like this.
- **The `.p12` was written by OpenSSL 3 with its default algorithms.** macOS
  cannot read those at all. Demonstrated:

  ```
  openssl pkcs12 -export ...            -> security import FAILED
  openssl pkcs12 -export -legacy ...    -> security import OK
  ```

  `-legacy` is required, or `-certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES
  -macalg SHA1`. A `.p12` from Keychain Access is already in that shape; only a
  hand-rolled one is at risk.
- **The base64 was truncated or altered** on its way into the secret field.
- **The wrong file was encoded** — easy where a keychain holds several
  identities, which most do.

A wrong *password* does not produce this — that fails later, complaining about
MAC verification. This message is about the format alone.

`./scripts/signing-cert.sh` checks all of these locally, which is cheaper than
finding out after a five-minute build on a runner.

### Confirming it worked

The workflow reports this after each macOS build, so an unsigned bundle is
visible in the log rather than discovered by whoever downloads it:

```sh
codesign --verify --deep --strict --verbose=2 path/to/dcmd.app
spctl --assess --type execute --verbose path/to/dcmd.app
```

`spctl` is the check Gatekeeper performs on another machine. A release that is
ready reports `accepted` and `source=Notarized Developer ID`. Anything else
means the download will be refused.

### The .dmg needs notarising too, separately

Tauri notarises the `.app` and then builds the `.dmg` around it, so the disk
image ends up signed but with no ticket of its own. Every check made of the
`.app` passes, and the download still fails — because what a user downloads is
the `.dmg`, and Gatekeeper assesses **that**:

```sh
xcrun stapler validate path/to.dmg
spctl --assess --type open --context context:primary-signature --verbose path/to.dmg
```

`-t open` is the question asked of a disk image; `-t execute` is the question
asked of an app. They have different answers, and only the first one matters to
somebody clicking a link. An unnotarised `.dmg` reports `rejected` and
`source=Unnotarized Developer ID`.

The workflow submits and staples it in a step of its own, after the build:

```sh
xcrun notarytool submit "$DMG" --apple-id … --team-id … --password … --wait
xcrun stapler staple "$DMG"
```

Signing locally works the same way — set the same variables and run
`pnpm tauri build`, then staple the `.dmg` by hand as above.

## Release notes

Two things belong in every release until they change:

- **If the macOS bundles are unsigned**, say so and give the way through:
  right-click → Open, or `xattr -d com.apple.quarantine /Applications/dcmd.app`.
  Silence here reads as a broken build.
- **Linux and Windows bundles are unsigned too.** Windows SmartScreen warns on
  an unsigned installer; that needs a separate code-signing certificate and is
  not set up.

## Known gaps

- **Nothing verifies the bundles run.** CI builds and signs them; that they
  launch on a clean machine is checked by hand or not at all.
- **No update mechanism.** Tauri's updater is not configured, so a new version
  means downloading it again.
- **`spctl` in the workflow is informational.** It reports and does not fail the
  build, because a fork with no secrets would otherwise always be red. Read the
  log before publishing.
