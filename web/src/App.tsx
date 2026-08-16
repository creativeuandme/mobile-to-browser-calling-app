import React, { useEffect, useState } from 'react';
import { GuestCallPage } from './components/GuestCallPage';
import { PhoneCall, Lock, ArrowRight } from 'lucide-react';

export const App: React.FC = () => {
  const [token, setToken] = useState<string | null>(null);
  const [inputToken, setInputToken] = useState<string>('');

  useEffect(() => {
    // Parse /call/:token from pathname or query param ?token=
    const path = window.location.pathname;
    const match = path.match(/\/call\/([a-zA-Z0-9_-]+)/i);

    if (match && match[1]) {
      setToken(match[1]);
    } else {
      const searchParams = new URLSearchParams(window.location.search);
      const qToken = searchParams.get('token');
      if (qToken) {
        setToken(qToken);
      }
    }
  }, []);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputToken.trim()) return;

    let extractedToken = inputToken.trim();
    // Extract token if user pasted full URL e.g. http://192.168.0.122:3000/call/abc123...
    const urlMatch = extractedToken.match(/\/call\/([a-zA-Z0-9_-]+)/i);
    if (urlMatch && urlMatch[1]) {
      extractedToken = urlMatch[1];
    }

    setToken(extractedToken);
    window.history.pushState({}, '', `/call/${extractedToken}`);
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-8 shadow-2xl">
          <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <PhoneCall className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100 mb-2">Private Calling Portal</h1>
          <p className="text-sm text-slate-400 mb-6">
            Enter your private calling link token below or open a private URL provided by the owner.
          </p>

          <form onSubmit={handleManualSubmit} className="space-y-4 mb-6">
            <div className="relative">
              <input
                type="text"
                value={inputToken}
                onChange={(e) => setInputToken(e.target.value)}
                placeholder="Paste token or link URL here..."
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-3.5 px-4 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={!inputToken.trim()}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-2xl shadow-lg shadow-emerald-900/20 transition-all"
            >
              Start Call Session <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="bg-slate-950 p-4 rounded-xl text-left border border-slate-800 text-xs text-slate-500 space-y-1">
            <p className="font-semibold text-slate-400 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-emerald-400" /> URL Format Example:
            </p>
            <code className="text-emerald-400 font-mono block break-all pt-1">
              http://192.168.0.122:3000/call/&lt;secure-token&gt;
            </code>
          </div>
        </div>
      </div>
    );
  }

  return <GuestCallPage token={token} />;
};

export default App;
