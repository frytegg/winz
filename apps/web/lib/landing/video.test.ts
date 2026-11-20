import { describe, expect, it } from "vitest";

import { embedUrl, resolveDemoVideo } from "./video";

const ID = "dQw4w9WgXcQ";

describe("resolveDemoVideo: nothing to play", () => {
  it.each([null, undefined, "", "   ", "#", "//cdn.example.com/a.mp4", "http://example.com/a.mp4"])(
    "is none for %j",
    (value) => {
      expect(resolveDemoVideo(value)).toEqual({ kind: "none" });
    },
  );

  it("is none for a script, a data URL and text that is not a link", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,<p>x</p>", "coming soon"]) {
      expect(resolveDemoVideo(value)).toEqual({ kind: "none" });
    }
  });

  it("is none for a path of this site that is not a video file", () => {
    expect(resolveDemoVideo("/demo")).toEqual({ kind: "none" });
    expect(resolveDemoVideo("/demo.html")).toEqual({ kind: "none" });
  });
});

describe("resolveDemoVideo: YouTube", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?feature=share&v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ])("reads the id of %s", (url) => {
    expect(resolveDemoVideo(url)).toEqual({ kind: "youtube", id: ID });
  });

  it("does not take an id that is not 11 characters, or a channel page, for a video", () => {
    expect(resolveDemoVideo("https://www.youtube.com/watch?v=short")).toEqual({
      kind: "external",
      href: "https://www.youtube.com/watch?v=short",
    });
    expect(resolveDemoVideo("https://www.youtube.com/@winz")).toEqual({
      kind: "external",
      href: "https://www.youtube.com/@winz",
    });
  });

  it("does not take another site that has youtube in its name for YouTube", () => {
    expect(resolveDemoVideo(`https://youtube.com.evil.example/watch?v=${ID}`)).toEqual({
      kind: "external",
      href: `https://youtube.com.evil.example/watch?v=${ID}`,
    });
  });

  it("embeds from youtube-nocookie, with autoplay, since the iframe only exists after a click", () => {
    expect(embedUrl({ kind: "youtube", id: ID })).toBe(
      `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0&playsinline=1`,
    );
  });
});

describe("resolveDemoVideo: Google Drive", () => {
  const drive = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";

  it.each([
    `https://drive.google.com/file/d/${drive}/view?usp=sharing`,
    `https://drive.google.com/file/d/${drive}/preview`,
    `https://drive.google.com/file/u/0/d/${drive}/view`,
    `https://drive.google.com/open?id=${drive}`,
    `https://drive.google.com/uc?id=${drive}&export=download`,
  ])("reads the id of %s", (url) => {
    expect(resolveDemoVideo(url)).toEqual({ kind: "drive", id: drive });
  });

  it("embeds the file's preview page", () => {
    expect(embedUrl({ kind: "drive", id: drive })).toBe(
      `https://drive.google.com/file/d/${drive}/preview`,
    );
  });
});

describe("resolveDemoVideo: a file", () => {
  it("plays a video file of this site, or an https one, in a video element", () => {
    expect(resolveDemoVideo("/demo/winz.mp4")).toEqual({ kind: "file", src: "/demo/winz.mp4" });
    expect(resolveDemoVideo("/demo/winz.webm?v=2")).toEqual({
      kind: "file",
      src: "/demo/winz.webm?v=2",
    });
    expect(resolveDemoVideo("https://cdn.example.com/winz.MP4")).toEqual({
      kind: "file",
      src: "https://cdn.example.com/winz.MP4",
    });
  });
});

describe("resolveDemoVideo: a link a page cannot embed", () => {
  it("is opened in a new tab, never put in an iframe", () => {
    expect(resolveDemoVideo("https://vimeo.com/123456789")).toEqual({
      kind: "external",
      href: "https://vimeo.com/123456789",
    });
    expect(resolveDemoVideo("https://www.loom.com/share/abc")).toEqual({
      kind: "external",
      href: "https://www.loom.com/share/abc",
    });
  });
});
