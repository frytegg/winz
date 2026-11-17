export function Cards() {
  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-md">
        <h3>Vaults</h3>
      </div>
      <div className="rounded-xl p-6 backdrop-blur-[20px]" style={{ background: 'rgba(15, 23, 42, 0.45)' }}>
        <h3>Rates</h3>
      </div>
      <div style={{ backdropFilter: 'blur(8px)', background: 'rgba(124, 58, 237, 0.2)', borderRadius: 12 }}>
        <h3>Oracles</h3>
      </div>
    </div>
  );
}
