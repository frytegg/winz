export const help = 'Use background-clip: text over a gradient only for the wordmark.';

export function Title() {
  return (
    <div>
      {/* <h1 className="bg-gradient-to-r from-violet-500 to-blue-500 bg-clip-text text-transparent">old</h1> */}
      <h1 className="bg-[url('/paper-texture.jpg')] bg-cover bg-clip-text text-transparent">Printed matter</h1>
      <h2 className="bg-clip-text font-semibold text-zinc-100">Plain text with a stray utility</h2>
    </div>
  );
}
