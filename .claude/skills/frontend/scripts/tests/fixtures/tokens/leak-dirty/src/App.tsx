import { Geist } from 'next/font/google';
import '@fontsource/inter/400.css';

const geist = Geist({ subsets: ['latin'] });

// a comment with bg-[#000000] must not count
export function App() {
  return (
    <div className={`${geist.className} bg-[#1a1a2e] text-white`}>
      <section className="bg-gradient-to-r from-purple-500 to-blue-500 hover:bg-[oklch(0.5_0.2_280)]">
        <div className="backdrop-blur-[12px] bg-(--brand-glow) shadow-[0_4px_12px_rgba(0,0,0,0.1)] w-[37px]">
          <p style={{ color: '#ff0080' }}>Mint now</p>
        </div>
      </section>
    </div>
  );
}
