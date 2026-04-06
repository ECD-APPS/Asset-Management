import { useEffect, useState } from 'react';

const PwaInstallPrompt = () => {
  const [deferred, setDeferred] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferred(event);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visible || !deferred) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[80] rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 shadow-lg">
      <div className="text-xs text-amber-900 mb-1">Install Expo app on your phone</div>
      <div className="flex gap-2">
        <button
          type="button"
          className="text-xs rounded-md bg-amber-500 hover:bg-amber-600 text-black px-2 py-1"
          onClick={async () => {
            deferred.prompt();
            await deferred.userChoice.catch(() => null);
            setVisible(false);
            setDeferred(null);
          }}
        >
          Install
        </button>
        <button
          type="button"
          className="text-xs rounded-md border border-amber-300 px-2 py-1"
          onClick={() => setVisible(false)}
        >
          Later
        </button>
      </div>
    </div>
  );
};

export default PwaInstallPrompt;
