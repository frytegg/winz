"use client";

import { ArrowDown, ArrowUp, Check, Copy, Share, SquarePlus, Smartphone, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { landingCopy } from "@/lib/landing/copy";
import { anchorPanel, type InstallQr, type SheetKind } from "@/lib/landing/install";
import { PrimaryButton } from "./primary-button";

const { install } = landingCopy;

/** What the provider tells the sheet to show: which one, for which button, and where that button is. */
export interface OpenSheet {
  readonly kind: SheetKind;
  /** The footer's button sends the visitor to `appInstallUrl`, the "Try the live demo" ones to `liveDemoUrl`. */
  readonly origin: "demo" | "footer";
  /** The button's box in the window, for the desktop panel that sits under it. */
  readonly anchor: { left: number; right: number; top: number; bottom: number };
  /** An iPad's Share button is at the top of the screen, an iPhone's at the bottom. */
  readonly ipad: boolean;
}

export interface InstallSheetProps {
  readonly sheet: OpenSheet | null;
  /** The app's address, for "Open in browser instead". */
  readonly openUrl: string | null;
  /** The QR the desktop panel shows. */
  readonly qr: InstallQr | null;
  /** Closed (by the X, the backdrop, Escape, or a choice): the provider forgets the sheet. */
  readonly onClose: () => void;
  /** The Android install dialog. */
  readonly onInstall: () => void;
}

/**
 * "Get Winz on your phone" (`sections/09-install-flow.md`): one dialog for the four buttons. On a phone it is
 * a bottom sheet, on a desktop a small panel that sits under the button, with the QR of the app. A native
 * modal `<dialog>` opened with `showModal()`, so the browser does what a hand-written one forgets: the page
 * behind is inert, focus is trapped, Escape closes it, and focus returns to the button that opened it.
 *
 * What it says depends on the platform (`sheetKindFor`); "Open in browser instead" is always there, since a
 * juror in a hurry must be able to test without installing anything.
 */
export function InstallSheet({
  sheet,
  openUrl,
  qr,
  onClose,
  onInstall,
}: InstallSheetProps): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  const isOpen = sheet !== null;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
      // Start on the title, which a screen reader reads out, not on the close button.
      titleRef.current?.focus({ preventScroll: true });
    }
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  // The desktop panel: under the button, kept inside the window (and again when the window changes). When
  // there is room neither under the button nor over it (the hero's button is in the middle of the first
  // screen), the page is scrolled up first, at once, so that the panel never lands on its own button.
  const anchor = sheet?.kind === "desktop-qr" ? sheet.anchor : null;
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null || anchor === null) return;
    let scrolled = 0;
    const place = (first: boolean): void => {
      const box = dialog.getBoundingClientRect();
      const position = anchorPanel({
        // The button has moved up by whatever this panel scrolled the page.
        anchor: {
          ...anchor,
          top: anchor.top - scrolled,
          bottom: anchor.bottom - scrolled,
        },
        panel: { width: box.width, height: box.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scrollRoom: first
          ? document.documentElement.scrollHeight - window.innerHeight - window.scrollY
          : 0,
      });
      if (position.scrollBy > 0) {
        window.scrollBy({ top: position.scrollBy, behavior: "instant" });
        scrolled += position.scrollBy;
      }
      dialog.style.setProperty("--panel-left", `${position.left}px`);
      dialog.style.setProperty("--panel-top", `${position.top}px`);
    };
    place(true);
    const onResize = (): void => place(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [anchor]);

  const kind = sheet?.kind ?? null;

  return (
    <dialog
      ref={ref}
      className="install-sheet"
      data-kind={kind ?? "closed"}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={subtitleId}
      onClose={onClose}
      onClick={(event) => {
        // Only the dimmed area is the dialog itself: the content fills it.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      {sheet === null ? null : (
        <div className="relative px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 sm:px-7">
          <div
            aria-hidden="true"
            className="mx-auto mb-4 h-1 w-10 rounded-full bg-landing-line install-handle"
          />

          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="absolute right-3 top-3 grid size-11 place-items-center rounded-full text-landing-gray transition-colors hover:bg-landing-card hover:text-ink"
          >
            <X className="size-5" strokeWidth={1.75} aria-hidden="true" />
            <span className="sr-only">{install.close}</span>
          </button>

          <div className="flex items-center gap-4 pr-10">
            <span
              aria-hidden="true"
              className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-lime"
            >
              <img
                src="/brand/icon-winz-dark.svg"
                alt=""
                width={87}
                height={71}
                className="h-5 w-auto"
              />
            </span>
            <div className="min-w-0">
              <h2
                id={titleId}
                ref={titleRef}
                tabIndex={-1}
                className="text-xl font-semibold leading-tight text-ink outline-none"
              >
                {install.title}
              </h2>
              <p id={subtitleId} className="mt-1 text-sm leading-5 text-landing-gray">
                {install.subtitle}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <SheetBody sheet={sheet} qr={qr} onInstall={onInstall} />
          </div>

          {openUrl === null ? null : (
            <p className="mt-4 text-center">
              <a
                href={openUrl}
                // The desktop's app opens in a tab of its own; a phone's, in this one.
                {...(sheet.kind === "desktop-qr"
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                onClick={onClose}
                className="inline-flex min-h-11 items-center rounded-md px-2 text-sm text-landing-gray underline underline-offset-4 transition-colors hover:text-ink"
              >
                {install.openInBrowser}
              </a>
            </p>
          )}
        </div>
      )}
    </dialog>
  );
}

function SheetBody({
  sheet,
  qr,
  onInstall,
}: {
  sheet: OpenSheet;
  qr: InstallQr | null;
  onInstall: () => void;
}): React.JSX.Element {
  switch (sheet.kind) {
    case "desktop-qr":
      return <DesktopQr qr={qr} />;
    case "android-prompt":
      return (
        <PrimaryButton tone="on-light" onClick={onInstall} className="w-full">
          {install.addToHome}
        </PrimaryButton>
      );
    case "android-accepted":
      return (
        <p
          role="status"
          className="flex items-start gap-3 rounded-2xl bg-landing-card p-4 text-base leading-6 text-ink"
        >
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-lime">
            <Check className="size-4" strokeWidth={2.5} aria-hidden="true" />
          </span>
          {install.accepted}
        </p>
      );
    case "android-menu":
      return (
        <p className="rounded-2xl bg-landing-card p-4 text-base leading-6 text-ink">
          {install.androidMenu}
        </p>
      );
    case "ios":
      return <IosSteps ipad={sheet.ipad} />;
    case "in-app":
      return <InAppCopy />;
  }
}

function DesktopQr({ qr }: { qr: InstallQr | null }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center text-center">
      {qr === null ? null : (
        <figure className="m-0 flex flex-col items-center">
          {/* The tile is white with a 4-module quiet zone: a reader needs the margin, and a dark-on-light code
              is read by more scanners than the inverted one. */}
          <svg
            role="img"
            aria-label={install.qrLabel}
            viewBox={`-4 -4 ${qr.size + 8} ${qr.size + 8}`}
            shapeRendering="crispEdges"
            className="size-44 rounded-2xl border border-landing-line bg-white"
          >
            <path d={qr.path} fill="#131314" />
          </svg>
          <figcaption className="mt-3 text-sm text-landing-gray">{qr.host}</figcaption>
        </figure>
      )}
      <p className="mt-3 text-base leading-6 text-ink">{install.desktop}</p>
    </div>
  );
}

function IosSteps({ ipad }: { ipad: boolean }): React.JSX.Element {
  const icons = [Share, SquarePlus, Smartphone] as const;
  const Arrow = ipad ? ArrowUp : ArrowDown;
  return (
    <div>
      <ol className="flex flex-col gap-3">
        {install.iosSteps.map((step, index) => {
          const Icon = icons[index] ?? Smartphone;
          return (
            <li
              key={step}
              className="flex items-center gap-4 rounded-2xl bg-landing-card p-3.5 text-base leading-6 text-ink"
            >
              <span
                aria-hidden="true"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-lime"
              >
                <Icon className="size-5" strokeWidth={1.75} />
              </span>
              <span>
                <span aria-hidden="true" className="mr-1.5 text-landing-gray">
                  {index + 1}.
                </span>
                {step}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 flex items-center justify-center gap-2 text-sm text-landing-gray">
        <Arrow className="install-arrow size-4" strokeWidth={2} aria-hidden="true" />
        {ipad ? install.iosArrowIpad : install.iosArrowIphone}
      </p>
    </div>
  );
}

/** The address does not change while the sheet is open. */
function noSubscription(): () => void {
  return () => undefined;
}

type CopyState = "idle" | "copied" | "failed";

/** Copies `text`: the clipboard API, then the old way, inside the dialog (anything outside a modal is inert). */
async function copyText(text: string, host: HTMLElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Not allowed here (an in-app browser, an insecure origin): try the selection route.
  }
  if (host === null) return false;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
  host.append(field);
  try {
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

function InAppCopy(): React.JSX.Element {
  const [state, setState] = useState<CopyState>("idle");
  // The page's own address: that is what Safari or Chrome has to open. Empty on the server.
  const address = useSyncExternalStore(
    noSubscription,
    () => window.location.href,
    () => "",
  );
  const wrap = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async (): Promise<void> => {
    const ok = await copyText(address, wrap.current);
    setState(ok ? "copied" : "failed");
    if (!ok) field.current?.select();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2600);
  }, [address]);

  return (
    <div ref={wrap}>
      <p className="rounded-2xl bg-landing-card p-4 text-base leading-6 text-ink">
        {install.inApp}
      </p>
      <div className="mt-4 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-base text-white transition-transform duration-150 active:scale-[0.98] motion-reduce:active:scale-100"
        >
          <Copy className="size-5" strokeWidth={1.75} aria-hidden="true" />
          {install.copyLink}
        </button>
        <input
          ref={field}
          readOnly
          value={address}
          aria-label={install.copyLink}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded-xl border border-landing-line bg-white px-3 py-2 text-center text-sm text-landing-gray"
        />
        {/* The toast: always in the page, so a screen reader hears it when its text changes. */}
        <p role="status" className="min-h-6 text-sm text-ink">
          {state === "copied" ? install.linkCopied : state === "failed" ? install.copyFailed : ""}
        </p>
      </div>
    </div>
  );
}
