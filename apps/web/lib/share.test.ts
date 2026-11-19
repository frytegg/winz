import { afterEach, describe, expect, it, vi } from "vitest";

import { copy } from "./copy";
import { shareOrCopy } from "./share";

const data = { title: "Joe's on Winz", text: "100% back.", url: "https://example.test/c/joes" };

function stubNavigator(parts: {
  share?: (data: unknown) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}): void {
  vi.stubGlobal("navigator", {
    share: parts.share,
    clipboard: { writeText: parts.writeText ?? (() => Promise.resolve()) },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shareOrCopy", () => {
  it("hands the title, text and link to the phone's share sheet", async () => {
    const share = vi.fn(() => Promise.resolve());
    stubNavigator({ share });
    expect(await shareOrCopy(data)).toBe("shared");
    expect(share).toHaveBeenCalledWith(data);
  });

  it("reads a closed sheet as cancelled, not as a failure, and copies nothing", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubNavigator({
      share: () => Promise.reject(new DOMException("closed", "AbortError")),
      writeText,
    });
    expect(await shareOrCopy(data)).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the link when the sheet refuses for another reason", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubNavigator({
      share: () => Promise.reject(new DOMException("busy", "InvalidStateError")),
      writeText,
    });
    expect(await shareOrCopy(data)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(data.url);
  });

  it("copies the link when there is no share sheet at all", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubNavigator({ writeText });
    expect(await shareOrCopy(data)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(data.url);
  });
});

describe("the share text", () => {
  it("names the venue when it is known", () => {
    expect(copy.live.shareTitle("Joe's Pizza")).toBe("Joe's Pizza on Winz");
    expect(copy.live.shareText("100% back if Texas wins", "Joe's Pizza")).toBe(
      "100% back if Texas wins. Get yours at Joe's Pizza.",
    );
  });

  it("does not leave a dangling 'at' or ' on Winz' when the venue is not known yet", () => {
    expect(copy.live.shareTitle("")).toBe("Winz");
    expect(copy.live.shareText("100% back if Texas wins", "")).toBe("100% back if Texas wins.");
  });
});
