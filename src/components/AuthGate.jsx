import React, { useState } from 'react';
import {
  Home,
  Loader2,
  AlertCircle,
  LogIn,
  UserPlus,
  KeyRound,
  ChevronDown,
  ShieldCheck,
} from 'lucide-react';
import { authLogin, authRegister, claimInvite, recoverOwner } from '../services/api';
import { roleLabel } from '../constants/roles';

export default function AuthGate({ invite, roomHint, onAuthed }) {
  const [tab, setTab] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recover, setRecover] = useState({
    pin: '',
    newPin: '',
    username: '',
    password: '',
    displayName: '',
  });
  const [recoverError, setRecoverError] = useState('');
  const [recoverBusy, setRecoverBusy] = useState(false);

  const preview = invite?.preview || null;

  const finishAuth = async () => {
    let claimedRoomId = null;
    if (invite?.token) {
      const claim = await claimInvite(invite.token);
      if (claim.success) {
        claimedRoomId = claim.room_id;
      } else {
        // Tài khoản đã vào được; link hỏng chỉ là mất một lời mời, không chặn cửa.
        alert(claim.error || 'Không nhận được link mời này.');
      }
    }
    onAuthed({ claimedRoomId });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const result = await authLogin({ username: username.trim(), password });
    if (!result.success) {
      setBusy(false);
      setError(result.error || 'Sai tên đăng nhập hoặc mật khẩu.');
      return;
    }
    await finishAuth();
    setBusy(false);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (password !== passwordConfirm) {
      setError('Hai lần nhập mật khẩu không khớp.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await authRegister({
      username: username.trim(),
      password,
      displayName: displayName.trim() || username.trim(),
    });
    if (!result.success) {
      setBusy(false);
      setError(result.error || 'Không tạo được tài khoản.');
      return;
    }
    await finishAuth();
    setBusy(false);
  };

  const handleRecover = async (e) => {
    e.preventDefault();
    if (!roomHint?.roomId) return;
    if (recover.newPin === recover.pin) {
      setRecoverError('Mã khôi phục mới phải khác mã cũ.');
      return;
    }
    setRecoverBusy(true);
    setRecoverError('');
    const result = await recoverOwner({
      roomId: roomHint.roomId,
      pin: recover.pin,
      newPin: recover.newPin,
      username: recover.username.trim(),
      password: recover.password,
      displayName: recover.displayName.trim(),
    });
    setRecoverBusy(false);
    if (!result.success) {
      setRecoverError(result.error || 'Không khôi phục được quyền chủ phòng.');
      return;
    }
    onAuthed({ claimedRoomId: result.room_id });
  };

  const inputClass =
    'w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white';

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-100">
        <div className="px-6 py-5 bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center">
              <Home className="w-4 h-4" />
            </div>
            <div>
              <h1 className="font-bold text-base">Phòng chi tiêu</h1>
              <p className="text-[11px] text-slate-400">
                Đăng nhập một lần, vào mọi phòng bạn tham gia
              </p>
            </div>
          </div>
        </div>

        {preview && (
          <div className="mx-5 mt-4 p-3 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-indigo-600" />
            <span>
              Bạn được mời vào <b>{preview.room_name}</b> với tên <b>{preview.member_name}</b> (
              {roleLabel(preview.role)}). Đăng nhập hoặc tạo tài khoản để nhận phòng.
            </span>
          </div>
        )}

        <div className="px-5 pt-4 flex gap-1.5">
          {[
            { key: 'login', label: 'Đăng nhập', icon: LogIn },
            { key: 'register', label: 'Tạo tài khoản', icon: UserPlus },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setError('');
              }}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
                tab === t.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mx-5 mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={tab === 'login' ? handleLogin : handleRegister} className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tên đăng nhập:</label>
            <input
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError('');
              }}
              placeholder="vd: thang.2a"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              className={inputClass}
            />
          </div>

          {tab === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tên hiển thị:</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="vd: Hồ Quốc Thắng"
                className={inputClass}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Mật khẩu:</label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              placeholder={tab === 'register' ? 'Ít nhất 8 ký tự' : '••••••••'}
              className={inputClass}
            />
          </div>

          {tab === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Nhập lại mật khẩu:
              </label>
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => {
                  setPasswordConfirm(e.target.value);
                  setError('');
                }}
                className={inputClass}
              />
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {busy ? 'Đang xử lý...' : tab === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
            </button>
          </div>
        </form>

        {roomHint?.roomId && (
          <div className="border-t border-slate-100">
            <button
              onClick={() => setRecoverOpen((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-3 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <span className="flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                Khôi phục chủ phòng bằng PIN
              </span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${recoverOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {recoverOpen && (
              <form onSubmit={handleRecover} className="px-5 pb-5 space-y-3">
                <p className="text-[11px] text-slate-500">
                  Dùng khi chủ phòng mất mật khẩu tài khoản. PIN của phòng{' '}
                  <span className="font-mono text-indigo-700">{roomHint.roomId}</span> là mã khôi phục
                  duy nhất, và sẽ được đổi sang mã mới ngay sau khi khôi phục.
                </p>

                {recoverError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{recoverError}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      PIN hiện tại:
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      value={recover.pin}
                      onChange={(e) => setRecover({ ...recover, pin: e.target.value })}
                      placeholder="••••••"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      PIN mới:
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      value={recover.newPin}
                      onChange={(e) => setRecover({ ...recover, newPin: e.target.value })}
                      placeholder="6–12 chữ số"
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Tên đăng nhập của bạn:
                    </label>
                    <input
                      value={recover.username}
                      onChange={(e) => setRecover({ ...recover, username: e.target.value })}
                      autoCapitalize="none"
                      placeholder="tài khoản cũ hoặc mới"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Mật khẩu:
                    </label>
                    <input
                      type="password"
                      value={recover.password}
                      onChange={(e) => setRecover({ ...recover, password: e.target.value })}
                      placeholder="≥ 8 ký tự"
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Tên hiển thị <span className="font-normal text-slate-400">(chỉ khi tạo tài khoản mới)</span>:
                  </label>
                  <input
                    value={recover.displayName}
                    onChange={(e) => setRecover({ ...recover, displayName: e.target.value })}
                    className={inputClass}
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={recoverBusy}
                    className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {recoverBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {recoverBusy ? 'Đang khôi phục...' : 'Khôi phục quyền chủ'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
