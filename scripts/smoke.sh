#!/usr/bin/env bash
# Smoke test đa phòng, chạy trên D1 LOCAL (không đụng production).
#   1) npm run build
#   2) npm run dev:server
#   3) bash scripts/smoke.sh
#
# Script tự tạo HAI phòng scratch qua API với PIN của chính nó, mọi assertion đi qua HTTP,
# và dọn sạch bằng SQL ở cuối (kể cả khi fail).

set -uo pipefail
API="${API:-http://127.0.0.1:8788}"
NS=$(date +%s)
RA="phong-smoke-a-$NS"
RB="phong-smoke-b-$NS"
DB_NAME="${DB_NAME:-phong_chi_tieu_db}"
PASS=0; FAIL=0

sha256() { python3 -c "import hashlib,sys;print(hashlib.sha256(sys.argv[1].encode()).hexdigest())" "$1"; }
HASH_A="$(sha256 'pin-phong-a')"
HASH_B="$(sha256 'pin-phong-b')"

api() { # api METHOD PATH [json] [admin-hash] [bearer]
  local m=$1 p=$2 j=${3:-} h=${4:-} b=${5:-}
  local args=(-s --max-time 20 -X "$m" -w '\n%{http_code}' "$API$p" -H 'Content-Type: application/json')
  [ -n "$h" ] && args+=(-H "x-admin-hash: $h")
  [ -n "$b" ] && args+=(-H "Authorization: Bearer $b")
  [ -n "$j" ] && args+=(-d "$j")
  local out; out="$(curl "${args[@]}")"
  HTTP_CODE="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}

# get <duong-dan> - theo 'a.b.0.c'; in '' neu khong co
get() { python3 -c "
import json,sys
try: d=json.loads(sys.argv[1])
except Exception: sys.exit(0)
for k in sys.argv[2].split('.'):
    if isinstance(d,list):
        try: d=d[int(k)]
        except Exception: d=None
    elif isinstance(d,dict): d=d.get(k)
    else: d=None
    if d is None: break
print('' if d is None else (json.dumps(d) if isinstance(d,(list,dict,bool)) else d))" "$BODY" "$1"; }

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1  -> HTTP $HTTP_CODE · ${BODY:0:180}"; FAIL=$((FAIL+1)); }
expect(){ # expect <mo-ta> <http-mong-doi>
  if [ "$HTTP_CODE" = "$2" ]; then ok "$1 ($2)"; else bad "$1 (muon $2)"; fi
}
expect_field(){ # expect_field <mo-ta> <duong-dan> <gia-tri-mong-doi>
  local v; v="$(get "$2")"
  if [ "$v" = "$3" ]; then ok "$1"; else bad "$1: '$v' != '$3'"; fi
}

purge() {
  # Quet theo prefix 'smoke-a-'/'smoke-b-' (khong dung ten day du) de don ca
  # phong sot lai tu nhung lan chay cu, va khong an loi cua wrangler nua.
  npx wrangler d1 execute "$DB_NAME" --local --command="
    DELETE FROM member_shares WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%';
    DELETE FROM periods WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%';
    DELETE FROM expenses WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%';
    DELETE FROM members WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%';
    DELETE FROM settings WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%';
    DELETE FROM invites WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%';
    DELETE FROM sessions WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%';
    DELETE FROM rooms WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%';" 2>&1 | grep -c '"success": true' | sed 's/^/  purge: \/8 statement OK -> /'
}
trap 'purge; echo "  (đã dọn $RA / $RB)"' EXIT

if ! curl -s --max-time 3 -o /dev/null "$API/api/data"; then
  echo "Không gọi được $API - chạy 'npm run build' rồi 'npm run dev:server' trước."; exit 2
fi
purge

echo "== 0. tuong lui: thieu ?p van ra phong cu =="
api GET /api/data
expect "GET /api/data 200" 200
expect_field "thieu ?p => phong-2a" room_id phong-2a

echo "== 1. tu tao phong =="
api POST /api/rooms "{\"name\":\"Phòng Smoke A $NS\",\"pin_hash\":\"$HASH_A\",\"owner_name\":\"Chu Phong A\"}"
expect "POST /api/rooms 200" 200
expect_field "slug sinh tu ten (bo dau)" room_id "$RA"
api POST /api/rooms "{\"name\":\"Phòng Smoke B $NS\",\"pin_hash\":\"$HASH_B\",\"owner_name\":\"Chu Phong B\"}"
expect "tao phong thu hai 200" 200
api POST /api/rooms "{\"name\":\"Phòng Smoke A $NS\",\"pin_hash\":\"$HASH_A\"}"
expect "ten trung => 409" 409
api POST /api/rooms '{"name":"x","pin_hash":"deadbeef"}'
expect "ten qua ngan / pin sai dinh dang => 400" 400
api GET "/api/data?p=$RA"
expect_field "phong moi co 1 thanh vien chu" 'members.0.name' 'Chu Phong A'
api GET "/api/data?p=phong-khong-ton-tai"
expect "phong khong ton tai => 404" 404
expect_field "404 kem need_invite" need_invite true
api GET "/api/data?p=PHONG%20SAI"
expect "slug sai cu phap => 400" 400

echo "== 2. PIN rieng tung phong =="
api POST "/api/admin/verify?p=$RA" "{\"pin_hash\":\"$HASH_A\"}"
expect_field "PIN dung cua A" valid true
api POST "/api/admin/verify?p=$RA" "{\"pin_hash\":\"$HASH_B\"}"
expect_field "PIN cua B khong dung duoc o A" valid false
api POST "/api/admin/periods?p=$RA" '{"id":"2026-11","title":"T"}' "$HASH_B"
expect "ghi A bang PIN B => 401" 401
# phong cu (chua migrate PIN) khong con accept hash mac dinh 123456 neu DB loi; o day
# phong-2a van giu hash cu trong settings nen khong doan duoc dieu nay - kiem tra thu cong.

echo "== 3. XUNG DOT KY: hai phong cung tao 2026-11 (loi #1 trong plan) =="
api POST "/api/admin/periods?p=$RA" '{"id":"2026-11","title":"Tháng 11/2026 A"}' "$HASH_A"
expect "A tao ky 2026-11" 200
api POST "/api/admin/periods?p=$RB" '{"id":"2026-11","title":"Tháng 11/2026 B"}' "$HASH_B"
expect "B tao CUNG ky 2026-11" 200
api GET "/api/data?p=$RA"; MEMA="$(get 'members.0.id')"
api GET "/api/data?p=$RB"; MEMB="$(get 'members.0.id')"
if [ -z "$MEMA" ] || [ -z "$MEMB" ]; then
  bad "khong lay duoc member_id cua hai phong scratch ($MEMA / $MEMB) - dung test"
  echo; echo "===== KET QUA: $PASS pass / $FAIL fail ====="; exit 1
fi
ok "lay duoc member_id cua ca hai phong"
api POST "/api/admin/toggle-share-paid?p=$RA" "{\"period_id\":\"2026-11\",\"member_id\":\"$MEMA\",\"is_paid\":1,\"paid_amount\":250000}" "$HASH_A"
expect "A ghi share 250k" 200
api POST "/api/admin/toggle-share-paid?p=$RB" "{\"period_id\":\"2026-11\",\"member_id\":\"$MEMB\",\"is_paid\":0,\"paid_amount\":1}" "$HASH_B"
expect "B ghi share 1d" 200
api GET "/api/data?p=$RA"
expect_field "share CUA A khong bi B de" 'member_shares.0.paid_amount' 250000
expect_field "A khong thay member cua B" 'members.0.name' 'Chu Phong A'
api GET "/api/data?p=$RB"
expect_field "share CUA B van la 1d (khong bi A de)" 'member_shares.0.paid_amount' 1

echo "== 4. member id cua phong khac bi chan (chong re-parent) =="
api POST "/api/admin/members?p=$RA" "{\"id\":\"$MEMB\",\"name\":\"đánh cắp\"}" "$HASH_A"
expect "upsert member cua B vao A => 409" 409
api GET "/api/data?p=$RB"
expect_field "B van con member cua minh" 'members.0.name' 'Chu Phong B'

echo "== 5. link moi (single-use) =="
api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$MEMA\",\"ttl_min\":15,\"uses\":1}" "$HASH_A"
expect "tao link 200" 200
TOKEN="$(get token)"
[ -n "$TOKEN" ] && ok "token tra ve 1 lan (${#TOKEN} ký tự)" || bad "thieu token"
expect_field "tuoi link 15 phut" ttl_min 15
api POST "/api/admin/invites?p=$RA" '{"member_id":"mem-khong-co-that"}' "$HASH_A"
expect "moi cho member la => 404" 404

echo "== 6. join + session =="
api POST /api/join "{\"token\":\"$TOKEN\",\"name\":\"Người Được Mời\"}"
expect "join lan 1 => 200" 200
SESSION="$(get 'session.token')"
expect_field "join tra dung room_id" room_id "$RA"
expect_field "join cap nhat ten member" 'member_name' 'Người Được Mời'
api POST /api/join "{\"token\":\"$TOKEN\"}"
expect "dung link lan 2 => 410" 410
api POST /api/join '{"token":"quan-ngan"}'
expect "token qua ngan => 400" 400
api GET "/api/data?p=$RA"
expect_field "member da claim ten qua link" 'members.0.name' 'Người Được Mời'

echo "== 7. me + tu tick da nop (khong can PIN admin) =="
api GET "/api/me?p=$RA" '' '' "$SESSION"
expect "GET /api/me => 200" 200
expect_field "me dung member_id" member_id "$MEMA"
expect_field "role cua me" role member
api POST "/api/member/toggle-share-paid?p=$RA" '{"period_id":"2026-11","is_paid":1,"paid_amount":90000}' '' "$SESSION"
expect "member tu tick => 200" 200
api GET "/api/data?p=$RA"
expect_field "server ghi dung so member tu khai" 'member_shares.0.paid_amount' 90000
api POST "/api/member/toggle-share-paid?p=$RB" '{"period_id":"2026-11","is_paid":1}' '' "$SESSION"
expect "session A dung o B => 403" 403
api GET "/api/me?p=$RA" '' '' 'token-khong-co-that'
expect "token la => 401" 401
api POST "/api/member/toggle-share-paid?p=$RA" '{"period_id":"khong-phai-ky","is_paid":1}' '' "$SESSION"
expect "ky sai dinh dang => 400" 400

echo "== 8. da nguoi khoi phong =="
api POST "/api/admin/revoke?p=$RA" "{\"member_id\":\"$MEMA\"}" "$HASH_A"
expect "revoke => 200" 200
api GET "/api/me?p=$RA" '' '' "$SESSION"
expect "request ke tiep => 401" 401
expect_field "ly do thu hoi" reason revoked
api POST "/api/member/toggle-share-paid?p=$RA" '{"period_id":"2026-11","is_paid":1}' '' "$SESSION"
expect "ghi bi chan sau revoke => 401" 401

echo "== 9. link het han =="
api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$MEMA\",\"ttl_min\":1}" "$HASH_A"
T2="$(get token)"
npx wrangler d1 execute "$DB_NAME" --local --command="UPDATE invites SET expires_at='2020-01-01T00:00:00Z' WHERE room_id='$RA';" >/dev/null 2>&1
api POST /api/join "{\"token\":\"$T2\"}"
expect "link qua han => 410" 410

echo "== 10. tao link moi vo hieu hoa link cu =="
api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$MEMA\"}" "$HASH_A"
T3="$(get token)"
api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$MEMA\"}" "$HASH_A"
T4="$(get token)"
api POST /api/join "{\"token\":\"$T3\"}"
expect "link cu bi thay the => 410/404" 404

echo
echo "===== KET QUA: $PASS pass / $FAIL fail ====="
[ "$FAIL" = 0 ] || exit 1
