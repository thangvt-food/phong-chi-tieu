#!/usr/bin/env bash
# Chạy một bước migration D1 trên production + deploy, theo đúng thứ tự đã đo:
# backup -> migrate -> verify từng dòng -> deploy -> verify live.
#
#   bash scripts/pr6-deploy.sh              # in ra lệnh sẽ chạy, không đụng prod
#   bash scripts/pr6-deploy.sh --yes        # chạy thật migration hiện tại (mặc định 003)
#   bash scripts/pr6-deploy.sh --rotate-pin --yes   # riêng bước đổi PIN
#   bash scripts/pr6-deploy.sh --rollback .wrangler/pre-003-prod-<ngày>.sql --yes
#   MIGRATION=migrations/004_x.sql TO_VERSION=4 bash scripts/pr6-deploy.sh --yes
#
# 002_multitenancy.sql đã áp dụng lên production ngày 2026-10-31; bản backup của nó
# là .wrangler/pre-mt-prod-2026-10-31.sql và vẫn là đường lùi của production.
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
# Migration + version đích. 002 đã áp dụng lên production ngày 2026-10-31, nên mặc
# định là bước TIẾP THEO chứ không phải 002: chạy lại 002 thì guard version chặn lại.
# Muốn migrate bước khác: MIGRATION=migrations/004_x.sql TO_VERSION=4 bash scripts/pr6-deploy.sh
MIGRATION=${MIGRATION:-migrations/003_invite_roles.sql}
TO_VERSION=${TO_VERSION:-3}
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

# Tên file backup phải mang theo scope VÀ migration: nếu chỉ theo ngày thì lần diễn
# tập --local chiếm chỗ bản prod, và migration 003 ghi đè bản backup của 002 — bản
# đó vẫn là đường lùi duy nhất của production.
TAG=$(basename "$MIGRATION" .sql | cut -d_ -f1)
if [ "$SCOPE" = "--remote" ]; then
  EXPORT=.wrangler/pre-${TAG}-prod-$STAMP.sql
  SCOPE_LABEL="PRODUCTION"
else
  EXPORT=.wrangler/pre-${TAG}-local-$STAMP.sql
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

# Version schema thật của DB đích, đọc từ schema_meta chứ không suy từ "bảng có tồn
# tại hay không": từ 002 trở đi bảng luôn còn đó, nên phép thử cũ chặn mọi migration
# sau này. Trả "" khi DB legacy (chưa có schema_meta) hoặc khi đọc lỗi.
db_version() {
  d1r "SELECT MAX(version) AS v FROM schema_meta" | python3 -c '
import json, sys
try:
    rows = json.load(sys.stdin)
except Exception:
    rows = []
v = rows[0].get("v") if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None
print("" if v is None else v)'
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
  # So VERSION, không xét "bảng schema_meta có tồn tại không": bảng đó có từ 002 nên
  # phép thử cũ sẽ chặn mọi migration sau 002, kể cả 003 chạy trên đúng DB này.
  NOW_V=$(db_version || true)
  EXPECT_V=$((TO_VERSION - 1))
  if [ -z "$NOW_V" ]; then
    # DB legacy, chưa có schema_meta: chỉ hợp lệ khi chính migration này là bước tạo ra nó.
    [ "$EXPECT_V" = 1 ] || { echo "  ! DB $SCOPE_LABEL không đọc được version (legacy hoặc lỗi)," >&2
                             echo "  ! mà $MIGRATION đòi hỏi version $EXPECT_V trước đó. Dừng." >&2; exit 1; }
    echo "  DB legacy (không có schema_meta) -> đúng cái cần migrate lên version $TO_VERSION"
  elif [ "$NOW_V" -ge "$TO_VERSION" ]; then
    echo "  ! DB $SCOPE_LABEL đã ở version $NOW_V >= $TO_VERSION -> $MIGRATION chạy rồi. Không làm gì thêm." >&2
    echo "  ! Nếu chỉ muốn đổi PIN: bash scripts/pr6-deploy.sh $([ "$SCOPE" = "--local" ] && echo --local) --rotate-pin" >&2
    exit 1
  elif [ "$NOW_V" != "$EXPECT_V" ]; then
    echo "  ! DB $SCOPE_LABEL đang ở version $NOW_V, $MIGRATION đòi hỏi đúng version $EXPECT_V." >&2
    echo "  ! Sai bước liền trước -> dừng, đừng chạy tắt." >&2
    exit 1
  else
    echo "  DB đang ở version $NOW_V -> đúng bước liền trước của $MIGRATION (lên version $TO_VERSION)"
  fi
fi

# ------------------------------------------------- (đi tắt) chỉ đổi PIN rồi dừng
if [ "$DO_ROTATE" = 1 ]; then
  say "Đổi PIN admin cho $ROOM ($SCOPE_LABEL)"
  echo "  Prod đang để PIN 123456 — ai biết URL là ghi được vào sổ. Bước này bắt buộc."
  if [ "$APPLY" = 1 ]; then
    NOW_V=$(db_version || true)
    [ -n "$NOW_V" ] && [ "$NOW_V" -ge 2 ] || {
      echo "  ! DB chưa migrate (version '${NOW_V:-legacy}'): settings còn là bảng khóa đơn, chưa có cột room_id." >&2
      echo "  ! Chạy migrate trước: bash scripts/pr6-deploy.sh --yes" >&2; exit 1; }
    echo "  DB ở version $NOW_V, settings đã per-room -> đổi PIN được"
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
  # Bản backup phải thật là trạng thái TRƯỚC migration này. Xét "có room_id hay không"
  # chỉ đúng cho 002 — prod giờ luôn có room_id nên phép đó chặn mọi lần chạy sau.
  # Version ghi ngay trong file backup là thứ tổng quát và không cần hỏi DB.
  [ "$(grep -c "CREATE TABLE" "$EXPORT")" -gt 0 ] || { echo "  ! Bản backup không có bảng nào — export hỏng? Dừng." >&2; exit 1; }
  # Định dạng thật của `wrangler d1 export` là một dòng INSERT không kèm danh sách cột,
  # ví trị version nằm ngay sau VALUES(. Grep mọi con số rồi lấy số lớn nhất sẽ trả về
  # 2026 (năm trong cột applied_at) — đã dính khi diễn tập.
  BK_V=$(python3 -c '
import re, sys
txt = open(sys.argv[1], encoding="utf-8", errors="replace").read()
vs = re.findall(r"INSERT INTO\s+.?schema_meta.?\s*(?:\([^)]*\))?\s*VALUES\s*\(\s*(\d+)", txt, re.I)
print(max(vs, key=int) if vs else "")' "$EXPORT")
  if [ -z "$BK_V" ]; then
    [ "${EXPECT_V:-1}" = 1 ] || { echo "  ! Bản backup là legacy (không có schema_meta) trong khi $MIGRATION đòi version trước = ${EXPECT_V:-?}." >&2; exit 1; }
    echo "  backup là schema legacy -> đúng cái cần migrate"
  elif [ "$BK_V" -ge "$TO_VERSION" ]; then
    echo "  ! Bản backup đã ở version $BK_V >= $TO_VERSION -> DB đã migrate rồi, export này không phải bản trước migration." >&2
    exit 1
  elif [ "$BK_V" != "$EXPECT_V" ]; then
    echo "  ! Backup ở version $BK_V, mong đợi đúng version $EXPECT_V ngay trước $MIGRATION." >&2
    exit 1
  fi
  [ -n "$BK_V" ] && echo "  backup ở version $BK_V -> đúng trạng thái trước $MIGRATION"
fi

# ---------------------------------------------------------------- 2. baseline
say "2. Ghi lại số dòng + dấu vân danh tính dòng trước khi migrate"
COUNTS="SELECT (SELECT COUNT(*) FROM rooms) r,(SELECT COUNT(*) FROM members) m,(SELECT COUNT(*) FROM periods) p,(SELECT COUNT(*) FROM expenses) e,(SELECT COUNT(*) FROM member_shares) s,(SELECT COUNT(*) FROM settings) st;"
FINGER="SELECT group_concat(x) f FROM (SELECT id||':'||COALESCE(name,'')||':'||COALESCE(phone,'') x FROM members UNION ALL SELECT id||':'||COALESCE(title,'')||':'||CAST(amount AS TEXT) FROM expenses UNION ALL SELECT period_id||'/'||member_id||':'||CAST(is_paid AS TEXT)||':'||CAST(COALESCE(paid_amount,0) AS TEXT) FROM member_shares ORDER BY 1);"
BEFORE=$(d1r "$COUNTS")
BEFORE_F=$(d1r "$FINGER")
echo "  trước: $BEFORE"

# ---------------------------------------------------------------- 3. migrate
say "3. Apply $MIGRATION lên $SCOPE_LABEL"
run "npx wrangler d1 execute $DB $SCOPE --file=$MIGRATION"

if [ "$APPLY" = 1 ]; then
  say "4. Kiểm tra sau migrate: version + số dòng + từng dòng một"
  AFTER_V=$(db_version || true)
  echo "  schema_meta: version=${AFTER_V:-?} (mong đợi $TO_VERSION)"
  if [ "${AFTER_V:-0}" != "$TO_VERSION" ]; then
    # route.js chỉ放行 đường ghi khi DB đúng version nó đòi (SCHEMA_VERSION). Migration
    # quên stamp version -> DB thấp hơn -> mọi POST/DELETE trên prod trả 503, mà app vẫn
    # đọc bình thường nên không ai thấy gì cho tới lúc có người bấm "Lưu".
    echo "  ! SAU MIGRATION DB ở version '${AFTER_V:-legacy}', phải là $TO_VERSION." >&2
    echo "  ! File $MIGRATION thiếu câu INSERT INTO schema_meta, hoặc chạy hỏng giữa chừng." >&2
    echo "  ! CHƯA deploy. Rollback: bash scripts/pr6-deploy.sh --rollback $EXPORT --yes" >&2
    exit 1
  fi
  AFTER=$(d1r "$COUNTS")
  AFTER_F=$(d1r "$FINGER")
  echo "  sau : $AFTER"
  if python3 - "$BEFORE" "$AFTER" "$BEFORE_F" "$AFTER_F" <<'PY'
import json, sys
b, a = json.loads(sys.argv[1])[0], json.loads(sys.argv[2])[0]
# Migration 005 có thể thêm một cờ join_approval cho mỗi phòng; mọi bảng khác phải nguyên số dòng.
bad = {k: (b[k], a[k]) for k in b if k != "st" and b[k] != a[k]}
settings_delta = a["st"] - b["st"]
if not 0 <= settings_delta <= b["r"]:
    bad["st"] = (b["st"], a["st"], "chỉ được thêm tối đa một cờ cho mỗi phòng")
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
  AUTH_STATE=$(d1r "SELECT (SELECT COUNT(*) FROM rooms) AS room_count,(SELECT COUNT(*) FROM settings WHERE key='join_approval' AND value='1') AS approval_count,(SELECT COUNT(*) FROM user_sessions WHERE revoked_at IS NULL) AS active_sessions,(SELECT COUNT(*) FROM users WHERE password_hash!='google-auth-only') AS old_hashes")
  if ! python3 - "$AUTH_STATE" <<'PY'
import json, sys
state = json.loads(sys.argv[1])[0]
if state["approval_count"] != state["room_count"]:
    raise SystemExit("  ! Không phải mọi phòng đều bật duyệt thành viên.")
if state["active_sessions"] or state["old_hashes"]:
    raise SystemExit("  ! Session cũ hoặc hash mật khẩu cũ còn tồn tại.")
print("  OK: duyệt bật cho mọi phòng; session/hash mật khẩu cũ đã vô hiệu hóa")
PY
  then
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
# Từ 004, /api/data đòi Bearer: 401 + needs_auth nghĩa là bundle mới đã lên Production.
# (Code cũ trả 200 công khai kèm room_id.)
if d.get("needs_auth"):
    print("  OK: code mới đã lên Production (401 needs_auth, đúng thiết kế)")
elif d.get("room_id"):
    raise SystemExit("  ! PRODUCTION VẪN CHẠY CODE CŨ (200 công khai + room_id). "
                     "Kiểm tra: npx wrangler pages deployment list --project-name=phong-chi-tieu")
elif "error" in d:
    raise SystemExit("  ! LỖI: %s" % d["error"])
else:
    raise SystemExit("  ! phản hồi lạ: %s" % d)
' || echo "  ! kiểm tra live thất bại — đọc thông báo ở trên trước khi nghĩ tới rollback."
  fi
fi

say "Còn lại làm tay trong app"
cat <<EOF
  - Vào $DOMAIN/?p=$ROOM, chọn "Khôi phục chủ phòng bằng PIN", đặt tài khoản + PIN mới.
  - Cài đặt > Thành viên: tạo link claim cho những người chưa có tài khoản.
  - Không nhập PIN vào terminal: mọi bước PIN chỉ gõ trong app.
EOF
