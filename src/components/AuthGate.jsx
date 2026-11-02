import React, { useState } from 'react';
import { AlertCircle, Home, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { authGoogle, claimInvite, recoverOwner } from '../services/api';
import { signInWithGoogle } from '../services/firebase';

export default function AuthGate({ invite, roomHint, onAuthed, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recoverRoomId, setRecoverRoomId] = useState(roomHint?.roomId || '');
  const [recoverPin, setRecoverPin] = useState('');
  const [recoverError, setRecoverError] = useState('');

  const preview = invite?.preview || null;

  const continueWithGoogle = async (recovery = false) => {
    setBusy(true);
    setError('');
    setRecoverError('');
    try {
      const google = await signInWithGoogle();
      const login = await authGoogle(google.idToken);
      if (!login.success) {
        setError(login.error || 'Không đăng nhập được bằng Google.');
        return;
      }

      let claimedRoomId = null;
      if (recovery) {
        const result = await recoverOwner({
          roomId: recoverRoomId.trim(),
          pin: recoverPin.trim(),
        });
        if (!result.success) {
          setRecoverError(result.error || 'Không khôi phục được quyền chủ phòng.');
          return;
        }
        claimedRoomId = result.room_id;
      } else if (invite?.token) {
        const result = await claimInvite(invite.token);
        if (result.success && !result.pending) {
          claimedRoomId = result.room_id;
        } else if (result.pending) {
          window.alert('Yêu cầu tham gia đã gửi cho chủ phòng. Bạn sẽ vào được phòng sau khi được duyệt.');
        } else {
          window.alert(result.error || 'Không nhận được link mời này.');
        }
      }
      onAuthed({ claimedRoomId });
    } catch (error) {
      if (error?.code === 'auth/popup-closed-by-user') {
        setError('Bạn đã đóng cửa sổ đăng nhập Google.');
      } else if (error?.code === 'auth/unauthorized-domain') {
        setError('Tên miền này chưa được cho phép trong Firebase Authentication.');
      } else {
        setError(error?.message || 'Không hoàn tất được đăng nhập Google.');
      }
    } finally {
      setBusy(false);
    }
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
                Tạo tài khoản hoặc đăng nhập bằng Google
              </p>
            </div>
          </div>
        </div>

        {preview && (
          <div className="mx-5 mt-4 p-3 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-indigo-600" />
            <span>
              Link này mời bạn vào <b>{preview.room_name}</b> với hồ sơ <b>{preview.member_name}</b>.
              {preview.requires_approval
                ? ' Sau khi đăng nhập, yêu cầu sẽ được chủ phòng duyệt.'
                : ' Sau khi đăng nhập, bạn sẽ vào phòng ngay.'}
            </span>
          </div>
        )}

        {error && (
          <div className="mx-5 mt-4 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-5 space-y-3">
          <button
            onClick={() => continueWithGoogle()}
            disabled={busy}
            className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2.5"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <span className="font-bold text-base text-indigo-600">G</span>
            )}
            {busy ? 'Đang kết nối Google...' : 'Tiếp tục với Google'}
          </button>
          <p className="text-[11px] text-center text-slate-500">
            Tài khoản được tạo tự động lần đầu đăng nhập. Muốn vào phòng, hãy nhận link từ chủ phòng.
          </p>
        </div>

        {(
          <div className="border-t border-slate-100">
            <button
              onClick={() => {
                setRecoverOpen((value) => !value);
                setRecoverError('');
              }}
              className="w-full flex items-center justify-between px-5 py-3 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <span className="flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                Tôi là chủ phòng{recoverRoomId ? ` ${recoverRoomId}` : ''}
              </span>
              <span>{recoverOpen ? 'Thu gọn' : 'Nhập PIN khôi phục'}</span>
            </button>
            {recoverOpen && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!recoverRoomId.trim()) {
                    setRecoverError('Nhập mã phòng cần nhận quyền.');
                    return;
                  }
                  if (!/^\d{6,12}$/.test(recoverPin.trim())) {
                    setRecoverError('Mã PIN cần 6–12 chữ số.');
                    return;
                  }
                  continueWithGoogle(true);
                }}
                className="px-5 pb-5 space-y-3"
              >
                <p className="text-[11px] text-slate-500">
                  Đăng nhập Google rồi nhập PIN của phòng để nhận quyền chủ. PIN sẽ được đổi ngay sau khi xác nhận.
                </p>
                <input
                  value={recoverRoomId}
                  onChange={(event) => setRecoverRoomId(event.target.value)}
                  placeholder="Mã phòng, ví dụ: 2a"
                  aria-label="Mã phòng"
                  className={inputClass}
                />
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={recoverPin}
                  onChange={(event) => setRecoverPin(event.target.value)}
                  placeholder="Mã PIN của phòng (6–12 số)"
                  aria-label="Mã PIN"
                  className={inputClass}
                />
                {recoverError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{recoverError}</span>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  {onCancel && (
                    <button
                      type="button"
                      onClick={onCancel}
                      className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                    >
                      Hủy
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Xác nhận bằng Google
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
        {onCancel && !recoverOpen && (
          <div className="px-5 pb-5 text-right">
            <button onClick={onCancel} className="text-xs font-semibold text-slate-500 hover:text-slate-800">
              Quay lại
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
