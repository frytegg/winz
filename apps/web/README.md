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

## Répétition sur une vraie chaîne (`e2e/rehearsal/`, porte G2, Q-03, Q-04)

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
   graine démo, pour que chaque dollar de test versé puisse être rapatrié.
3. Le match : le plus proche qui commence dans 45 minutes ou plus, avec une cote vainqueur à deux
   issues, sur un contrat dont la couverture ne détient rien. Le match et le contrat choisis sont
   affichés.
4. Le commerçant s'inscrit et crée la campagne ; l'admin pilote le carnet (sous le seuil de pause,
   avec de la profondeur pour toute la répétition). Avant toute vente, une sonde de pause : le
   carnet passe un tick au-dessus du seuil, la page de la campagne doit répondre `paused_price` et
   la route de vente démo refuser une vente (409 `sales_paused`, avant tout paiement ou
   transaction) ; le carnet revient sous le seuil et la répétition attend la réouverture (le délai
   de reprise du moteur, une dizaine de secondes). L'admin rejoue ensuite les ventes (trois à la fois par défaut,
   jamais deux du même acheteur en même temps : voir plus bas),
   déplace le carnet pour remplir les ordres maker jusqu'à ce que chaque ticket soit facturé
   on-chain ; le commerçant clôt les ventes ; l'admin force le résultat ; la répétition attend le
   règlement, les remboursements (OUI), le paiement du commerçant et la libération, puis
   `POST /api/admin/demo/reset`, arrête le moteur et rapatrie chaque portefeuille démo vers la
   trésorerie (`sweepDemoWallets` sur Arc ; sur une chaîne locale, le jeton de test est renvoyé
   après un `anvil_setBalance` qui paie le gaz du transfert).
5. Les invariants (Q-04, critères 3, 4 et 5) : chaque vente a son ticket ; aucune vente au-dessus du
   seuil de pause (le carnet piloté pendant les ventes est resté sous le seuil, aucun prix par vente
   n'étant stocké, et la sonde a vu le moteur suspendre les ventes au-dessus) ni au-delà du budget ; aucune facturation au-dessus de la garantie de son devis,
   aucune garantie au-dessus du plafond des marges ; la position non couverte sous `U_max` (au plus
   5 s au-dessus, le Hedge desk lu chaque seconde) ; l'escrow ne détient plus rien pour la
   campagne ; chaque remboursement égal au remboursable du ticket ; l'argent juste au micro-USDC
   près entre trésorerie, acheteurs, commerçant et escrow, gaz à part ; chaque réponse portant
   `demo` pour cette campagne à `true` ; rien de la vente démo n'a atteint Stripe.
6. Le reçu, JSON et Markdown, nommé par l'heure UTC de départ, la chaîne et l'issue : chaîne,
   escrow, adresses des rôles et des portefeuilles (acheteurs numérotés, aucune adresse e-mail),
   match et contrat, scénario, chaque transaction (hash, nature, bloc, gaz, frais, lien vers
   l'explorateur d'Arc), les délais (appel de vente → ticket, appel → vente visible sur le détail du
   commerçant, de `settle` au dernier remboursement en blocs, en secondes de chaîne et en temps
   réel), les invariants, les soldes avant, après règlement et après rapatriement, le coût net et
   ce qui a été rapatrié. Jamais une clé ni la graine : les deux fichiers sont vérifiés avant
   d'être écrits. Sur Arc testnet il va dans `docs/rehearsals/` ; le reçu d'une chaîne locale ne va
   jamais sous `docs/` (un dossier temporaire par défaut).

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

Rien de ce qui est affiché ou écrit ne contient de secret : les clés, la graine, la clé de chaque
portefeuille démo et le jeton d'accès d'une URL RPC (le chemin et la requête d'une URL QuickNode ;
viem cite l'URL dans ses messages d'erreur, que le moteur journalise) sont remplacés par
`<redacted>` dans chaque ligne affichée, dans le journal du moteur et dans le reçu, et chaque
adresse e-mail par `<e-mail>`.

### Récupérer une campagne bloquée

Si la récupération échoue (le moteur ne répond plus, un délai expire), le reçu le dit sous « Left
behind » et `stranded` vaut `true`. Avec `--throwaway-db`, la base jetable n'est alors **pas**
supprimée : c'est la seule qui connaît la campagne. La commande affiche son URL et le dossier de
données du serveur Postgres, qui reste démarré. Pour finir la campagne :

1. relancer le moteur sur cette base, avec le même environnement Arc
   (`DB_URL=<url affichée> pnpm --filter @winz/engine start`) : il reprend ses tâches en attente
   (clôture, couverture, règlement, paiements) ;
2. si les ventes sont encore ouvertes, ou si aucun résultat n'a été forcé, appeler les routes du
   commerçant (`POST /api/campaigns/:id/close`) et de l'admin (`POST /api/admin/demo/result`) d'une
   instance du web branchée sur la même base, puis attendre la libération ;
3. rapatrier les portefeuilles démo (le commerçant et les acheteurs du reçu) avec
   `sweepDemoWallets` ;
4. arrêter le serveur Postgres (`pg_ctl -D <dossier affiché> stop`) et supprimer son dossier.

En dernier recours, sans moteur, le contrat ouvre sa voie d'urgence 7 jours après la clôture des
ventes : n'importe qui peut alors appeler `emergencyClaim` pour chaque ticket et
`emergencyReleaseBudget` pour le budget.

### Ce que ça coûte

Rien ne se perd sauf le gaz : la trésorerie avance le budget, chaque vente et, sur OUI, ce qui est
dû au commerçant (13,20 USDC pour le scénario par défaut : 12 ventes de 0,50 USDC, remboursement
100 %, budget 1,20), et tout revient par les facturations de couverture et le rapatriement. Le gaz
se paie en USDC sur Arc : au pire 9,2 millions de gaz pour le scénario par défaut, soit 0,18 USDC
au plancher de 20 gwei ; une répétition locale de 6 ventes en a consommé 2,1 millions, rapatriement compris. Le chiffre
exact, au prix du moment, est celui de `--estimate`.

Le prix unitaire ne descend pas sous 0,50 USDC : la route de création n'accepte qu'un montant
payable par carte (au moins 0,50 $ en centimes entiers). La mesure du critère 6 à 300 tickets
demande donc au moins 150 USDC avancés (plus 150 de dû sur OUI à 100 %) : hors de portée des
quelque 90 USDC de la trésorerie actuelle, la répétition refuse de la lancer.

Une campagne réglée sur un résultat forcé laisse ses contrats détenus sur l'instrument, et le
moteur les compte contre l'exposition d'une nouvelle campagne sur le même instrument, qu'il ne
couvre ni ne facture jamais. La répétition choisit donc un contrat sur lequel la couverture ne
détient rien : deux répétitions sur le même match prennent ses deux issues, une troisième attend un
autre match.

Deux ventes d'un même nouvel acheteur traitées en même temps par le moteur peuvent échouer
(`IdentityConflictError` à la création de sa ligne `users`, la vente finit « failed ») : la
répétition ne rejoue donc jamais deux ventes du même acheteur à la fois.

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
(`e2e/rehearsal/rehearsal.test.ts` : OUI, NON sur la même base et le même escrow, chaque refus,
une étape en échec, une vente en échec, Ctrl-C avant les ventes et pendant la couverture, chacun
suivi de sa récupération, et 60 ventes pour le temps des remboursements ; environ 4 minutes) :

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
couvrir chaque garantie), `--outcome` (`yes` ou `no`), `--buyers` (6), `--parallel` (3). Le journal
du moteur va dans un fichier temporaire (`--engine-log` pour en choisir un), le reçu dans
`docs/rehearsals/` (`--receipt-dir`).
