import { describe, expect, it } from "vitest";

import { resolvePrimaryButton } from "./primary-button-state";

describe("resolvePrimaryButton", () => {
  it("is a link for a usable href, external when it is an absolute URL", () => {
    expect(resolvePrimaryButton({ href: "https://github.com/frytegg/winz" })).toEqual({
      kind: "link",
      href: "https://github.com/frytegg/winz",
      external: true,
    });
    expect(resolvePrimaryButton({ href: "/" })).toEqual({
      kind: "link",
      href: "/",
      external: false,
    });
  });

  it("lets the caller override whether a link is external", () => {
    expect(resolvePrimaryButton({ href: "https://winz.example/", external: false })).toMatchObject({
      external: false,
    });
  });

  it("is INACTIVE for a null href, and for one a page must never use", () => {
    for (const href of [null, "", "#", "#top", "http://example.com", "javascript:void(0)"]) {
      expect(resolvePrimaryButton({ href })).toEqual({ kind: "inactive" });
      // Even with an action next to it: a decided-against link does not fall back to a click.
      expect(resolvePrimaryButton({ href, hasAction: true })).toEqual({ kind: "inactive" });
    }
  });

  it("is an action button when it has a click handler and no href", () => {
    expect(resolvePrimaryButton({ hasAction: true })).toEqual({ kind: "action" });
  });

  it("is INACTIVE when it has nothing to do: no href, no action", () => {
    expect(resolvePrimaryButton({})).toEqual({ kind: "inactive" });
  });

  it("is INACTIVE when told it is unavailable, whatever else it has", () => {
    expect(resolvePrimaryButton({ unavailable: true, href: "/", hasAction: true })).toEqual({
      kind: "inactive",
    });
  });
});
