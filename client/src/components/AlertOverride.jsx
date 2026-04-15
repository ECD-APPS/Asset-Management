import { useEffect, useRef, useState } from 'react';

const AlertOverride = () => {
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const restoreRef = useRef(null);
  const activeRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const originalAlert = window.alert ? window.alert.bind(window) : null;
    restoreRef.current = originalAlert;
    activeRef.current = true;

    window.alert = (message) => {
      if (!activeRef.current) {
        if (originalAlert) originalAlert(message);
        return;
      }
      setQueue((prev) => [...prev, String(message ?? '')]);
    };

    return () => {
      activeRef.current = false;
      if (restoreRef.current) {
        window.alert = restoreRef.current;
      }
    };
  }, []);

  useEffect(() => {
    if (current !== null) return;
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    setCurrent(next);
    setQueue(rest);
  }, [queue, current]);

  if (current === null) return null;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-900/45 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-slate-900">Notification</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{current}</p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => setCurrent(null)}
            autoFocus
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlertOverride;
