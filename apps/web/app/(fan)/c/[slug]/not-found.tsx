import { Button } from "@/components/ui/button";
import { Diagonals } from "@/components/ui/diagonals";
import { Logo } from "@/components/ui/logo";
import { copy } from "@/lib/copy";

export default function CampaignNotFound(): React.JSX.Element {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-6 text-center">
      <Diagonals />
      <div className="relative flex flex-col items-center gap-4">
        <Logo />
        <h1 className="text-promise mt-4">{copy.campaign.notFoundTitle}</h1>
        <p className="text-body text-muted">{copy.campaign.notFoundBody}</p>
        <Button href="/" variant="dark" className="mt-4">
          {copy.brand.productName}
        </Button>
      </div>
    </main>
  );
}
