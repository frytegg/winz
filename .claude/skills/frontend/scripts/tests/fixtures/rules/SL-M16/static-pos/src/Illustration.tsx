export function Illustration() {
  return (
    <div>
      <svg viewBox="0 0 400 300" className="w-full">
        <rect x="0" y="0" width="400" height="300" />
        <circle cx="50" cy="50" r="20" />
        <circle cx="120" cy="60" r="14" />
        <circle cx="200" cy="80" r="30" />
        <rect x="40" y="140" width="80" height="40" rx="8" />
        <rect x="140" y="140" width="80" height="40" rx="8" />
        <rect x="240" y="140" width="80" height="40" rx="8" />
        <ellipse cx="300" cy="60" rx="40" ry="20" />
        <polygon points="10,290 60,240 110,290" />
        <polygon points="290,290 340,240 390,290" />
        <line x1="0" y1="200" x2="400" y2="200" />
        <circle cx="350" cy="250" r="10" />
        <path d="M0 0 L10 10" />
      </svg>
      <div className="flex gap-1.5">
        <span className="h-3 w-3 rounded-full bg-red-500" />
        <span className="h-3 w-3 rounded-full bg-yellow-500" />
        <span className="h-3 w-3 rounded-full bg-green-500" />
      </div>
      <div className="flex justify-between">
        <span>9:41</span>
      </div>
    </div>
  );
}
