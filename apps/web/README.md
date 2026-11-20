# @winz/web

L'application Next.js de Winz : les écrans (commerçant, page de campagne, ticket) et les routes
HTTP de `/api`.

Mise en ligne (Supabase, Render, Privy, Vercel, Stripe), réglages du projet Vercel et variables : voir
[`docs/deploy.md`](../../docs/deploy.md).

## Construire les écrans sans le back : l'API simulée

Toutes les routes de l'API existent déjà. En mode simulé, chacune renvoie une
réponse d'exemple, au format exact que renverra le vrai back. Les exemples racontent l'histoire des
promos filmées pour la vidéo : le commerçant « Buzzball’s shop » (apostrophe typographique, comme en
production) vend un « Smash burger » à 12 $, 100 % remboursé si Texas gagne de 14 points ou plus ;
chaque montant (ventes, exposition, remboursements, bilan, solde, tickets) en découle. Aucun service n'a besoin de
tourner et aucun secret n'est nécessaire : ni base de données, ni Stripe, ni Privy.

```bash
APP_API_MOCK=true NEXT_PUBLIC_APP_API_MOCK=true pnpm --filter @winz/web dev
```

L'application est sur `http://localhost:3000`. Pour vérifier que l'API répond :

```bash
curl http://localhost:3000/api/c/buzzballs-shop-texas-wins-by-14
```

Sans `APP_API_MOCK=true`, une route qui n'est pas encore branchée répond `501` avec
`{ "error": { "code": "internal", "message": "Not implemented yet" } }`. La liste des routes déjà
réelles est plus bas, dans « Le vrai back ».

### Choisir un scénario

Chaque route a un scénario `default`, servi quand on ne demande rien. Pour en obtenir un autre,
ajouter l'en-tête `x-mock-scenario` à la requête :

```bash
curl -H "x-mock-scenario: settledYes" http://localhost:3000/api/c/buzzballs-shop-texas-wins-by-14
```

```ts
import { MOCK_SCENARIO_HEADER } from "@winz/shared";

const response = await fetch("/api/c/buzzballs-shop-texas-wins-by-14", {
  headers: { [MOCK_SCENARIO_HEADER]: "settledYes" },
});
```

Un nom de scénario inconnu répond `400 invalid_request`, et le message donne la liste des noms
valides pour cette route.

Les paramètres du chemin `:id`, `:slug` et `:pi` sont ignorés en mode simulé :
`/api/c/nimporte-quoi` renvoie le même exemple que `/api/c/buzzballs-shop-texas-wins-by-14`. Trois
réponses suivent la requête ou l'horloge (`lib/server/mock-answers.ts`) :

- `GET /api/t/:token`, sans scénario, répond le ticket de ce jeton parmi les tickets des exemples
  (ceux de « My tickets ») : le ticket ouvert depuis la liste est celui de sa carte. Un jeton
  qu'aucun exemple n'a répond `404 not_found`, comme la vraie route. Avec un scénario (`inGame`…),
  c'est l'exemple de ce scénario, quel que soit le jeton.
- `GET /api/events` date les matchs autres que celui de l'exemple (Arkansas-Texas, que partagent
  toutes les promos et tous les tickets) à partir de l'heure du serveur, quatre jours plus tard :
  M3 ne propose jamais un match passé.
- `POST /api/campaigns/preview` calcule les chiffres de M6 avec la fonction de prix du vrai serveur
  (`limits()` de `@winz/pricing`, comme `lib/server/preview.ts`) sur un carnet simulé par
  instrument : ils suivent le prix, les marges et le budget. `aboveThreshold` lit un carnet passé
  au-dessus du seuil, `noBook` aucun carnet. Les exemples `open` et `aboveThreshold` sont ce calcul
  pour la requête d'exemple, et un test le vérifie.

### Scénarios par route

| Route                            | Scénarios                                                                  |
| -------------------------------- | -------------------------------------------------------------------------- |
| `GET /api/me`                    | `default`, `merchant`, `newUser`, `fan`, et le fan sous `noTickets`, `severalTickets`, `demoTicket`, `ticketsUnavailable` |
| `POST /api/merchants`            | `default`                                                                  |
| `GET /api/events`                | `default`                                                                  |
| `POST /api/campaigns/preview`    | `default`, `open`, `aboveThreshold`, `noBook`                              |
| `POST /api/campaigns`            | `default`, `created`, `repeated`, `repeatedLive`                           |
| `GET /api/campaigns`             | `default`, `withFunding`, `withCancelled`                                  |
| `GET /api/campaigns/:id`         | `default`, `live`, `paused`, `settledYes`, `settledNo`, `cancelled`, `demo` |
| `POST /api/campaigns/:id/pause`  | `default`                                                                  |
| `POST /api/campaigns/:id/resume` | `default`                                                                  |
| `POST /api/campaigns/:id/close`  | `default`                                                                  |
| `POST /api/campaigns/:id/top-up` | `default`, `created`, `repeated`, `credited`                               |
| `GET /api/c/:slug`               | `default`, `live`, `paused`, `salesClosed`, `settledYes`, `settledNo`, `demo` |
| `POST /api/checkout`             | `default`, `salesPaused`, `salesClosed`                                    |
| `POST /api/checkout/:pi/confirm` | `default`, `processing`, `ticketed`, `cancelledPaused`, `failed`           |
| `GET /api/checkout/:pi`          | `default`, `processing`, `ticketed`, `cancelledPaused`, `failed`           |
| `GET /api/t/:token`              | `default`, `preGame`, `inGame`, `refunded`, `notThisTime`, `cancelled`, `demo` |
| `GET /api/tickets`               | `default`, `noTickets`, `severalTickets`, `demoTicket`                     |
| `GET /api/hedge-desk`            | `default`, `demo`, `venueCheckProven`                                      |
| `POST /api/admin/demo/book`      | `default`                                                                  |
| `POST /api/admin/demo/result`    | `default`                                                                  |
| `POST /api/admin/demo/sale`      | `default`, `processing`                                                    |
| `POST /api/admin/demo/reset`     | `default`                                                                  |
| `POST /api/webhooks/stripe`      | `default`                                                                  |
| `POST /api/webhooks/quicknode`   | `default`                                                                  |

Le détail d'une campagne suit aussi sa ligne publique `live_campaigns` en Supabase Realtime
(`lib/realtime/use-live-campaign.ts`) : ventes, exposition, couverture et état des ventes en viennent
quand elle est plus récente que la réponse de l'API, le reste vient de l'API, relue aussitôt, et
toutes les 2 s tant que le flux se tait (`lib/merchant/live-detail.ts`). L'API simulée ne pousse
rien : la suite du navigateur ne prouve que les relectures, la poussée se prouve sur la pile déployée.

Quel exemple sert `default` :

- `GET /api/me` : `merchant`
- `POST /api/campaigns/preview` : `open`
- `GET /api/campaigns/:id` et `GET /api/c/:slug` : `live`
- `POST /api/checkout/:pi/confirm` : `processing`
- `GET /api/checkout/:pi` : `ticketed`
- `GET /api/t/:token` : `preGame`

`demo`, sur la page publique, le ticket, le détail et le Hedge desk, est l'exemple par défaut avec
`demo: true` (une campagne touchée par une action démo) : il fait apparaître le bandeau « DEMO MODE ».

Le contenu des exemples est dans `packages/shared/src/api/examples.ts`, et le type de chaque
réponse dans `packages/shared/src/api/schemas.ts`.

### Champs à connaître

`requestId` est obligatoire sur `POST /api/campaigns` ; les autres champs ci-dessous sont présents
dans chaque réponse, simulée ou réelle.

- `POST /api/campaigns` prend `requestId` (un `uuid` tiré une fois par appui sur « Fund » et
  renvoyé tel quel à chaque nouvelle tentative). Le même `requestId` rend la même campagne et le
  même paiement, sans rien créer ; avec d'autres réglages, `409`. **Obligatoire** : un corps sans
  lui répond `400 invalid_request`, `Invalid body.requestId: …`, et ne crée rien, y compris sur
  l'API simulée (sans lui, un double appui créerait deux campagnes et deux paiements). Le front
  l'envoie déjà (`components/wizard/step-review.tsx`, `/kit/pay`). Détail plus bas, « Créer une
  campagne (M7) ».
- `event: { sport, league, home, away }` (le match, équipes comme dans `GET /api/events`) sur
  `GET /api/campaigns`, `GET /api/campaigns/:id`, `GET /api/c/:slug`, `GET /api/t/:token` et
  `GET /api/tickets`. `eventTitle` reste.
- `subjectName` (`"Texas"`, ou `null`) : l'équipe dont parle la condition, écrite comme dans
  `conditionLabel`. Sur les modèles de `GET /api/events`, le détail, la page publique et le ticket.
  `null` pour un total de points (`Over 45.5 points`) et pour un nul (`Draw`).
- `resultLabel` : la condition au passé une fois le match réglé, `"Texas won by 14+"` sur OUI,
  `"Texas did not win by 14+"` sur NON ; `null` avant et pour un match annulé. Sur le détail, la
  page publique et le ticket. Total : `The game went over 45.5 points` ; nul : `The game ended in a
  draw` (et leurs négations en `did not`).
- `team: "home" | "away" | null` sur chaque modèle de `GET /api/events` : quelle équipe est
  `subjectName` (`null` quand la condition ne parle pas d'une équipe, et, rarement, quand le
  catalogue ne sait pas de quel côté est le contrat : `subjectName` reste alors rempli).
- `home.winProbabilityBps` et `away.winProbabilityBps` sur `GET /api/events` seulement : le milieu
  (meilleure offre + meilleure demande, divisé par 2) du contrat « vainqueur » de cette équipe, à la
  même cote fraîche que les modèles. `null` sans ce contrat ou sans cote fraîche des deux côtés. Deux
  carnets distincts : les deux chances n'ont pas à faire 100 %.
- `createdAt` et `liveAt` sur `GET /api/campaigns` (donc le détail aussi) : la création, et la
  mise en ligne on-chain (`null` jusque-là). Une campagne dont le budget n'a jamais été payé (feuille
  de paiement fermée) reste `funding` : le back ne l'expire jamais, au front de masquer les vieilles
  à partir de `createdAt` (scénario `withFunding`).

### Les refus de vente

Deux scénarios de `POST /api/checkout` ne renvoient pas un exemple mais un refus, pour construire
les écrans « promo en pause » et « ventes closes » :

| Scénario      | Réponse                                 |
| ------------- | --------------------------------------- |
| `salesPaused` | `409`, `error.code` vaut `sales_paused` |
| `salesClosed` | `409`, `error.code` vaut `sales_closed` |

D'autres refus servent aux écrans de connexion et à « My tickets » :

| Route               | Scénario             | Réponse                                                         |
| ------------------- | -------------------- | --------------------------------------------------------------- |
| `GET /api/me`       | `meRefused`          | `403`, `forbidden` : la session est fermée, comme sur un `401`  |
| `GET /api/me`       | `meUnavailable`      | `503`, `internal` : l'API ne sait pas dire qui est connecté     |
| `GET /api/tickets`  | `ticketsUnavailable` | `503`, `internal` : la liste ne se charge pas                   |

Toute réponse d'erreur a la même forme, en mode simulé comme en vrai :

```json
{ "error": { "code": "sales_paused", "message": "This promo is paused right now, you were not charged" } }
```

`message` est en anglais et peut être montré tel quel au client. La liste des codes est
`API_ERROR_CODES` dans `@winz/shared`.

Les routes du mode démo ont aussi leurs refus simulés, avec les mots des vraies routes ; aucun n'est
dans le sélecteur de scénarios du front (`lib/api/mock-scenario.ts`), la suite du navigateur les
demande elle-même par l'en-tête :

| Route                         | Scénario            | Réponse                                     |
| ----------------------------- | ------------------- | ------------------------------------------- |
| les quatre `/api/admin/demo/*` | `wrongKey`          | `401`, `error.code` vaut `unauthenticated`  |
| `POST /api/admin/demo/book`   | `offTick`           | `400`, `error.code` vaut `invalid_request`  |
| `POST /api/admin/demo/result` | `unknownInstrument` | `404`, `error.code` vaut `not_found`        |
| `POST /api/admin/demo/sale`   | `salesPaused`       | `409`, `error.code` vaut `sales_paused`     |

### Les requêtes sont quand même vérifiées

Même en mode simulé, le corps JSON des `POST` et les paramètres de la query string sont validés
contre le schéma de la route. Une requête mal formée répond `400 invalid_request` et le message
nomme le premier champ fautif, par exemple `Invalid body.qty: ...`. Un écran qui marche sur l'API
simulée envoie donc déjà des requêtes que le vrai back acceptera.

```bash
curl -X POST http://localhost:3000/api/checkout \
  -H "content-type: application/json" \
  -d '{"slug":"buzzballs-shop-texas-wins-by-14","qty":1}'
```

### Ce que l'API simulée ne fait pas

- Elle ne vérifie aucune authentification : les routes `user`, `merchant` et `admin` répondent
  sans jeton ni clé.
- Elle n'a pas d'état : créer une campagne ne l'ajoute pas à `GET /api/campaigns`. Pour dérouler
  un parcours, changer de scénario d'un appel à l'autre.
- Les webhooks répondent `{ "received": true }` sans lire le corps.

## Le vrai back

Sans `APP_API_MOCK=true`, les routes lisent et écrivent la vraie base. Le web n'envoie jamais de
transaction : il écrit des lignes et met des jobs dans la table `jobs`, que le moteur
(`apps/engine`) exécute. Un changement on-chain (campagne en ligne, pause écrite, ticket émis)
apparaît donc quelques secondes après la réponse de la route, quand le moteur l'a fait.

Le client Postgres (`lib/server/db.ts`) exige TLS pour tout hôte qui n'est pas local (chiffré, sans
vérifier le certificat, comme `sslmode=require` ; un `sslmode=` dans `DB_URL` l'emporte) et ferme
une connexion inutilisée après 5 s. Sur Vercel, chaque réponse d'une route API garde l'instance
éveillée (`after`, donc `waitUntil`) jusqu'à ce que ses connexions soient fermées, 6 s au plus :
une instance gelée ne garde plus de connexion du pooler. Ailleurs (`next dev`, tests), rien
n'attend. Quand Privy ne peut pas vérifier un jeton (ses clés injoignables), la route répond
`503 internal` (« try again »), jamais `401` : le front ne déconnecte personne.
Si Privy refuse la demande de clés elle-même (400, 401, 403 ou 404, le plus souvent un
`NEXT_PUBLIC_PRIVY_APP_ID` faux), la réponse reste `503`, mais une ligne ERROR (une par minute), et
elle seule, le dit et nomme la variable ; une panne (5xx, délai, réseau) reste un WARN.

### Routes réelles

| Route                                                  | Ce qu'elle fait                                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `GET /api/me`, `POST /api/merchants`                   | Profil, rôles, création du commerce ; la même création répétée répond le commerce créé, une autre `409` |
| `GET /api/events`                                      | Catalogue et modèles calculés                                                                       |
| `POST /api/campaigns/preview`                          | Chiffres de l'écran M6                                                                              |
| `POST /api/campaigns`                                  | Crée la campagne (`funding`) et le paiement du budget (écran M7)                                    |
| `GET /api/campaigns`, `GET /api/campaigns/:id`         | Liste et détail du commerçant connecté                                                              |
| `POST /api/campaigns/:id/pause`, `/resume`, `/close`   | Pause, reprise et clôture manuelles                                                                 |
| `POST /api/campaigns/:id/top-up`                       | Recharge le budget d'une campagne en cours, payée par carte (CA-6)                                  |
| `GET /api/c/:slug`                                     | Page publique de la campagne                                                                        |
| `POST /api/checkout`                                   | Vérifie que la promo vend, crée l'autorisation de la carte                                          |
| `POST /api/checkout/:pi/confirm`, `GET /api/checkout/:pi` | Déclenche l'achat, puis suit son état                                                            |
| `GET /api/t/:token`, `GET /api/tickets`                | Ticket par lien secret, tickets du fan connecté                                                     |
| `POST /api/webhooks/stripe`                            | Webhook Stripe, signature vérifiée sur le corps brut                                                |
| `POST /api/webhooks/quicknode`                         | Webhook QuickNode Streams : les logs de l'escrow dans `chain_events`, une fois (HE-1)               |
| `GET /api/hedge-desk`                                  | Hedge desk public : instruments couverts, lieu d'exécution, paramètres, totaux, contrôle sandbox    |
| `POST /api/admin/demo/book`, `/result`, `/sale`, `/reset` | Mode démo, derrière la clé admin                                                                 |

Plus aucune route ne répond `501`.

### Le webhook QuickNode Streams

`POST /api/webhooks/quicknode` vérifie la signature (`x-qn-nonce`, `x-qn-timestamp`,
`x-qn-signature`, HMAC-SHA256 du jeton `QUICKNODE_STREAMS_TOKEN`) sur le corps brut, décompressé
s'il est en gzip, puis écrit les logs de `ARC_ESCROW_ADDRESS` dans `chain_events` avec la source
`streams`, sous la même forme que le reçu et la relecture `eth_getLogs` du moteur ; un événement
déjà écrit par une autre source ne change rien. Le moteur l'applique comme les deux autres.
Aucune fenêtre sur l'horodatage (secondes Unix) : QuickNode ne dit pas si une nouvelle tentative
est signée à nouveau, et une livraison rejouée n'écrit rien de plus. Le jeton, le réseau attendu
(`QUICKNODE_STREAMS_NETWORK`, défaut `arc-testnet`) et l'escrow viennent de la configuration du
serveur (`serverConfigOf`, `lib/server/deps.ts`), son seul lecteur de l'environnement.
Création de l'endpoint et du Stream : `docs/quicknode.md`.

| Réponse | Quand                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------- |
| `200`   | Livraison écrite (ou déjà écrite) ; les logs d'autres adresses sont ignorés                         |
| `401`   | En-tête manquant, signature fausse, horodatage qui n'est pas un nombre ; rien n'est écrit           |
| `400`   | Corps qui n'est pas du JSON d'une forme documentée, nombre hors de ce que la table garde (bloc, index, date), livraison d'un autre réseau ou sans réseau |
| `413`   | Plus de 4 Mio, compressé ou une fois décompressé                                                   |
| `503`   | `QUICKNODE_STREAMS_TOKEN` ou `ARC_ESCROW_ADDRESS` absent (dit une fois dans les logs)               |
| `500`   | Base indisponible : rien n'est écrit, QuickNode renvoie la livraison                               |

### Créer une campagne (M7)

`POST /api/campaigns` prend les réglages de l'aperçu plus `product`. Le prix unitaire et le budget
sont payés par carte : chacun doit être un nombre entier de cents, entre 0,50 $ et 999 999,99 $.
Sinon la route répond `400 invalid_request` et le message nomme le champ, par exemple
`Invalid body.unitPrice: must be a whole number of cents`. Un match dont les ventes sont déjà
closes répond `409 sales_closed`, une condition indisponible `404`.

La réponse donne `budgetPayment.clientSecret` : le front le passe au Payment Element de Stripe pour
payer le budget. La campagne reste `funding` jusqu'à ce que le moteur l'ait créée on-chain, puis
passe `live` avec son `slug` : relire `GET /api/campaigns/:id` jusqu'à voir `live`.

Le front tire un `requestId` (`crypto.randomUUID()`) à chaque appui sur « Fund » et le renvoie à
chaque nouvelle tentative de ce même appui (réseau coupé, `502`). M7 le garde dans le
`sessionStorage` de l'onglet (`winz.fund-request`, écrit avant l'envoi, avec la clé des réglages) :
un rechargement ou un aller-retour par M6 renvoie le même ; il est oublié une fois le budget payé et
après un `409`. Deux appels du même `requestId`,
même au même instant, font une campagne et un paiement. Ce que rend une répétition, selon où en
est la campagne :

| La campagne                                   | La réponse                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| attend le paiement                            | `status: "funding"`, même `campaignId`, même `clientSecret` : rouvrir la feuille de paiement |
| payée, en route vers la chaîne                | `status: "funding"`, même paiement : Stripe dira qu'il est déjà payé, suivre le détail       |
| en ligne, en pause, close, réglée             | son `status` du moment (`live`…), même paiement : rien à payer, ouvrir la campagne           |
| `funding`, son paiement annulé chez Stripe    | la campagne est jetée : `status: "funding"`, un NOUVEAU `campaignId` et un nouveau paiement : le front garde toujours le `campaignId` et le `clientSecret` de la DERNIÈRE réponse |
| encore en création par un autre appel du même `requestId` | `503 internal`, `This promo is still being created; try again in a moment` : rien n'est annulé, renvoyer le **même** `requestId` un peu plus tard (comme après toute réponse `5xx` ou coupure réseau de cette route) |
| mêmes `requestId`, autres réglages            | `409 conflict`, `This request was already used for another promo; make a new request to create one` |

Un corps sans `requestId`, ou dont le `requestId` n'est pas un `uuid`, répond `400
invalid_request` (`Invalid body.requestId: …`) et ne crée rien. Si Stripe est en panne (`502`), le
même `requestId` réessayé plus tard retrouve le paiement éventuellement créé, sans en créer un
second. Une campagne `funding` dont le budget n'est jamais payé n'est jamais expirée par le back :
elle reste dans `GET /api/campaigns`, avec `liveAt: null`.

### Pause, reprise, clôture

- `pause` : seulement quand la campagne est `live` et vend. La vente s'arrête tout de suite
  (`saleState: "paused_manual"`) ; `status` passe à `paused` quand le moteur a écrit la pause.
- `resume` : seulement après une pause manuelle. `saleState` reste `paused_manual` jusqu'à ce que le
  moteur l'ait recalculé (il peut alors être une pause automatique, par exemple `paused_price`).
- `close` : avant la fin des ventes, sur une campagne `live` ou `paused`. `saleState` devient
  `closed` tout de suite.

La réponse est l'état tel que le commerçant le verra en relisant le détail, pas l'état futur.
Une action impossible dans l'état actuel (déjà en pause, ventes closes, campagne réglée) répond
`409 conflict` ; la campagne d'un autre commerçant répond `404`.

### Recharger le budget

`POST /api/campaigns/:id/top-up` prend `{ amount, requestId }` (micro-USDC, un `uuid` gardé par le
front pour ses nouvelles tentatives, dans le `sessionStorage` par promo ; sur un `409` de demande
finie, la feuille en tire un nouveau et renvoie une fois, dans le même geste) et répond comme la création : `budgetPayment.clientSecret` pour
le Payment Element, et `status` (`requires_payment`). Le même `requestId` rend le même paiement
avec son `status` du moment (`processing` une fois payée, `credited` une fois versée : rien à
payer) ; une recharge finie autrement (annulée, refusée, remplacée, remboursée) répond `409` : il
faut une nouvelle demande. Refus : `409` si la campagne n'est pas en ligne, ventes closes
(`sales_closed`), réglée, ou si une recharge payée est en route (une recharge pas encore payée est
remplacée, son paiement annulé) ; `400` hors 0,50 $–999 999,99 $ ou si le budget total dépasserait
999 999,99 $. Le budget du détail change quand le moteur l'a versé. Stripe n'est jamais appelé
pendant que la ligne de la campagne est verrouillée : une recharge lente ne retient pas ses ventes.

Stripe rend le même PaymentIntent à un `requestId` pendant environ 24 h, quoi qu'il soit devenu :
une demande dont le paiement a été créé puis retiré (annulé) ne peut plus jamais être payée, et
son `requestId` est fini. Chaque `409` de la route, avec son message (à montrer tel quel), et si le
même `requestId` peut aboutir plus tard :

| Message du `409`                                                                                  | Même `requestId` plus tard ?                                |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `This promo is not live yet`                                                                      | oui, une fois la promo en ligne (rien n'a été créé)         |
| `A top-up of this promo is on its way; try again once it is credited`                            | oui, une fois cette recharge versée (rien n'a été créé)     |
| `A top-up of this promo is being paid; try again once it is credited`                             | oui, une fois ce paiement fini (rien n'a été créé)          |
| `This promo cannot be topped up now`                                                              | garde défensive, qu'aucun statut actuel n'atteint           |
| `This promo is already settled` ; `sales_closed` : `Sales are closed for this promo: …`           | non : plus aucune recharge possible sur cette promo         |
| `This top-up request is over; make a new request to top up again`                                | non : nouvelle demande                                      |
| `This request was already used for another top-up; make a new request to top up`                  | non : ce `requestId` sert à une autre recharge              |
| `A top-up of this promo is on its way; once it is credited, make a new request to top up again`   | non : son paiement, déjà créé, est retiré                   |
| `A top-up of this promo is being paid; once it is credited, make a new request to top up again`   | non : son paiement, déjà créé, est retiré                   |
| `Another top-up of this promo was just requested; make a new request to top up again`             | non : d'autres demandes ont pris la place, paiement retiré  |

De même, après un `502` (Stripe en panne) ou un `400` de plafond survenus une fois le paiement
créé, le même `requestId` répond ensuite `This top-up request is over…`. Avant d'enregistrer un
paiement, la route relit son état chez Stripe (une lecture par demande, verrou relâché) : un
paiement déjà annulé finit la demande (`409`, jamais un `clientSecret` impayable). Une recharge
dont une demande plus récente a annulé le paiement finit `failed` aussitôt, même si cette demande
est ensuite refusée : sa répétition répond `409`, et la place de la campagne est libre.

Deux appels simultanés d'une même demande (double tap, ou nouvelle tentative pendant que le premier
appel est encore chez Stripe) envoient la même clé d'idempotence, et Stripe refuse le second tant
qu'il traite le premier. Le second attend alors le premier (pauses de 1 s, 8 au plus) et répond ce
qu'il a obtenu : le même paiement, ou le même `409` si la demande a fini autrement. Si le premier
n'a toujours pas fini, il répond `503` (`internal`) avec
`This top-up is still being created; try again in a moment` : rien de cette demande n'a été
enregistré ni annulé,
et le front renvoie le **même** `requestId` un peu plus tard, jamais un nouveau (ce serait un
second paiement). C'est pourquoi ce n'est pas un `409`, qui sur cette route demande le plus
souvent une nouvelle demande. Une autre panne de Stripe reste un `502`, sauf si un autre appel de
la même demande a enregistré la recharge entre-temps : l'appel répond alors cette recharge.

### Le parcours d'achat, côté front

1. `POST /api/checkout` avec `{ slug, qty }`. Si la promo ne vend pas, `409` avec `sales_paused`
   ou `sales_closed` et un message à montrer tel quel : rien n'a été créé, rien n'est débité.
2. Monter l'Express Checkout Element (ou le Payment Element) de Stripe avec le `clientSecret`
   reçu, avec `emailRequired: true` : l'e-mail du payeur sert à retrouver son compte. Le client
   confirme dans la feuille de paiement (`stripe.confirmPayment`, `redirect: "if_required"`). La
   carte est seulement autorisée, pas débitée.
3. Dès que la confirmation Stripe a réussi, appeler `POST /api/checkout/:pi/confirm` (corps vide).
   Le webhook Stripe déclenche le même traitement : appeler les deux ne crée qu'un achat.
4. Interroger `GET /api/checkout/:pi` toutes les secondes environ, jusqu'à `ticketed` ou un échec.
   Confirmation échouée (réseau, `502`) : ne pas la rappeler, interroger suffit. Un paiement resté
   `requires_payment` 5 s, la route relit l'intent chez Stripe (une fois par 5 s au plus) et, carte
   autorisée, lance le même achat que la confirmation ; Stripe injoignable, elle répond la ligne.
   - `requires_payment` ou `processing` : continuer d'attendre ;
   - `ticketed` : ouvrir `/t/<ticketToken>` ;
   - `cancelled_paused` ou `failed` : afficher `message` tel quel (« Promo just paused, you were
     not charged », etc.). La carte n'est pas débitée.

   Si le client réessaie dans la même feuille de paiement après une carte refusée et que la
   nouvelle tentative est autorisée, rappeler `POST /api/checkout/:pi/confirm` : le paiement
   repasse en `processing`. Un événement d'échec Stripe arrivé en retard ne fait jamais passer en
   `failed` un paiement autorisé depuis : le serveur relit l'état chez Stripe, et dès que l'achat
   est transmis au moteur, seul le moteur décide de l'issue.

   Un paiement `failed` sans job d'achat (une carte refusée, marquée par le webhook) n'est donc pas
   une fin : le même intent peut être payé par une autre carte, et le webhook qui le transmettrait
   peut être encore en route. `GET /api/checkout/:pi` le relit chez Stripe comme un paiement
   `requires_payment` (au plus une fois par 5 s) et le répond sur la parole de Stripe, jamais sur
   la ligne :
   - `failed` (avec le message de la ligne) si cette lecture trouve l'intent impayé ou fini
     (`requires_payment_method`, `requires_confirmation`, `canceled`, ou annulé ici comme abandonné) ;
   - `processing` si elle trouve la carte autorisée (l'achat est transmis au moteur) ou en attente
     chez Stripe (`requires_action`, `processing`) ;
   - `requires_payment` si elle n'a pas lu Stripe (dans la fenêtre de 5 s, ou une autre lecture
     tient la place), n'a pas pu le lire, ou a trouvé un intent qui ne correspond pas à la ligne.

   Un `failed` de cette route est ainsi toujours la parole de Stripe ou la fin donnée par le moteur.
   La confirmation répond de même `processing` pour un tel paiement quand Stripe le dit en attente,
   et `failed` quand il le dit impayé. Un paiement `failed` dont le job d'achat existe appartient au
   moteur : ni la lecture du statut ni la confirmation ne le relisent ou ne le reprennent.

   L'app web n'a pas de planificateur : un intent abandonné est annulé quand on le croise. Quand la
   lecture du statut ou la confirmation trouve un intent qui attend le fan (`requires_action`, une
   validation 3-D Secure laissée ouverte, `requires_payment_method` ou `requires_confirmation`),
   sans job d'achat, plus de 15 min après la création du paiement
   (`ABANDONED_PURCHASE_AFTER_SECONDS`, mesuré sur `created_at` par l'horloge de la base, pas sur
   `updated_at` que chaque lecture tamponne), elle l'annule chez Stripe et passe le paiement `failed`
   avec le message d'annulation (« Your payment was cancelled, you were not charged »). Quinze
   minutes, c'est quinze fois la minute pendant laquelle la page suit un achat, et bien plus que le
   temps d'un tap à une autorisation, validation dans l'app de la banque comprise. Jamais un intent
   lu autorisé (`requires_capture`) ni un paiement dont le job existe : ceux-là sont au moteur. Un
   refus de Stripe (l'intent est en cours de paiement, `processing`) ne change rien et la réponse
   reste `processing` ; une panne de Stripe est journalisée et rien n'est marqué, la lecture
   suivante réessaie. Annuler ne peut pas débiter : un intent annulé ne se capture plus, et la
   feuille qui le gardait en paie un nouveau, une seule fois. Une limite, étroite : Stripe accepte
   d'annuler un intent autorisé (il libère l'autorisation). Une validation qui tomberait dans les
   millisecondes entre notre lecture et l'annulation, sur un intent vieux de quinze minutes, est
   donc libérée ; si le webhook l'avait déjà prise, la capture du moteur échoue et l'achat finit
   annulé, jamais débité. Ce cas est journalisé en erreur (`abandoned purchase cancelled at Stripe
   after its purchase job was taken`).

5. Un `pi` inconnu répond `404`. Ces réponses ne contiennent jamais l'e-mail, l'adresse de
   l'acheteur ni aucun terme on-chain.

Ce que fait l'écran (`components/winz/checkout-sheet.tsx`, décisions dans `lib/fan/checkout-flow.ts`
et `lib/fan/pending-purchase.ts`, testées à côté) :

- **Un seul paiement, quel que soit le nombre de taps.** La réponse de `POST /api/checkout` est
  gardée par la feuille, pour cette promo et cette quantité, et l'essai suivant paie ce même
  PaymentIntent au lieu d'en créer un autre. Elle n'est oubliée que quand ce paiement est fini : un
  ticket, une fin sans ticket après la confirmation (`cancelled_paused`, `failed`), un intent
  `canceled` chez Stripe (annulé par le moteur, abandonné depuis plus de 15 min, ou autorisation
  expirée : l'essai en crée alors un nouveau, une seule fois), ou une autre quantité. Une carte
  refusée ne finit pas le paiement : l'intent repasse `requires_payment_method` et le tap suivant le
  paie avec une autre carte (le serveur, qui a marqué le paiement `failed`, le reprend dès que
  cette carte est autorisée). Après un tap dont la carte est autorisée, un `failed` de la lecture du
  statut ne finit l'attente que si la confirmation a répondu pour cet essai, ou qu'une lecture a
  répondu `processing` (l'achat est transmis, ou Stripe a été lu) : confirmation perdue, le
  paiement refusé avec la carte précédente peut encore dire `failed` avant que la lecture relise
  Stripe et trouve la nouvelle carte autorisée. L'attente continue alors, dans sa minute.
  `cancelled_paused` et une carte refusée au tap finissent toujours aussitôt.
  La règle tient au-delà de la page : un tap sur « Pay » alors que le navigateur garde pour cette
  promo un achat dont la carte a été vue autorisée, ou un achat repris après un rechargement ou une
  redirection (la feuille n'en a plus le `clientSecret`), suit d'abord cet achat jusqu'à sa fin
  (`beforePaying`, `lib/fan/pending-purchase.ts`) ; il ne crée un nouveau paiement que si celui-là
  s'avère fini sans ticket. Tant qu'un achat autorisé est en route, la feuille le dit
  (`copy.checkout.stillOnItsWay`), quelle que soit la quantité choisie.
- **Une erreur de Stripe n'est pas forcément un échec.** Quand `confirmPayment` répond une erreur
  ou lève, l'intent est relu une fois (`retrievePaymentIntent`) : `requires_capture` (ou déjà
  `processing`, `succeeded`) continue comme un succès (`lib/stripe/payment.ts`).
- **Une page perdue retrouve son ticket.** Dès que `POST /api/checkout` répond, le navigateur garde
  `{ paymentIntentId, authorized }` pour la promo (`localStorage`, clé `winz.purchase.<slug>`). À la
  visite suivante de la même promo, la page reprend le suivi (`GET /api/checkout/:pi`) et ouvre le
  ticket ; un paiement fini sans ticket est oublié. Un paiement dont la carte n'a pas été vue
  autorisée n'est oublié qu'après 15 s, et seulement si la confirmation (`POST /api/checkout/:pi/confirm`,
  demandée au plus une fois toutes les 5 s) répond `requires_payment`, ou une fin avant ticket. La
  confirmation relit Stripe à chaque appel, et son `requires_payment` veut dire que Stripe dit
  l'intent impayé ou fini (`requires_payment_method`, `requires_confirmation`, `canceled`). Elle
  répond 502 quand elle ne peut pas lire Stripe, et aussi quand Stripe ne connaît pas l'intent ou
  qu'il ne correspond pas à sa ligne (autre compte, autre mode) : rien n'est prouvé. Un intent encore
  en attente chez Stripe (`requires_action`, une validation 3-D Secure ouverte dans l'app de la
  banque, ou `processing`) répond `processing` : l'attente est affichée, et la lecture du statut le
  prend dès que Stripe passe à `requires_capture`. Le `requires_payment` de la lecture du statut ne
  suffit jamais, puisqu'elle répond la ligne quand Stripe ne répond pas, ni son `failed` pour une
  carte jamais vue autorisée (un paiement refusé avec une première carte, puis payé avec une autre
  avant que la page soit perdue) : il est suivi comme `requires_payment`, et seule la confirmation
  décide. Un intent abandonné plus de 15 min est annulé par la lecture qui le trouve : la reprise
  voit alors une fin et oublie le paiement, au lieu de le suivre une minute à chaque visite. Un 404
  ne fait oublier le paiement que s'il porte le code `not_found` de l'API (pas un 404 d'un
  déploiement cassé). Sans ces réponses, le paiement reste gardé et le tap suivant le suit au lieu
  de payer. Le retour d'une redirection de paiement (3-D Secure,
  `?payment_intent=…&redirect_status=…` sur la page de la promo) est suivi de la même façon, même
  dans un navigateur qui n'a rien gardé. Aucun e-mail n'est envoyé : l'e-mail sert à retrouver ses
  tickets dans « My tickets ».
- **L'attente a une fin.** Le suivi d'un achat en cours ne rappelle jamais la confirmation (la
  lecture du statut complète seule un paiement autorisé ; seule la reprise d'un paiement jamais vu
  autorisé la demande, voir plus haut) et s'arrête après 60 s (`WAIT_LIMIT_SECONDS`). Après un tap,
  la minute part de « Securing your promo… » : le temps de la confirmation compte, une confirmation
  qui ne répond pas est coupée au bout de la minute, et chaque lecture du statut ne dispose que du
  temps restant. Pour la reprise, c'est la même borne dure : elle est vérifiée après chaque appel,
  dans tous les cas, sur l'heure relue après l'appel, et chaque appel (lecture du statut ou
  confirmation) ne dispose que du temps restant avant les 60 s (au moins une seconde, pour que la
  dernière lecture ait lieu ; `withinBound`, un `AbortController` enfant et un `setTimeout`, sans
  `AbortSignal.any` que les vieux Safari iOS n'ont pas). Un appel coupé par cette borne compte comme
  « pas de réponse », jamais comme un abandon de la page, même quand Stripe met 47 s à répondre à
  chaque route. Une réponse qui tranche gagne quand elle arrive ; sinon la reprise finit
  `unresolved` et le paiement reste gardé. L'écran dit alors que rien n'est débité avant que le
  ticket existe, que rouvrir la promo sur ce téléphone reprend le suivi, et que payer à nouveau
  vérifie d'abord cet achat. Les deux bornes, après un tap comme à la reprise, se mesurent sur
  `performance.now()`, une horloge qui ne recule jamais, et pas sur l'heure de l'appareil, qu'un
  réglage ou une resynchronisation peut faire reculer (`monotonicNow`).
- **Une cote n'est jamais affichée comme fraîche quand elle ne l'est pas.** Sur C1 et le ticket,
  une relecture qui échoue affiche la chance comme inconnue (« Odds updating… »), et C1 ne vend
  plus tant que la dernière lecture réussie a plus de 10 s (`BOOK_STALE_AFTER_MS`, la règle de
  `liveProbabilityBps` côté serveur ; `lib/fan/fresh-read.ts`). L'heure de la dernière lecture est
  posée par la lecture elle-même (`stampingReads`), pas déduite d'un changement d'objet.

### Stripe en mode test

Seules les clés de test sont acceptées (`sk_test_...`) : une clé live est refusée au démarrage de
la première requête. Variables à mettre dans `.env` (jamais commitées) :

| Variable                             | Où la trouver                                                     |
| ------------------------------------ | ----------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`                  | Dashboard Stripe, mode test, Developers → API keys                |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Même page (`pk_test_...`), pour le front                          |
| `STRIPE_WEBHOOK_SECRET`              | Affiché par `stripe listen` ci-dessous (`whsec_...`)              |

En local, faire suivre les webhooks au serveur de développement avec la CLI Stripe :

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe \
  --events payment_intent.succeeded,payment_intent.amount_capturable_updated,payment_intent.canceled,payment_intent.payment_failed
```

Cartes de test utiles : `4242 4242 4242 4242` (acceptée), `4000 0000 0000 0002` (refusée). Le
budget d'une campagne est débité tout de suite ; un achat reste autorisé jusqu'à ce que le moteur
capture (ticket émis) ou annule (promo passée en pause entre-temps, échec).

`next build` ne lit aucun secret : la construction marche sans `.env`.

### Le Hedge desk (`GET /api/hedge-desk`)

Route publique, sans jeton, en lecture seule. Elle assemble ce que le moteur écrit en base :

- `instruments` : un élément par instrument que le moteur couvre (table `live_hedge_desk`), triés
  par début du match puis par symbole. Pour du temps réel, s'abonner à `live_hedge_desk` (une
  ligne par instrument, `payload` a exactement la forme d'un élément de `instruments`) ;
- `venue`, `venueLabel`, `venueNote` : le lieu d'exécution, à afficher tel quel et en clair. En
  `paper`, `venueLabel` vaut « PAPER · live Gemini book » et `venueNote` dit que les exécutions
  sont simulées sur le carnet réel de Gemini et que les exécutions maker sont optimistes ;
- `params` : les paramètres de risque en vigueur (`uMax` en micro-USDC, comme tout montant) ;
- `totals` : économie maker, pertes de garantie et gains de croisement, sur tous les matchs ;
- `venueCheck` : la dernière exécution du contrôle des ordres réels sur le sandbox Gemini (HE-10,
  `docs/gemini-sandbox.md`), ou `null` s'il n'a jamais tourné : l'heure, le lieu (`venue`), le
  verdict (`outcome` : `proven` ou `failed`, avec `failedStep` et `failure` en cas d'échec) et ses
  ordres (identifiant Gemini, étape, sens, type, prix, quantité, quantité exécutée et statut relu
  chez Gemini). Le scénario simulé `venueCheckProven` montre une exécution réussie avec des
  identifiants d'exemple ; `default` n'en a pas (« Not proven yet ») ;
- `demo` : `true` dès qu'une action du mode démo est en cours (un carnet piloté ou un résultat
  forcé existe).

La réponse ne contient jamais d'e-mail ni d'adresse.

### Le mode démo (`POST /api/admin/demo/*`)

Chaque appel porte l'en-tête `x-admin-key` (constante `ADMIN_KEY_HEADER` de `@winz/shared`) avec
la valeur de `APP_ADMIN_DEMO_KEY`. Sans en-tête ou avec une mauvaise clé : `401 unauthenticated`,
et rien n'est modifié. La clé reste côté serveur ou dans le panneau admin : jamais dans le code du
front public.

```bash
curl -X POST http://localhost:3000/api/admin/demo/book \
  -H "content-type: application/json" -H "x-admin-key: $APP_ADMIN_DEMO_KEY" \
  -d '{"instrumentSymbol":"GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13","bidBps":1100,"askBps":1300,"depth":"500000000"}'
```

| Route                          | Corps                                                         | Effet                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/admin/demo/book`    | `{ instrumentSymbol, bidBps, askBps, depth }`                 | Le moteur utilise ce carnet (un niveau de chaque côté, `depth` en micro-contrats) à la place de celui de Gemini, et suit l'instrument 60 min |
| `POST /api/admin/demo/result`  | `{ instrumentSymbol, outcome }` (`yes`, `no` ou `void`)       | Le moteur règle les campagnes de l'instrument sur ce résultat à la place de celui de Gemini                                   |
| `POST /api/admin/demo/sale`    | `{ slug, qty, email }`                                        | Rejoue un achat sans carte (voir plus bas)                                                                                     |
| `POST /api/admin/demo/reset`   | `{}` ou corps vide                                            | Supprime tous les carnets pilotés et tous les résultats forcés                                                                |

Toutes répondent `{ "ok": true, "demo": true, "ticketToken": null, "paymentIntentId": null }`,
sauf `sale` qui donne toujours un `paymentIntentId` et, si le ticket est déjà émis, un
`ticketToken`.

- `book` : `bidBps` et `askBps` sont des multiples de 100 entre 100 et 9900, avec `bidBps` <
  `askBps` ; `depth` est un multiple de `10000` (0,01 contrat) strictement positif. Sinon
  `400 invalid_request`. Un instrument inconnu répond `404`.
- `result` : un instrument inconnu répond `404`. Le règlement n'est pas immédiat : le moteur le
  fait une fois les ventes closes.
- `sale` : la campagne doit pouvoir vendre exactement comme pour `POST /api/checkout` : sinon
  `404` (slug inconnu) ou `409` avec `sales_paused` ou `sales_closed`. La route crée un paiement
  `pi_demo_…`, le transmet au moteur, puis attend jusqu'à 8 secondes que le ticket soit émis :
  `ticketToken` est alors rempli (ouvrir `/t/<ticketToken>`), sinon il vaut `null` et le ticket
  arrivera un peu plus tard : suivre alors le paiement avec `GET /api/checkout/<paymentIntentId>`
  exactement comme pour un achat par carte, jusqu'à `ticketed`, `failed` ou `cancelled_paused`.
  Ne pas relancer `sale` après un `ticketToken` à `null` : chaque appel est une nouvelle vente.
- `reset` : les campagnes touchées par une action démo restent des campagnes démo.

### Qui est connecté, et où il arrive

- **Une API lente ne déconnecte personne** (`lib/auth/me-retry.ts`, les deux fournisseurs de
  connexion). Seuls un `401` ou un `403` de `GET /api/me` ferment la session. Sans réponse, ou sur
  un `5xx` (dont le `503` du serveur quand il ne peut pas vérifier un jeton), l'écran reste en
  chargement, la requête est refaite après 1 s, 2 s et 4 s, puis « Can't reach Winz » s'affiche avec
  « Try again » (`lib/auth/unreachable-gate.tsx`), la session gardée.
- **Deux entrées, une seule connexion** (`lib/auth/route-guard.ts`). « Start a promo » ouvre
  `/start` : un commerçant arrive sur `/home`, les autres sur `/business`. « I'm a fan » (M0) ouvre
  `/tickets`, qui envoie quelqu'un de non connecté sur `/start?from=tickets` (« Find your tickets »,
  avec l'e-mail du paiement, code ou Face ID) ; `from=tickets` suit l'étape du code, et la connexion
  finit sur « My tickets », jamais sur `/business`. Un commerçant qui ouvre `/tickets` y voit ses
  propres tickets.

### « My tickets » (C4, `/tickets`)

La liste de `GET /api/tickets`, en trois groupes (`lib/fan/tickets-view.ts`) :
**Live** (`pre_game`, `in_game`, le prochain match d'abord), **Won** (`refunded`) et **Not this time**
(`not_this_time`, et `cancelled`, qui garde son étiquette « Cancelled » : pas de remboursement,
l'achat tient), les deux derniers du match le plus récent au plus ancien. Chaque ticket porte le mot
de sa page (`copy.ticket.phases`) et ouvre son ticket vivant (`/t/<token>`). En tête, le total
remboursé tel que l'API l'envoie (`refundedTotal`, jamais recalculé). Sans ticket : quoi faire, et
« Use another email ». Erreur : le message et « Try again ». Le bandeau « DEMO MODE » suit la
réponse (un ticket `demo`). Scénarios : `noTickets`, `severalTickets` (un ticket par phase, dont
deux smash burgers), `demoTicket`, et le refus `ticketsUnavailable`. Sous ces scénarios,
`GET /api/me` répond le fan (`maya@example.com`), pas le commerçant.

### Le bandeau « DEMO MODE »

Afficher le bandeau « DEMO MODE » sur tout écran dont une réponse porte un champ `demo` à `true` :
`GET /api/c/:slug`, `GET /api/t/:token` et chaque ticket de `GET /api/tickets`,
`GET /api/campaigns/:id`, `GET /api/hedge-desk`, et les réponses des routes démo elles-mêmes. Une
campagne touchée par une action démo (carnet piloté ou résultat forcé sur son instrument, vente
rejouée) le reste pour toujours, même après `reset`.

## Le test de bout en bout (`e2e/`)

Le dossier `e2e/` fait tourner tout le produit d'un seul tenant, sur une chaîne locale : les
handlers des routes de `app/api` (appelés comme Next.js les appelle, avec une `Request`), le moteur
comme un seul processus (`startEngine`, câblé comme `apps/engine/src/index.ts`) et le vrai
`WinzEscrow` avec son jeton de test. Seuls Gemini et Stripe sont simulés :

- **Stripe** : un seul compte simulé (`e2e/support/stripe.ts`) que le web et le moteur partagent,
  chacun par sa propre interface `PaymentGateway`. L'autorisation créée par `POST /api/checkout`
  est donc celle que le moteur capture ou annule. Les webhooks sont signés et vérifiés par le code
  de Stripe. Chaque appel est noté, ce qui permet de compter captures, annulations et
  remboursements.
- **Gemini** : l'API REST que lit la synchronisation du catalogue (un match, deux issues, puis son
  résultat), et un flux de carnets alimenté à la main sur lequel tourne le vrai `BookFeed` du
  moteur, qui écrit donc `book_cache` et `live_instruments` comme en production.

Toutes les horloges (moteur, routes, carnets) suivent l'heure des blocs : avancer le temps de la
chaîne fait expirer les cotations et fermer les ventes. Un scénario ne pilote que la surface
publique (requêtes HTTP, ce que le client fait sur la feuille de paiement, webhooks signés,
carnets, résultat du match, temps de la chaîne) ; il lit la base et la chaîne pour vérifier, sans
jamais les écrire.

Ce que les scénarios prouvent :

| Fichier           | Scénario                                                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loop.test.ts`    | A : la boucle complète, issue OUI (création, budget, ventes, couverture maker, clôture, règlement, remboursements), l'argent vérifié au micro-USDC près ; G : la latence d'une vente ; B : issue NON ; F : deux commerçants sur le même match |
| `pause.test.ts`   | C : carte autorisée puis vente impossible (pause du commerçant, prix au-dessus du seuil, carnet périmé) : « Promo just paused, you were not charged », autorisation annulée, rien sur la chaîne, puis la vente repart                         |
| `demo.test.ts`    | D : le mode démo de bout en bout (carnet piloté, vente rejouée sans Stripe, résultat forcé, règlement OUI) et le champ `demo` de chaque réponse                                                                                               |
| `restart.test.ts` | E : le moteur redémarré après un `buyFor` miné et avant la capture, puis au milieu du règlement : rien n'arrive deux fois                                                                                                                     |
| `top-up.test.ts`  | CA-6 : une promo au budget épuisé est rechargée par la route et le webhook Stripe, revend sans autre action, puis réglée OUI rend le budget non dépensé, recharge comprise, au micro-USDC près                                               |

`e2e/support/harness.test.ts` vérifie le harnais lui-même, sans chaîne ni base : une attente
bornée ne laisse aucun minuteur derrière elle, une erreur de route n'est pas prise pour une pause,
le registre Stripe voit une seconde capture faite sous une autre clé d'idempotence, et la garantie
d'un ticket ne dépasse pas `floor(payé × (marge usuelle − marge minimale) / 10 000)`.

Lancer (les binaires de Postgres et `anvil` doivent être installés, comme pour les tests du
moteur : chaque scénario a sa propre base et son propre escrow, une seule chaîne par fichier) :

```bash
pnpm --filter @winz/web exec vitest run e2e
```

Le scénario A affiche les latences mesurées (`[e2e latency] …`). Pour suivre ce que fait le
moteur, `E2E_LOG_FILE=/chemin/engine.log` écrit tout son journal (niveau `debug`) dans ce
fichier ; sans elle, seuls ses avertissements et erreurs sont gardés, et cités quand une attente
échoue.

## Les écrans dans un navigateur (`e2e/ui/`, Playwright)

Une suite Playwright ouvre les écrans eux-mêmes, au format d'un iPhone 15, sur l'API simulée :
l'onboarding M0 → M8 (taps comptés, moins de 15, et durée), M4 et M6 quand
la promo ne se vendrait pas (scénarios `aboveThreshold` et `noBook` de l'aperçu), la page de
campagne C1 dans chaque état des scénarios, l'achat C2 par le paiement simulé (durée du scan au
ticket, moins de 30 s ; total au cent près selon la quantité ; refus `sales_paused` et
`sales_closed`, paiement `failed`, pause pendant l'attente), le ticket C3 dans ses cinq phases (le
montant remboursé au cent près), l'espace commerçant (liste et onglets, détail en ligne, en pause,
réglé avec son bilan, match annulé, exposition et jauge de couverture, une vente vue en moins de 3 s
par les seules relectures de l'API, relectures en échec, totaux avec un match annulé, pause et
reprise, réglages) et le Hedge desk. Sur chaque page ouverte, elle
vérifie aussi : aucune réponse 404 ou 5xx, ni aucune 4xx de l'API, que le scénario n'a pas
demandée, aucune erreur de page ni de console (les exceptions sont listées, avec leur raison, dans
`e2e/ui/support/fixtures.ts`), aucun défilement horizontal à 393 px (mesuré contre
`documentElement.clientWidth` : sous l'émulation mobile, `window.innerWidth` s'élargit avec le
contenu et ne peut rien détecter), aucun lien vers une page qui n'existe pas, aucune requête qui
sort de la machine (bloquée). `e2e/ui/harness.spec.ts` montre que chacune de ces gardes se
déclenche sur un défaut planté (un élément de 900 px, une 400 de l'API), sans quoi une suite verte
ne prouverait rien.

```bash
pnpm e2e:ui            # depuis la racine ; ou pnpm --filter @winz/web e2e:ui
```

- **Un seul projet**, `iphone-15` : le profil iPhone 15 de Playwright (taille, user agent, tactile,
  mobile, échelle ramenée à 2) sur **Chromium**, faute de WebKit installé. La mise en page et les
  parcours à cette taille sont prouvés, pas le rendu de Safari.
- **Le serveur** : la suite lance `next dev --turbopack` en mode simulé (`APP_API_MOCK=true`,
  `NEXT_PUBLIC_APP_API_MOCK=true`) sur le port 3460 (`E2E_UI_PORT` pour un autre), ou réutilise
  celui qui y tourne déjà, après avoir vérifié qu'il est bien simulé. Turbopack plutôt que webpack :
  avec webpack, `next dev` dépasse 6 Go en compilant toutes les routes et se relance au milieu du
  passage. Chaque page et chaque route sont demandées une fois avant les parcours, pour que les
  temps mesurés soient ceux de l'app et pas du compilateur. Pas de `next build` : il lui faut Google
  Fonts.
- **Aucun accès au réseau, serveur compris** : `next/font/google` lit
  `e2e/ui/support/google-fonts-mock.cjs` au lieu de Google Fonts (`NEXT_FONT_GOOGLE_MOCKED_RESPONSES`),
  une réponse `local()` sans fichier à télécharger ; toute autre requête sortante du serveur meurt
  sur un proxy mort (`127.0.0.1:9`, localhost exclu). Les captures montrent donc la police de
  repli, sauf sur une machine où Sora est installée. Pour la vraie police, lancer `pnpm dev` à la
  main sur une machine qui a le réseau. Un serveur déjà lancé sur le port (réutilisé) n'a pas ces
  garanties : `harness.spec.ts` échoue alors sur sa vérification de la police.
- **Le service worker** ne joue pas : Serwist ne le génère qu'en production (`next.config.ts`), et
  la suite bloque de toute façon les service workers (`serviceWorkers: "block"`), donc aucun passage
  ne dépend du cache d'un passage précédent.
- **Les reçus** : une capture pleine page de chaque écran atteint, sous un nom stable, dans
  `docs/receipts/ui/`, réécrite à chaque passage, avec `README.md` (ce que montre chaque image, taps
  et temps du dernier passage, date, ce que les reçus ne prouvent pas) et `measures.json`.
- **Les défauts trouvés** restent des attentes marquées `test.fail` (liste et raisons dans
  `e2e/ui/support/known-defects.ts`) : elles passent tant que le défaut existe et échouent le jour
  où il est corrigé, il faut alors retirer la marque. La marque est posée en cours de test
  (`knownDefectFromHere`), juste avant l'attente qui montre le défaut : une connexion ou une
  navigation cassée avant elle fait échouer le test normalement au lieu de passer pour le défaut.
- **Ce qu'aucun scénario n'offre** n'est pas testé : une page de campagne C1 introuvable (l'API
  simulée ignore le slug, et C1 la lit côté serveur, hors d'atteinte du navigateur). Il faudrait un
  refus simulé `notFound` sur `publicCampaign` (`MOCK_REFUSALS`, `lib/server/route.ts`).
- **Le panneau démo** (`e2e/ui/demo-admin.spec.ts`) : la mauvaise clé refusée et redemandée,
  les quatre actions avec le corps de « Le mode démo » ci-dessus, les bornes du carnet saisies au
  doigt, la confirmation avant un résultat forcé, un 400, un 404 et un 409 dits avec les mots de
  l'API, la clé en `sessionStorage` et dans le seul en-tête `x-admin-key`, aucun lien public vers
  `/admin` et `noindex`, puis le bandeau « DEMO MODE » sur C1, C3, le détail, le Hedge desk et le
  panneau (scénarios `demo`). L'API simulée ne vérifie aucune clé : c'est la spec qui joue le
  contrôle et demande le refus `wrongKey`. La vraie clé est prouvée par `lib/server/auth.test.ts`,
  les vraies routes par `lib/server/demo.test.ts`, et le moteur qui obéit au carnet et au résultat
  par `e2e/demo.test.ts` (scénario D) et la répétition sur Arc testnet.
- vitest ignore `e2e/ui/` (`vitest.config.ts`) et Playwright ne lit que `e2e/ui/**/*.spec.ts`.

Pas encore dans la CI : le runner devrait installer Chromium à chaque passage (`pnpm --filter
@winz/web exec playwright install --with-deps chromium`, environ 150 Mo, ou une image
`mcr.microsoft.com/playwright` à la version de `@playwright/test`), puis lancer `pnpm e2e:ui` et
garder `docs/receipts/ui/` en artefact. Compter quatre à cinq minutes, compilation comprise.

## Répétition sur une vraie chaîne (`e2e/rehearsal/`)

La répétition joue toute la boucle en mode démo, en temps réel, sur une chaîne réelle : le moteur
démarre avec ses intervalles de production (`startEngine`, rien de raccourci), les routes du
commerçant et de l'admin sont appelées exactement comme dans les tests de bout en bout, et toutes
les transactions de la boucle sont envoyées par le moteur. Contrairement aux tests de `e2e/`, elle
ne voyage pas dans le temps : le commerçant clôt ses ventes par `POST /api/campaigns/:id/close`,
et le résultat est forcé par `POST /api/admin/demo/result`.

Dans l'ordre :

1. Refus avant tout envoi : la chaîne doit être Arc testnet (5042002) ou une chaîne locale (31337,
   ou un autre identifiant avec `--local`) et répondre cet identifiant ; le relayer, l'oracle et la
   trésorerie lus dans l'escrow doivent être les adresses des clés données (la trésorerie est le
   relayer) ; le scénario doit être un scénario que la route de création accepte. Elle affiche
   ensuite les adresses (jamais une clé), les soldes de la trésorerie et de l'oracle, et le pire
   cas : ce que la trésorerie avance (budget, chaque vente, et ce qui est dû au commerçant sur OUI)
   et le gaz de chaque transaction au prix actuel du nœud (au moins le plancher d'Arc, 20 gwei).
   Elle refuse si les soldes ne couvrent pas ce pire cas avec 20 % de marge. `--estimate` s'arrête
   là.
2. Le moteur démarre : Gemini réel par défaut (catalogue et carnets), ou simulé avec
   `--gemini simulated` ; le paiement du budget passe par le Stripe simulé et son webhook, les
   ventes par `DemoPaymentGateway` ; tous les portefeuilles (commerçant compris) sont dérivés de la
   graine démo, pour que chaque dollar de test versé puisse être rapatrié. Sur une base jetable
   (`--throwaway-db` sans `--deploy-block`), le lecteur d'événements du moteur part de la tête de
   la chaîne au départ moins 50 blocs, et non du bloc de déploiement : une base neuve n'a besoin de
   rien d'antérieur à la répétition. Le bloc est affiché et écrit dans le reçu
   (`escrow.engineStartBlock`). Avec `--db-url`, rien ne change, et la répétition attend que le
   curseur du moteur ait rattrapé la tête avant la première vente (elle l'affiche) : pendant un
   rattrapage, toutes les requêtes du processus attendent derrière ses `eth_getLogs`, et les délais
   mesurés ne seraient pas honnêtes.
3. Le match : le plus proche qui commence dans 45 minutes ou plus, avec une cote vainqueur à deux
   issues. Le match et le contrat choisis sont affichés.
4. Le commerçant s'inscrit et crée la campagne ; l'admin pilote le carnet (sous le seuil de pause,
   avec de la profondeur pour toute la répétition). Avant toute vente, une sonde de pause : le
   carnet passe un tick au-dessus du seuil, la page de la campagne doit répondre `paused_price` et
   la route de vente démo refuser une vente (409 `sales_paused`, avant tout paiement ou
   transaction) ; le carnet revient sous le seuil et la répétition attend la réouverture (le délai
   de reprise du moteur, une dizaine de secondes). L'admin rejoue ensuite les ventes (trois à la
   fois par défaut, deux du même acheteur pouvant partir ensemble : le moteur crée une seule fois
   la ligne d'un nouvel acheteur, quel que soit le nombre de ses ventes simultanées), déplace le
   carnet pour remplir les ordres maker jusqu'à ce que chaque ticket soit facturé
   on-chain ; le commerçant clôt les ventes ; l'admin force le résultat ; la répétition attend le
   règlement, les remboursements (OUI), le paiement du commerçant et la libération, puis
   `POST /api/admin/demo/reset`, arrête le moteur et rapatrie chaque portefeuille démo vers la
   trésorerie (sur Arc, tout le solde natif moins le gaz du transfert, comme `sweepDemoWallets` ;
   sur une chaîne locale, le jeton de test, après un `anvil_setBalance` qui paie le gaz).
5. Les invariants (critères 3, 4 et 5) : chaque vente a son ticket ; aucune vente au-dessus du
   seuil de pause (le carnet piloté pendant les ventes est resté sous le seuil, aucun prix par vente
   n'étant stocké, et la sonde a vu le moteur suspendre les ventes au-dessus) ni au-delà du budget ;
   aucune facturation au-dessus de la garantie de son devis, aucune garantie au-dessus du plafond
   des marges ; la position non couverte sous `U_max` (au plus 5 s au-dessus, le Hedge desk lu
   chaque seconde) ; l'escrow ne détient plus rien pour la campagne ; chaque remboursement égal au
   remboursable du ticket ; l'argent juste au micro-USDC près entre trésorerie, acheteurs,
   commerçant et escrow, gaz à part ; chaque réponse portant `demo` pour cette campagne à `true` ;
   rien de la vente démo n'a atteint Stripe. Le douzième (critère 7) : la cote du ticket suit
   le carnet à moins de 2 s (section suivante).
6. Le reçu, JSON et Markdown, nommé par l'heure UTC de départ, la chaîne et l'issue : chaîne,
   escrow, adresses des rôles et des portefeuilles (acheteurs numérotés, aucune adresse e-mail),
   match et contrat, scénario, chaque transaction (hash, nature, bloc, gaz, frais, lien vers
   l'explorateur d'Arc), les délais (appel de vente → ticket, appel → vente visible sur le détail du
   commerçant, de `settle` au dernier remboursement en blocs, en secondes de chaîne et en temps
   réel), le décalage de la cote du ticket (section « Ticket odds »), les invariants, les soldes
   avant, après règlement et après rapatriement, le coût net,
   ce qui a été rapatrié, ce qui n'a pas pu être relu (« Could not be read »), et le nombre de
   requêtes de la répétition au nœud, refusées et relancées, étape par étape, avec les compteurs du
   limiteur (section « Node », aussi affichée en fin de répétition). Jamais une clé ni la graine :
   les deux fichiers sont vérifiés avant d'être écrits. Sur Arc testnet il va dans
   `docs/rehearsals/` ; le reçu d'une chaîne locale ne va jamais sous `docs/` (un dossier
   temporaire par défaut).

En cas d'échec d'une étape, ou de Ctrl-C, une fois la campagne en ligne, la répétition la récupère
d'abord, moteur encore en marche (étape `recover`, que Ctrl-C n'interrompt plus ; chaque attente
garde son délai) : elle couvre les tickets vendus et non encore facturés (le règlement exige une
réserve de couverture nulle), clôt les ventes si elles sont ouvertes, force NON (aucun
remboursement à envoyer ; le portefeuille démo du commerçant reçoit le reste, que le rapatriement
renvoie à la trésorerie), sauf si la répétition avait déjà forcé un résultat, et attend la
libération. Puis le moteur est arrêté, les portefeuilles sont rapatriés et le reçu est écrit avec
`FAILED`, l'étape, la raison, la récupération et tout ce qui a été mesuré ; ce qui reste dans
l'escrow (une campagne non libérée) y est écrit. Code de sortie : 0 si tout est passé (ou après
`--estimate`), 1 si une étape ou un invariant a échoué, 2 si elle a refusé de démarrer.

### La cote du ticket

Le critère : « le ticket vivant suit la cote avec moins de 2 secondes de décalage ». Il n'y a pas
encore de page de ticket dans `apps/web` ; ce qu'elle lit est fixé par les données : la réponse de
`GET /api/t/:token` porte `probabilityBps`, le `mid_bps` de la ligne `live_instruments` de
l'instrument (premier affichage), et `instrumentSymbol`, par lequel la page suit cette ligne en
Supabase Realtime (la migration initiale donne `select` à `anon` sur les tables `live_*`
sous une politique `using (true)`). La répétition mesure donc les deux : la ligne lue **comme le
rôle anonyme** (`set local role anon` dans une transaction, sûr derrière le pooler de Supabase, si
bien que le droit et la politique RLS s'appliquent ; si la connexion ne peut pas prendre ce rôle,
elle lit avec sa propre connexion et le reçu le dit), et la route.

- **Carnet piloté** (étape `odds-driven`, une fois chaque ticket facturé et avant la clôture) : le
  carnet est placé sur N prix distincts (`--odds-samples`, 10 par défaut), tous sous le seuil de
  pause (les ventes restent ouvertes), au-dessus de tout ordre maker d'achat encore actif (aucun ne
  doit être rempli par la mesure), aucun égal au précédent, pris bas, haut, bas, haut. Après chacun,
  les deux sources sont lues toutes les `--odds-poll-ms` (50 ms) jusqu'à montrer le nouveau mid ;
  un prix qui n'apparaît pas en `--odds-timeout` secondes (10) est un échantillon en échec, gardé,
  jamais écarté. Chaque prix part après une pause tirée entre 0 et la période de lecture des
  carnets démo du moteur (1 s), pour ne pas toujours tomber au même instant de son cycle. Le délai
  jugé part du **retour** de l'appel qui pose le carnet : le carnet n'existe à sa source qu'une fois
  la route admin l'a écrit, et c'est de là qu'un client qui regarde le marché le voit bouger ; le
  délai depuis l'**envoi** de l'appel (qui ajoute le temps de la route) est donné à côté. Le carnet
  calme est remis ensuite, et la campagne doit à nouveau répondre ouverte dessus.
- **Flux en direct** (étape `odds-live`, avec Gemini réel seulement, avant que le carnet soit
  piloté) : la ligne de l'instrument de la campagne est lue toutes les 50 ms pendant
  `--odds-window` secondes (60 ; 0 la saute), et chaque fois que son `observed_at` avance,
  « vu − `observed_at` » est un échantillon. C'est le seul instrument dont le flux est sûr : le
  moteur ne suit que les instruments des campagnes en ligne ou en pause et les lignes
  `tracked_instruments` du web. `observed_at` est l'heure de **réception** du message Gemini par le
  moteur (trame WebSocket ou réponse REST), pas l'horodatage de Gemini : ce délai exclut le réseau
  depuis Gemini. Sans mise à jour pendant la fenêtre, le reçu dit « no update observed » : ce n'est
  pas un succès.

Le reçu (section « Ticket odds » du Markdown, champ `odds` du JSON, optionnel : la version reste 2,
`--recover` et les anciens reçus marchent comme avant) donne, par chemin et par source, le nombre
d'échantillons, les échecs, min, médiane, p95 (rang le plus proche) et max en millisecondes ; la
période d'écriture des carnets du moteur (`writeThrottleMs`, 500 ms) et celle de lecture des
carnets démo (`demoRefreshMs`, 1 s), lues sur l'instance du moteur ; la période de lecture ; la
borne de l'erreur de mesure (un délai est surestimé d'au plus une période plus une lecture, jamais
sous-estimé) ; et ce qu'il n'inclut pas : la poussée de Supabase Realtime jusqu'au téléphone et le
rendu de la page, que seul un projet déployé peut mesurer (la route est appelée dans le processus,
sans HTTP). L'invariant passe quand, sur chaque chemin mesuré, aucun échantillon n'a échoué et le
p95 de chaque source est sous 2 000 ms ; un chemin non mesuré (Gemini simulé, fenêtre à 0, aucune
mise à jour) est dit tel et ne fait pas échouer la répétition ; quand rien n'a été mesuré,
l'invariant est « NOT MEASURED », jamais passé. Sur le carnet piloté, le délai tient surtout à la
lecture des carnets démo par le moteur (au plus 1 s) ; sur le flux en direct, à la période
d'écriture (au plus 500 ms).

### Un nœud qui limite la répétition

Le premier passage sur Arc a échoué sur une seule réponse « rate limit exceeded » du RPC public
(HTTP 429, code -32005) pendant l'attente de la couverture, puis la récupération et le
rapatriement ont échoué sur la même réponse : la campagne est restée dans l'escrow avec
6,54 USDC (reçu `docs/rehearsals/20261118T031821Z-5042002-yes.json`). Désormais :

- toutes les requêtes de la répétition passent par le client de `createArcClients`, donc par le
  limiteur du moteur : le moteur et la répétition partagent ses plafonds et ses pauses (dix
  requêtes par seconde, quatre `eth_getLogs`, une pause d'une seconde doublée à chaque refus de
  suite). Ses variables (`ARC_RPC_MAX_REQUESTS_PER_SECOND`,
  `ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND`, `ARC_RPC_HEAVY_METHODS`) passent de l'environnement de
  la commande au moteur, ses pauses vont dans le journal du moteur et ses compteurs dans le reçu ;
- une lecture qui échoue un instant n'est plus une étape en échec : une attente redemande jusqu'à
  son propre délai, puis dit ce qu'elle attendait et la dernière erreur vue ; les lectures hors
  attente (soldes, reçus de transactions, événements de la campagne) sont relancées avec un délai
  qui double, six fois en une demi-minute environ, et le reçu dit précisément ce qui n'a pas pu
  être lu au lieu de perdre le reste (un solde après règlement qui manque est dit non lu, jamais
  remplacé par le solde d'avant) ; le rapatriement relance chaque portefeuille de la même façon ;
- le rapatriement ne perd ni ne double un transfert dont la réponse s'est perdue : chaque
  transfert est signé sur place et noté par son hash, calculé sur les octets signés, **avant**
  `eth_sendRawTransaction`. Si la diffusion échoue, ou si le nœud l'a acceptée et que sa réponse
  s'est perdue (un délai dépassé, une connexion coupée), la répétition demande d'abord au nœud ce
  qu'il sait de ce hash : miné, en attente ou inconnu. Un transfert qu'il connaît est attendu,
  jamais signé à nouveau ; un transfert qu'il ne connaît pas lui est renvoyé tel quel (les mêmes
  octets, donc le même hash : « already known » ou « nonce too low » en réponse valent succès) ;
  seul un refus net du nœud, qui ne le connaît pas, fait signer un nouveau transfert. La ligne du
  portefeuille nomme alors ce hash et le montant réellement envoyé, sur Arc comme avec le jeton
  de test. Un portefeuille dont le rapatriement a échoué n'est dit laissé en plan que si son
  solde relu après le rapatriement n'est pas nul (ou n'a pas pu être relu). Est passager :
  une limite de débit (quel que soit le libellé du nœud), un délai dépassé, un 408, 425, 429 ou
  5xx, une connexion refusée ou coupée (le nœud comme Postgres). Le reste fait échouer l'étape
  tout de suite : un refus du produit (une route qui répond un autre 4xx), un revert, une plage de
  blocs refusée, un invariant, une interruption ;
- la répétition est sobre : moins de cinq requêtes par seconde à elle seule pendant les attentes
  (une lecture de la campagne par seconde ; le nombre de tickets facturés lu dans les journaux de
  l'escrow au plus une fois toutes les deux secondes et seulement s'il y a un nouveau bloc, par
  tranches de 1 000 blocs ; pendant le règlement, la tête lue toutes les 500 ms). Aucun
  `eth_getLogs` en boucle serrée : les événements de la campagne sont relus une fois à la fin.
  Le délai de `settle` au dernier remboursement garde ses blocs exacts, et son temps réel est
  l'écart entre les instants où la répétition a vu la tête atteindre chacun des deux blocs, à
  environ un bloc près.

Rien de ce qui est affiché ou écrit ne contient de secret : les clés, la graine, la clé de chaque
portefeuille démo et le jeton d'accès d'une URL RPC (le chemin et la requête d'une URL QuickNode ;
viem cite l'URL dans ses messages d'erreur, que le moteur journalise) sont remplacés par
`<redacted>` dans chaque ligne affichée, dans le journal du moteur et dans le reçu, et chaque
adresse e-mail par `<e-mail>`.

### Récupérer une campagne bloquée

Si la récupération échoue (le moteur ne répond plus, un délai expire), le reçu le dit sous « Left
behind » et `stranded` vaut `true` (aussi quand l'état de la campagne n'a pas pu être relu). Avec
`--throwaway-db`, la base jetable n'est alors **pas** supprimée : c'est la seule qui connaît la
campagne. La commande affiche son URL, le dossier de données du serveur Postgres, qui reste
démarré, et la commande qui finit la campagne :

```bash
cd apps/web
# Mêmes clés, même graine et même chaîne que la répétition (l'environnement, comme pour elle).
pnpm exec tsx e2e/rehearsal/run.ts --recover <reçu>.json --db-url <url affichée> --estimate
pnpm exec tsx e2e/rehearsal/run.ts --recover <reçu>.json --db-url <url affichée>
```

Elle refuse avant tout envoi ce que refuse une répétition (la chaîne, les rôles de l'escrow
contre les clés, le gaz avec 20 % de marge pour ce qui reste à envoyer), et vérifie que le reçu,
la base et la chaîne parlent de la même campagne : identifiant de chaîne, escrow, campagne connue
de la base avec le même identifiant on-chain, portefeuille du commerçant dérivé de la graine et de
l'identifiant de la répétition ; elle dit ce qui diffère. `--throwaway-db` est refusé avec
`--recover`. Elle affiche ensuite où en est la campagne on-chain (en vente, ventes closes,
réglée, libérée ; tickets vendus, facturés, remboursés ; ce que l'escrow détient pour elle) ;
`--estimate` s'arrête là. Puis elle démarre le moteur sur cette base avec le câblage de
production et finit la campagne par la surface publique, exactement comme l'étape `recover` :
carnet piloté à nouveau comme pendant la répétition, couverture des tickets non facturés, clôture
des ventes si elles sont ouvertes, NON forcé sauf si un résultat est déjà forcé ou connu (sur
OUI, les remboursements sont payés aux acheteurs puis rapatriés), attente du règlement, des
remboursements, du paiement du commerçant et de la libération ; puis `POST /api/admin/demo/reset`,
arrêt du moteur et rapatriement de chaque portefeuille de la répétition (le commerçant et chaque
acheteur du reçu).

Elle écrit un **nouveau** reçu à côté du premier (même nom suivi de `-recovery`, JSON et Markdown ;
`-recovery-2` au passage suivant), qui nomme le reçu qu'il récupère, chaque transaction causée avec
son hash, l'état de la campagne avant et après, les soldes avant et après, ce qui a été rapatrié et
ce qui reste ; le reçu d'origine n'est jamais réécrit. Il dit aussi avec quel résultat la campagne a
été réglée (lu dans son événement `CampaignSettled`) et d'où il vient : déjà réglée on-chain, déjà
forcé dans la base, connu dans la base, ou forcé par cette récupération (champ `result`, optionnel :
le reçu reste en version 2). Quand ce résultat n'est pas celui que demandait le scénario du reçu
d'origine, une phrase le dit. Quand la récupération a forcé NON elle-même (rien n'était forcé ni
connu dans la base à son départ), la phrase dit ce que montre le reçu d'origine, et rien de plus :
une répétition qui n'a jamais forcé de résultat (son reçu ne note ni étape `settle` ni récupération
à elle allée jusqu'à décider le résultat, par exemple après un échec à `drive-book` avec le scénario
OUI) est dite telle ; une étape `settle` notée réussie montre que la répétition avait forcé son
résultat, et sa propre remise à zéro, qui efface tout résultat forcé, est nommée comme cause
possible ; une étape qui force un résultat notée sans que le reçu puisse montrer si le résultat a
été forcé (`settle` en échec, ou sa récupération une fois le résultat décidé), ou un reçu qui ne
liste pas ses étapes, est dit tel quel, la remise à zéro n'étant alors nommée que sous condition.
Pour l'argent, cela ne change rien (tout revient par le portefeuille du commerçant et le
rapatriement), mais le reçu ne le tait pas. Code de sortie : 0 seulement si la campagne est libérée
et que rien ne reste (ou après `--estimate`), 1 sinon, 2 si elle a refusé (par exemple quand le gaz
de l'oracle ou du relayer, ou la trésorerie, ne couvre pas avec 20 % de marge ce qui reste à envoyer : la phrase nomme le manque, et rien n'est envoyé). On peut la relancer sans risque : sur une
campagne déjà libérée, elle ne fait que rapatrier ce qui reste et le dit ; interrompue (Ctrl-C
arrête le moteur, rapatrie et écrit son reçu), elle reprend où en est la chaîne, sans rien renvoyer,
et chacun des deux reçus ne liste que les transactions de son propre passage. Un reçu dont `driven`
vaut `null` (la répétition a échoué avant de piloter le carnet, donc avant toute vente) est récupéré
sans piloter le carnet ni attendre de couverture : clôture, NON forcé, règlement, libération et
rapatriement. Une fois sortie avec 0 : arrêter le serveur Postgres (`pg_ctl -D <dossier affiché>
stop`) et supprimer son dossier.

En dernier recours, sans moteur, le contrat ouvre sa voie d'urgence 7 jours après la clôture des
ventes : n'importe qui peut alors appeler `emergencyClaim` pour chaque ticket et
`emergencyReleaseBudget` pour le budget.

### Ce que ça coûte

Rien ne se perd sauf le gaz : la trésorerie avance le budget, chaque vente et, sur OUI, ce qui est
dû au commerçant (13,20 USDC pour le scénario par défaut : 12 ventes de 0,50 USDC, remboursement 100 %, budget 1,20), et tout revient par les facturations de couverture et le rapatriement. Le gaz se
paie en USDC sur Arc : au pire 9,2 millions de gaz pour le scénario par défaut, soit 0,18 USDC au
plancher de 20 gwei ; une répétition locale de 6 ventes en a consommé 2,1 millions, rapatriement
compris. Le chiffre exact, au prix du moment, est celui de `--estimate`.

Le prix unitaire ne descend pas sous 0,50 USDC : la route de création n'accepte qu'un montant
payable par carte (au moins 0,50 $ en centimes entiers). La mesure du critère 6 à 300 tickets
demande donc au moins 150 USDC avancés (plus 150 de dû sur OUI à 100 %) : hors de portée des
quelque 90 USDC de la trésorerie actuelle, la répétition refuse de la lancer.

Les contrats qui couvraient une campagne réglée, sur un résultat forcé comme sur un vrai, ne sont
plus comptés comme détenus : une nouvelle campagne sur le même contrat est couverte et facturée
normalement. Une seconde répétition sur la même base rejoue donc la démo sur le même match et le
même contrat, comme un opérateur devant un jury.

### Sur une chaîne locale

```bash
cd apps/web
# Terminal 1 : anvil (chaîne 31337), l'escrow et son jeton de test ; affiche les variables.
pnpm exec tsx e2e/rehearsal/local-chain.ts

# Terminal 2 : coller les quatre `export` affichés, puis les clés publiques de développement
# d'anvil (relayer et trésorerie = compte 1, oracle = compte 2) et une graine démo jetable.
MNEMONIC="test test test test test test test test test test test junk"
CAST=../../packages/contracts/node_modules/.bin/cast
export ARC_RELAYER_PRIVATE_KEY=$($CAST wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 1)
export ARC_ORACLE_PRIVATE_KEY=$($CAST wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 2)
export APP_DEMO_WALLET_SEED=0x$(openssl rand -hex 32)
pnpm exec tsx e2e/rehearsal/run.ts --gemini simulated --throwaway-db --purchases 6 --buyers 3
```

`--throwaway-db` démarre un Postgres jetable avec toutes les migrations (l'outil des tests du
moteur) ; sinon `--db-url` ou `DB_URL`. Les tests de la répétition font la même chose sous Vitest
(`e2e/rehearsal/rehearsal.test.ts` : OUI sur un nœud qui refuse au hasard une part des lectures de
la répétition et toutes pendant une seconde sur neuf, base neuve lue près de la tête, avec le débit
de la répétition mesuré pendant la couverture et le règlement ; NON sur la même base et le même
escrow, depuis le bloc de déploiement ; chaque refus ; une étape en échec, une vente en échec,
Ctrl-C avant les ventes et pendant la couverture, chacun suivi de sa récupération ; 60 ventes pour
le temps des remboursements ; le rapatriement en USDC natif sur un nœud qui refuse ; et quatre
campagnes laissées en plan comme sur Arc puis finies par `--recover` : une lecture qui ne revient
jamais pendant la clôture puis un OUI déjà forcé, avec d'abord un refus pour une trésorerie qui ne
couvre pas le dû du commerçant ; des tickets non facturés avec les refus, la commande `run.ts
--recover` elle-même qui sort avec 2 quand le gaz de l'oracle et du relayer manque, et `--estimate`,
puis un NON forcé que le reçu dit différent du OUI demandé ; tous les tickets facturés ventes
ouvertes, avec une récupération interrompue par le signal d'arrêt après la clôture puis relancée ;
et une répétition arrêtée avant de piloter le carnet (`driven` à `null`). Chacune est relancée une
fois de plus, sauf la dernière. La cote du ticket : le OUI mesure les 10 prix par défaut sur le
carnet piloté (le 18 novembre : médiane 602 ms, p95 1 003 ms sur la ligne lue comme `anon` comme sur
la route, le chemin en direct dit non mesuré), les autres répétitions 3 prix ; une répétition dont
toutes les lignes `live_instruments` sont verrouillées 3 s au début de la mesure, l'écriture du
moteur attendant derrière, a un premier prix jamais lisible en 1,5 s : échantillon en échec, le
douzième invariant échoue, et lui seul, la répétition va au bout. Ces ajouts coûtent environ
75 s : 31 s d'étape `odds-driven` dans les répétitions existantes et 43 s pour celle au verrou.
Environ 11 minutes en tout, dont 7 avant `--recover`, le limiteur du moteur compris).
`e2e/rehearsal/odds.unit.test.ts` vérifie sans base ni chaîne les statistiques (p95 au rang le plus
proche), les prix pilotés, les deux boucles de mesure contre de fausses sources (un échantillon
jamais visible est gardé en échec, une lecture en erreur est relue, aucune mise à jour en direct
n'est pas un succès), chaque verdict du douzième invariant, la section du reçu et les options. `e2e/rehearsal/sweep.unit.test.ts` rapatrie un portefeuille à travers un nœud qui accepte
le transfert et perd sa réponse, en minage immédiat et avec un bloc par seconde, en USDC natif et
avec le jeton de test : un seul transfert atteint le nœud, la ligne dit `swept` avec son hash et son
montant, le portefeuille finit à zéro. Il y ajoute trois chemins : la recherche qui suit la réponse
perdue refusée (un 429 sur `eth_getTransactionReceipt`, une connexion coupée sur
`eth_getTransactionByHash`), rien n'étant miné tant que la relance n'a pas trouvé le transfert en
attente, qui est attendu et jamais signé à nouveau ; une diffusion qui n'a jamais atteint le nœud,
les frais ayant changé entre les tentatives (le frais de base divisé par deux par anvil) : les
octets qui finissent par arriver sont ceux de la première signature, une seconde signature porterait
d'autres frais ; et un transfert du jeton miné qui revert (le jeton bloque la destination, comme la
liste noire d'USDC) : la ligne dit `failed` avec son hash, l'erreur est `SweepRevertedError`,
définitive, donc aucun second transfert, et le portefeuille est dit laissé en plan avec ce qu'il
détient encore :

```bash
pnpm --filter @winz/web exec vitest run e2e/rehearsal
```

`REHEARSAL_TEST_DIR=/un/dossier` y garde les reçus des tests au lieu de les effacer.

### Sur Arc testnet

**Attention : cette commande dépense de vrais fonds du testnet** (le gaz de chaque transaction, en
USDC, sur la trésorerie et l'oracle) et avance plus de 13 USDC de la trésorerie le temps de la
répétition. Lancer d'abord `--estimate`, qui n'envoie rien.

```bash
cd apps/web
export ARC_RELAYER_PRIVATE_KEY=…   # la clé du relayer (et de la trésorerie) de l'escrow déployé
export ARC_ORACLE_PRIVATE_KEY=…    # la clé de l'oracle
export APP_DEMO_WALLET_SEED=…      # 0x suivi de 64 chiffres hexadécimaux
export ARC_RPC_URL=…               # QuickNode ; ARC_RPC_FALLBACK_URL vaut https://rpc.testnet.arc.io
# Seulement si les connexions sortantes passent par un proxy (le WebSocket de Gemini) :
# export APP_HTTPS_PROXY_URL=… APP_PROXY_CA_FILE=…
pnpm exec tsx e2e/rehearsal/run.ts --throwaway-db --estimate
pnpm exec tsx e2e/rehearsal/run.ts --throwaway-db --outcome yes
pnpm exec tsx e2e/rehearsal/run.ts --throwaway-db --outcome no
```

L'escrow et son bloc de déploiement sont lus dans `packages/contracts/deployments/5042002.json`
(`--escrow` et `--deploy-block`, ou `ARC_ESCROW_ADDRESS` et `ARC_ESCROW_DEPLOY_BLOCK`, pour un
autre). Les clés et la graine ne se passent que par l'environnement, jamais par une option.
Options du scénario : `--purchases` (12, jusqu'à 300), `--units` (1), `--unit-price` (0.50),
`--refund-pct` (100), `--usual-margin-pct` (65), `--min-margin-pct` (45), `--budget` (de quoi
couvrir chaque garantie), `--outcome` (`yes` ou `no`), `--buyers` (6), `--parallel` (3). Options
de la mesure de la cote du ticket : `--odds-samples` (10 prix du carnet piloté, de 1 à 100),
`--odds-timeout` (10 s par prix), `--odds-window` (60 s de flux en direct ; 0 la saute) et
`--odds-poll-ms` (50 ms) ; refusées avec `--recover`, qui ne mesure rien. Le journal
du moteur va dans un fichier temporaire (`--engine-log` pour en choisir un), le reçu dans
`docs/rehearsals/` (`--receipt-dir`).
