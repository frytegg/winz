import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { meetsLimit } from "./support/criteria";
import { KNOWN_DEFECTS } from "./support/known-defects";
import type { Measure } from "./support/measures";
import { MEASURES_DIR, RECEIPTS_DIR } from "./support/paths";
import { RECEIPTS, type ReceiptName } from "./support/receipts";

const MEASURES_FILE = join(RECEIPTS_DIR, "measures.json");

function isMeasure(value: unknown): value is Measure {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.label === "string" &&
    typeof record.value === "number" &&
    (record.unit === "taps" || record.unit === "s") &&
    (typeof record.limit === "number" || record.limit === null) &&
    typeof record.detail === "string" &&
    typeof record.measuredAt === "string"
  );
}

function readMeasures(file: string): Record<string, Measure> {
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null) return {};
  const measures: Record<string, Measure> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (isMeasure(value)) measures[key] = value;
  }
  return measures;
}

/** The measurements of this run, over those of the previous runs for what this run did not measure. */
function mergedMeasures(): Record<string, Measure> {
  const merged = readMeasures(MEASURES_FILE);
  if (existsSync(MEASURES_DIR)) {
    for (const file of readdirSync(MEASURES_DIR).sort()) {
      if (!file.endsWith(".json")) continue;
      const single: unknown = JSON.parse(readFileSync(join(MEASURES_DIR, file), "utf8"));
      if (isMeasure(single)) merged[file.replace(/\.json$/, "")] = single;
    }
  }
  return merged;
}

function frenchNumber(value: number): string {
  return value.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function readme(measures: Record<string, Measure>, at: string): string {
  const measureRows = Object.values(measures).map((measure) => {
    const unit = measure.unit === "s" ? " s" : " taps";
    const limit = measure.limit === null ? "–" : `${frenchNumber(measure.limit)}${unit}`;
    const verdict =
      measure.limit === null
        ? ""
        : meetsLimit(measure.value, measure.limit)
          ? " (tenu)"
          : " (DÉPASSÉ)";
    return `| ${cell(measure.label)} | ${frenchNumber(measure.value)}${unit}${verdict} | ${limit} | ${cell(measure.detail)} | ${measure.measuredAt} |`;
  });
  const images = (Object.keys(RECEIPTS) as ReceiptName[]).filter((name) =>
    existsSync(join(RECEIPTS_DIR, `${name}.png`)),
  );
  const imageRows = images.map(
    (name) => `| [\`${name}.png\`](./${name}.png) | ${cell(RECEIPTS[name])} |`,
  );
  const defects = Object.values(KNOWN_DEFECTS).map((defect) => `- ${defect.reason}`);

  return [
    "# Reçus des écrans : Playwright, iPhone 15, API simulée",
    "",
    "Écrit par `pnpm e2e:ui` (suite `apps/web/e2e/ui` : parcours commerçant, client et Hedge desk). Les images",
    "et ce fichier sont réécrits à chaque passage ; `measures.json` garde les mesures (une mesure qu'un",
    "passage partiel n'a pas refaite garde sa date d'origine, dans la dernière colonne).",
    "",
    `Dernier passage : ${at} (UTC).`,
    "",
    "## Mesures du dernier passage",
    "",
    "Un tap est un appui, une touche pressée seule, ou un champ saisi (un champ saisi compte pour un,",
    "quelle que soit sa longueur). Les temps sont ceux de l'horloge, navigateur compris, sur l'API simulée",
    "et après la compilation des pages par `next dev` (première ligne).",
    "",
    "Les limites des critères de succès sont strictes (« moins de 15 taps », « moins de 2 minutes », « en moins",
    "de 30 secondes ») : une valeur égale à la limite est notée DÉPASSÉ.",
    "",
    "| Mesure | Valeur | Limite stricte | Détail | Mesurée le (UTC) |",
    "| --- | --- | --- | --- | --- |",
    ...measureRows,
    "",
    "## Les images",
    "",
    "Pleine page, viewport de l'iPhone 15 (393 px de large) à l'échelle 2, sans vidéo.",
    "",
    "| Fichier | Ce qu'il montre |",
    "| --- | --- |",
    ...imageRows,
    "",
    "## Défauts trouvés, gardés en attentes `test.fail`",
    "",
    "Plus un constat qui ne fait pas échouer la suite : en mode simulé, les pages qui importent",
    "Stripe chargent quand même `https://js.stripe.com` (`lib/stripe/client.ts:1`) ; la suite bloque",
    "cette requête, comme toute requête qui sortirait de la machine.",
    "",
    "Chacun fait passer son test tant que le défaut existe, et le fait échouer le jour où il est corrigé :",
    "retirer alors le `test.fail`.",
    "",
    ...defects,
    "",
    "## Ce que ces reçus ne prouvent pas",
    "",
    "- **Safari.** WebKit n'est pas installé ici : le profil iPhone 15 de Playwright (taille, user agent,",
    "  échelle, tactile, mobile) tourne sur Chromium. La mise en page et les parcours à cette taille sont",
    "  prouvés, pas le rendu de Safari ni ses particularités (barre d'adresse, `dvh`, feuille de partage).",
    "- **La vraie police.** Rien ne sort de la machine, serveur compris : `next/font/google` reçoit",
    "  une réponse locale (`e2e/ui/support/google-fonts-mock.cjs`, sans fichier à télécharger) au lieu",
    "  de Google Fonts. Les captures montrent la police de repli, sauf sur une machine où Sora est",
    "  installée ; `pnpm dev` sur une machine qui a le réseau donne la vraie.",
    "- **Le webpack de `pnpm dev`.** La suite lance `next dev --turbopack` : avec webpack, `next dev`",
    "  dépasse 6 Go en compilant toutes les routes et se relance au milieu du passage.",
    "- **Un vrai paiement.** En mode simulé, Stripe, Apple Pay et Google Pay sont remplacés par le",
    "  bouton « Simulate payment » : aucune carte, aucune feuille de paiement réelle.",
    "- **La vraie API.** Chaque route renvoie un exemple figé, choisi par scénario, sans état ni",
    "  authentification ; rien ne passe par la base, le moteur, la chaîne ni Gemini. Les temps mesurés",
    "  sont ceux du front sur des réponses immédiates (plus les attentes simulées : 0,6 s par étape de",
    "  connexion, 1,5 s avant M8, 0,5 s d'autorisation de carte).",
    "- **Le temps réel.** La cote « vivante » est une oscillation simulée ; Supabase Realtime n'est pas",
    "  branché.",
    "- **Les éléments fixes en pleine page.** Une capture pleine page fige la barre de navigation",
    "  flottante là où se trouvait le bas de l'écran : elle apparaît donc au milieu des images longues.",
    "- **Les états qu'aucun scénario n'offre**, comme une page de campagne introuvable (C1 n'a pas de",
    "  scénario 404 : l'API simulée ignore le slug, et C1 lit la promo côté serveur, hors d'atteinte",
    "  du navigateur ; il faudrait un refus simulé `notFound` sur `publicCampaign`).",
    "",
  ].join("\n");
}

/** Gathers the measurements of the run into `measures.json` and writes the receipts' README. */
export default function globalTeardown(): void {
  const measures = mergedMeasures();
  mkdirSync(RECEIPTS_DIR, { recursive: true });
  writeFileSync(MEASURES_FILE, `${JSON.stringify(measures, null, 2)}\n`);
  writeFileSync(join(RECEIPTS_DIR, "README.md"), readme(measures, new Date().toISOString()));
}
