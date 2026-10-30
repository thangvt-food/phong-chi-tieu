# Phòng chi tiêu

Stack: React 18 + Vite + Tailwind, Cloudflare Pages + Functions, D1 (SQLite).
Chi tiết vận hành xem `README.md`.

## graphify

Tồn tại `graphify-out/graph.json` (knowledge graph của repo này). Quy tắc:

- Trước khi trả lời câu hỏi về kiến trúc, file, luồng dữ liệu hay quan hệ giữa các module:
  đọc `graphify-out/GRAPH_REPORT.md` hoặc chạy `graphify query "<câu hỏi>"`
  (`graphify explain "X"`, `graphify path "A" "B"`, `graphify affected "X"`).
  Chỉ mở file nguồn khi graph không có câu trả lời, và nói rõ là đã phải đọc tay.
- Sau khi sửa code: `graphify update .`  (AST cục bộ, không tốn token, không cần API key).
- Sau khi sửa `README.md` hoặc docs: `/graphify . --update`  (cần LLM cho phần tài liệu).
- graph.json build từ commit nào ghi trong `GRAPH_REPORT.md`; nếu `git rev-parse HEAD`
  lệch nhiều, chạy `graphify update .` trước khi tin vào graph.
- `graphify-out/` đã nằm trong `.gitignore` — không commit output, không coi nó là source of truth
  nếu nó cũ hơn code.
