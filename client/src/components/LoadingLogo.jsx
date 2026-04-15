import PropTypes from 'prop-types';

export const LOADING_LOGO_SRC = '/loading-logo.png';

/**
 * Branded loading mark: rotating logo. Use for boot, route lazy-load, and in-page waits.
 */
export default function LoadingLogo({
  message,
  subMessage,
  className = '',
  sizeClass = 'w-24 h-24'
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <div
        className={`${sizeClass} shrink-0 motion-reduce:animate-none animate-[spin_2.3s_linear_infinite]`}
        aria-hidden
      >
        <img
          src={LOADING_LOGO_SRC}
          alt=""
          className="h-full w-full object-contain select-none drop-shadow-md"
          draggable={false}
          width={96}
          height={96}
        />
      </div>
      {message ? (
        <p className="max-w-xs text-center text-sm font-semibold text-inherit">{message}</p>
      ) : null}
      {subMessage ? (
        <p className="max-w-xs text-center text-xs opacity-80 text-inherit">{subMessage}</p>
      ) : null}
    </div>
  );
}

LoadingLogo.propTypes = {
  message: PropTypes.string,
  subMessage: PropTypes.string,
  className: PropTypes.string,
  sizeClass: PropTypes.string
};
