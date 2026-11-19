"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { landingCopy } from "@/lib/landing/copy";

const { nav } = landingCopy;

export interface NavMenuProps {
  links: readonly { readonly label: string; readonly href: string }[];
  /** The main button, rendered by the server component and slotted in under the links. */
  children: ReactNode;
}

/** The width from which the navigation is on one line (`lg` of Tailwind), and the menu is not needed. */
const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * The menu of a phone and a tablet: a button, and a full-screen dark panel with the anchors and the
 * main button. The panel is a `<dialog>` opened with `showModal()`, so the browser does what a menu
 * must do and a hand-written one forgets: the page behind is inert, focus is trapped, Escape closes it,
 * and focus goes back to the button. A client component only for that call.
 */
export function NavMenu({ links, children }: NavMenuProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  // Resized to a desktop width with the menu open: the anchors are on the page now, close it.
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent): void => {
      if (event.matches) dialogRef.current?.close();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const show = (): void => {
    dialogRef.current?.showModal();
    setOpen(true);
  };
  const hide = (): void => dialogRef.current?.close();

  // A tap on an anchor or on the button inside closes the panel, then the browser follows the link.
  const onPanelClick = (event: MouseEvent<HTMLDialogElement>): void => {
    if (event.target instanceof Element && event.target.closest("a") !== null) hide();
  };

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={show}
        className="grid size-11 place-items-center rounded-full text-white lg:hidden"
      >
        <Menu className="size-7" strokeWidth={1.5} aria-hidden="true" />
        <span className="sr-only">{nav.openMenu}</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-label={nav.menuLabel}
        onClose={() => setOpen(false)}
        onClick={onPanelClick}
        className="landing-menu m-0 h-dvh max-h-none w-full max-w-none flex-col overflow-y-auto border-0 bg-landing-ink p-0 text-white open:flex"
      >
        <div className="flex justify-end px-5 pt-[max(1.25rem,env(safe-area-inset-top))] md:px-8">
          <button
            type="button"
            onClick={hide}
            className="grid size-11 place-items-center rounded-full text-white"
          >
            <X className="size-7" strokeWidth={1.5} aria-hidden="true" />
            <span className="sr-only">{nav.closeMenu}</span>
          </button>
        </div>

        <nav
          aria-label={nav.menuLabel}
          className="flex flex-1 flex-col justify-center gap-8 px-5 pb-[max(2rem,env(safe-area-inset-bottom))] md:px-8"
        >
          <ul className="flex flex-col gap-2">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="flex min-h-14 items-center rounded-md text-3xl font-semibold text-white no-underline"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <div>{children}</div>
        </nav>
      </dialog>
    </>
  );
}
