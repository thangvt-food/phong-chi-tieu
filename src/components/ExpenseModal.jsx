import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Zap,
  Droplets,
  Home,
  Wifi,
  Trash2,
  UserCheck,
  ShoppingBag,
  Calendar,
  Users,
  Split,
  Plus,
  Loader2,
} from 'lucide-react';
import {
  formatMoney,
  formatCompact,
  parseSplitConfig,
  calcExpenseShares,
} from '../services/api';

const PRESETS = [
  { key: 'dien', label: 'Điện', icon: Zap, color: 'border-amber-400 bg-amber-50 text-amber-700' },
  { key: 'nuoc_uong', label: 'Nước', icon: Droplets, color: 'border-cyan-400 bg-cyan-50 text-cyan-700' },
  { key: 'phong', label: 'Phòng', icon: Home, color: 'border-blue-400 bg-blue-50 text-blue-700' },
  { key: 'mang', label: 'Wifi', icon: Wifi, color: 'border-indigo-400 bg-indigo-50 text-indigo-700' },
  { key: 'rac', label: 'Rác', icon: Trash2, color: 'border-emerald-400 bg-emerald-50 text-emerald-700' },
  { key: 'rieng', label: 'Mua riêng', icon: UserCheck, color: 'border-rose-400 bg-rose-50 text-rose-700' },
  { key: 'khac', label: 'Khác', icon: ShoppingBag, color: 'border-purple-400 bg-purple-50 text-purple-700' },
];

export default function ExpenseModal({
  isOpen,
  onClose,
  onSave,
  members = [],
  editingExpense = null,
  saving = false,
}) {
  // NOTE: Mọi hook phải chạy trước mọi `return` (Rules of Hooks).
  // Không được `return null` ở đây — xem cuối hàm, sau useMemo.
  const todayStr = new Date().toISOString().split('T')[0];

  const [pending, setPending] = useState(false);

  const [category, setCategory] = useState('dien');
  const [expenseDate, setExpenseDate] = useState(todayStr);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [targetMemberId, setTargetMemberId] = useState('');

  // Nước uống
  const [bottlesCount, setBottlesCount] = useState(2);
  const [bottlePrice, setBottlePrice] = useState(25000);

  // Cấu hình chia tiền (áp dụng cho các khoản chung, không phải 'rieng')
  const [splitMode, setSplitMode] = useState('all'); // 'all' | 'custom' | 'fixed'
  const [splitMemberIds, setSplitMemberIds] = useState([]);
  const [fixedEntries, setFixedEntries] = useState([{ member_id: '', amount: '' }]);

  // Modal giờ sống qua cả lệnh ghi + loadRoom, members sẽ đổi identity giữa chừng.
  // Effet nạp form chỉ được chạy theo editingExpense/isOpen, nên đọc members qua ref.
  const membersRef = useRef(members);
  membersRef.current = members;

  useEffect(() => {
    const members = membersRef.current;
    if (editingExpense) {
      setCategory(editingExpense.category || 'khac');
      setExpenseDate(editingExpense.expense_date || todayStr);
      setTitle(editingExpense.title || '');
      setAmount(editingExpense.amount ? String(editingExpense.amount) : '');
      setNote(editingExpense.note || '');
      setTargetMemberId(editingExpense.target_member_id || members[0]?.id || '');
      if (editingExpense.category === 'nuoc_uong') {
        setBottlesCount(editingExpense.quantity || 2);
        setBottlePrice(editingExpense.unit_price || 25000);
      }
      // Nạp cấu hình chia đã lưu
      const cfg = parseSplitConfig(editingExpense);
      setSplitMode(cfg.mode || 'all');
      setSplitMemberIds(
        cfg.member_ids && cfg.member_ids.length > 0
          ? cfg.member_ids.filter((id) => members.some((m) => m.id === id))
          : members.map((m) => m.id)
      );
      setFixedEntries(
        cfg.fixed && cfg.fixed.length > 0
          ? cfg.fixed.map((f) => ({ member_id: f.member_id, amount: String(f.amount) }))
          : [{ member_id: members[0]?.id || '', amount: '' }]
      );
    } else {
      setCategory('dien');
      setExpenseDate(todayStr);
      setTitle('Tiền điện');
      setAmount('');
      setNote('');
      setTargetMemberId(members[0]?.id || '');
      setBottlesCount(2);
      setBottlePrice(25000);
      setSplitMode('all');
      setSplitMemberIds(members.map((m) => m.id));
      setFixedEntries([{ member_id: members[0]?.id || '', amount: '' }]);
    }
  }, [editingExpense, isOpen]);

  const handleSelectPreset = (catKey) => {
    setCategory(catKey);
    if (catKey === 'dien') {
      setTitle('Tiền điện');
      setTargetMemberId('');
    } else if (catKey === 'nuoc_uong') {
      setTitle(`Nước bình (${bottlesCount} thùng)`);
      setAmount(String(bottlesCount * bottlePrice));
      setTargetMemberId('');
    } else if (catKey === 'phong') {
      setTitle('Tiền thuê phòng');
      setTargetMemberId('');
    } else if (catKey === 'mang') {
      setTitle('Internet / Wifi');
      setTargetMemberId('');
    } else if (catKey === 'rac') {
      setTitle('Tiền rác');
      setTargetMemberId('');
    } else if (catKey === 'rieng') {
      const target = members.find((m) => m.id === targetMemberId) || members[0];
      setTitle(`Mua đồ cho ${target?.nickname || target?.name || 'thành viên'}`);
    } else {
      setTitle('');
      setTargetMemberId('');
    }
  };

  useEffect(() => {
    if (category === 'nuoc_uong') {
      const total = (parseInt(bottlesCount) || 0) * (parseInt(bottlePrice) || 0);
      setAmount(String(total));
      setTitle(`Nước bình (${bottlesCount} thùng)`);
    }
  }, [bottlesCount, bottlePrice, category]);

  useEffect(() => {
    if (category === 'rieng' && targetMemberId) {
      const target = members.find((m) => m.id === targetMemberId);
      if (target) {
        setTitle(`Mua đồ cho ${target.nickname || target.name}`);
      }
    }
  }, [targetMemberId, category, members]);

  const [year, month] = (expenseDate || todayStr).split('-');

  const isSharedCategory = category !== 'rieng';

  const toggleSplitMember = (id) => {
    setSplitMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const fixedValid = fixedEntries
    .filter((f) => f.member_id && parseInt(f.amount) > 0)
    .map((f) => ({ member_id: f.member_id, amount: parseInt(f.amount) }));
  const fixedTotal = fixedValid.reduce((s, f) => s + f.amount, 0);
  const billAmount = parseInt(amount) || 0;
  const remainder = Math.max(0, billAmount - fixedTotal);

  // Xem trước mỗi người phải trả bao nhiêu cho khoản này
  const splitPreview = useMemo(() => {
    if (!isSharedCategory || billAmount <= 0 || members.length === 0) return null;
    const cfg =
      splitMode === 'custom'
        ? { mode: 'custom', member_ids: splitMemberIds }
        : splitMode === 'fixed'
          ? { mode: 'fixed', member_ids: splitMemberIds, fixed: fixedValid }
          : { mode: 'all' };
    return calcExpenseShares({ amount: billAmount, split_config: cfg }, members);
  }, [isSharedCategory, billAmount, splitMode, splitMemberIds, fixedValid, members]);

  const excludeFixedFromSplit = () => {
    const fixedIds = new Set(fixedValid.map((f) => f.member_id));
    setSplitMemberIds((prev) => prev.filter((id) => !fixedIds.has(id)));
  };

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pending) return;
    const finalAmount = parseInt(amount) || 0;
    if (finalAmount <= 0) {
      alert('Vui lòng nhập số tiền hợp lệ!');
      return;
    }

    // Build split_config cho khoản chung
    let split_config = null;
    if (isSharedCategory) {
      if (splitMode === 'custom') {
        if (splitMemberIds.length === 0) {
          alert('Hãy chọn ít nhất 1 người tham gia chia tiền!');
          return;
        }
        if (splitMemberIds.length < members.length) {
          split_config = { mode: 'custom', member_ids: splitMemberIds };
        }
      } else if (splitMode === 'fixed') {
        if (fixedValid.length === 0) {
          alert('Hãy nhập ít nhất 1 người chịu số tiền cố định!');
          return;
        }
        if (fixedTotal > finalAmount) {
          alert(
            `Tổng cố định (${formatMoney(fixedTotal)}) đang vượt quá tổng bill (${formatMoney(finalAmount)})!`
          );
          return;
        }
        if (splitMemberIds.length === 0 && fixedTotal < finalAmount) {
          alert('Còn dư tiền sau phần cố định nhưng chưa chọn ai để chia phần còn lại!');
          return;
        }
        split_config = { mode: 'fixed', member_ids: splitMemberIds, fixed: fixedValid };
      }
    }

    setPending(true);
    try {
      const res = await onSave({
        id: editingExpense?.id,
        category,
        expense_date: expenseDate,
        period_id: `${year}-${month}`,
        title: title.trim() || 'Khoản chi',
        amount: finalAmount,
        note: note.trim(),
        target_member_id: category === 'rieng' ? targetMemberId : null,
        quantity: category === 'nuoc_uong' ? parseInt(bottlesCount) : null,
        unit_price: category === 'nuoc_uong' ? parseInt(bottlePrice) : null,
        split_config,
      });
      if (res?.success) onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl border border-slate-100 flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <span className="font-bold text-sm">
            {editingExpense ? 'Sửa chi tiêu' : 'Thêm chi tiêu'}
          </span>
          <button
            onClick={onClose}
            disabled={pending}
            className="p-1 rounded-full text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={handleSubmit}
          className="p-4 space-y-3 overflow-y-auto max-h-[75vh]"
        >
          {/* Preset Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {PRESETS.map((p) => {
              const isSelected = category === p.key;
              const IconComp = p.icon;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handleSelectPreset(p.key)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 shrink-0 border transition-all ${
                    isSelected
                      ? `${p.color} shadow-sm scale-105`
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <IconComp className="w-3.5 h-3.5" />
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>

          {/* Date Picker */}
          <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <span className="font-semibold text-slate-600 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-indigo-600" /> Ngày:
            </span>
            <input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none"
            />
          </div>

          {/* Category-specific inputs */}
          {category === 'dien' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Số tiền điện:
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="VD: 550000"
                autoFocus
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-base font-extrabold text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          )}

          {category === 'nuoc_uong' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Số thùng:</label>
                  <input
                    type="number"
                    min="1"
                    value={bottlesCount}
                    onChange={(e) => setBottlesCount(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Giá/thùng:</label>
                  <input
                    type="number"
                    step="1000"
                    value={bottlePrice}
                    onChange={(e) => setBottlePrice(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold outline-none"
                  />
                </div>
              </div>
              <div className="p-2 rounded-xl bg-cyan-50 border border-cyan-200 flex justify-between text-xs font-bold text-cyan-900">
                <span>Tổng tiền:</span>
                <span>{formatMoney((parseInt(bottlesCount) || 0) * (parseInt(bottlePrice) || 0))}</span>
              </div>
            </div>
          )}

          {category === 'rieng' && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Người nhận:</label>
                <select
                  value={targetMemberId}
                  onChange={(e) => setTargetMemberId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none"
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.nickname ? `(${m.nickname})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Số tiền:</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="VD: 50000"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-base font-extrabold text-slate-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Ghi chú:</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="VD: Mua đồ ăn riêng..."
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none"
                />
              </div>
            </div>
          )}

          {!['dien', 'nuoc_uong', 'rieng'].includes(category) && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Tên khoản:</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="VD: Tiền phòng, wifi..."
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Số tiền:</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="VD: 200000"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-base font-extrabold text-slate-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Ghi chú (tùy chọn):</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="VD: Gói cước tháng..."
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none"
                />
              </div>
            </div>
          )}

          {/* ===== Cấu hình chia tiền (chỉ khoản chung) ===== */}
          {isSharedCategory && members.length > 0 && (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-2.5 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900">
                <Split className="w-3.5 h-3.5 text-indigo-600" />
                <span>Cách chia tiền</span>
              </div>

              {/* 3 chế độ */}
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-white border border-slate-200">
                {[
                  { key: 'all', label: 'Chia đều' },
                  { key: 'custom', label: 'Chọn người' },
                  { key: 'fixed', label: 'Cố định + chia' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setSplitMode(opt.key)}
                    className={`px-1 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                      splitMode === opt.key
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Chế độ chia đều */}
              {splitMode === 'all' && (
                <p className="text-[11px] font-medium text-slate-600 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-indigo-500" />
                  Chia đều cho cả {members.length} người trong phòng
                  {billAmount > 0 && (
                    <span className="font-bold text-indigo-700">
                      • {formatMoney(Math.round(billAmount / members.length))}/người
                    </span>
                  )}
                </p>
              )}

              {/* Chế độ chọn người */}
              {splitMode === 'custom' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-600">
                      Chia cho {splitMemberIds.length}/{members.length} người:
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setSplitMemberIds(members.map((m) => m.id))}
                        className="text-[10px] font-bold text-indigo-600 hover:underline"
                      >
                        Tất cả
                      </button>
                      <span className="text-[10px] text-slate-300">|</span>
                      <button
                        type="button"
                        onClick={() => setSplitMemberIds([])}
                        className="text-[10px] font-bold text-slate-500 hover:underline"
                      >
                        Bỏ hết
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {members.map((m) => {
                      const checked = splitMemberIds.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggleSplitMember(m.id)}
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-xl border text-[11px] font-bold transition-all ${
                            checked
                              ? 'border-indigo-400 bg-indigo-600 text-white shadow-sm'
                              : 'border-slate-200 bg-white text-slate-600'
                          }`}
                        >
                          <span
                            className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px] shrink-0 ${
                              checked ? 'bg-white text-indigo-700 border-white' : 'border-slate-300 text-transparent'
                            }`}
                          >
                            ✓
                          </span>
                          <span className="truncate">{m.nickname || m.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Chế độ cố định + chia đều phần còn lại */}
              {splitMode === 'fixed' && (
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-bold text-slate-600">
                      Ai chịu số cố định?
                    </span>
                    {fixedEntries.map((row, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <select
                          value={row.member_id}
                          onChange={(e) => {
                            const next = [...fixedEntries];
                            next[idx] = { ...next[idx], member_id: e.target.value };
                            setFixedEntries(next);
                          }}
                          className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-bold outline-none"
                        >
                          <option value="">— Chọn người —</option>
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} {m.nickname ? `(${m.nickname})` : ''}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="0"
                          placeholder="Số tiền"
                          value={row.amount}
                          onChange={(e) => {
                            const next = [...fixedEntries];
                            next[idx] = { ...next[idx], amount: e.target.value };
                            setFixedEntries(next);
                          }}
                          className="w-24 px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-bold outline-none"
                        />
                        {fixedEntries.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setFixedEntries(fixedEntries.filter((_, i) => i !== idx))}
                            className="p-1.5 text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setFixedEntries([
                          ...fixedEntries,
                          { member_id: '', amount: '' },
                        ])
                      }
                      className="flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800"
                    >
                      <Plus className="w-3 h-3" /> Thêm người cố định
                    </button>
                  </div>

                  <div className="space-y-1.5 pt-1 border-t border-indigo-100">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-600">
                        Phần còn lại ({formatMoney(remainder)}) chia cho:
                      </span>
                      {fixedValid.length > 0 && (
                        <button
                          type="button"
                          onClick={excludeFixedFromSplit}
                          className="text-[10px] font-bold text-indigo-600 hover:underline"
                        >
                          Trừ người cố định
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {members.map((m) => {
                        const checked = splitMemberIds.includes(m.id);
                        const isFixed = fixedValid.some((f) => f.member_id === m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleSplitMember(m.id)}
                            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-xl border text-[11px] font-bold transition-all ${
                              checked
                                ? 'border-indigo-400 bg-indigo-600 text-white shadow-sm'
                                : 'border-slate-200 bg-white text-slate-600'
                            }`}
                          >
                            <span
                              className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px] shrink-0 ${
                                checked ? 'bg-white text-indigo-700 border-white' : 'border-slate-300 text-transparent'
                              }`}
                            >
                              ✓
                            </span>
                            <span className="truncate">
                              {m.nickname || m.name}
                              {isFixed ? ` (${formatCompact(fixedValid.find((f) => f.member_id === m.id)?.amount)})` : ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Xem trước */}
              {splitPreview && billAmount > 0 && splitMode !== 'all' && (
                <div className="p-2 rounded-xl bg-white border border-indigo-100 space-y-0.5">
                  <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wide">
                    Xem trước mỗi người trả:
                  </span>
                  {members
                    .filter((m) => (splitPreview[m.id] || 0) > 0)
                    .map((m) => (
                      <div
                        key={m.id}
                        className="flex justify-between text-[11px] font-semibold text-slate-700"
                      >
                        <span>{m.nickname || m.name}</span>
                        <span className="font-bold text-slate-900">
                          {formatMoney(Math.round(splitPreview[m.id]))}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="px-3.5 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={pending || saving}
              className="flex items-center gap-1.5 px-5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-colors disabled:opacity-50"
            >
              {pending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Đang lưu…
                </>
              ) : (
                editingExpense ? 'Lưu' : 'Thêm'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
