#!/bin/sh
set -eu

if [ "$#" -ne 5 ]; then
  echo "usage: apply-verified-config.sh ACTIVE_CONFIG CANDIDATE_CONFIG ACTIVE_SHA256 CANDIDATE_SHA256 TRANSACTION_ID" >&2
  exit 64
fi

active_input=$1
candidate_input=$2
expected_active=$3
expected_candidate=$4
transaction_id=$5

case "$expected_active" in
  *[!a-f0-9]*) echo "active SHA256 must use lowercase hexadecimal" >&2; exit 64 ;;
esac
case "$expected_candidate" in
  *[!a-f0-9]*) echo "candidate SHA256 must use lowercase hexadecimal" >&2; exit 64 ;;
esac
test "${#expected_active}" -eq 64 || { echo "active SHA256 must contain 64 characters" >&2; exit 64; }
test "${#expected_candidate}" -eq 64 || { echo "candidate SHA256 must contain 64 characters" >&2; exit 64; }
test "$expected_active" != "$expected_candidate" || { echo "active and candidate SHA256 must differ" >&2; exit 64; }
case "$transaction_id" in
  *[!a-f0-9]*) echo "transaction ID must use lowercase hexadecimal" >&2; exit 64 ;;
esac
test "${#transaction_id}" -eq 24 || { echo "transaction ID must contain 24 characters" >&2; exit 64; }

for command_name in readlink sha256sum flock nginx systemctl cp mv stat mktemp awk find grep chmod chown rm id; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "$command_name is required" >&2
    exit 69
  }
done

active_path=$(readlink -f -- "$active_input")
candidate_path=$(readlink -f -- "$candidate_input")
test "$active_input" = "$active_path" || { echo "active config path must already be canonical and must not be a symlink" >&2; exit 64; }
test "$candidate_input" = "$candidate_path" || { echo "candidate config path must already be canonical and must not be a symlink" >&2; exit 64; }
test "$active_path" != "$candidate_path" || { echo "active and candidate paths must differ" >&2; exit 64; }

test_mode=${MUGEN_NGINX_TEST_MODE:-0}
if [ "$test_mode" = 1 ]; then
  test -n "${MUGEN_NGINX_TEST_ROOT:-}" || { echo "MUGEN_NGINX_TEST_ROOT is required in test mode" >&2; exit 64; }
  test_root=$(readlink -f -- "$MUGEN_NGINX_TEST_ROOT")
  case "$test_root" in
    /tmp/*|/private/tmp/*|/var/folders/*|/[A-Za-z]/Users/*) ;;
    *) echo "test root must stay inside a recognized temporary user directory" >&2; exit 64 ;;
  esac
  nginx_root="$test_root/etc/nginx"
  staging_root="$test_root/tmp"
  lock_file="$test_root/mugen-nginx-policy.lock"
elif [ "$test_mode" = 0 ]; then
  test "$(id -u)" = 0 || { echo "Nginx policy activation must run as root" >&2; exit 77; }
  case "$active_path" in
    *[!A-Za-z0-9_./-]*) echo "active config path contains unsupported characters" >&2; exit 64 ;;
  esac
  case "$candidate_path" in
    *[!A-Za-z0-9_./-]*) echo "candidate config path contains unsupported characters" >&2; exit 64 ;;
  esac
  nginx_root=/etc/nginx
  staging_root=/tmp
  lock_file=/run/lock/mugen-nginx-policy.lock
else
  echo "MUGEN_NGINX_TEST_MODE must be 0 or 1" >&2
  exit 64
fi

case "$active_path" in
  "$nginx_root"/conf.d/*.conf)
    relative_active=${active_path#"$nginx_root"/conf.d/}
    ;;
  "$nginx_root"/sites-available/*)
    relative_active=${active_path#"$nginx_root"/sites-available/}
    ;;
  *) echo "active config must resolve to a dedicated file under the approved Nginx root" >&2; exit 64 ;;
esac
case "$relative_active" in
  ''|*/*) echo "active config must be a direct child of an approved Nginx directory" >&2; exit 64 ;;
esac
case "$candidate_path" in
  "$staging_root"/mugen-nginx-policy-*/candidate.conf)
    candidate_token=${candidate_path#"$staging_root"/mugen-nginx-policy-}
    candidate_token=${candidate_token%/candidate.conf}
    case "$candidate_token" in *[!a-f0-9]*) echo "candidate staging token is invalid" >&2; exit 64 ;; esac
    test "${#candidate_token}" -eq 24 || { echo "candidate staging token must contain 24 characters" >&2; exit 64; }
    ;;
  "$active_path".mugen-policy-*.bak)
    backup_suffix=${candidate_path#"$active_path".mugen-policy-}
    backup_suffix=${backup_suffix%.bak}
    backup_token=${backup_suffix%-*}
    backup_hash=${backup_suffix##*-}
    case "$backup_token" in *[!a-f0-9]*) echo "candidate backup token is invalid" >&2; exit 64 ;; esac
    case "$backup_hash" in *[!a-f0-9]*) echo "candidate backup hash prefix is invalid" >&2; exit 64 ;; esac
    test "${#backup_token}" -eq 24 || { echo "candidate backup token must contain 24 characters" >&2; exit 64; }
    test "${#backup_hash}" -eq 12 || { echo "candidate backup hash prefix must contain 12 characters" >&2; exit 64; }
    expected_backup_hash=$(printf '%.12s' "$expected_candidate")
    test "$backup_hash" = "$expected_backup_hash" || { echo "candidate backup hash prefix does not match its reviewed digest" >&2; exit 64; }
    ;;
  *) echo "candidate config must be the unique uploaded candidate or a backup of this active config" >&2; exit 64 ;;
esac

test_stage_fails() {
  test "$test_mode" = 1 && test "${MUGEN_NGINX_TEST_FAIL_STAGE:-}" = "$1"
}

test -s "$active_path" || { echo "active config is missing or empty" >&2; exit 66; }
test -s "$candidate_path" || { echo "candidate config is missing or empty" >&2; exit 66; }
if [ "$test_mode" = 0 ]; then
  test "$(stat -c %u -- "$active_path")" = 0 || { echo "active config must be owned by root" >&2; exit 77; }
  test "$(stat -c %u -- "$candidate_path")" = 0 || { echo "candidate config must be owned by root" >&2; exit 77; }
fi
permission_is_unsafe() {
  if [ "$test_mode" = 1 ] && [ "${MUGEN_NGINX_TEST_UNSAFE_ACTIVE:-0}" = 1 ] && [ "$1" = "$active_path" ]; then
    return 0
  fi
  if [ "$test_mode" = 1 ] && [ "${MUGEN_NGINX_TEST_UNSAFE_CANDIDATE:-0}" = 1 ] && [ "$1" = "$candidate_path" ]; then
    return 0
  fi
  find "$1" -prune -perm /022 -print | grep -q .
}
for permission_path in "$active_path" "$candidate_path"; do
  if permission_is_unsafe "$permission_path"; then
    echo "active and candidate configs must not be group- or world-writable" >&2
    exit 77
  fi
done

file_sha256() {
  sha256sum -- "$1" | awk 'NF == 2 && $1 ~ /^[a-f0-9]{64}$/ { print $1; found=1 } END { if (!found) exit 1 }'
}

exec 9>"$lock_file"
flock -n 9 || { echo "another Nginx policy transaction is active" >&2; exit 75; }

active_before=$(file_sha256 "$active_path")
candidate_before=$(file_sha256 "$candidate_path")
test "$active_before" = "$expected_active" || { echo "active config changed after review" >&2; exit 76; }
test "$candidate_before" = "$expected_candidate" || { echo "candidate config changed after review" >&2; exit 76; }
original_mode=$(stat -c %a -- "$active_path")
original_uid=$(stat -c %u -- "$active_path")
original_gid=$(stat -c %g -- "$active_path")

hash_prefix=$(printf '%.12s' "$expected_active")
backup_path="${active_path}.mugen-policy-${transaction_id}-${hash_prefix}.bak"
test ! -e "$backup_path" || { echo "backup path already exists" >&2; exit 73; }
backup_temporary=$(mktemp "${backup_path}.tmp.XXXXXX")
if cp -p -- "$active_path" "$backup_temporary"; then :; else
  rm -f -- "$backup_temporary" >/dev/null 2>&1 || :
  echo "cannot create reviewed backup" >&2
  exit 74
fi
chmod 600 "$backup_temporary"
test -s "$backup_temporary" || { rm -f -- "$backup_temporary"; echo "backup is empty" >&2; exit 74; }
backup_sha=$(file_sha256 "$backup_temporary")
test "$backup_sha" = "$expected_active" || { rm -f -- "$backup_temporary"; echo "backup does not match the reviewed active config" >&2; exit 74; }
mv -- "$backup_temporary" "$backup_path"

rollback_required=0
temporary_path=
restore_path=
restore_status=0
restore_message=

restore_fail() {
  restore_status=$1
  restore_message=$2
  if [ -n "$restore_path" ]; then
    rm -f -- "$restore_path" >/dev/null 2>&1 || :
    restore_path=
  fi
  return 0
}

restore_previous() {
  restore_status=0
  restore_message=
  restore_path=

  if current_restore_sha=$(file_sha256 "$active_path"); then :; else
    restore_fail 91 "cannot hash active config before restoration"
    return 0
  fi
  if [ "$current_restore_sha" = "$expected_active" ]; then
    rollback_required=0
  elif [ "$current_restore_sha" != "$expected_candidate" ]; then
    restore_fail 92 "active config no longer matches either reviewed digest"
    return 0
  fi

  if [ "$rollback_required" -eq 1 ]; then
    if test_stage_fails restore-create; then
      restore_fail 93 "injected restoration file creation failure"
      return 0
    fi
    if restore_path=$(mktemp "${active_path}.restore.XXXXXX"); then :; else
      restore_fail 93 "cannot create restoration file"
      return 0
    fi
    if test_stage_fails restore-copy; then
      restore_fail 94 "injected restoration copy failure"
      return 0
    fi
    if cp -p -- "$backup_path" "$restore_path"; then :; else
      restore_fail 94 "cannot copy reviewed backup into restoration file"
      return 0
    fi
    if test -s "$restore_path"; then :; else
      restore_fail 95 "restoration file is empty"
      return 0
    fi
    if test_stage_fails restore-hash; then
      restore_fail 96 "injected restoration hash failure"
      return 0
    fi
    if restore_sha=$(file_sha256 "$restore_path"); then :; else
      restore_fail 96 "cannot hash restoration file"
      return 0
    fi
    if [ "$restore_sha" = "$expected_active" ]; then :; else
      restore_fail 97 "restoration file does not match reviewed active digest"
      return 0
    fi
    if test_stage_fails restore-mode; then
      restore_fail 98 "injected restoration mode failure"
      return 0
    fi
    if chmod "$original_mode" "$restore_path"; then :; else
      restore_fail 98 "cannot restore original file mode"
      return 0
    fi
    if [ "$test_mode" = 1 ]; then :; elif chown "$original_uid:$original_gid" "$restore_path"; then :; else
      restore_fail 99 "cannot restore original ownership"
      return 0
    fi
    if test_stage_fails restore-move; then
      restore_fail 100 "injected restoration move failure"
      return 0
    fi
    if mv -f -- "$restore_path" "$active_path"; then
      restore_path=
    else
      restore_fail 100 "cannot atomically restore active config"
      return 0
    fi
    if restored_active_sha=$(file_sha256 "$active_path"); then :; else
      restore_fail 101 "cannot read back restored active config"
      return 0
    fi
    if [ "$restored_active_sha" = "$expected_active" ]; then :; else
      restore_fail 102 "restored active config does not match reviewed digest"
      return 0
    fi
  fi

  if test_stage_fails restore-nginx-test; then
    restore_fail 103 "injected restored config test failure"
    return 0
  fi
  if nginx -t; then :; else
    restore_fail 103 "nginx -t failed for restored config"
    return 0
  fi
  if test_stage_fails restore-reload; then
    restore_fail 104 "injected restored config reload failure"
    return 0
  fi
  if systemctl reload nginx; then :; else
    restore_fail 104 "Nginx reload failed for restored config"
    return 0
  fi
  if restored_active_sha=$(file_sha256 "$active_path"); then :; else
    restore_fail 105 "cannot perform final restored config readback"
    return 0
  fi
  if [ "$restored_active_sha" = "$expected_active" ]; then :; else
    restore_fail 106 "restored config changed during reload"
    return 0
  fi
  rollback_required=0
  return 0
}

on_exit() {
  status=$?
  test "$status" -ne 0 || status=1
  trap - EXIT HUP INT TERM
  if [ "$rollback_required" -eq 1 ]; then
    echo "policy activation failed; restoring $backup_path" >&2
    restore_previous
    if [ "$restore_status" -ne 0 ]; then
      echo "automatic restoration stopped safely: $restore_message" >&2
      echo "restore $backup_path manually and verify the active process before continuing" >&2
      status=90
    else
      echo "reviewed active config restored and reloaded" >&2
    fi
  fi
  if [ -n "$temporary_path" ]; then rm -f -- "$temporary_path" >/dev/null 2>&1 || :; fi
  if [ -n "$restore_path" ]; then rm -f -- "$restore_path" >/dev/null 2>&1 || :; fi
  exit "$status"
}
trap on_exit EXIT HUP INT TERM

temporary_path=$(mktemp "${active_path}.candidate.XXXXXX")
cp -p -- "$active_path" "$temporary_path"
cp -- "$candidate_path" "$temporary_path"
test -s "$temporary_path" || { echo "prepared candidate is empty" >&2; exit 74; }
prepared_candidate_sha=$(file_sha256 "$temporary_path")
test "$prepared_candidate_sha" = "$expected_candidate" || { echo "prepared candidate digest mismatch" >&2; exit 74; }

if [ "$test_mode" = 1 ] && [ "${MUGEN_NGINX_TEST_TAMPER_BEFORE_SWAP:-0}" = 1 ]; then
  tamper_path=$(readlink -f -- "${MUGEN_NGINX_TEST_TAMPER_FILE:-}")
  case "$tamper_path" in
    "$test_root"/fixtures/*) ;;
    *) echo "test tamper file must stay inside the test fixture directory" >&2; exit 64 ;;
  esac
  test -s "$tamper_path" || { echo "test tamper file is missing or empty" >&2; exit 66; }
  cp -- "$tamper_path" "$active_path"
fi
active_pre_swap=$(file_sha256 "$active_path")
candidate_pre_swap=$(file_sha256 "$candidate_path")
test "$active_pre_swap" = "$expected_active" || { echo "active config changed immediately before activation" >&2; exit 76; }
test "$candidate_pre_swap" = "$expected_candidate" || { echo "candidate config changed immediately before activation" >&2; exit 76; }

rollback_required=1
mv -f -- "$temporary_path" "$active_path"
temporary_path=
active_swapped_sha=$(file_sha256 "$active_path")
test "$active_swapped_sha" = "$expected_candidate" || { echo "active config is incomplete after atomic activation" >&2; exit 74; }

nginx -t
systemctl reload nginx
active_after=$(file_sha256 "$active_path")
test "$active_after" = "$expected_candidate"
nginx -t

rollback_required=0
trap - EXIT HUP INT TERM
echo "Nginx policy activated"
echo "active_sha256=$active_after"
echo "backup=$backup_path"
