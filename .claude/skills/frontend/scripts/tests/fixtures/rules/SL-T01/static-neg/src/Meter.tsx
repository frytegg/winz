// A reputation meter (FD14-F07: ETHDenver's four-stop data ramp is not the tell).
export function Meter({ score }: { score: number }) {
  return (
    <div className="h-2 w-full rounded" style={{ background: 'linear-gradient(to right, #7A9E6E, #5B9BD5, #A78BFA, #C9A84C)' }}>
      <span style={{ left: `${score}%` }} />
    </div>
  );
}

export function Washes() {
  return (
    <div>
      {/* <div className="bg-gradient-to-r from-violet-600 to-blue-500" /> */}
      <div className="bg-gradient-to-r from-indigo-500 to-blue-600">indigo into blue stays one family</div>
      <div className="bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400">a sunset, not purple into blue</div>
      <div className="bg-gradient-to-r from-violet-100 to-sky-100">a pale wash</div>
    </div>
  );
}
