#!/usr/bin/env bash
# Disposable SSH server for the remote-browsing tests.
#
#   ./scripts/ssh-test-server.sh start   # container + throwaway key + fixtures
#   ./scripts/ssh-test-server.sh stop
#   eval "$(./scripts/ssh-test-server.sh env)" && cargo test   # run the live tests
#
# Deliberately isolated: its own keypair and its own ssh config, so nothing
# touches ~/.ssh/config or ~/.ssh/authorized_keys, and no real host is involved.
set -euo pipefail

NAME=dcmd-sshd
PORT=2222
DIR="${TMPDIR:-/tmp}/dcmd-ssh-test"
KEY="$DIR/id_test"
CONFIG="$DIR/ssh_config"

# Two things the image lacks that the tests it exists for need.
#
# rsync, because transfers to and from a remote run it on the far side — without
# it four live tests fail with "bash: line 1: rsync: command not found".
#
# Connection headroom, because cargo runs tests in parallel and sshd ships with
# `MaxStartups 10`: past ten unauthenticated connections at once it starts
# refusing at random, and rsync reports that as "connection unexpectedly closed
# (0 bytes received so far)" — which reads like a bug in the transfer rather
# than the server declining to talk. The live config is the one sshd was started
# with, not /etc/ssh/sshd_config.
provision() {
  docker exec "$NAME" apk add --no-cache rsync >/dev/null 2>&1 \
    || { echo "could not install rsync into $NAME" >&2; exit 1; }
  docker exec "$NAME" sh -c '
    sed -i "/^#\?MaxStartups/d; /^#\?MaxSessions/d" /config/sshd/sshd_config
    printf "MaxStartups 100:30:200\nMaxSessions 100\n" >> /config/sshd/sshd_config
    kill -HUP "$(pgrep -f "sshd.*listener" | head -1)"
  ' >/dev/null 2>&1 || { echo "could not raise MaxStartups in $NAME" >&2; exit 1; }
}

start() {
  command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
  mkdir -p "$DIR"
  [ -f "$KEY" ] || ssh-keygen -t ed25519 -f "$KEY" -N "" -C dcmd-test -q

  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -p "$PORT:2222" \
    -e PUBLIC_KEY="$(cat "$KEY.pub")" -e USER_NAME=tester -e SUDO_ACCESS=false \
    linuxserver/openssh-server >/dev/null

  cat > "$CONFIG" <<EOF
Host dcmd-test
  HostName 127.0.0.1
  Port $PORT
  User tester
  IdentityFile $KEY
  IdentitiesOnly yes
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
EOF

  printf 'waiting for sshd'
  for _ in $(seq 1 30); do
    if ssh -F "$CONFIG" -o ConnectTimeout=2 dcmd-test true 2>/dev/null; then
      echo " ready"
      provision
      seed
      echo
      echo "Run the live tests with:"
      echo "  eval \"\$($0 env)\" && cargo test"
      return 0
    fi
    printf '.'; sleep 1
  done
  echo " timed out" >&2; exit 1
}

seed() {
  # The awkward names are the point: they are what breaks parsing `ls` output,
  # and the reason listings go over SFTP instead.
  ssh -F "$CONFIG" dcmd-test '
    rm -rf /tmp/demo /tmp/awkward
    mkdir -p /tmp/demo/sub /tmp/awkward
    echo hello > /tmp/demo/a.txt
    printf "x%.0s" $(seq 1 5000) > /tmp/demo/big.bin
    echo nested > /tmp/demo/sub/nested.txt
    cd /tmp/awkward
    touch "a file with spaces.txt" "naïve.txt" "quote'"'"'s.txt"
    touch "$(printf "new\nline.txt")"
  ' >/dev/null
}

case "${1:-start}" in
  start) start ;;
  stop)  docker rm -f "$NAME" >/dev/null 2>&1 && echo stopped || echo "not running" ;;
  env)   echo "export DCMD_TEST_SSH_CONFIG='$CONFIG'" ;;
  *)     echo "usage: $0 {start|stop|env}" >&2; exit 1 ;;
esac
