// Verbatim hero of a past build (ETHDenver agentfi frontend/src/app/page.tsx:155-177, FD14-F15): the formula sits in
// the lead paragraph under the h1, not in a heading.
export function Landing() {
  return (
        <section className="relative mx-auto max-w-7xl px-6" style={{ paddingTop: "100px", paddingBottom: "80px", minHeight: "100vh" }}>
          <div className="grid w-full gap-12 lg:grid-cols-5">
            {/* Left */}
            <div className="flex flex-col justify-center lg:col-span-3">
              <h1
                className={`fade-in-up mb-6 text-4xl font-bold leading-tight lg:text-5xl xl:text-6xl`}
                style={{ animationDelay: "100ms", color: "var(--text-primary)", letterSpacing: "0.02em" }}
              >
                The Banking System
                <br />
                For Autonomous
                <br />
                <span style={{ color: "var(--gold)" }}>AI Agents</span>
              </h1>

              <p
                className="fade-in-up mb-8 max-w-lg text-lg leading-relaxed"
                style={{ animationDelay: "200ms", color: "var(--text-secondary)" }}
              >
                Hire specialized AI agents. Pay on ADI Chain.
                <br />
                Own them as iNFTs on 0G Chain. Built for the agentic economy.
              </p>
          </div>
        </div>
      </section>
  );
}
