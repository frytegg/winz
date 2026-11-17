// The agentfi shape (FD14 review): a cream 16px toggle knob and a terracotta category label on a near-black page.
const CATEGORY_COLOURS = { Risk: '#C47A5A', Yield: '#7A9E6E' };

export default function Page() {
  return (
    <main style={{ background: 'var(--bg-base)' }}>
      <span style={{ color: CATEGORY_COLOURS.Risk }}>Risk</span>
      <button role="switch" aria-checked="true" style={{ width: 32, height: 18 }}>
        <span style={{ display: 'block', width: 16, height: 16, borderRadius: 8, background: '#F5ECD7' }} />
      </button>
    </main>
  );
}
