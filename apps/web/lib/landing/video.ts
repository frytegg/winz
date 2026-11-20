/**
 * What the Demo section's player does with `landingLinks.videoUrl`. Pure, and with no `@/` import.
 *
 * The page embeds what it can embed without a script of its own, and only after a click (see
 * `DemoPlayer`): a YouTube video (in `youtube-nocookie.com`, which sets no cookie until the video
 * plays), a Google Drive file (its preview page), a video file (`<video controls>`). Any other link
 * (Vimeo, Loom, Streamable, a page) is not embedded: the play button then opens it in a new tab, which is
 * honest, where an iframe of a site that refuses framing would show an error page.
 */

export type DemoVideo =
  /** No video yet: the play button is shown inactive. */
  | { readonly kind: "none" }
  | { readonly kind: "youtube"; readonly id: string }
  | { readonly kind: "drive"; readonly id: string }
  | { readonly kind: "file"; readonly src: string }
  /** A video the page cannot embed: an https link, opened in a new tab. */
  | { readonly kind: "external"; readonly href: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;
const VIDEO_FILE = /\.(mp4|webm|mov|m4v|ogv)$/i;

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const YOUTUBE_NOCOOKIE_HOSTS = new Set(["youtube-nocookie.com", "www.youtube-nocookie.com"]);

/** The 11-character id of a YouTube link of any usual shape, or `null`. */
function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter((part) => part !== "");
  let candidate: string | null = null;

  if (host === "youtu.be") {
    candidate = segments[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === "watch") candidate = url.searchParams.get("v");
    else if (["embed", "shorts", "live", "v"].includes(segments[0] ?? "")) candidate = segments[1] ?? null;
  } else if (YOUTUBE_NOCOOKIE_HOSTS.has(host)) {
    if (segments[0] === "embed") candidate = segments[1] ?? null;
  }
  return candidate !== null && YOUTUBE_ID.test(candidate) ? candidate : null;
}

/** The id of a Google Drive file link (`/file/d/<id>/view`, `/open?id=<id>`, `/uc?id=<id>`), or `null`. */
function driveId(url: URL): string | null {
  if (url.hostname.toLowerCase() !== "drive.google.com") return null;
  const fromPath = /^\/file\/(?:u\/\d+\/)?d\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
  const candidate = fromPath ?? url.searchParams.get("id");
  return candidate !== null && DRIVE_ID.test(candidate) ? candidate : null;
}

/**
 * Reads the link. `null`, an empty string, `#` or anything that is not an https URL or a path of this
 * site is `none` (the page never builds a player, or a link, out of it).
 */
export function resolveDemoVideo(value: string | null | undefined): DemoVideo {
  if (value === null || value === undefined) return { kind: "none" };
  const text = value.trim();

  // A path of this site (`/demo.mp4`): a file in `public/`, or nothing.
  if (/^\/(?!\/)\S*$/.test(text)) {
    const path = text.split(/[?#]/)[0] ?? "";
    return VIDEO_FILE.test(path) ? { kind: "file", src: text } : { kind: "none" };
  }

  if (!/^https:\/\/[^\s/]\S*$/.test(text)) return { kind: "none" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { kind: "none" };
  }

  const youtube = youtubeId(url);
  if (youtube !== null) return { kind: "youtube", id: youtube };

  const drive = driveId(url);
  if (drive !== null) return { kind: "drive", id: drive };

  if (VIDEO_FILE.test(url.pathname)) return { kind: "file", src: url.toString() };
  return { kind: "external", href: url.toString() };
}

/**
 * The address of the iframe for a YouTube or Drive video. `autoplay=1` is allowed because the iframe only
 * exists after the visitor's click; `rel=0` keeps the end screen to this channel's videos.
 */
export function embedUrl(video: Extract<DemoVideo, { kind: "youtube" | "drive" }>): string {
  if (video.kind === "youtube") {
    return `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&playsinline=1`;
  }
  return `https://drive.google.com/file/d/${video.id}/preview`;
}
