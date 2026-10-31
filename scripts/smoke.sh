#!/usr/bin/env bash
# Smoke test đa phòng, chạy trên D1 LOCAL (không đụng production).
#   1) npm run build
#   2) npm run dev:server
#   3) bash scripts/smoke.sh
#
# Script tự tạo BA phòng scratch qua API với PIN của chính nó, mọi assertion đi qua HTTP,
# và dọn sạch bằng SQL ở cuối (kể cả khi fail).
#   A, B - đa phòng: slug, PIN riêng, kỳ không đè nhau, link mời một lượt, ba mức quyền.
#   C    - không có chủ phòng, để đo riêng guard "phòng còn lại một người".

set -uo pipefail
API="${API:-http://127.0.0.1:8788}"
NS=$(date +%s)
RA="phong-smoke-a-$NS"
RB="phong-smoke-b-$NS"
# Phòng C dựng ở mục 17: KHONG có owner (POST /api/rooms cho phép bỏ owner_name) để đo
# riêng guard "phòng phải còn ít nhất một người active", không lẫn với guard chủ phòng.
RC="phong-smoke-c-$NS"
DB_NAME="${DB_NAME:-phong_chi_tieu_db}"
PASS=0; FAIL=0

sha256() { python3 -c "import hashlib,sys;print(hashlib.sha256(sys.argv[1].encode()).hexdigest())" "$1"; }
HASH_A="$(sha256 'pin-phong-a')"
HASH_B="$(sha256 'pin-phong-b')"
HASH_C="$(sha256 'pin-phong-c')"

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
# hasval <mang> <truong> <gia-tri> -> 1 khi co mot phan tu cua mang co truong bang gia tri
hasval() { python3 -c "
import json,sys
try: d=json.loads(sys.argv[1])
except Exception: print(0); raise SystemExit
arr=d.get(sys.argv[2]) or []
print(1 if any(str(x.get(sys.argv[3]))==sys.argv[4] for x in arr) else 0)" "$BODY" "$1" "$2" "$3"; }
expect_has(){ # expect_has <mo-ta> <mang> <truong> <gia-tri>
  local v; v="$(hasval "$2" "$3" "$4")"
  if [ "$v" = 1 ]; then ok "$1"; else bad "$1: không tìm thấy '$3=$4' trong $2"; fi
}
expect_len(){ # expect_len <mo-ta> <mang> <so-phan-tu-mong-doi>
  local v; v="$(python3 -c "
import json,sys
try: d=json.loads(sys.argv[1])
except Exception: print(-1); raise SystemExit
print(len(d.get(sys.argv[2]) or []))" "$BODY" "$2")"
  if [ "$v" = "$3" ]; then ok "$1"; else bad "$1: count=$v mong=$3"; fi
}

purge() {
  # Quet theo prefix 'smoke-a-'/'smoke-b-' (khong dung ten day du) de don ca
  # phong sot lai tu nhung lan chay cu, va khong an loi cua wrangler nua.
  npx wrangler d1 execute "$DB_NAME" --local --command="
    DELETE FROM member_shares WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%' OR room_id LIKE '%smoke-c-%';
    DELETE FROM periods WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%' OR room_id LIKE '%smoke-c-%';
    DELETE FROM expenses WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%' OR room_id LIKE '%smoke-c-%';
    DELETE FROM members WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%' OR room_id LIKE '%smoke-c-%';
    DELETE FROM settings WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%' OR room_id LIKE '%smoke-c-%';
    DELETE FROM invites WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%' OR room_id LIKE '%smoke-c-%';
    DELETE FROM sessions WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%' OR room_id LIKE '%smoke-c-%';
    DELETE FROM rooms WHERE room_id LIKE '%smoke-a-%' OR room_id LIKE '%smoke-b-%' OR room_id LIKE '%smoke-c-%';" 2>&1 | grep -c '"success": true' | sed 's/^/  purge: \/8 statement OK -> /'
}
trap 'purge; echo "  (đã dọn $RA / $RB / $RC)"' EXIT

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

echo "== 11. schema 003: duong ghi khong bi 503 nua =="
api POST "/api/admin/periods?p=$RB" '{"id":"2026-12","title":"Tháng 12/2026 B"}' "$HASH_B"
expect "ghi sau khi migrate 003 => 200 (khong 503)" 200

echo "== 12. ba muc quyen cua link moi =="
api POST "/api/admin/members?p=$RA" '{"name":"Thành Viên Hai"}' "$HASH_A"
expect "them thanh vien thu 2 vao A" 200
MEMA2="$(get id)"
api GET "/api/data?p=$RA"
expect_field "chong phong duoc stamp dung chu" owner_member_id "$MEMA"
api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$MEMA2\",\"role\":\"viewer\"}" "$HASH_A"
expect "moi muc viewer => 200" 200
expect_field "link ghi role viewer" role viewer
TV="$(get token)"
api POST /api/join "{\"token\":\"$TV\"}"
expect "join bang link viewer => 200" 200
expect_field "role tu link vao phien" role viewer
SV="$(get 'session.token')"
api GET "/api/me?p=$RA" '' '' "$SV"
expect_field "GET /api/me tra role viewer" role viewer
api POST "/api/member/toggle-share-paid?p=$RA" '{"period_id":"2026-11","is_paid":1}' '' "$SV"
expect "viewer tu tick => 403" 403
api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$MEMA2\",\"role\":\"manager\"}" "$HASH_A"
expect "moi muc manager => 200" 200
TM="$(get token)"
api POST /api/join "{\"token\":\"$TM\"}"
expect "join bang link manager => 200" 200
SM="$(get 'session.token')"

echo "== 13. manager: moi + thu hoi duoc, sua sổ khong =="
api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$MEMA\"}" '' "$SM"
expect "manager tao link chi bang Bearer (khong PIN) => 200" 200
expect_field "mac dinh cua link manager la member" role member
api POST "/api/admin/settings?p=$RA" '{"room_name":"đổi tráo"}' '' "$SM"
expect "manager ghi settings => 401" 401
api POST "/api/admin/periods?p=$RA" '{"id":"2027-01","title":"x"}' '' "$SM"
expect "manager tao ky => 401" 401
api POST "/api/admin/expenses?p=$RA" '{"title":"x","amount":1000,"category":"nuoc","period_id":"2026-11"}' '' "$SM"
expect "manager them khoan chi => 401" 401
api GET "/api/data?p=$RA"
expect_field "khong ghi duoc nen setting khong doi" 'settings.room_name' "Phòng Smoke A $NS"
expect_len "khong ky naò lem vào phòng A" periods 1
api POST "/api/admin/revoke?p=$RA" "{\"member_id\":\"$MEMA2\"}" '' "$SM"
expect "manager thu hoi phien cua chinh no => 200" 200
api GET "/api/me?p=$RA" '' '' "$SM"
expect "phien manager chet ngay sau do => 401" 401
expect_field "ly do thu hoi" reason revoked

echo "== 14. chu phong khong tu xoa duoc minh =="
api DELETE "/api/admin/members/$MEMA?p=$RA" '' "$HASH_A"
expect "xoa chu phong => 409" 409
api GET "/api/data?p=$RA"
expect_has "chu phong van con trong so" members id "$MEMA"

echo "== 15. ngung hoat dong gi lai lịch sử tien =="
api POST "/api/admin/toggle-share-paid?p=$RA" "{\"period_id\":\"2026-11\",\"member_id\":\"$MEMA2\",\"is_paid\":1,\"paid_amount\":400000}" "$HASH_A"
expect "ghi phien cua thanh vien 2" 200
api GET "/api/data?p=$RA"
SHARES_BEFORE="$(python3 -c "import json,sys;print(len(json.loads(sys.argv[1])['member_shares']))" "$BODY")"
api DELETE "/api/admin/members/$MEMA2?p=$RA" '' "$HASH_A"
expect "ngung hoat dong => 200" 200
expect_field "server noi ro la ngung chu khong phai xoa" deactivated true
api GET "/api/data?p=$RA"
expect_has "nhan vat da roi van con trong dan sach ky cu" members id "$MEMA2"
expect_len "số phần chưa giảm khi có người rời" member_shares "$SHARES_BEFORE"
expect_has "phần tiền 400k của người rời còn nguyên" member_shares member_id "$MEMA2"

echo "== 16. ro phong: bang phien va bang PIN =="
api POST "/api/admin/members?p=$RA" '{"name":"Người Rời"}' "$HASH_A"
MEMA3="$(get id)"
api POST "/api/admin/invites?p=$RA" "{\"member_id\":\"$MEMA3\"}" "$HASH_A"
T5="$(get token)"
api POST /api/join "{\"token\":\"$T5\"}"
expect "Người Rời vào phòng bang link" 200
S5="$(get 'session.token')"
api POST "/api/rooms/leave?p=$RA" '{}' '' "$S5"
expect "ro phong bang phien => 200" 200
expect_field "server ghi ro là tự rời, không phải bị xóa" left true
api GET "/api/me?p=$RA" '' '' "$S5"
expect "phien het hieu luc ngay sau khi ro => 401" 401
api GET "/api/data?p=$RA"
expect_has "người đã ro vẫn còn trong kỳ cu" members id "$MEMA3"
api POST "/api/rooms/leave?p=$RA" "{\"member_id\":\"$MEMA\"}" "$HASH_A"
expect "chủ phòng ro bang PIN => 409" 409
api POST "/api/admin/transfer-owner?p=$RA" "{\"member_id\":\"$MEMA2\"}" "$HASH_A"
expect "giao phong cho người đã ngung => 409" 409
api POST "/api/admin/members?p=$RA" "{\"id\":\"$MEMA2\",\"name\":\"Thành Viên Hai\",\"is_active\":1}" "$HASH_A"
expect "them lại người đã ro" 200
api POST "/api/admin/transfer-owner?p=$RA" "{\"member_id\":\"$MEMA2\"}" "$HASH_A"
expect "giao phong cho người đang hoat dong => 200" 200
api GET "/api/data?p=$RA"
expect_field "chủ mới nằm trong rooms" owner_member_id "$MEMA2"
api POST "/api/rooms/leave?p=$RA" "{\"member_id\":\"$MEMA\"}" "$HASH_A"
expect "chủ cu ro duoc sau khi giao phong => 200" 200

echo "== 17. phòng khong duoc mat người cuoi cung =="
api POST /api/rooms "{\"name\":\"Phòng Smoke C $NS\",\"pin_hash\":\"$HASH_C\"}"
expect "tao phong C khong dat chu phong" 200
expect_field "slug phong C" room_id "$RC"
api POST "/api/admin/members?p=$RC" '{"name":"Người Một"}' "$HASH_C"
expect "them người 1" 200
C1="$(get id)"
api POST "/api/admin/members?p=$RC" '{"name":"Người Hai"}' "$HASH_C"
C2="$(get id)"
api DELETE "/api/admin/members/$C1?p=$RC" '' "$HASH_C"
expect "con người khac nen ngung duoc => 200" 200
api DELETE "/api/admin/members/$C2?p=$RC" '' "$HASH_C"
expect "người active cuoi cung => 409" 409
api POST "/api/rooms/leave?p=$RC" "{\"member_id\":\"$C2\"}" "$HASH_C"
expect "ro phong bang PIN cung bi chan giong xoa => 409" 409
api GET "/api/data?p=$RC"
expect_has "người bi ngung van duoc liet ke" members id "$C1"

echo
echo "===== KET QUA: $PASS pass / $FAIL fail ====="
[ "$FAIL" = 0 ] || exit 1
