# Releasing

Releases are cut from a tag. Pushing `v*` runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds
four bundles on real runners and collects them into a **draft** GitHub release.
Nothing becomes public until someone presses publish.

Four targets, because only those runners can produce them:

| Target | Runner | Output |
| --- | --- | --- |
| `aarch64-apple-darwin` | `macos-latest` | `.dmg` |
| `x86_64-apple-darwin` | `macos-13` | `.dmg` |
| `x86_64-unknown-linux-gnu` | `ubuntu-22.04` | `.AppImage`, `.deb` |
| `x86_64-pc-windows-msvc` | `windows-latest` | `.msi`, `.exe` |

Both Mac architectures are built separately rather than as one universal
binary: a universal build doubles the download for everyone to spare one group
a choice, and an x86_64 build will not run natively on Apple silicon.

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
3. Upload the CSR, download the `.cer`, double-click to install.
4. Keychain Access → *My Certificates* → the new "Developer ID Application"
   entry → right-click → **Export** → `.p12`, with a password.

### The credentials CI needs

```sh
base64 -i cert.p12 | pbcopy                                    # APPLE_CERTIFICATE
security find-identity -v -p codesigning | grep "Developer ID" # APPLE_SIGNING_IDENTITY
```

Notarisation needs an **app-specific password**, not the Apple ID password:
appleid.apple.com → Sign-In and Security → App-Specific Passwords.

Add six repository secrets under Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the password set when exporting it |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | the Apple ID email |
| `APPLE_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | the 10-character team ID |

Tauri reads these itself: it imports the certificate into a temporary keychain,
signs with the hardened runtime, and submits for notarisation.

A build with the secrets absent still succeeds, unsigned. Forks have no secrets,
and a missing one should not become a red build whose cause is invisible.

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

Signing locally works the same way — set the same variables and run
`pnpm tauri build`.

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
