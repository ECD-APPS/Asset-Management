import { useEffect, useState } from 'react';

const PwaInstallPrompt = () => {
  const [deferred, setDeferred] = useState(null);
  const [androidVisible, setAndroidVisible] = useState(false);
  const [iosVisible, setIosVisible] = useState(false);

  const isStandalone = () =>
    window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator.standalone === true;

  useEffect(() => {
    if (isStandalone()) return undefined;
    const dismissed = window.localStorage.getItem('expo_pwa_prompt_dismissed') === '1';
    const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
    const isSafari = /safari/i.test(window.navigator.userAgent || '') && !/crios|fxios|edgios/i.test(window.navigator.userAgent || '');
    if (!dismissed && isIOS && isSafari) setIosVisible(true);

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferred(event);
      setAndroidVisible(true);
    };
    const onInstalled = () => {
      setAndroidVisible(false);
      setIosVisible(false);
      setDeferred(null);
      window.localStorage.setItem('expo_pwa_prompt_dismissed', '1');
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!androidVisible && !iosVisible) return null;

  return (
    <div className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:w-[22rem] z-[80] rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 shadow-lg">
      <div className="text-xs text-amber-900 mb-1 font-semibold">Install Expo City Dubai app</div>
      {androidVisible && deferred ? (
        <div className="flex gap-2 items-center">
          <button
            type="button"
            className="text-xs rounded-md bg-amber-500 hover:bg-amber-600 text-black px-2 py-1"
            onClick={async () => {
              deferred.prompt();
              await deferred.userChoice.catch(() => null);
              setAndroidVisible(false);
              setDeferred(null);
            }}
          >
            Install
          </button>
          <button
            type="button"
            className="text-xs rounded-md border border-amber-300 px-2 py-1"
            onClick={() => {
              setAndroidVisible(false);
              window.localStorage.setItem('expo_pwa_prompt_dismissed', '1');
            }}
          >
            Later
          </button>
        </div>
      ) : null}
      {iosVisible ? (
        <div className="text-[11px] text-amber-900 leading-relaxed">
          In Safari, tap the Share button then select <strong>Add to Home Screen</strong>.
          <div className="mt-2">
            <button
              type="button"
              className="text-xs rounded-md border border-amber-300 px-2 py-1"
              onClick={() => {
                setIosVisible(false);
                window.localStorage.setItem('expo_pwa_prompt_dismissed', '1');
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {!androidVisible && !iosVisible ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="text-xs rounded-md border border-amber-300 px-2 py-1"
            onClick={() => {
              setAndroidVisible(false);
              setIosVisible(false);
            }}
          >
            Close
          </button>
        </div>
      ) : null}
      <div className="sr-only">
        App installation prompt
      </div>
    </div>
  );
};

export default PwaInstallPrompt;
