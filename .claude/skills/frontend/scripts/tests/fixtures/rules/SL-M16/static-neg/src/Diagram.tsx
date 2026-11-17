export function Diagram() {
  return (
    <div>
      <svg viewBox="0 0 24 24" width="24" height="24">
        <circle cx="2" cy="2" r="1" />
        <circle cx="4" cy="2" r="1" />
        <circle cx="6" cy="2" r="1" />
        <circle cx="8" cy="2" r="1" />
        <circle cx="10" cy="2" r="1" />
        <circle cx="12" cy="2" r="1" />
        <circle cx="14" cy="2" r="1" />
        <circle cx="16" cy="2" r="1" />
        <circle cx="18" cy="2" r="1" />
        <circle cx="20" cy="2" r="1" />
        <circle cx="22" cy="2" r="1" />
        <circle cx="2" cy="4" r="1" />
        <circle cx="4" cy="4" r="1" />
      </svg>
      <svg viewBox="0 0 600 200" className="w-full">
        <rect x="10" y="10" width="100" height="40" />
        <rect x="150" y="10" width="100" height="40" />
        <rect x="290" y="10" width="100" height="40" />
        <rect x="430" y="10" width="100" height="40" />
        <line x1="110" y1="30" x2="150" y2="30" />
        <line x1="250" y1="30" x2="290" y2="30" />
        <line x1="390" y1="30" x2="430" y2="30" />
        <circle cx="60" cy="120" r="10" />
        <circle cx="200" cy="120" r="10" />
        <circle cx="340" cy="120" r="10" />
        <circle cx="480" cy="120" r="10" />
        <rect x="10" y="160" width="520" height="20" />
        <text x="20" y="35">Deposit</text>
        <text x="160" y="35">Lock</text>
      </svg>
      <span className="h-2 w-2 rounded-full bg-red-500" aria-label="Failed" />
      <p>Meeting at 9:41 am</p>
    </div>
  );
}
