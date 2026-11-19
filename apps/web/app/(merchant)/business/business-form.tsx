"use client";

import { MERCHANT_CATEGORIES, type MerchantCategory } from "@winz/shared";
import { Beer, Pizza, Plus, Sandwich, ShoppingBag, Store, X, type LucideIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Splash } from "@/components/ui/splash";
import { WizardFrame } from "@/components/wizard/wizard-frame";
import { apiFetch, errorMessage } from "@/lib/api/client";
import { useAuth, useRouteGuard } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { journeyProgress } from "@/lib/journey";
import { submitBusiness } from "@/lib/merchant/business-create";

const CATEGORY_ICONS: Record<MerchantCategory, LucideIcon> = {
  bar: Beer,
  pizza: Pizza,
  burger: Sandwich,
  retail: ShoppingBag,
  other: Store,
};

const NAME_MAX = 80;

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * M2: the business name and category (the API's five), and an optional logo given as a link: the
 * API takes a URL and has no upload route yet (see DEMANDES-ALEXANDRE).
 */
export function BusinessForm(): React.JSX.Element {
  const { adoptMerchant, refreshMe } = useAuth();
  const ready = useRouteGuard("signed-in");

  const [name, setName] = useState("");
  const [category, setCategory] = useState<MerchantCategory | null>(null);
  const [logoOpen, setLogoOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!ready) return <Splash />;

  const trimmedName = name.trim();
  const trimmedLogo = logoUrl.trim();
  const logoInvalid = logoOpen && trimmedLogo !== "" && !isHttpUrl(trimmedLogo);
  const canContinue = trimmedName !== "" && category !== null && !logoInvalid;

  async function submit(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    if (!canContinue || category === null || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const outcome = await submitBusiness(
        () =>
          apiFetch("createMerchant", {
            body: {
              name: trimmedName,
              category,
              ...(logoOpen && trimmedLogo !== "" ? { logoUrl: trimmedLogo } : {}),
            },
          }),
        async () => ({ hasBusiness: (await refreshMe()).merchant != null }),
      );
      // The route guard sees the merchant and moves on to the first step of the wizard. A user who
      // already had a business (409) has it in the session read again: the guard moves on too.
      if (outcome.kind === "created") adoptMerchant(outcome.merchant);
    } catch (caught: unknown) {
      setError(errorMessage(caught, copy.common.genericError));
      setSubmitting(false);
    }
  }

  return (
    <WizardFrame
      stepKey="business"
      progress={journeyProgress("business")}
      title={copy.business.title}
      backHref="/"
      footer={
        <Button type="submit" form="business-form" disabled={!canContinue} loading={submitting}>
          {copy.common.continue}
        </Button>
      }
    >
      <form
        id="business-form"
        onSubmit={(event) => void submit(event)}
        noValidate
        className="flex flex-col gap-6"
      >
        <Field
          label={copy.business.nameLabel}
          name="business-name"
          autoComplete="organization"
          enterKeyHint="done"
          maxLength={NAME_MAX}
          placeholder={copy.business.namePlaceholder}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-label uppercase text-text">
            {copy.business.categoryLabel}
          </legend>
          <div className="flex flex-wrap gap-2">
            {MERCHANT_CATEGORIES.map((value) => (
              <Chip
                key={value}
                variant="fill"
                label={copy.business.categories[value]}
                icon={CATEGORY_ICONS[value]}
                active={category === value}
                onClick={() => setCategory(value)}
              />
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-3">
          {logoOpen ? (
            <div className="flex items-end gap-2">
              <Field
                className="min-w-0 flex-1"
                label={copy.business.logoLinkLabel}
                type="url"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={copy.business.logoUrlPlaceholder}
                value={logoUrl}
                onChange={(event) => setLogoUrl(event.target.value)}
                error={logoInvalid ? copy.business.logoInvalid : undefined}
              />
              <button
                type="button"
                aria-label={copy.business.logoRemove}
                onClick={() => {
                  setLogoOpen(false);
                  setLogoUrl("");
                }}
                className="mb-0.5 grid size-11 shrink-0 place-items-center rounded-full bg-card-raised text-text transition-transform duration-150 ease-out active:scale-[0.94]"
              >
                <X className="size-5" strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <>
              <p className="text-label uppercase text-text">
                {copy.business.logoLabel}{" "}
                <span className="normal-case text-muted">· {copy.common.optional}</span>
              </p>
              <button
                type="button"
                aria-label={copy.business.logoAdd}
                onClick={() => setLogoOpen(true)}
                className="grid size-14 place-items-center rounded-2xl bg-card-raised text-text transition-transform duration-150 ease-out active:scale-[0.96]"
              >
                <Plus className="size-6" strokeWidth={1.5} aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        {error === undefined ? null : (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
      </form>
    </WizardFrame>
  );
}
