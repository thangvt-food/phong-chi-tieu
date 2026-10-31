#!/usr/bin/env bash
# Chạy di cư production cho nhiều phòng (PR6).
#
#   bash scripts/pr6-deploy.sh              # in ra lệnh sẽ chạy, không đụng prod
#   bash scripts/pr6-deploy.sh --yes        # chạy thật
#   bash scripts/pr6-deploy.sh --rotate-pin # riêng bước đổi PIN
#   bash scripts/pr6-deploy.sh --rollback .wrangler/pre-mt-2026-10-31.sql --yes
#
# Thứ tự BẮT BUỘC là migrate trước, deploy sau. Đã đo cả hai chiều bằng cách
# chạy code cũ trên schema mới và ngược lại: code mới + schema cũ làm GET /api/data
# trả 500 (sập app với mọi người), còn code cũ + schema mới thì đọc vẫn 200 và chỉ
# 3 đường ghi hỏng trong cửa sổ vài phút đó.
set -euo pipefail

# Cho phép diễn tập toàn bộ script trên D1 local:  --local --skip-deploy --yes
DB=${DB:-phong_chi_tieu_db}
# Production của project này là branch "production" (cài đặt Pages), KHÔNG phải "main".
# Thiếu cờ này thì `wrangler pages deploy` dùng tên branch hiện tại = main -> chỉ lên
# PREVIEW, còn phong-chi-tieu.pages.dev vẫn chạy bundle cũ: DB đã migrate mà code prod
# vẫn cũ => admin/periods, admin/settings, admin/toggle-share-paid trả 500 với người thật.
# Đã dính đúng như vậy ở lần chạy 2026-10-31.
PAGES_BRANCH=${PAGES_BRANCH:-production}
PROJECT=${PROJECT:-phong-chi-tieu}
DOMAIN=${DOMAIN:-https://phong-chi-tieu.pages.dev}
ROOM=phong-2a
MIGRATION=migrations/002_multitenancy.sql
STAMP=$(date +%F)
SCOPE=--remote          # --local khi diễn tập
SKIP_DEPLOY=0
APPLY=0; DO_ROLLBACK=""; DO_ROTATE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) APPLY=1 ;;
    --rotate-pin) DO_ROTATE=1 ;;
    --local) SCOPE=--local ;;
    --skip-deploy) SKIP_DEPLOY=1 ;;
    --rollback) shift; DO_ROLLBACK="${1:-}" ;;
    *) echo "Cờ không hiểu: $1" >&2; exit 2 ;;
  esac
  shift
done

# Tên file backup phải mang theo scope: nếu chỉ theo ngày thì một lần diễn tập
# --local sẽ chiếm chỗ bản backup prod, và lần chạy thật "đã tồn tại, dùng lại"
# là không còn gì để rollback.
if [ "$SCOPE" = "--remote" ]; then
  EXPORT=.wrangler/pre-mt-prod-$STAMP.sql
  SCOPE_LABEL="PRODUCTION"
else
  EXPORT=.wrangler/pre-mt-local-$STAMP.sql
  SCOPE_LABEL="local (diễn tập)"
fi

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
run() {
  printf '  + %s\n' "$*"
  if [ "$APPLY" = 1 ]; then
    eval "$@" || { echo "  ! lệnh trên thất bại — dừng ở đây, đừng đi tiếp." >&2; exit 1; }
  else
    echo "    (dry-run: chưa chạy)"
  fi
}

d1r() { # truy vấn D1 production, trả JSON. Dry-run thì không được chạm prod.
  if [ "$APPLY" != 1 ]; then echo '"(dry-run: không hỏi prod)"'; return 0; fi
  npx wrangler d1 execute "$DB" $SCOPE --json --command "$1" 2>/dev/null \
    | python3 -c 'import json,sys;d=json.load(sys.stdin);print(json.dumps((d[0] if isinstance(d,list) else d).get("results")))'
}

if [ "$APPLY" = 0 ]; then
  say "DRY RUN — không có lệnh nào chạm production. Thêm --yes để chạy thật."
fi

# ---------------------------------------------------------------- rollback
if [ -n "$DO_ROLLBACK" ]; then
  [ -f "$DO_ROLLBACK" ] || { echo "Không thấy bản backup: $DO_ROLLBACK" >&2; exit 1; }
  say "ROLLBACK về $DO_ROLLBACK (xóa toàn bộ bảng rồi import lại — mất mọi phòng tạo sau backup)"
  run "npx wrangler d1 execute $DB $SCOPE --command \"DROP TABLE IF EXISTS member_shares; DROP TABLE IF EXISTS expenses; DROP TABLE IF EXISTS periods; DROP TABLE IF EXISTS members; DROP TABLE IF EXISTS settings; DROP TABLE IF EXISTS rooms; DROP TABLE IF EXISTS invites; DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS schema_meta;\""
  run "npx wrangler d1 execute $DB $SCOPE --file=$DO_ROLLBACK"
  exit 0
fi

# ---------------------------------------------------------------- 0. tiền kiểm
say "0. Tiền kiểm — đích đến: $SCOPE_LABEL"
[ -f "$MIGRATION" ] || { echo "Thiếu $MIGRATION — đang ở sai repo/branch?" >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || echo "  ! Cảnh báo: working tree đang bẩn, code deploy có thể khác code đã test."
if [ "$SKIP_DEPLOY" = 0 ] && [ "$DO_ROTATE" = 0 ]; then
  run "npm run build"
fi

if [ "$APPLY" = 1 ] && [ "$DO_ROTATE" = 0 ]; then
  # Hỏi thẳng DB đích, không tin vào file backup: nếu schema_meta đã tồn tại thì
  # hoặc đã migrate rồi, hoặc đây là diễn tập lần hai — chạy tiếp sẽ vô nghĩa và
  # dễ làm hỏng bản backup đang có.
  ALREADY=$(d1r "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'")
  case "$ALREADY" in
    *schema_meta*)
      echo "  ! DB $SCOPE_LABEL đã có schema_meta -> đã migrate rồi. Không làm gì thêm." >&2
      echo "  ! Nếu chỉ muốn đổi PIN: bash scripts/pr6-deploy.sh $([ "$SCOPE" = "--local" ] && echo --local) --rotate-pin" >&2
      exit 1 ;;
  esac
  echo "  DB chưa migrate (không có schema_meta) -> đúng cái cần làm"
fi

# ------------------------------------------------- (đi tắt) chỉ đổi PIN rồi dừng
if [ "$DO_ROTATE" = 1 ]; then
  say "Đổi PIN admin cho $ROOM ($SCOPE_LABEL)"
  echo "  Prod đang để PIN 123456 — ai biết URL là ghi được vào sổ. Bước này bắt buộc."
  if [ "$APPLY" = 1 ]; then
    case "$(d1r "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'")" in
      *schema_meta*) : ;;
      *) echo "  ! DB chưa migrate: settings còn là bảng khóa đơn, chưa có cột room_id." >&2
         echo "  ! Chạy migrate trước: bash scripts/pr6-deploy.sh --yes" >&2; exit 1 ;;
    esac
    echo "  hash hiện tại: $(d1r "SELECT substr(value,1,10)||'…' h FROM settings WHERE room_id='$ROOM' AND key='admin_pin_hash'")"
  fi
  printf '  PIN mới (4+ ký tự, sẽ không hiện lại): '
  read -rs NEWPIN; echo
  printf '  Nhập lại PIN mới:                    '
  read -rs NEWPIN2; echo
  [ "$NEWPIN" = "$NEWPIN2" ] || { echo "  ! hai lần nhập không khớp" >&2; exit 1; }
  [ "${#NEWPIN}" -ge 4 ] || { echo "  ! PIN phải từ 4 ký tự" >&2; exit 1; }
  # Hash qua stdin để PIN và hash không lộ trong argv (`ps`). Hash này là bearer
  # credential cho mọi đường ghi admin: lộ hash cũng tệ như lộ PIN.
  HASH=$(printf '%s' "$NEWPIN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(require("crypto").createHash("sha256").update(s.trim()).digest("hex"))})')
  unset NEWPIN NEWPIN2
  TMP=$(mktemp); chmod 600 "$TMP"
  printf "UPDATE settings SET value='%s' WHERE room_id='%s' AND key='admin_pin_hash';\n" "$HASH" "$ROOM" > "$TMP"
  run "npx wrangler d1 execute $DB $SCOPE --file=$TMP"
  shred -u "$TMP" 2>/dev/null || rm -f "$TMP"
  if [ "$APPLY" = 1 ]; then
    NOW=$(d1r "SELECT substr(value,1,10)||'…' h FROM settings WHERE room_id='$ROOM' AND key='admin_pin_hash'")
    echo "  hash mới: $NOW"
    [ "$NOW" = "[]" ] && { echo "  ! không đọc lại được hash" >&2; exit 1; }
  fi
  echo "  Xong. PIN cũ không còn dùng được ở mọi thiết bị."
  exit 0
fi

# ---------------------------------------------------------------- 1. backup
say "1. Xuất bản backup $SCOPE_LABEL -> $EXPORT (bản duy nhất để rollback)"
if [ -f "$EXPORT" ]; then
  echo "  đã tồn tại, dùng lại (không ghi đè để mất bản gốc)"
else
  run "npx wrangler d1 export $DB $SCOPE --output=$EXPORT"
fi

if [ "$APPLY" = 1 ] && [ -f "$EXPORT" ]; then
  if grep -q "room_id" "$EXPORT"; then
    echo "  ! Bản export đã có room_id -> không phải schema legacy. Dừng, kiểm tra lại." >&2
    exit 1
  fi
  echo "  export là schema legacy (không có room_id) -> đúng cái cần migrate"
fi

# ---------------------------------------------------------------- 2. baseline
say "2. Ghi lại số dòng + dấu vân danh tính dòng trước khi migrate"
COUNTS="SELECT (SELECT COUNT(*) FROM members) m,(SELECT COUNT(*) FROM periods) p,(SELECT COUNT(*) FROM expenses) e,(SELECT COUNT(*) FROM member_shares) s,(SELECT COUNT(*) FROM settings) st;"
FINGER="SELECT group_concat(x) f FROM (SELECT id||':'||COALESCE(name,'')||':'||COALESCE(phone,'') x FROM members UNION ALL SELECT id||':'||COALESCE(title,'')||':'||CAST(amount AS TEXT) FROM expenses UNION ALL SELECT period_id||'/'||member_id||':'||CAST(is_paid AS TEXT)||':'||CAST(COALESCE(paid_amount,0) AS TEXT) FROM member_shares ORDER BY 1);"
BEFORE=$(d1r "$COUNTS")
BEFORE_F=$(d1r "$FINGER")
echo "  trước: $BEFORE"

# ---------------------------------------------------------------- 3. migrate
say "3. Apply $MIGRATION lên $SCOPE_LABEL"
run "npx wrangler d1 execute $DB $SCOPE --file=$MIGRATION"

if [ "$APPLY" = 1 ]; then
  say "4. Kiểm tra sau migrate: version + số dòng + từng dòng một"
  echo "  schema_meta: $(d1r 'SELECT version FROM schema_meta')"
  AFTER=$(d1r "$COUNTS")
  AFTER_F=$(d1r "$FINGER")
  echo "  sau : $AFTER"
  if python3 - "$BEFORE" "$AFTER" "$BEFORE_F" "$AFTER_F" <<'PY'
import json, sys
b, a = json.loads(sys.argv[1])[0], json.loads(sys.argv[2])[0]
# settings được phép tăng đúng 1 dòng (transfer_code); các bảng khác phải nguyên số dòng.
bad = {k: (b[k], a[k]) for k in b if k != "st" and b[k] != a[k]}
if b["st"] not in (a["st"], a["st"] - 1):
    bad["st"] = (b["st"], a["st"])
bf = json.loads(sys.argv[3])[0]["f"]
af = json.loads(sys.argv[4])[0]["f"]
if bf != af:
    pre, post = set((bf or "").split(",")), set((af or "").split(","))
    print("  !! dòng biến mất:", sorted(pre - post)[:5], flush=True)
    print("  !! dòng mới lạ:  ", sorted(post - pre)[:5], flush=True)
    sys.exit(1)
if bad:
    print("  !! SỐ DÒNG LỆCH:", bad, "-> đừng deploy, chạy --rollback", flush=True)
    sys.exit(1)
print("  OK: từng dòng members/expenses/member_shares giống hệt nhau trước và sau", flush=True)
PY
  then :; else
    echo "  ! DỪNG ở bước 4, CHƯA deploy gì cả." >&2
    echo "  ! Rollback: bash scripts/pr6-deploy.sh --rollback $EXPORT --yes" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------- 5. deploy
if [ "$SKIP_DEPLOY" = 0 ]; then
  say "5. Deploy Functions + client lên $PROJECT (branch $PAGES_BRANCH = Production)"
  run "npx wrangler pages deploy dist --project-name=$PROJECT --branch=$PAGES_BRANCH"

  if [ "$APPLY" = 1 ]; then
    say "6. Kiểm tra bản live"
    sleep 8
    code=$(curl -s -o /tmp/pr6-live.json -w '%{http_code}' "$DOMAIN/api/data?p=$ROOM" || echo 000)
    echo "  GET /api/data?p=$ROOM -> HTTP $code"
    python3 -c '
import json
try:
    d = json.load(open("/tmp/pr6-live.json"))
except Exception as e:
    raise SystemExit("  ! không đọc được JSON: %s" % e)
if "error" in d:
    raise SystemExit("  ! LỖI: %s" % d["error"])
# room_id chỉ tồn tại ở code MỚI. Không có nó nghĩa là phong-chi-tieu.pages.dev vẫn
# đang serve bundle cũ (deploy rơi vào Preview) — tức là prod chưa được cập nhật.
if not d.get("room_id"):
    raise SystemExit("  ! PRODUCTION VẪN CHẠY CODE CŨ (response không có room_id). "
                     "Kiểm tra: npx wrangler pages deployment list --project-name=phong-chi-tieu")
print("  members=%d periods=%d expenses=%d shares=%d | transfer_code=%s" % (
    len(d["members"]), len(d["periods"]), len(d["expenses"]),
    len(d["member_shares"]), d["settings"].get("transfer_code")))
' || echo "  ! kiểm tra live thất bại — cân nhắc --rollback $EXPORT"
    echo "  PIN vẫn là hash cũ: $(d1r "SELECT substr(value,1,8)||'…' v FROM settings WHERE room_id='$ROOM' AND key='admin_pin_hash'")"
  fi
fi

say "Còn lại làm tay trong app"
cat <<EOF
  - Vào $DOMAIN, mở Cài đặt > PIN & Mời người, đặt PIN mới nếu chưa chạy --rotate-pin.
  - Tạo thử phòng thứ hai (nút trên Header > Tạo phòng / vào bằng link mời).
  - Gửi link mời cho một người thật, mở bằng điện thoại khác, kiểm tra hết hạn 15'.
EOF
