import { describe, expect, it } from "vitest";

import {
  primaryButton,
  primaryButtonArrow,
  primaryButtonHint,
  primaryButtonKnob,
  type PrimaryButtonState,
  type PrimaryButtonTone,
} from "./primary-button-styles";

const STATES: PrimaryButtonState[] = ["active", "inactive"];
const TONES: PrimaryButtonTone[] = ["on-dark", "on-light"];

const split = (classes: string): string[] => classes.split(/\s+/);

describe("primaryButton", () => {
  for (const state of STATES) {
    for (const tone of TONES) {
      it(`keeps the label in the app's ink, never white: ${state} on ${tone}`, () => {
        const classes = split(primaryButton({ state, tone }));
        expect(classes).toContain("text-ink");
        expect(classes).not.toContain("text-white");
        expect(classes).not.toContain("text-text");
      });
    }
  }

  it("is lime when active and lime-dim (the label unchanged) when inactive", () => {
    expect(split(primaryButton({ state: "active" }))).toContain("bg-lime");
    expect(split(primaryButton({ state: "active" }))).not.toContain("bg-lime-dim");
    expect(split(primaryButton({ state: "inactive" }))).toContain("bg-lime-dim");
    expect(split(primaryButton({ state: "inactive" }))).not.toContain("bg-lime");
  });

  it("only presses when it is active", () => {
    expect(primaryButton({ state: "active" })).toContain("active:scale-[0.98]");
    expect(primaryButton({ state: "inactive" })).not.toContain("scale");
    expect(primaryButton({ state: "inactive" })).toContain("cursor-not-allowed");
  });

  it("draws a focus ring that suits the section: lime on dark, ink on light", () => {
    expect(primaryButton({ tone: "on-dark" })).toContain("focus-visible:outline-lime");
    expect(primaryButton({ tone: "on-light" })).toContain("focus-visible:outline-ink");
  });

  it("has the mockup's size: 255 x 55 on desktop, 48 high on a phone", () => {
    const classes = split(primaryButton());
    expect(classes).toContain("h-12");
    expect(classes).toContain("md:h-[55px]");
    expect(classes).toContain("md:min-w-[255px]");
  });
});

describe("the round and its arrow", () => {
  it("slides and turns on hover only when active, and not at all under reduced motion", () => {
    const knob = primaryButtonKnob({ state: "active" });
    const arrow = primaryButtonArrow({ state: "active" });
    expect(knob).toContain("group-hover/btn:translate-x-0.5");
    expect(knob).toContain("motion-reduce:group-hover/btn:translate-x-0");
    expect(arrow).toContain("group-hover/btn:rotate-12");
    expect(arrow).toContain("motion-reduce:group-hover/btn:rotate-0");
    expect(primaryButtonKnob({ state: "inactive" })).not.toContain("hover");
    expect(primaryButtonArrow({ state: "inactive" })).not.toContain("hover");
  });

  it("keeps a lime ring around the black round", () => {
    expect(primaryButtonKnob({ state: "active" })).toContain("ring-lime");
    expect(primaryButtonKnob({ state: "active" })).toContain("bg-ink");
  });
});

describe("the whole button", () => {
  it("animates transform and opacity only", () => {
    const all = [
      primaryButton(),
      primaryButtonKnob(),
      primaryButtonArrow(),
      primaryButtonHint,
    ].join(" ");
    expect(all).not.toContain("transition-all");
    expect(all).not.toMatch(/transition-\[(?![^\]]*(transform|opacity|background-color))/);
  });

  it("shows the hint on hover, on focus, and for a moment after a tap", () => {
    expect(primaryButtonHint).toContain("group-hover/hint:opacity-100");
    expect(primaryButtonHint).toContain("group-focus-within/hint:opacity-100");
    expect(primaryButtonHint).toContain("data-[shown=true]:opacity-100");
  });
});
