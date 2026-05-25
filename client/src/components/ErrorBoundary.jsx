import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Catches unhandled React render errors and shows a friendly fallback
 * instead of a blank white screen.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4 animate-fade-in">
          <div className="w-16 h-16 bg-red-900/40 rounded-2xl flex items-center justify-center mx-auto border border-red-700/40">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>

          <h1 className="text-xl font-bold text-white">Có lỗi xảy ra</h1>
          <p className="text-slate-400 text-sm">
            Ứng dụng gặp sự cố không mong đợi. Hãy tải lại trang để thử lại.
          </p>

          {this.state.error && (
            <pre className="text-left text-xs text-slate-500 bg-slate-800 rounded-xl p-3 overflow-x-auto max-h-32">
              {this.state.error.message}
            </pre>
          )}

          <button
            onClick={() => window.location.reload()}
            className="btn-primary flex items-center gap-2 mx-auto"
          >
            <RefreshCw className="w-4 h-4" /> Tải lại trang
          </button>
        </div>
      </div>
    );
  }
}
