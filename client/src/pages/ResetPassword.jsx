import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => String(searchParams.get('token') || '').trim(), [searchParams]);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, loading: authLoading, branding } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && user) {
      navigate('/', { replace: true });
    }
  }, [user, authLoading, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!token) {
      setError('This reset link is missing a token. Open the link from your email or request a new reset.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/reset-password', { token, password });
      setInfo(data?.message || 'Password updated.');
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-app-page relative overflow-hidden font-sans text-app-main">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-[30%] h-[30%] bg-app-accent-soft rounded-full blur-3xl opacity-70" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[30%] h-[30%] bg-white/40 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md px-6 relative z-10">
        {branding?.logoUrl ? (
          <div className="flex justify-center mb-7">
            <img
              src={branding.logoUrl}
              alt="Application logo"
              className="h-28 md:h-32 w-auto object-contain drop-shadow-sm animate-spin"
              style={{ animationDuration: '20s' }}
            />
          </div>
        ) : null}

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
          <h2 className="text-xl font-bold text-slate-800 mb-2 text-center">Set a new password</h2>
          <p className="text-sm text-slate-600 text-center mb-6">
            Choose a new password for your account, then sign in with it.
          </p>

          {!token && (
            <div className="mb-6 p-4 bg-amber-50 text-amber-900 text-sm rounded-lg border border-amber-100">
              This page needs a valid link from your reset email.{' '}
              <Link className="font-medium text-amber-700 hover:text-amber-800" to="/forgot-password">
                Request a new link
              </Link>
              .
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-600" />
              {error}
            </div>
          )}

          {info && (
            <div className="mb-6 p-4 bg-emerald-50 text-emerald-800 text-sm rounded-lg border border-emerald-100 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
              {info}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-slate-700 text-sm font-semibold mb-2 ml-1" htmlFor="reset-password">
                New password
              </label>
              <div className="relative">
                <input
                  id="reset-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all text-slate-800 placeholder-slate-400"
                  placeholder="Enter new password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" aria-hidden /> : <Eye className="w-5 h-5" aria-hidden />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-slate-700 text-sm font-semibold mb-2 ml-1" htmlFor="reset-confirm">
                Confirm new password
              </label>
              <div className="relative">
                <input
                  id="reset-confirm"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all text-slate-800 placeholder-slate-400"
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? <EyeOff className="w-5 h-5" aria-hidden /> : <Eye className="w-5 h-5" aria-hidden />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !token}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 rounded-lg transition-all shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2 mt-2"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Updating…</span>
                </>
              ) : (
                <span>Update password</span>
              )}
            </button>

            <div className="text-center pt-2">
              <Link
                to="/login"
                className="text-amber-600 hover:text-amber-700 text-sm font-medium transition-colors"
              >
                Back to sign in
              </Link>
            </div>
          </form>
        </div>

        <p className="text-center text-slate-400 text-xs mt-8">
          © {new Date().getFullYear()} Expo City Dubai. All rights reserved.
        </p>
      </div>
    </div>
  );
};

export default ResetPassword;
