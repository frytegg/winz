// FD14-F16 (XRPL): a paper grain over a black vignette is texture over luminance, not grain over a colour gradient.
export function Vignette() {
  return (
    <div className="relative" style={{ background: 'radial-gradient(circle at center, transparent 40%, #000 100%)' }}>
      <img className="absolute left-0 top-0 opacity-10" src="/textures/paper-grain.png" alt="" />
    </div>
  );
}
