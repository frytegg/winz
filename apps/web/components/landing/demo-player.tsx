"use client";

import { useEffect, useId, useRef, useState } from "react";

import { landingCopy } from "@/lib/landing/copy";
import { embedUrl, resolveDemoVideo } from "@/lib/landing/video";
import { cn } from "@/lib/utils";

const { demo } = landingCopy;

/**
 * The lime round of the mockup: 95 px at 1728, a phone's thumb target on a small screen. The frame carries
 * it as `--play` so that the hint under it can sit one radius below the middle.
 */
const PLAY_SIZE = "[--play:clamp(64px,calc(95*var(--u)),96px)]";

const playButton = cn(
  "grid size-[var(--play)] place-items-center rounded-full bg-lime text-ink no-underline",
  "transition-transform duration-200 ease-out hover:scale-[1.06] motion-reduce:transition-none motion-reduce:hover:scale-100",
  "focus-visible:outline-lime",
);

/**
 * The play triangle of the mockup: 32 x 35 on a 95 px round, 3 px right of the middle so that it looks
 * centered. A triangle drawn small and thickened by a round stroke, so that all three corners are round.
 */
function PlayGlyph(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 35"
      className="ml-[6%] h-[37%] w-auto"
      fill="currentColor"
    >
      <path d="M4 4V31L28 17.5Z" stroke="currentColor" strokeWidth="8" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The Demo's 16:9 player (`sections/04-demo.md`): a black frame with a lime play button, and NOTHING loaded
 * before the click: no iframe, no script, no request. The click replaces the button with the player
 * (YouTube in `youtube-nocookie.com` with autoplay, a Drive preview, or a `<video controls>`), and puts the
 * focus in it, so that a keyboard user is not dropped on the page when the button goes.
 *
 * With no `videoUrl` the button is shown inactive and says why under itself: a focusable `button` with
 * `aria-disabled` (a keyboard and a screen-reader user can reach it, and "Demo video coming soon." is its
 * description), never a link to nowhere. A link the page cannot embed opens in a new tab.
 *
 * The frame is the mockup's 1112 x 572 from 1024 px up and 16:9 below; whatever it is, the player inside is
 * 16:9, so a video is never stretched (on the wide frame the sides are black, as the frame is).
 */
export function DemoPlayer({
  videoUrl,
}: {
  /** `landingLinks.videoUrl`. */
  videoUrl: string | null;
}): React.JSX.Element {
  const video = resolveDemoVideo(videoUrl);
  const [playing, setPlaying] = useState(false);
  const soonId = useId();
  const mediaRef = useRef<HTMLIFrameElement | HTMLVideoElement | null>(null);

  useEffect(() => {
    if (playing) mediaRef.current?.focus();
  }, [playing]);

  const frame = cn(
    "relative mx-auto grid w-full place-items-center overflow-hidden bg-black",
    "aspect-video rounded-[clamp(20px,calc(64*var(--u)),64px)]",
    "lg:aspect-auto lg:h-[calc(572*var(--u))] lg:w-[calc(1112*var(--u))]",
    PLAY_SIZE,
  );

  if (video.kind === "none") {
    return (
      <div className={frame}>
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={soonId}
          aria-label={demo.play}
          className={cn(playButton, "cursor-not-allowed bg-lime-dim hover:scale-100")}
        >
          <PlayGlyph />
        </button>
        <p
          id={soonId}
          className="absolute inset-x-4 top-[calc(50%+var(--play)/2+16px)] text-center text-sm text-white/70 lg:text-base"
        >
          {demo.soon}
        </p>
      </div>
    );
  }

  if (video.kind === "external") {
    return (
      <div className={frame}>
        <a
          href={video.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={demo.external}
          className={playButton}
        >
          <PlayGlyph />
        </a>
      </div>
    );
  }

  if (!playing) {
    return (
      <div className={frame}>
        <button
          type="button"
          aria-label={demo.play}
          className={cn(playButton, "cursor-pointer")}
          onClick={() => {
            setPlaying(true);
          }}
        >
          <PlayGlyph />
        </button>
      </div>
    );
  }

  if (video.kind === "file") {
    return (
      <div className={frame}>
        <video
          ref={(node) => {
            mediaRef.current = node;
          }}
          src={video.src}
          controls
          autoPlay
          playsInline
          title={demo.frameTitle}
          className="size-full object-contain"
        />
      </div>
    );
  }

  return (
    <div className={frame}>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="aspect-video h-full max-w-full">
          <iframe
            ref={(node) => {
              mediaRef.current = node;
            }}
            src={embedUrl(video)}
            title={demo.frameTitle}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="size-full border-0"
          />
        </div>
      </div>
    </div>
  );
}
