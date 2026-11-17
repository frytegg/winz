// A legibility panel over live video (FD10-F22): the blur is function, not decoration.
export function Stream() {
  return (
    <div className="relative">
      <video src="/demo.mp4" autoPlay muted />
      <div className="absolute bottom-4 left-4 rounded-lg bg-black/40 p-3 backdrop-blur-md">Live</div>
    </div>
  );
}
