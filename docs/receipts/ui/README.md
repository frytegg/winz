# Reçus des écrans : Playwright, iPhone 15, API simulée

Écrit par `pnpm e2e:ui` (suite `apps/web/e2e/ui` : parcours commerçant, client et Hedge desk). Les images
et ce fichier sont réécrits à chaque passage ; `measures.json` garde les mesures (une mesure qu'un
passage partiel n'a pas refaite garde sa date d'origine, dans la dernière colonne).

Dernier passage : 2026-11-20T05:40:22.869Z (UTC).

## Mesures du dernier passage

Un tap est un appui, une touche pressée seule, ou un champ saisi (un champ saisi compte pour un,
quelle que soit sa longueur). Les temps sont ceux de l'horloge, navigateur compris, sur l'API simulée
et après la compilation des pages par `next dev` (première ligne).

Les limites des critères de succès sont strictes (« moins de 15 taps », « moins de 2 minutes », « en moins
de 30 secondes ») : une valeur égale à la limite est notée DÉPASSÉ.

| Mesure | Valeur | Limite stricte | Détail | Mesurée le (UTC) |
| --- | --- | --- | --- | --- |
| Compilation des pages et des routes par `next dev` avant les parcours (non comptée dans les parcours) | 85,3 s | – | 15 pages, 15 routes d'API, une requête chacune | 2026-11-20T05:35:12.791Z |
| Achat client, du scan (ouverture de C1) au ticket affiché | 4,6 s (tenu) | 30 s | navigation vers /c/buzzballs-shop-texas-wins-by-14 jusqu'à la jauge du ticket visible, hors prise des captures ; comprend 0,5 s d'autorisation simulée et le suivi du paiement (1 s) | 2026-11-20T05:35:29.027Z |
| Achat client, C1 → C3 : taps | 2 taps | – | 1. tap « Buy with Apple Pay » (C1) · 2. tap the simulated payment (C2) | 2026-11-20T05:35:29.026Z |
| Onboarding commerçant, M0 → M8 : durée | 10,7 s (tenu) | 120 s | de M0 affiché au QR de M8 affiché, hors prise des captures ; gestes d'un robot, un humain lit et tape plus lentement | 2026-11-20T05:37:36.543Z |
| Onboarding commerçant, M0 → M8 : taps | 12 taps (tenu) | 15 taps | 1. tap « Start a promo » (M0) · 2. type the e-mail (M1) · 3. tap Continue (M1) · 4. type the 6-digit code (M1) · 5. type the business name (M2) · 6. tap the category « Bar » (M2) · 7. tap Continue (M2) · 8. tap the first game (M3) · 9. tap the recommended promo (M4) · 10. tap Continue (M5) · 11. tap « Review the promo » (M6) · 12. tap the simulated payment (M7) | 2026-11-20T05:37:36.543Z |

## Les images

Pleine page, viewport de l'iPhone 15 (393 px de large) à l'échelle 2, sans vidéo.

| Fichier | Ce qu'il montre |
| --- | --- |
| [`m0-home.png`](./m0-home.png) | M0, l'accueil : la promesse, « Start a promo ». |
| [`m0-role-menu.png`](./m0-role-menu.png) | M0, le menu « winz ▾ » ouvert : le lien vers l'espace client (« I'm a fan »). |
| [`m1-email.png`](./m1-email.png) | M1, la connexion : l'e-mail saisi. |
| [`m1-code.png`](./m1-code.png) | M1, le code à 6 chiffres (connexion simulée). |
| [`m2-business.png`](./m2-business.png) | M2, le commerce : nom saisi, catégorie choisie. |
| [`m3-game.png`](./m3-game.png) | M3, la liste des matchs. |
| [`m4-promo.png`](./m4-promo.png) | M4, les modèles de promo du match choisi, avec leur coût estimé. |
| [`m5-offer.png`](./m5-offer.png) | M5, l'offre pré-remplie et la promesse figée. |
| [`m6-margin.png`](./m6-margin.png) | M6, marge, budget et résultats calculés (coût par vente, capacité, seuil de pause). |
| [`m6-above-threshold.png`](./m6-above-threshold.png) | M6, aperçu `aboveThreshold` : la cote dépasse le seuil de pause, « Pick another promo » à la place du récapitulatif. |
| [`m6-no-book.png`](./m6-no-book.png) | M6, aperçu `noBook` : le marché n'a pas encore de carnet, pas de coût par vente, « Pick another promo ». |
| [`m7-review.png`](./m7-review.png) | M7, le récapitulatif (budget de 1 000 $, coût et marge par vente) et le paiement simulé du budget. |
| [`m8-live.png`](./m8-live.png) | M8, la promo en ligne : compte à rebours, QR, lien court, partage. |
| [`m8-qr-fullscreen.png`](./m8-qr-fullscreen.png) | M8, le QR ouvert en plein écran par un tap (pour le scan de l'autre côté du comptoir), bouton « Close » ; l'écran du téléphone seul, pas la page entière. |
| [`c1-open.png`](./c1-open.png) | C1, la page de campagne qui vend (scénario `live`). |
| [`c1-paused.png`](./c1-paused.png) | C1, promo en pause (scénario `paused`) : boutons d'achat désactivés. |
| [`c1-sales-closed.png`](./c1-sales-closed.png) | C1, ventes closes (scénario `salesClosed`). |
| [`c1-settled-yes.png`](./c1-settled-yes.png) | C1, match réglé sur OUI (scénario `settledYes`). |
| [`c1-settled-no.png`](./c1-settled-no.png) | C1, match réglé sur NON (scénario `settledNo`). |
| [`c2-checkout.png`](./c2-checkout.png) | C2, la feuille de paiement (paiement simulé) : 20,00 $ pour un. |
| [`c2-checkout-two.png`](./c2-checkout-two.png) | C2, la feuille de paiement après « + » sur C1 : quantité 2, total 40,00 $. |
| [`c2-securing.png`](./c2-securing.png) | C2, l'attente « Securing your promo… » après le paiement. |
| [`c2-refused-sales-paused.png`](./c2-refused-sales-paused.png) | C2, refus `409 sales_paused` du paiement (scénario `salesPaused`) : le message de l'API. |
| [`c2-refused-sales-closed.png`](./c2-refused-sales-closed.png) | C2, refus `409 sales_closed` du paiement (scénario `salesClosed` sur la seule requête de paiement) : le message de l'API. |
| [`c2-ended-failed.png`](./c2-ended-failed.png) | C2, paiement qui n'a pas abouti (scénario `failed`) : le message de l'API, « Try again » et le retour à la promo. |
| [`c2-ended-cancelled-paused.png`](./c2-ended-cancelled-paused.png) | C2, achat annulé car la promo s'est mise en pause pendant l'attente (scénario `cancelledPaused`). |
| [`c3-ticket-pre-game.png`](./c3-ticket-pre-game.png) | C3, le ticket avant le match (« … chance it's free », compte à rebours). |
| [`c3-ticket-in-game.png`](./c3-ticket-in-game.png) | C3, le ticket pendant le match (« Game on »). |
| [`c3-ticket-refunded.png`](./c3-ticket-refunded.png) | C3, le ticket remboursé : écran lime, « Refunded » et le montant (12,00 $). |
| [`c3-ticket-not-this-time.png`](./c3-ticket-not-this-time.png) | C3, le ticket perdu : « Not this time… », « Find another promo ». |
| [`c3-ticket-cancelled.png`](./c3-ticket-cancelled.png) | C3, le match annulé : « Game cancelled · your purchase stands ». |
| [`c3-ticket-not-found.png`](./c3-ticket-not-found.png) | C3, un lien de ticket inconnu (404 renvoyé par le test lui-même). |
| [`c4-sign-in.png`](./c4-sign-in.png) | C4, la connexion du fan (« Find your tickets »), ouverte depuis « My tickets ». |
| [`c4-tickets.png`](./c4-tickets.png) | C4, « My tickets » : Live, Won, Not this time, le total remboursé (scénario `severalTickets`). |
| [`c4-tickets-empty.png`](./c4-tickets-empty.png) | C4, aucun ticket : que faire (scénario `noTickets`). |
| [`c4-tickets-error.png`](./c4-tickets-error.png) | C4, la liste n'a pas chargé : le message et « Try again » (refus `ticketsUnavailable`). |
| [`c4-tickets-demo.png`](./c4-tickets-demo.png) | C4, un ticket de démo : le bandeau « DEMO MODE » (scénario `demoTicket`). |
| [`id-unreachable.png`](./id-unreachable.png) | L'API ne répond pas à `GET /api/me` (refus `meUnavailable`, 503) : « Can't reach Winz », la session gardée. |
| [`md-home.png`](./md-home.png) | Espace commerçant, l'accueil (solde, statistiques, promos actives). |
| [`md-list-in-progress.png`](./md-list-in-progress.png) | Espace commerçant, la liste des promos, onglet « In progress ». |
| [`md-list-closed.png`](./md-list-closed.png) | Espace commerçant, la liste des promos, onglet « Closed ». |
| [`md-list-with-funding.png`](./md-list-with-funding.png) | La liste avec une promo dont le budget n'est pas payé (scénario `withFunding`). |
| [`md-detail-live-stats.png`](./md-detail-live-stats.png) | Détail d'une promo en ligne, onglet « Stats ». |
| [`md-detail-live-budget.png`](./md-detail-live-budget.png) | Détail d'une promo en ligne, onglet « Budget ». |
| [`md-detail-live-controls.png`](./md-detail-live-controls.png) | Détail d'une promo en ligne, onglet « Controls ». |
| [`md-detail-paused-by-you.png`](./md-detail-paused-by-you.png) | Le même détail après « Pause sales » : « Paused by you », « Resume sales ». |
| [`md-detail-resumed.png`](./md-detail-resumed.png) | Le même détail après « Resume sales » : la vente reprend. |
| [`md-detail-paused.png`](./md-detail-paused.png) | Détail d'une promo en pause (scénario `paused`). |
| [`md-detail-settled-yes.png`](./md-detail-settled-yes.png) | Détail d'une promo réglée sur OUI, avec le bilan (scénario `settledYes`). |
| [`md-detail-settled-no.png`](./md-detail-settled-no.png) | Détail d'une promo réglée sur NON, avec le bilan (scénario `settledNo`). |
| [`md-detail-cancelled.png`](./md-detail-cancelled.png) | Détail d'une promo dont le match est annulé, avec son bilan (scénario `cancelled`) : « Cancelled », jamais « Lost ». |
| [`md-detail-polled-sale.png`](./md-detail-polled-sale.png) | Détail d'une promo en ligne : une vente apparue par la seule relecture de l'API, Realtime absent. |
| [`md-detail-stale.png`](./md-detail-stale.png) | Détail d'une promo en ligne quand les relectures échouent : « reconnecting », cote « updating ». |
| [`md-home-with-cancelled.png`](./md-home-with-cancelled.png) | L'accueil avec une promo au match annulé (scénario `withCancelled`) : ses ventes comptent. |
| [`md-stats-with-cancelled.png`](./md-stats-with-cancelled.png) | Les statistiques avec une promo au match annulé (scénario `withCancelled`) : ses ventes comptent. |
| [`md-settings.png`](./md-settings.png) | Les réglages : profil, solde, informations techniques repliées, déconnexion. |
| [`hd-desk.png`](./hd-desk.png) | Le Hedge desk public : lieu d'exécution en tête, totaux, limites, instruments. |
| [`hd-desk-tripped.png`](./hd-desk-tripped.png) | Le Hedge desk, réponse servie par le test : coupe-circuit déclenché (carnet périmé), non couvert au-dessus de la limite. |
| [`hd-venue-check.png`](./hd-venue-check.png) | Le Hedge desk, panneau « Real orders on Gemini sandbox » (scénario `venueCheckProven`) : les trois ordres relus chez Gemini. Valeurs d'exemple du mode simulé, pas la preuve réelle (docs/gemini-sandbox.md). |
| [`admin-key.png`](./admin-key.png) | Le panneau démo, l'écran de la clé, bandeau « DEMO MODE » déjà affiché. |
| [`admin-key-refused.png`](./admin-key-refused.png) | L'écran de la clé après une mauvaise clé (401 de l'API simulée) : redemandée. |
| [`admin-result-confirm.png`](./admin-result-confirm.png) | « Force the result » : la confirmation qui nomme le choix et l'instrument, rien d'envoyé encore. |
| [`admin-panel.png`](./admin-panel.png) | Le panneau après les quatre actions (carnet piloté, résultat forcé, deux ventes rejouées, remise à zéro) et leur journal. |
| [`admin-refusals.png`](./admin-refusals.png) | Le panneau après un 400 (carnet), un 404 (résultat) et un 409 (vente) : les mots de l'API. |

## Défauts trouvés, gardés en attentes `test.fail`

Plus un constat qui ne fait pas échouer la suite : en mode simulé, les pages qui importent
Stripe chargent quand même `https://js.stripe.com` (`lib/stripe/client.ts:1`) ; la suite bloque
cette requête, comme toute requête qui sortirait de la machine.

Chacun fait passer son test tant que le défaut existe, et le fait échouer le jour où il est corrigé :
retirer alors le `test.fail`.


## Ce que ces reçus ne prouvent pas

- **Safari.** WebKit n'est pas installé ici : le profil iPhone 15 de Playwright (taille, user agent,
  échelle, tactile, mobile) tourne sur Chromium. La mise en page et les parcours à cette taille sont
  prouvés, pas le rendu de Safari ni ses particularités (barre d'adresse, `dvh`, feuille de partage).
- **La vraie police.** Rien ne sort de la machine, serveur compris : `next/font/google` reçoit
  une réponse locale (`e2e/ui/support/google-fonts-mock.cjs`, sans fichier à télécharger) au lieu
  de Google Fonts. Les captures montrent la police de repli, sauf sur une machine où Sora est
  installée ; `pnpm dev` sur une machine qui a le réseau donne la vraie.
- **Le webpack de `pnpm dev`.** La suite lance `next dev --turbopack` : avec webpack, `next dev`
  dépasse 6 Go en compilant toutes les routes et se relance au milieu du passage.
- **Un vrai paiement.** En mode simulé, Stripe, Apple Pay et Google Pay sont remplacés par le
  bouton « Simulate payment » : aucune carte, aucune feuille de paiement réelle.
- **La vraie API.** Chaque route renvoie un exemple figé, choisi par scénario, sans état ni
  authentification ; rien ne passe par la base, le moteur, la chaîne ni Gemini. Les temps mesurés
  sont ceux du front sur des réponses immédiates (plus les attentes simulées : 0,6 s par étape de
  connexion, 1,5 s avant M8, 0,5 s d'autorisation de carte).
- **Le temps réel.** La cote « vivante » est une oscillation simulée ; Supabase Realtime n'est pas
  branché.
- **Les éléments fixes en pleine page.** Une capture pleine page fige la barre de navigation
  flottante là où se trouvait le bas de l'écran : elle apparaît donc au milieu des images longues.
- **Les états qu'aucun scénario n'offre**, comme une page de campagne introuvable (C1 n'a pas de
  scénario 404 : l'API simulée ignore le slug, et C1 lit la promo côté serveur, hors d'atteinte
  du navigateur ; il faudrait un refus simulé `notFound` sur `publicCampaign`).
