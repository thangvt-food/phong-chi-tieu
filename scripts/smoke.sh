#!/usr/bin/env bash
# Smoke test tài khoản + phân quyền, chạy trên D1 LOCAL (không đụng production).
#   1) npm run db:schema:local     (dựng DB sạch, schema version 5)
#   2) npm run build
#   3) npm run dev:server
#   4) bash scripts/smoke.sh
#
# Assertion đi qua HTTP; account/session kiểm thử được seed trong D1 local.
# Script tự dọn phòng/user scratch ở đầu và cuối.

set -uo pipefail
API="${API:-http://127.0.0.1:8788}"
NS=$(date +%s)
DB_NAME="${DB_NAME:-phong_chi_tieu_db}"
PERSIST_TO="${PERSIST_TO:-}"
RA="smoke-a-$NS"
RB="smoke-b-$NS"
PASS=0; FAIL=0

U_A="smoke-alice-$NS"
U_B="smoke-bob-$NS"
U_C="smoke-carol-$NS"
U_D="smoke-dave-$NS"
U_E="smoke-erin-$NS"
U_F="smoke-frank-$NS"
U_R="smoke-rec-$NS"
U_OLD="smoke-legacy-$NS"

purge() {
  local persist_args=()
  if [ -n "$PERSIST_TO" ]; then persist_args+=(--persist-to "$PERSIST_TO"); fi
  npx wrangler d1 execute "$DB_NAME" --local "${persist_args[@]}" --command="
    DELETE FROM member_shares WHERE room_id LIKE 'smoke-%';
    DELETE FROM join_requests WHERE room_id LIKE 'smoke-%';
    DELETE FROM periods WHERE room_id LIKE 'smoke-%';
    DELETE FROM expenses WHERE room_id LIKE 'smoke-%';
    DELETE FROM memberships WHERE room_id LIKE 'smoke-%' OR user_id IN (SELECT id FROM users WHERE username LIKE 'smoke-%');
    DELETE FROM members WHERE room_id LIKE 'smoke-%';
    DELETE FROM settings WHERE room_id LIKE 'smoke-%';
    DELETE FROM invites WHERE room_id LIKE 'smoke-%';
    DELETE FROM sessions WHERE room_id LIKE 'smoke-%';
    DELETE FROM rooms WHERE room_id LIKE 'smoke-%';
    DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'smoke-%');
    DELETE FROM users WHERE username LIKE 'smoke-%';
    DELETE FROM auth_throttle WHERE key LIKE 'login:smoke-%' OR key LIKE 'pin:smoke-%';" >/dev/null 2>&1
}
purge
trap 'purge; echo "  (đã dọn phòng/user smoke)"' EXIT

DB_ARGS=()
if [ -n "$PERSIST_TO" ]; then DB_ARGS=(--persist-to "$PERSIST_TO"); fi

create_test_user() {
  local username=$1 display=$2 token_var=$3
  local user_id="test-$username"
  local token token_hash email
  token="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  token_hash="$(TOKEN="$token" python3 -c 'import hashlib,os; print(hashlib.sha256(os.environ["TOKEN"].encode()).hexdigest())')"
  email="${username}@example.test"
  npx wrangler d1 execute "$DB_NAME" --local "${DB_ARGS[@]}" --command="
    INSERT INTO users (id, username, display_name, password_hash, firebase_uid, email)
    VALUES ('$user_id', '$username', '$display', 'google-auth-only', 'firebase-$username', '$email');
    INSERT INTO user_sessions (token_hash, user_id, expires_at)
    VALUES ('$token_hash', '$user_id', '2099-01-01T00:00:00.000Z');" >/dev/null
  printf -v "$token_var" '%s' "$token"
}

api() { # api METHOD PATH [json] [bearer]
  local m=$1 p=$2 j=${3:-} b=${4:-}
  local args=(-s --max-time 40 -X "$m" -w '\n%{http_code}' "$API$p" -H 'Content-Type: application/json')
  [ -n "$b" ] && args+=(-H "Authorization: Bearer $b")
  [ -n "$j" ] && args+=(-d "$j")
  local out; out="$(curl "${args[@]}")"
  HTTP_CODE="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}

get() {
  BODY="$BODY" python3 - "$1" <<'PY'
import json, os, sys
path = sys.argv[1].split('.') if sys.argv[1] else []
try:
    d = json.loads(os.environ.get('BODY') or '{}')
except Exception:
    print(''); raise SystemExit
for k in path:
    if d is None: break
    if isinstance(d, list):
        try:
            d = d[int(k)]
        except Exception:
            d = None; break
    else:
        d = d.get(k)
if d is True: print('true')
elif d is False: print('false')
elif d is None: print('')
else: print(d)
PY
}

expect() {
  local name=$1 want=$2
  if [ "$HTTP_CODE" = "$want" ]; then
    PASS=$((PASS+1)); echo "  ok   $name"
  else
    FAIL=$((FAIL+1)); echo "  FAIL $name -> HTTP $HTTP_CODE (want $want): $BODY"
  fi
}

expect_field() {
  local name=$1 path=$2 want=$3 got
  got="$(get "$path")"
  if [ "$got" = "$want" ]; then
    PASS=$((PASS+1)); echo "  ok   $name"
  else
    FAIL=$((FAIL+1)); echo "  FAIL $name -> '$got' (want '$want'): $BODY"
  fi
}

echo "== 1. tài khoản =="
create_test_user "$U_A" Alice TOK_A
create_test_user "$U_B" Bob TOK_B
create_test_user "$U_C" Carol TOK_C
create_test_user "$U_D" Dave TOK_D
create_test_user "$U_E" Erin TOK_E
create_test_user "$U_F" Frank TOK_F
create_test_user "$U_R" Recovery TOK_R
create_test_user "$U_OLD" Legacy TOK_OLD
npx wrangler d1 execute "$DB_NAME" --local "${DB_ARGS[@]}" \
  --command="UPDATE users SET firebase_uid = NULL WHERE username = '$U_OLD'" >/dev/null
api POST /api/auth/register '{"username":"old-account","password":"password-123"}'
expect "API đăng ký bằng mật khẩu đã tắt => 410" 410
api POST /api/auth/login '{"username":"old-account","password":"password-123"}'
expect "API đăng nhập bằng mật khẩu đã tắt => 410" 410
api POST /api/auth/google '{"id_token":"invalid"}'
expect "Google token không hợp lệ => 401" 401
api GET /api/auth/me
expect "auth/me không phiên => 401" 401
expect_field "báo cần đăng nhập" needs_auth true
api GET /api/auth/me '' "$TOK_A"
expect "auth/me có phiên => 200" 200
expect_field "user.username khớp" user.username "$U_A"
api GET /api/auth/me '' "$TOK_OLD"
expect "phiên tài khoản cũ không có Google UID => 401" 401
expect_field "lý do yêu cầu đăng nhập Google" reason google_required

echo "== 2. phòng + đọc dữ liệu =="
api POST /api/rooms "{\"name\":\"Smoke A $NS\",\"pin\":\"123123\",\"owner_name\":\"Alice Chủ\"}" "$TOK_A"
expect "tạo phòng A => 200" 200
RA="$(get room.room_id)"
expect_field "room_id là slug" room.room_id "smoke-a-$NS"
expect_field "người tạo là chủ" room.role owner
api POST /api/rooms "{\"name\":\"Smoke B $NS\",\"pin\":\"456456\"}" "$TOK_A"
expect "tạo phòng B => 200" 200
RB="$(get room.room_id)"
api GET /api/auth/me '' "$TOK_A"
expect "cùng tài khoản liệt kê được hai phòng => 200" 200
expect_field "phòng A nằm trong danh sách" rooms.0.room_id "$RA"
expect_field "tài khoản là chủ ở phòng A" rooms.0.role owner
expect_field "phòng B nằm trong danh sách" rooms.1.room_id "$RB"
expect_field "tài khoản là chủ ở phòng B" rooms.1.role owner
api GET "/api/data?p=$RA"
expect "GET /api/data không phiên => 401" 401
api GET "/api/data?p=$RA" '' "$TOK_A"
expect "GET /api/data có phiên => 200" 200
expect_field "me.role owner" me.role owner
expect_field "me.is_owner" me.is_owner true
expect_field "payload KHÔNG trả admin_pin_hash" settings.admin_pin_hash ""
expect_field "phòng A có dữ liệu/cài đặt riêng" settings.room_name "Smoke A $NS"
expect_field "bật duyệt thành viên mặc định" settings.join_approval 1
api GET "/api/data?p=$RB" '' "$TOK_A"
expect "cùng tài khoản truy cập phòng B => 200" 200
expect_field "phòng B có hồ sơ chủ riêng" me.role owner
expect_field "phòng B có dữ liệu/cài đặt riêng" settings.room_name "Smoke B $NS"
expect_field "phòng mới bật duyệt mặc định" settings.join_approval 1

echo "== 3. thành viên + duyệt link mời =="
api POST "/api/admin/members?p=$RA" "{\"name\":\"Thành Viên Một\",\"nickname\":\"M1\",\"phone\":\"0900000001\"}" "$TOK_A"
expect "thêm M1" 200
M1="$(get id)"
api POST "/api/admin/members?p=$RA" "{\"name\":\"Thành Viên Hai\",\"nickname\":\"M2\",\"phone\":\"0900000002\"}" "$TOK_A"
expect "thêm M2" 200
M2="$(get id)"
api POST "/api/admin/members?p=$RA" "{\"name\":\"Thành Viên Ba\",\"nickname\":\"M3\"}" "$TOK_A"
expect "thêm M3" 200
M3="$(get id)"
api POST "/api/admin/members?p=$RA" "{\"name\":\"Thành Viên Bốn\",\"nickname\":\"M4\"}" "$TOK_A"
expect "thêm M4" 200
M4="$(get id)"

api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$M1\"}" "$TOK_A"
expect "tạo link member" 200
INV1="$(get token)"
expect_field "link chỉ cấp role member" role member
api GET "/api/invites/$INV1"
expect "xem trước link không cần đăng nhập => 200" 200
expect_field "preview đúng người" member_name "Thành Viên Một"
expect_field "preview đúng quyền ban đầu" role member

api POST /api/invites/claim "{\"token\":\"$INV1\"}" "$TOK_B"
expect "Bob nhận link member => 200" 200
expect_field "yêu cầu chờ chủ duyệt" pending true
api POST /api/invites/claim "{\"token\":\"$INV1\"}" "$TOK_B"
expect "dùng lại link đã nhận => 410" 410
api GET /api/auth/me '' "$TOK_B"
expect_field "tài khoản thấy yêu cầu đang chờ" pending_requests.0.room_id "$RA"
api GET "/api/admin/join-requests?p=$RA" '' "$TOK_A"
expect "chủ xem được danh sách duyệt => 200" 200
expect_field "yêu cầu gắn đúng hồ sơ" requests.0.member_id "$M1"
JOIN1="$(get requests.0.id)"
api GET "/api/data?p=$RA" '' "$TOK_B"
expect "chưa duyệt thì chưa đọc được sổ => 403" 403
api POST "/api/admin/join-requests/$JOIN1/approve?p=$RA" '{}' "$TOK_A"
expect "chủ duyệt yêu cầu => 200" 200
api POST "/api/admin/members/$M1/role?p=$RA" '{"role":"viewer"}' "$TOK_A"
expect "chủ đổi role sau khi vào phòng => 200" 200
api GET /api/auth/me '' "$TOK_B"
expect_field "hết yêu cầu chờ sau khi duyệt" pending_requests.0.id ""
api GET "/api/data?p=$RA" '' "$TOK_B"
expect "sau khi duyệt viewer đọc được sổ" 200
expect_field "role nhận được là viewer" me.role viewer
expect_field "viewer có me.role viewer" me.role viewer
expect_field "viewer không thấy SĐT người khác" members.2.phone ""
expect_field "thành viên đã nhận tài khoản" members.1.has_account true
api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$M4\"}" "$TOK_A"
expect "tạo link cho yêu cầu sẽ bị từ chối" 200
INV_REJECT="$(get token)"
api POST /api/invites/claim "{\"token\":\"$INV_REJECT\"}" "$TOK_E"
expect_field "Erin gửi yêu cầu chờ duyệt" pending true
api GET "/api/admin/join-requests?p=$RA" '' "$TOK_A"
JOIN_REJECT="$(get requests.0.id)"
expect_field "yêu cầu mới thuộc M4" requests.0.member_id "$M4"
api POST "/api/admin/join-requests/$JOIN_REJECT/reject?p=$RA" '{}' "$TOK_A"
expect "chủ từ chối yêu cầu => 200" 200
api GET /api/auth/me '' "$TOK_E"
expect_field "tài khoản nhận được trạng thái bị từ chối" pending_requests.0.status rejected
api POST "/api/admin/settings?p=$RA" '{"join_approval":"0"}' "$TOK_A"
expect "chủ tắt chế độ duyệt => 200" 200
api GET "/api/data?p=$RA" '' "$TOK_A"
expect_field "setting tắt duyệt được lưu" settings.join_approval 0
api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$M2\"}" "$TOK_A"
expect "tạo link sau khi tắt duyệt" 200
INV2="$(get token)"
api GET "/api/invites/$INV2"
expect_field "preview báo không cần duyệt" requires_approval false

echo "== 4. viewer bị chặn ghi =="
api POST "/api/member/toggle-share-paid?p=$RA" '{"period_id":"2026-10","is_paid":true}' "$TOK_B"
expect "viewer tự tick => 403" 403
api POST "/api/admin/expenses?p=$RA" "{\"title\":\"Điện\",\"amount\":100000,\"period_id\":\"2026-10\"}" "$TOK_B"
expect "viewer ghi khoản => 403" 403
api POST "/api/admin/settings?p=$RA" '{"room_name":"Hack"}' "$TOK_B"
expect "viewer đổi cài đặt => 403" 403
api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$M2\"}" "$TOK_B"
expect "viewer mời người => 403" 403
api POST "/api/admin/members?p=$RA" '{"name":"Người Lạ"}' "$TOK_B"
expect "viewer thêm thành viên => 403" 403

echo "== 5. rời phòng / ngưng hoạt động giữ lịch sử =="
api POST "/api/rooms/leave?p=$RA" '{}' "$TOK_B"
expect "viewer tự rời phòng => 200" 200
api GET "/api/data?p=$RA" '' "$TOK_B"
expect "rời xong mất quyền đọc ngay => 403" 403
api GET "/api/data?p=$RA" '' "$TOK_A"
expect_field "người đã rời vẫn nằm trong sổ" members.1.is_active 0
api POST "/api/admin/members/$M1/reactivate?p=$RA" '' "$TOK_A"
expect "thêm lại người đã rời => 200" 200
api GET "/api/data?p=$RA" '' "$TOK_B"
expect "tài khoản cũ đọc lại được (membership giữ nguyên) => 200" 200

echo "== 6. member tự tick, không ghi sổ =="
api POST /api/invites/claim "{\"token\":\"$INV2\"}" "$TOK_C"
expect "Carol nhận link member => 200" 200
api GET "/api/data?p=$RA" '' "$TOK_C"
expect_field "Carol là member" me.role member
api POST "/api/member/toggle-share-paid?p=$RA" '{"period_id":"2026-10","is_paid":true,"paid_amount":50000}' "$TOK_C"
expect "member tự tick phần mình => 200" 200
api POST "/api/admin/toggle-share-paid?p=$RA" "{\"period_id\":\"2026-10\",\"member_id\":\"$M3\",\"is_paid\":true}" "$TOK_C"
expect "member tick hộ người khác => 403" 403
api POST "/api/admin/expenses?p=$RA" "{\"title\":\"Nước\",\"amount\":20000,\"period_id\":\"2026-10\"}" "$TOK_C"
expect "member ghi khoản => 403" 403
api GET "/api/data?p=$RA" '' "$TOK_A"
expect_field "khoản Carol đã tick lưu đúng member" member_shares.0.member_id "$M2"
expect_field "số tiền từng phần lưu đúng" member_shares.0.paid_amount 50000

echo "== 7. manager: ghi sổ được, cài đặt thì không =="
api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$M3\"}" "$TOK_A"
expect "chủ tạo link member" 200
INV3="$(get token)"
api POST /api/invites/claim "{\"token\":\"$INV3\"}" "$TOK_D"
expect "Dave nhận link member => 200" 200
api POST "/api/admin/members/$M3/role?p=$RA" '{"role":"manager"}' "$TOK_A"
expect "chủ nâng role sau khi vào phòng => 200" 200
api GET "/api/data?p=$RA" '' "$TOK_D"
expect_field "Dave là manager" me.role manager
api POST "/api/admin/expenses?p=$RA" "{\"title\":\"Wifi\",\"amount\":90000,\"period_id\":\"2026-10\"}" "$TOK_D"
expect "manager ghi khoản => 200" 200
api POST "/api/admin/settings?p=$RA" '{"room_name":"Hack"}' "$TOK_D"
expect "manager đổi cài đặt => 403" 403
api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$M4\",\"role\":\"manager\"}" "$TOK_D"
expect "invite không thể cấp manager trực tiếp => 400" 400
api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$M4\"}" "$TOK_D"
expect "manager chỉ cấp link member => 200" 200
INV4="$(get token)"
api POST "/api/admin/periods?p=$RA" "{\"id\":\"period_smoke_$NS\",\"title\":\"Kỳ Smoke\"}" "$TOK_D"
expect "manager tạo kỳ => 200" 200
api DELETE "/api/admin/periods/period_smoke_$NS?p=$RA" '' "$TOK_D"
expect "manager xóa kỳ => 403" 403
api DELETE "/api/admin/periods/period_smoke_$NS?p=$RA" '' "$TOK_A"
expect "chủ xóa kỳ => 200" 200
api POST "/api/admin/members/$M1/deactivate?p=$RA" '' "$TOK_D"
expect "manager ngưng người cấp dưới => 200" 200
api GET "/api/data?p=$RA" '' "$TOK_B"
expect "bị ngưng thì mất quyền đọc ngay => 403" 403
api POST "/api/admin/members/$M1/reactivate?p=$RA" '' "$TOK_D"
expect "manager thêm lại người cấp dưới => 200" 200
api GET "/api/data?p=$RA" '' "$TOK_B"
expect "thêm lại thì đọc lại được => 200" 200

echo "== 8. giao phòng + rời phòng =="
api POST "/api/rooms/leave?p=$RA" '{}' "$TOK_A"
expect "chủ phòng tự rời => 409" 409
api POST "/api/admin/transfer-owner?p=$RA" "{\"member_id\":\"$M4\"}" "$TOK_A"
expect "giao cho người chưa có tài khoản => 409" 409
api POST /api/invites/claim "{\"token\":\"$INV4\"}" "$TOK_C"
expect "người đã là thành viên nhận link khác => 409" 409
api POST /api/invites/claim "{\"token\":\"$INV4\"}" "$TOK_F"
expect "Frank nhận link member => 200" 200
api POST "/api/admin/transfer-owner?p=$RA" "{\"member_id\":\"$M2\"}" "$TOK_A"
expect "giao phòng cho người có tài khoản => 200" 200
api GET "/api/data?p=$RA" '' "$TOK_A"
expect_field "chủ cũ hạ xuống manager" me.role manager
api POST "/api/rooms/leave?p=$RA" '{}' "$TOK_A"
expect "chủ cũ rời phòng sau khi giao => 200" 200
api GET "/api/data?p=$RA" '' "$TOK_A"
expect "chủ cũ mất quyền đọc => 403" 403
api GET "/api/data?p=$RA" '' "$TOK_C"
expect_field "chủ mới là owner" me.role owner
api POST "/api/rooms/leave?p=$RA" '{}' "$TOK_C"
expect "chủ mới tự rời => 409" 409

echo "== 9. khôi phục chủ phòng bằng PIN =="
api POST "/api/rooms/recover-owner?p=$RB" '{"pin":"999999","new_pin":"654654"}' "$TOK_R"
expect "sai PIN => 403" 403
api POST "/api/rooms/recover-owner?p=$RB" '{"pin":"456456","new_pin":"654654"}' "$TOK_R"
expect "đúng PIN => 200" 200
TOK_R="$(get token)"
expect_field "tài khoản khôi phục là chủ" role owner
MB_OWNER="$(get member_id)"
api GET "/api/data?p=$RB" '' "$TOK_R"
expect "phiên khôi phục đọc được phòng" 200
expect_field "me.is_owner" me.is_owner true
expect_field "chủ phòng cũ (owner member) giữ nguyên" me.member_id "$MB_OWNER"
api GET "/api/data?p=$RB" '' "$TOK_A"
expect "tài khoản cũ mất phòng B => 403" 403
api POST "/api/rooms/recover-owner?p=$RB" '{"pin":"456456","new_pin":"111111"}' "$TOK_R"
expect "PIN cũ đã chết => 403" 403
for i in 1 2 3 4; do
  api POST "/api/rooms/recover-owner?p=$RB" '{"pin":"456456","new_pin":"111111"}' "$TOK_R"
done
expect "5 lần sai PIN liên tiếp => 403" 403
api POST "/api/rooms/recover-owner?p=$RB" '{"pin":"456456","new_pin":"111111"}' "$TOK_R"
expect "lần sai thứ 6 => 429" 429
api GET /api/auth/me '' "$TOK_R"
expect "phiên Google sau recovery vẫn hợp lệ" 200

echo "== 10. endpoint PIN cũ đã bị xóa =="
api POST /api/join '{"token":"whatever"}' "$TOK_R"
expect "/api/join => 404" 404
api POST /api/admin/verify '{}' "$TOK_R"
expect "/api/admin/verify => 404" 404
api POST "/api/admin/members/$M1/deactivate?p=$RA" '' "$TOK_R"
expect "người ngoài phòng không thao tác được => 403" 403

echo "== 11. danh sách phòng của tài khoản =="
api GET /api/auth/me '' "$TOK_A"
expect "Alice vẫn đăng nhập được" 200
expect_field "Alice không còn phòng nào" rooms.0.room_id ""

echo
echo "===== KET QUA: $PASS pass / $FAIL fail ====="
[ "$FAIL" = 0 ] || exit 1
