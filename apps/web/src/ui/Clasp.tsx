/** A small brass clasp: a plate on the cover and a hinged tab that just peeks over the page edge. Decorative. */
export function Clasp() {
  return (
    <div className="lt-clasp" aria-hidden="true">
      <svg viewBox="0 0 30 44" focusable="false">
        <defs>
          <linearGradient id="lt-brass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="lt-brass-a" />
            <stop offset=".45" className="lt-brass-b" />
            <stop offset="1" className="lt-brass-c" />
          </linearGradient>
          <linearGradient id="lt-brass-dark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="lt-brass-e" />
            <stop offset="1" className="lt-brass-d" />
          </linearGradient>
        </defs>
        <rect x="1" y="2" width="17" height="40" rx="4" className="lt-brass-fill lt-brass-line" />
        <path className="lt-brass-hi" d="M4 6 V38" />
        <circle cx="7" cy="9" r="1.8" className="lt-brass-rivet" />
        <circle cx="7" cy="35" r="1.8" className="lt-brass-rivet" />
        <rect x="13" y="12" width="16" height="20" rx="4" className="lt-brass-dark lt-brass-line" />
        <circle cx="21" cy="22" r="1.8" className="lt-brass-rivet" />
      </svg>
    </div>
  );
}
