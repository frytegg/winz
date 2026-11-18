import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CampaignPage } from "@/components/winz/campaign-page";
import { isMockApi } from "@/lib/api/mock-scenario";
import { copy } from "@/lib/copy";
import { loadPublicCampaign, requestOrigin } from "@/lib/fan/public-campaign";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** In the simulated mode, `?scenario=paused` picks the example the server asks the mock API for. */
async function scenarioOf(searchParams: Props["searchParams"]): Promise<string | null> {
  if (!isMockApi()) return null;
  const value = (await searchParams).scenario;
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === "" ? null : first;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadPublicCampaign(slug, await scenarioOf(searchParams));
  const origin = await requestOrigin();
  const metadataBase = origin === null ? undefined : new URL(origin);
  if (result.kind !== "ok") {
    return { metadataBase, title: copy.brand.productName, robots: { index: false } };
  }
  const { campaign } = result;
  const description = `${campaign.merchant.name} · ${copy.campaign.pitch(campaign.conditionLabel)}`;
  return {
    metadataBase,
    title: campaign.promise,
    description,
    openGraph: {
      type: "website",
      siteName: copy.brand.productName,
      title: campaign.promise,
      description,
    },
    twitter: { card: "summary_large_image", title: campaign.promise, description },
  };
}

/**
 * C1: the page a fan lands on after scanning the venue's code. The promo is read on the server, so
 * the promise is in the HTML a link preview or a slow phone gets; the odds and the buttons come alive
 * in the browser.
 */
export default async function Page({ params, searchParams }: Props): Promise<React.JSX.Element> {
  const { slug } = await params;
  const scenario = await scenarioOf(searchParams);
  const result = await loadPublicCampaign(slug, scenario);
  if (result.kind === "not_found") notFound();
  return (
    <CampaignPage
      slug={slug}
      initial={result.kind === "ok" ? result.campaign : null}
      initialScenario={scenario}
    />
  );
}
