export function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 256 256" role="img" aria-label="Specfold">
      <defs>
        <linearGradient id="brand-badge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2563EB" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill="url(#brand-badge)" />
      <g stroke="#ffffff" strokeWidth="13" strokeLinecap="round">
        <line x1="92" y1="96" x2="176" y2="104" />
        <line x1="176" y1="104" x2="120" y2="176" />
        <line x1="120" y1="176" x2="92" y2="96" />
      </g>
      <g fill="#ffffff">
        <circle cx="92" cy="96" r="19" />
        <circle cx="176" cy="104" r="19" />
        <circle cx="120" cy="176" r="19" />
      </g>
    </svg>
  );
}

