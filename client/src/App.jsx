import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import LoadingLogo from './components/LoadingLogo';
import ApiLoadingOverlay from './components/ApiLoadingOverlay';
import PwaInstallPrompt from './components/PwaInstallPrompt';
import PropTypes from 'prop-types';
// Eager-load home route: repeated refresh can abort lazy chunk fetches (Vite dynamic import errors).
import Dashboard from './pages/Dashboard';

const Login = lazy(() => import('./pages/Login'));
const Portal = lazy(() => import('./pages/Portal'));
const Assets = lazy(() => import('./pages/Assets'));
const TechScanner = lazy(() => import('./pages/TechScanner'));
const Technicians = lazy(() => import('./pages/Technicians'));
const Stores = lazy(() => import('./pages/Stores'));
const TechAssets = lazy(() => import('./pages/TechAssets'));
const AdminTechnicianAssets = lazy(() => import('./pages/AdminTechnicianAssets'));
const TechRequest = lazy(() => import('./pages/TechRequest'));
const AdminRequests = lazy(() => import('./pages/AdminRequests'));
const AddMembers = lazy(() => import('./pages/AddMembers'));
const Vendors = lazy(() => import('./pages/Vendors'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const ReceiveProcess = lazy(() => import('./pages/ReceiveProcess'));
const DisposalProcess = lazy(() => import('./pages/DisposalProcess'));
const Products = lazy(() => import('./pages/Products'));
const ProductDetails = lazy(() => import('./pages/ProductDetails'));
const AssetHistory = lazy(() => import('./pages/AssetHistory'));
const NoSerialAssets = lazy(() => import('./pages/NoSerialAssets'));
const Setup = lazy(() => import('./pages/Setup'));
const Permits = lazy(() => import('./pages/Permits'));
const Passes = lazy(() => import('./pages/Passes'));
const RecentActivity = lazy(() => import('./pages/RecentActivity'));
const SystemLogs = lazy(() => import('./pages/SystemLogs'));
const Tools = lazy(() => import('./pages/Tools'));
const TechTools = lazy(() => import('./pages/TechTools'));
const Consumables = lazy(() => import('./pages/Consumables'));
// Eager-load PPM routes: soft refresh can abort lazy chunk loads and leave the page stuck on “Loading…”.
import TechPpmPanel from './pages/TechPpmPanel';
import PpmHistory from './pages/PpmHistory';

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading, activeStore, globalLoading } = useAuth();
  const location = useLocation();

  if (loading || globalLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-page px-4 text-app-main">
        <LoadingLogo
          message="Please wait…"
          subMessage="Processing your request."
          sizeClass="w-24 h-24"
          className="text-app-main"
        />
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Super Admin / Viewer Logic: Must have active store selected, unless on /portal
  if ((user.role === 'Super Admin' || user.role === 'Viewer') && !activeStore && location.pathname !== '/portal') {
    return <Navigate to="/portal" />;
  }

  if (allowedRoles) {
    // Super Admin has access to everything if store is selected (or if specific role logic allows)
    // But we might want to restrict Super Admin from Technician pages? 
    // "SUPER ADMIN HAVE ALL PERMISSIONS" -> implying they can access Admin pages.
    // Technician pages might be irrelevant but accessible.
    // If allowedRoles doesn't include Super Admin explicitly, we assume they have access unless restricted.
    // However, existing routes use ['Admin'] or ['Technician'].
    // Let's allow Super Admin if 'Admin' is allowed.
    // const effectiveRole = user.role === 'Super Admin' ? 'Admin' : user.role;
    
    // Check if user.role is in allowedRoles OR if user is Super Admin and 'Admin' is in allowedRoles
    const isAllowed = allowedRoles.includes(user.role) || (user.role === 'Super Admin' && allowedRoles.includes('Admin'));
    
    if (!isAllowed) {
      // Allow Super Admin to access everything? User said "SUPER ADMIN HAVE ALL PERMISSIONS".
      // So if user is Super Admin, just return children.
      if (user.role === 'Super Admin') return children;
      return <Navigate to="/" />;
    }
  }

  return children;
};

ProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
  allowedRoles: PropTypes.arrayOf(PropTypes.string)
};

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <ApiLoadingOverlay />
          <PwaInstallPrompt />
          <Suspense fallback={
            <div className="flex min-h-screen items-center justify-center bg-app-page px-4 text-app-main">
              <LoadingLogo
                message="Loading page…"
                subMessage="Fetching this section of Expo Stores."
                sizeClass="w-24 h-24"
                className="text-app-main"
              />
            </div>
          }>
            <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/portal" element={
            <ProtectedRoute allowedRoles={['Super Admin', 'Viewer']}>
              <Portal />
            </ProtectedRoute>
          } />
        
        <Route element={<Layout />}>
          <Route path="/" element={
            <ProtectedRoute>
              <DashboardWrapper />
            </ProtectedRoute>
          } />

          <Route path="/events/recent-activity" element={
            <ProtectedRoute allowedRoles={['Admin', 'Technician']}>
              <RecentActivity />
            </ProtectedRoute>
          } />

          <Route path="/events/system-logs" element={
            <ProtectedRoute allowedRoles={['Admin']}>
              <SystemLogs />
            </ProtectedRoute>
          } />
          
          <Route path="/assets" element={
            <ProtectedRoute allowedRoles={['Admin', 'Viewer']}>
              <Assets />
            </ProtectedRoute>
          } />
          
          <Route path="/asset/:id" element={
            <ProtectedRoute allowedRoles={['Admin', 'Viewer', 'Technician']}>
              <AssetHistory />
            </ProtectedRoute>
          } />

          <Route path="/assets/no-serial" element={
            <ProtectedRoute allowedRoles={['Admin', 'Viewer', 'Technician']}>
              <NoSerialAssets />
            </ProtectedRoute>
          } />

          <Route path="/technicians" element={
            <ProtectedRoute allowedRoles={['Admin']}>
              <Technicians />
            </ProtectedRoute>
          } />

          <Route path="/add-members" element={
            <ProtectedRoute allowedRoles={['Admin']}>
              <AddMembers />
            </ProtectedRoute>
          } />
          
          <Route path="/admin-tech-assets" element={
            <ProtectedRoute allowedRoles={['Admin']}>
              <AdminTechnicianAssets />
            </ProtectedRoute>
          } />

          <Route path="/stores" element={
            <ProtectedRoute allowedRoles={['Admin', 'Viewer']}>
              <Stores />
            </ProtectedRoute>
          } />

          <Route path="/tools" element={
            <ProtectedRoute allowedRoles={['Admin', 'Viewer']}>
              <Tools />
            </ProtectedRoute>
          } />

          <Route path="/tools/panel" element={
            <ProtectedRoute allowedRoles={['Technician', 'Admin']}>
              <TechTools />
            </ProtectedRoute>
          } />

          <Route path="/consumables" element={
            <ProtectedRoute allowedRoles={['Admin', 'Viewer']}>
              <Consumables />
            </ProtectedRoute>
          } />

          <Route path="/ppm" element={
            <ProtectedRoute allowedRoles={['Admin', 'Viewer', 'Technician']}>
              <TechPpmPanel />
            </ProtectedRoute>
          } />

          <Route path="/ppm/panel" element={
            <ProtectedRoute allowedRoles={['Admin', 'Viewer', 'Technician']}>
              <Navigate to="/ppm" replace />
            </ProtectedRoute>
          } />

          <Route path="/ppm/history" element={
            <ProtectedRoute allowedRoles={['Admin', 'Viewer', 'Technician']}>
              <PpmHistory />
            </ProtectedRoute>
          } />

          <Route path="/scanner" element={
            <ProtectedRoute allowedRoles={['Technician', 'Admin']}>
              <TechScanner />
            </ProtectedRoute>
          } />
          
          <Route path="/my-assets" element={
            <ProtectedRoute allowedRoles={['Technician']}>
              <TechAssets />
            </ProtectedRoute>
          } />
          
          <Route path="/tech-request" element={
            <ProtectedRoute allowedRoles={['Technician']}>
              <TechRequest />
            </ProtectedRoute>
          } />
          
          <Route path="/admin-requests" element={
            <ProtectedRoute allowedRoles={['Admin', 'Viewer']}>
              <AdminRequests />
            </ProtectedRoute>
          } />

          <Route path="/setup" element={
            <ProtectedRoute allowedRoles={['Admin']}>
              <Setup />
            </ProtectedRoute>
          } />

          <Route path="/vendors" element={
            <ProtectedRoute allowedRoles={['Admin', 'Viewer']}>
              <Vendors />
            </ProtectedRoute>
          } />

          <Route path="/purchase-orders" element={
            <ProtectedRoute allowedRoles={['Admin', 'Viewer']}>
              <PurchaseOrders />
            </ProtectedRoute>
          } />

          <Route path="/receive-process" element={
            <ProtectedRoute allowedRoles={['Admin']}>
              <ReceiveProcess />
            </ProtectedRoute>
          } />

          <Route path="/disposal-process" element={
            <ProtectedRoute allowedRoles={['Admin']}>
              <DisposalProcess />
            </ProtectedRoute>
          } />

          <Route path="/setup/products" element={
            <ProtectedRoute allowedRoles={['Admin']}>
              <Products />
            </ProtectedRoute>
          } />

          <Route path="/products" element={
            <ProtectedRoute allowedRoles={['Admin', 'Viewer']}>
              <Products readOnly={true} />
            </ProtectedRoute>
          } />

          <Route path="/products/:productName" element={
            <ProtectedRoute allowedRoles={['Admin', 'Viewer']}>
              <ProductDetails />
            </ProtectedRoute>
          } />

          

          <Route path="/permits" element={
            <ProtectedRoute allowedRoles={['Admin']}>
              <Permits />
            </ProtectedRoute>
          } />

          <Route path="/passes" element={
            <ProtectedRoute allowedRoles={['Admin']}>
              <Passes />
            </ProtectedRoute>
          } />

          {/* 404 Fallback */}
          <Route path="*" element={
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
              <h1 className="text-6xl font-bold text-gray-200 mb-4">404</h1>
              <h2 className="text-2xl font-semibold text-gray-700 mb-2">Page Not Found</h2>
              <p className="text-gray-500 mb-8">The page you are looking for does not exist or has been moved.</p>
              <a href="/" className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition-colors">
                Return to Dashboard
              </a>
            </div>
          } />
        </Route>
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    </AuthProvider>
  );
}

// Wrapper to redirect based on role for the index route
const DashboardWrapper = () => {
  const { user } = useAuth();
  if (user?.role === 'Technician') {
    return <Navigate to="/scanner" />;
  }
  return <Dashboard />;
};

export default App;
