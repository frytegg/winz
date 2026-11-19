/**
 * Every screenshot the suite leaves in `docs/receipts/ui/`, with what it shows (in French: the
 * README of the receipts is in French). A name that is not here cannot be taken, so the README
 * always describes every image.
 */
export const RECEIPTS = {
  // Merchant onboarding, M0 to M8
  "m0-home": "M0, l'accueil : la promesse, « Start a promo ».",
  "m0-role-menu": "M0, le menu « winz ▾ » ouvert : le lien vers l'espace client (« I'm a fan »).",
  "m1-email": "M1, la connexion : l'e-mail saisi.",
  "m1-code": "M1, le code à 6 chiffres (connexion simulée).",
  "m2-business": "M2, le commerce : nom saisi, catégorie choisie.",
  "m3-game": "M3, la liste des matchs.",
  "m4-promo": "M4, les modèles de promo du match choisi, avec leur coût estimé.",
  "m5-offer": "M5, l'offre pré-remplie et la promesse figée.",
  "m6-margin":
    "M6, marge, budget et résultats calculés (coût par vente, capacité, seuil de pause).",
  "m6-above-threshold":
    "M6, aperçu `aboveThreshold` : la cote dépasse le seuil de pause, « Pick another promo » à la place du récapitulatif.",
  "m6-no-book":
    "M6, aperçu `noBook` : le marché n'a pas encore de carnet, pas de coût par vente, « Pick another promo ».",
  "m7-review":
    "M7, le récapitulatif (budget de 1 000 $, coût et marge par vente) et le paiement simulé du budget.",
  "m8-live": "M8, la promo en ligne : compte à rebours, QR, lien court, partage.",
  // Fan, C1 to C3
  "c1-open": "C1, la page de campagne qui vend (scénario `live`).",
  "c1-paused": "C1, promo en pause (scénario `paused`) : boutons d'achat désactivés.",
  "c1-sales-closed": "C1, ventes closes (scénario `salesClosed`).",
  "c1-settled-yes": "C1, match réglé sur OUI (scénario `settledYes`).",
  "c1-settled-no": "C1, match réglé sur NON (scénario `settledNo`).",
  "c2-checkout": "C2, la feuille de paiement (paiement simulé) : 20,00 $ pour un.",
  "c2-checkout-two": "C2, la feuille de paiement après « + » sur C1 : quantité 2, total 40,00 $.",
  "c2-securing": "C2, l'attente « Securing your promo… » après le paiement.",
  "c2-refused-sales-paused":
    "C2, refus `409 sales_paused` du paiement (scénario `salesPaused`) : le message de l'API.",
  "c2-refused-sales-closed":
    "C2, refus `409 sales_closed` du paiement (scénario `salesClosed` sur la seule requête de paiement) : le message de l'API.",
  "c2-ended-failed":
    "C2, paiement qui n'a pas abouti (scénario `failed`) : le message de l'API, « Try again » et le retour à la promo.",
  "c2-ended-cancelled-paused":
    "C2, achat annulé car la promo s'est mise en pause pendant l'attente (scénario `cancelledPaused`).",
  "c3-ticket-pre-game":
    "C3, le ticket avant le match (« … chance this is free », compte à rebours).",
  "c3-ticket-in-game": "C3, le ticket pendant le match (« Game on »).",
  "c3-ticket-refunded":
    "C3, le ticket remboursé : écran lime, « Refunded » et le montant (20,00 $).",
  "c3-ticket-not-this-time": "C3, le ticket perdu : « Not this time… », « Find another promo ».",
  "c3-ticket-cancelled": "C3, le match annulé : « Game cancelled · your purchase stands ».",
  "c3-ticket-not-found": "C3, un lien de ticket inconnu (404 renvoyé par le test lui-même).",
  // Merchant space
  "md-home": "Espace commerçant, l'accueil (solde, statistiques, promos actives).",
  "md-list-in-progress": "Espace commerçant, la liste des promos, onglet « In progress ».",
  "md-list-closed": "Espace commerçant, la liste des promos, onglet « Closed ».",
  "md-list-with-funding":
    "La liste avec une promo dont le budget n'est pas payé (scénario `withFunding`).",
  "md-detail-live-stats": "Détail d'une promo en ligne, onglet « Stats ».",
  "md-detail-live-budget": "Détail d'une promo en ligne, onglet « Budget ».",
  "md-detail-live-controls": "Détail d'une promo en ligne, onglet « Controls ».",
  "md-detail-paused-by-you":
    "Le même détail après « Pause sales » : « Paused by you », « Resume sales ».",
  "md-detail-resumed": "Le même détail après « Resume sales » : la vente reprend.",
  "md-detail-paused": "Détail d'une promo en pause (scénario `paused`).",
  "md-detail-settled-yes":
    "Détail d'une promo réglée sur OUI, avec le bilan (scénario `settledYes`).",
  "md-detail-settled-no":
    "Détail d'une promo réglée sur NON, avec le bilan (scénario `settledNo`).",
  "md-detail-cancelled":
    "Détail d'une promo dont le match est annulé, avec son bilan (scénario `cancelled`) : « Cancelled », jamais « Lost ».",
  "md-detail-polled-sale":
    "Détail d'une promo en ligne : une vente apparue par la seule relecture de l'API, Realtime absent.",
  "md-detail-stale":
    "Détail d'une promo en ligne quand les relectures échouent : « reconnecting », cote « updating ».",
  "md-home-with-cancelled":
    "L'accueil avec une promo au match annulé (scénario `withCancelled`) : ses ventes comptent.",
  "md-stats-with-cancelled":
    "Les statistiques avec une promo au match annulé (scénario `withCancelled`) : ses ventes comptent.",
  "md-settings": "Les réglages : profil, solde, informations techniques repliées, déconnexion.",
  // Hedge desk
  "hd-desk": "Le Hedge desk public : lieu d'exécution en tête, totaux, limites, instruments.",
  "hd-desk-tripped":
    "Le Hedge desk, réponse servie par le test : coupe-circuit déclenché (carnet périmé), non couvert au-dessus de la limite.",
  // Demo panel (U-07)
  "admin-key": "Le panneau démo, l'écran de la clé, bandeau « DEMO MODE » déjà affiché.",
  "admin-key-refused":
    "L'écran de la clé après une mauvaise clé (401 de l'API simulée) : redemandée.",
  "admin-result-confirm":
    "« Force the result » : la confirmation qui nomme le choix et l'instrument, rien d'envoyé encore.",
  "admin-panel":
    "Le panneau après les quatre actions (carnet piloté, résultat forcé, deux ventes rejouées, remise à zéro) et leur journal.",
  "admin-refusals":
    "Le panneau après un 400 (carnet), un 404 (résultat) et un 409 (vente) : les mots de l'API.",
} as const;

export type ReceiptName = keyof typeof RECEIPTS;
