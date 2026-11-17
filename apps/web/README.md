# @winz/web

L'application Next.js de Winz : les écrans (commerçant, page de campagne, ticket) et les routes
HTTP de `/api`.

## Construire les écrans sans le back : l'API simulée

Toutes les routes de la section 10 de `SPEC.md` existent déjà. En mode simulé, chacune renvoie une
réponse d'exemple figée, au format exact que renverra le vrai back. Aucun service n'a besoin de
tourner et aucun secret n'est nécessaire : ni base de données, ni Stripe, ni Privy.

```bash
APP_API_MOCK=true pnpm --filter @winz/web dev
```

L'application est sur `http://localhost:3000`. Pour vérifier que l'API répond :

```bash
curl http://localhost:3000/api/c/joes-texas
```

Sans `APP_API_MOCK=true`, une route qui n'est pas encore branchée répond `501` avec
`{ "error": { "code": "internal", "message": "Not implemented yet" } }`. La liste des routes déjà
réelles est plus bas, dans « Le vrai back ».

### Choisir un scénario

Chaque route a un scénario `default`, servi quand on ne demande rien. Pour en obtenir un autre,
ajouter l'en-tête `x-mock-scenario` à la requête :

```bash
curl -H "x-mock-scenario: settledYes" http://localhost:3000/api/c/joes-texas
```

```ts
import { MOCK_SCENARIO_HEADER } from "@winz/shared";

const response = await fetch("/api/c/joes-texas", {
  headers: { [MOCK_SCENARIO_HEADER]: "settledYes" },
});
```

Un nom de scénario inconnu répond `400 invalid_request`, et le message donne la liste des noms
valides pour cette route.

Les paramètres du chemin (`:id`, `:slug`, `:pi`, `:token`) sont ignorés en mode simulé :
`/api/c/nimporte-quoi` renvoie le même exemple que `/api/c/joes-texas`. Seul l'en-tête change la
réponse.

### Scénarios par route

| Route                            | Scénarios                                                                  |
| -------------------------------- | -------------------------------------------------------------------------- |
| `GET /api/me`                    | `default`, `merchant`, `newUser`, `fan`                                    |
| `POST /api/merchants`            | `default`                                                                  |
| `GET /api/events`                | `default`                                                                  |
| `POST /api/campaigns/preview`    | `default`, `open`, `aboveThreshold`, `noBook`                              |
| `POST /api/campaigns`            | `default`                                                                  |
| `GET /api/campaigns`             | `default`                                                                  |
| `GET /api/campaigns/:id`         | `default`, `live`, `paused`, `settledYes`, `settledNo`                     |
| `POST /api/campaigns/:id/pause`  | `default`                                                                  |
| `POST /api/campaigns/:id/resume` | `default`                                                                  |
| `POST /api/campaigns/:id/close`  | `default`                                                                  |
| `GET /api/c/:slug`               | `default`, `live`, `paused`, `salesClosed`, `settledYes`, `settledNo`      |
| `POST /api/checkout`             | `default`, `salesPaused`, `salesClosed`                                    |
| `POST /api/checkout/:pi/confirm` | `default`, `processing`, `ticketed`, `cancelledPaused`, `failed`           |
| `GET /api/checkout/:pi`          | `default`, `processing`, `ticketed`, `cancelledPaused`, `failed`           |
| `GET /api/t/:token`              | `default`, `preGame`, `inGame`, `refunded`, `notThisTime`, `cancelled`     |
| `GET /api/tickets`               | `default`                                                                  |
| `GET /api/hedge-desk`            | `default`                                                                  |
| `POST /api/admin/demo/book`      | `default`                                                                  |
| `POST /api/admin/demo/result`    | `default`                                                                  |
| `POST /api/admin/demo/sale`      | `default`, `processing`                                                    |
| `POST /api/admin/demo/reset`     | `default`                                                                  |
| `POST /api/webhooks/stripe`      | `default`                                                                  |
| `POST /api/webhooks/quicknode`   | `default`                                                                  |

Quel exemple sert `default` :

- `GET /api/me` : `merchant`
- `POST /api/campaigns/preview` : `open`
- `GET /api/campaigns/:id` et `GET /api/c/:slug` : `live`
- `POST /api/checkout/:pi/confirm` : `processing`
- `GET /api/checkout/:pi` : `ticketed`
- `GET /api/t/:token` : `preGame`

Le contenu des exemples est dans `packages/shared/src/api/examples.ts`, et le type de chaque
réponse dans `packages/shared/src/api/schemas.ts`.

### Les refus de vente

Deux scénarios de `POST /api/checkout` ne renvoient pas un exemple mais un refus, pour construire
les écrans « promo en pause » et « ventes closes » :

| Scénario      | Réponse                                 |
| ------------- | --------------------------------------- |
| `salesPaused` | `409`, `error.code` vaut `sales_paused` |
| `salesClosed` | `409`, `error.code` vaut `sales_closed` |

Toute réponse d'erreur a la même forme, en mode simulé comme en vrai :

```json
{ "error": { "code": "sales_paused", "message": "This promo is paused right now, you were not charged" } }
```

`message` est en anglais et peut être montré tel quel au client. La liste des codes est
`API_ERROR_CODES` dans `@winz/shared`.

### Les requêtes sont quand même vérifiées

Même en mode simulé, le corps JSON des `POST` et les paramètres de la query string sont validés
contre le schéma de la route. Une requête mal formée répond `400 invalid_request` et le message
nomme le premier champ fautif, par exemple `Invalid body.qty: ...`. Un écran qui marche sur l'API
simulée envoie donc déjà des requêtes que le vrai back acceptera.

```bash
curl -X POST http://localhost:3000/api/checkout \
  -H "content-type: application/json" \
  -d '{"slug":"joes-texas","qty":1}'
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

### Routes réelles

| Route                                                  | Ce qu'elle fait                                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `GET /api/me`, `POST /api/merchants`                   | Profil, rôles, création du commerce                                                                 |
| `GET /api/events`                                      | Catalogue et modèles calculés                                                                       |
| `POST /api/campaigns/preview`                          | Chiffres de l'écran M6                                                                              |
| `POST /api/campaigns`                                  | Crée la campagne (`funding`) et le paiement du budget (écran M7)                                    |
| `GET /api/campaigns`, `GET /api/campaigns/:id`         | Liste et détail du commerçant connecté                                                              |
| `POST /api/campaigns/:id/pause`, `/resume`, `/close`   | Pause, reprise et clôture manuelles                                                                 |
| `GET /api/c/:slug`                                     | Page publique de la campagne                                                                        |
| `POST /api/checkout`                                   | Vérifie que la promo vend, crée l'autorisation de la carte                                          |
| `POST /api/checkout/:pi/confirm`, `GET /api/checkout/:pi` | Déclenche l'achat, puis suit son état                                                            |
| `GET /api/t/:token`, `GET /api/tickets`                | Ticket par lien secret, tickets du fan connecté                                                     |
| `POST /api/webhooks/stripe`                            | Webhook Stripe, signature vérifiée sur le corps brut                                                |
| `GET /api/hedge-desk`                                  | Hedge desk public : instruments couverts, lieu d'exécution, paramètres, totaux, contrôle sandbox    |
| `POST /api/admin/demo/book`, `/result`, `/sale`, `/reset` | Mode démo, derrière la clé admin                                                                 |

Répond encore `501` : `POST /api/webhooks/quicknode`.

### Créer une campagne (M7)

`POST /api/campaigns` prend les réglages de l'aperçu plus `product`. Le prix unitaire et le budget
sont payés par carte : chacun doit être un nombre entier de cents, entre 0,50 $ et 999 999,99 $.
Sinon la route répond `400 invalid_request` et le message nomme le champ, par exemple
`Invalid body.unitPrice: must be a whole number of cents`. Un match dont les ventes sont déjà
closes répond `409 sales_closed`, une condition indisponible `404`.

La réponse donne `budgetPayment.clientSecret` : le front le passe au Payment Element de Stripe pour
payer le budget. La campagne reste `funding` jusqu'à ce que le moteur l'ait créée on-chain, puis
passe `live` avec son `slug` : relire `GET /api/campaigns/:id` jusqu'à voir `live`.

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

### Le parcours d'achat, côté front

1. `POST /api/checkout` avec `{ slug, qty }`. Si la promo ne vend pas, `409` avec `sales_paused`
   ou `sales_closed` et un message à montrer tel quel : rien n'a été créé, rien n'est débité.
2. Monter l'Express Checkout Element (ou le Payment Element) de Stripe avec le `clientSecret`
   reçu, avec `emailRequired: true` : l'e-mail du payeur sert à retrouver son compte. Le client
   confirme dans la feuille de paiement (`stripe.confirmPayment`, `redirect: "if_required"`). La
   carte est seulement autorisée, pas débitée.
3. Dès que la confirmation Stripe a réussi, appeler `POST /api/checkout/:pi/confirm` (corps vide).
   Le webhook Stripe déclenche le même traitement : appeler les deux ne crée qu'un achat.
4. Interroger `GET /api/checkout/:pi` toutes les secondes environ, jusqu'à `ticketed` ou un échec :
   - `requires_payment` ou `processing` : continuer d'attendre ;
   - `ticketed` : ouvrir `/t/<ticketToken>` ;
   - `cancelled_paused` ou `failed` : afficher `message` tel quel (« Promo just paused, you were
     not charged », etc.). La carte n'est pas débitée.

   Si le client réessaie dans la même feuille de paiement après une carte refusée et que la
   nouvelle tentative est autorisée, rappeler `POST /api/checkout/:pi/confirm` : le paiement
   repasse en `processing`. Un événement d'échec Stripe arrivé en retard ne fait jamais passer en
   `failed` un paiement autorisé depuis : le serveur relit l'état chez Stripe, et dès que l'achat
   est transmis au moteur, seul le moteur décide de l'issue.
5. Un `pi` inconnu répond `404`. Ces réponses ne contiennent jamais l'e-mail, l'adresse de
   l'acheteur ni aucun terme on-chain.

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
- `venueCheck` : le dernier contrôle des ordres réels sur le sandbox Gemini, ou `null` s'il n'a
  jamais tourné ;
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

### Le bandeau « DEMO MODE »

Afficher le bandeau « DEMO MODE » sur tout écran dont une réponse porte un champ `demo` à `true` :
`GET /api/c/:slug`, `GET /api/t/:token` et chaque ticket de `GET /api/tickets`,
`GET /api/campaigns/:id`, `GET /api/hedge-desk`, et les réponses des routes démo elles-mêmes. Une
campagne touchée par une action démo (carnet piloté ou résultat forcé sur son instrument, vente
rejouée) le reste pour toujours, même après `reset`.
