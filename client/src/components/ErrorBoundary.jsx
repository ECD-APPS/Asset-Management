import React from 'react';
import { AlertTriangle } from 'lucide-react';

const CHUNK_RELOAD_FLAG = 'chunk_reload_once_v1';

const isLikelyChunkLoadError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('failed loading dynamically imported module') ||
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('importing a module script failed')
  );
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  componentDidMount() {
    // Normal successful app boot: clear one-time chunk-reload marker.
    sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // You can also log the error to an error reporting service
    console.error("Uncaught error:", error, errorInfo);

    // Vite dev/prod deploy edge case: stale dynamic-import chunk URL after rebuild.
    // Auto-reload once so users do not get stuck on the error card.
    if (isLikelyChunkLoadError(error)) {
      const alreadyRetried = sessionStorage.getItem(CHUNK_RELOAD_FLAG) === '1';
      if (!alreadyRetried) {
        sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
        window.location.reload();
        return;
      }
    } else {
      sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
    }
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
          <div className="bg-white p-8 rounded-lg shadow-lg max-w-2xl w-full border-l-4 border-red-500">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="text-red-500 w-8 h-8" />
              <h1 className="text-2xl font-bold text-gray-800">Something went wrong</h1>
            </div>
            <p className="text-gray-600 mb-6">
              The application encountered an unexpected error. Please try refreshing the page.
            </p>
            
            <div className="bg-gray-100 p-4 rounded-md overflow-auto max-h-60 mb-6">
              <p className="font-mono text-sm text-red-600 whitespace-pre-wrap">
                {this.state.error && this.state.error.toString()}
              </p>
              {this.state.errorInfo && (
                <pre className="font-mono text-xs text-gray-500 mt-2">
                  {this.state.errorInfo.componentStack}
                </pre>
              )}
            </div>

            <button
              onClick={() => window.location.reload()}
              className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children; 
  }
}

export default ErrorBoundary;
