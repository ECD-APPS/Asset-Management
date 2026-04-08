import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const FALLBACK_LOGO = '/logo.svg';

const Login = () => {
  const [identifier, setIdentifier] = useState(''); // Email or Username
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [logoSrc, setLogoSrc] = useState(FALLBACK_LOGO);
  const { login, user, loading: authLoading, branding } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = location.state?.from?.pathname;
  const redirectAfterLogin = useCallback((loggedUser) => {
    if (fromPath && fromPath !== '/login') {
      navigate(fromPath, { replace: true });
      return;
    }
    if (loggedUser.role === 'Super Admin') {
      navigate('/portal', { replace: true });
    } else if (loggedUser.role === 'Technician') {
      navigate('/scanner', { replace: true });
    } else {
      navigate('/', { replace: true });
    }
  }, [fromPath, navigate]);

  useEffect(() => {
    if (!authLoading && user) {
      redirectAfterLogin(user);
    }
  }, [user, authLoading, redirectAfterLogin]);

  useEffect(() => {
    setLogoSrc(branding?.logoUrl || FALLBACK_LOGO);
  }, [branding?.logoUrl]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      // Backend expects 'email' key but we configured it to check username too
      const loggedInUser = await login(identifier, password);
      
      redirectAfterLogin(loggedInUser);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-app-page relative overflow-hidden font-sans text-app-main">
      {/* Decorative Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-[30%] h-[30%] bg-app-accent-soft rounded-full blur-3xl opacity-70"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-[30%] h-[30%] bg-white/40 rounded-full blur-3xl"></div>
      </div>

      <div className="w-full max-w-md px-6 relative z-10">
        {/* Logo Section */}
        <div className="flex flex-col items-center mb-8">
           <img
             src={logoSrc}
             alt="Expo City Dubai"
             className="h-24 w-auto mb-4 drop-shadow-sm"
             onError={() => setLogoSrc((prev) => (prev === FALLBACK_LOGO ? prev : FALLBACK_LOGO))}
           />
           <div className="text-center">
             <h1 className="text-2xl font-bold tracking-tight text-app-main uppercase">Expo City Dubai</h1>
             <div className="flex items-center justify-center gap-2 mt-2">
               <div className="h-0.5 w-8 bg-app-accent rounded-full"></div>
               <p className="text-xs text-slate-500 tracking-[0.2em] uppercase font-bold">Asset Management</p>
               <div className="h-0.5 w-8 bg-app-accent rounded-full"></div>
             </div>
           </div>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
          <h2 className="text-xl font-bold text-slate-800 mb-6 text-center">
            Sign In to Your Account
          </h2>

          {error && (
            <div className="mb-6 p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-600"></span>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-slate-700 text-sm font-semibold mb-2 ml-1">
                Username or Email
              </label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all text-slate-800 placeholder-slate-400"
                placeholder="Enter your username"
                required
              />
            </div>

            <div>
              <label className="block text-slate-700 text-sm font-semibold mb-2 ml-1">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all text-slate-800 placeholder-slate-400"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={0}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" aria-hidden /> : <Eye className="w-5 h-5" aria-hidden />}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button 
                type="button" 
                className="text-amber-600 hover:text-amber-700 text-sm font-medium transition-colors"
                onClick={() => alert('Please contact your administrator to reset password.')}
              >
                Forgot Password?
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 rounded-lg transition-all shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2 mt-4"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Signing In...</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </button>
          </form>
        </div>
        
        {/* Footer */}
        <p className="text-center text-slate-400 text-xs mt-8">
          © {new Date().getFullYear()} Expo City Dubai. All rights reserved.
        </p>
      </div>
    </div>
  );
};

export default Login;
