# Gemini sandbox : la preuve d'ordres réels (HE-10)

> **Exécutée sur le vrai sandbox le 2026-11-20 à 04:15:08 UTC, résultat `proven`** : sur
> `GEMI-ETH2611200500-HI1720`, l'ordre maker `145853902324436356` placé puis annulé, l'ordre taker
> `145853902324436442` rempli. Reçu : [`receipts/prod/settlements-2026-11-19.md`](receipts/prod/settlements-2026-11-19.md),
> section « Gemini sandbox : ordres réels ».
>
> L'adaptateur a d'abord été écrit et vérifié contre un serveur simulé, sans clé. Ce qui avait été
> lu en direct le 20 novembre 2026, sans clé : la liste publique des événements du sandbox (81
> événements crypto actifs ce soir-là, des carnets à deux côtés sur les contrats horaires), un
> carnet (`GET /v1/book/GEMI-XRP2611200100-HI0D88`), et deux refus de la partie privée : sans
> en-têtes, `401 {"result":"error","reason":"MissingSecurityHeaders"}` ; avec une clé inventée,
> `400 {"result":"error","reason":"InvalidApiKey"}`. Le reste vient de la documentation officielle
> (liste en fin de page) et de la spécification OpenAPI des Prediction Markets, lue en entier.

Ce que la preuve montre (HE-10), sur un contrat crypto du sandbox, chaque étape relue chez
Gemini et jamais déduite de la seule réponse au placement :

1. **un ordre maker** (`makerOrCancel: true`, `good-til-cancel`) d'achat de 1 contrat YES, deux
   ticks sous le meilleur bid pour qu'il repose ; relu dans les ordres actifs avec le statut
   `open`, puis une seconde fois 3 s plus tard ;
2. **son annulation** (`POST /v1/prediction-markets/order/cancel`), relue dans l'historique avec le
   statut `cancelled` ;
3. **un ordre exécuté** : un achat de 1 contrat au meilleur ask, `immediate-or-cancel`, relu dans
   l'historique avec une quantité exécutée supérieure à zéro.

Coût : moins de 1 $ de fonds de test par exécution (le contrat acheté vaut au plus 0,99 $).

## Le marché choisi, et pourquoi

Le sandbox ne liste **aucun marché sportif** (relevé : 106 événements le 17 novembre,
88 crypto et 18 matières premières ; 81 crypto actifs le 20 novembre). La preuve se fait donc sur
un **contrat Prediction Markets crypto** (par exemple `GEMI-BTC2611202200-HI91000`, « BTC au-dessus
de 91 000 $ à 17 h »), et non sur le marché spot `btcusd` : un contrat YES se traite exactement
comme les contrats sportifs de la couverture (prix en dollars de 0,01 à 0,99, quantités en
contrats au pas de 0,01, mêmes routes `/v1/prediction-markets/*`). La preuve passe ainsi par
l'adaptateur que le moteur utilise (`GeminiOrderVenue`, derrière `ExecutionVenue`), pas par un
chemin à part.

Les contrats crypto du sandbox sont horaires ou quotidiens : un symbole écrit en dur serait
périmé le lendemain. La commande choisit le contrat au moment où elle tourne : actif, marché
ouvert, pas un combo, échéance à plus de 20 minutes, un bid et un ask qui laissent la place d'un
achat qui repose ; les plus proches de 50 % d'abord (les plus vivants), puis l'échéance la plus
lointaine ; elle lit au plus 6 carnets, un par seconde, et prend le premier à deux côtés. Pour
imposer un contrat : `--symbol <instrumentSymbol>` ou `GEMINI_SANDBOX_CHECK_SYMBOL`.

## 1. Le compte sandbox (A, 10 min)

1. S'inscrire sur [exchange.sandbox.gemini.com](https://exchange.sandbox.gemini.com). Le sandbox
   crédite le nouveau compte de soldes de test (100 000 $ USD, entre autres) et n'envoie **aucun
   e-mail**.
2. La double authentification est active par défaut. D'après la documentation du sandbox, sur
   l'écran du code : poser le cookie `GEMINI-SANDBOX-2FA=true` (console du navigateur :
   `document.cookie = "GEMINI-SANDBOX-2FA=true; path=/";`) puis saisir le code `9999999`.
3. Ouvrir Prediction Markets une fois dans l'interface et **accepter les conditions** si elles
   sont proposées. Sinon, la vérification peut les accepter elle-même avec
   `APP_VENUE_CHECK_ACCEPT_TERMS=true` (étape 4) ; sans l'un ou l'autre elle s'arrête à l'étape
   `preflight` en le disant.

Si le compte est refusé : voir **Repli** en fin de page.

## 2. La clé API (A, 5 min)

Dans le sandbox, **Settings → API** ([exchange.sandbox.gemini.com/settings/api](https://exchange.sandbox.gemini.com/settings/api)),
créer une clé :

| Réglage | Valeur | Pourquoi |
| --- | --- | --- |
| Portée (scope) | **Primary** : une clé du compte (préfixe `account-`), pas une clé maître (`master-`) | une clé maître devrait nommer le compte dans chaque requête |
| Rôle | **Trader** (le rôle par défaut) | placer, annuler, lire les ordres actifs et l'historique |
| Requires Heartbeat | **non coché** | coché, Gemini annule tous les ordres de la clé après 30 s sans requête |
| Nonce basé sur l'heure (time-based) | **non coché** de préférence | le moteur envoie alors des millisecondes croissantes (`GEMINI_SANDBOX_NONCE_MODE=incremental`, le défaut). Coché : poser `GEMINI_SANDBOX_NONCE_MODE=time` (secondes, à ±30 s de l'horloge de Gemini) |

Gemini montre la clé et son secret **une seule fois**. Les copier directement dans Render
(étape 4), **jamais** dans le chat, un ticket, un fichier du dépôt, un `.env` commité ni Vercel :
le web n'en a pas besoin, et `pnpm env:check web` refuse un nom de secret du moteur posé côté web.

## 3. La table de la preuve (A, 2 min)

La migration `supabase/migrations/20261120000000_venue_checks.sql` crée `venue_check_runs` (une
ligne par exécution, réussie ou non), ajoute à `venue_checks` ce qui a été relu chez Gemini (sens,
type, prix, quantité, quantité exécutée, statut de Gemini, prix moyen) et crée
`venue_order_links` (le lien entre l'identifiant d'ordre du moteur et celui de Gemini, voir
**Limites**). À appliquer avant la première exécution, comme les autres (`docs/deploy.md`,
étape 1, point 2) :

```bash
supabase db push --remote --dry-run   # doit lister 20261120000000_venue_checks.sql
supabase db push --remote
```

Sans elle, la vérification tourne quand même, mais l'enregistrement échoue (log ERROR « the venue
check could not be recorded ») et le Hedge desk n'a rien à montrer.

## 4. Lancer la vérification

### Sur Render, sans shell (la voie prévue)

L'offre gratuite de Render n'a pas de shell : le moteur fait la vérification **une fois au
démarrage** quand on le lui demande, à côté de ses services, sans jamais les bloquer ni s'arrêter
si le sandbox refuse.

1. Render → le service du moteur → **Environment** → ajouter :

   | Variable | Valeur |
   | --- | --- |
   | `GEMINI_SANDBOX_API_KEY` | la clé (`account-…`) |
   | `GEMINI_SANDBOX_API_SECRET` | le secret |
   | `APP_VENUE_CHECK_ON_BOOT` | `true` |
   | `APP_VENUE_CHECK_ACCEPT_TERMS` | `true` seulement si les conditions n'ont pas été acceptées dans l'interface |
   | `GEMINI_SANDBOX_NONCE_MODE` | seulement si la clé est en nonce « time-based » : `time` |

   **Ne pas toucher `APP_EXECUTION_VENUE`** : la couverture reste `paper` (voir plus bas).
2. **Save, rebuild, and deploy** (ou Save puis Manual Deploy).
3. Dans les **Logs** du service, quelques secondes après `engine starting` : une ligne
   `venue check at boot: real orders on the Gemini sandbox`, puis l'une des deux :
   - `venue check at boot PROVEN: maker placed, cancelled, and an order filled on the Gemini sandbox`,
     avec `runId`, `instrument` et les trois `venueOrderId` et leur `status` ;
   - `venue check at boot FAILED`, niveau ERROR, avec `step` et `reason` (tableau plus bas).
4. Ouvrir `/hedge-desk` : le panneau « Real orders on Gemini sandbox » montre l'exécution.
5. **Remettre ensuite `APP_VENUE_CHECK_ON_BOOT` à `false`** (ou supprimer la variable). Sinon
   chaque redémarrage (un déploiement, et le réveil d'une instance gratuite endormie) repasse
   trois ordres de test et ajoute une exécution ; le panneau montre toujours la dernière, donc un
   échec plus tard remplacerait une preuve réussie à l'écran (elle reste dans la table). Les deux
   clés peuvent rester : sans le drapeau, le moteur ne s'en sert pas.

Si le drapeau est posé sans les deux clés, rien n'est envoyé : log ERROR « APP_VENUE_CHECK_ON_BOOT
is set but the check cannot run » et une exécution enregistrée en échec à l'étape `preflight`
(« GEMINI_SANDBOX_API_KEY and GEMINI_SANDBOX_API_SECRET are not both set »). Le moteur démarre
normalement dans tous les cas.

### En local

```bash
GEMINI_SANDBOX_API_KEY=… GEMINI_SANDBOX_API_SECRET=… \
DB_URL='postgres://…' \
  pnpm --filter engine venue:check            # options : --symbol <instrumentSymbol>, --accept-terms, --no-record
```

`DB_URL` est l'URL du session pooler de Supabase (celle du moteur) pour que le Hedge desk de
production montre la preuve ; `--no-record` l'exécute sans rien enregistrer (rien ne s'affiche
alors sur le desk). La commande ne lit que ces variables (liste complète en tête de
`apps/engine/src/venues/gemini/check-env.ts`), jamais les clés de la chaîne. Code de sortie : 0
prouvé, 1 échec ou enregistrement impossible, 2 configuration incomplète (les noms des
variables manquantes, jamais leurs valeurs).

Sortie, ici contre le **serveur simulé** des tests (identifiants simulés, pas une preuve) :

```text
Gemini sandbox order check (command)
  started  2026-11-20T01:02:37.165Z   finished 2026-11-20T01:02:43.108Z
  contract GEMI-BTC2611202200-HI91000 (BTC price today at 5pm EST), bid 38¢, ask 57¢
  placed_maker order 73797746498585286  maker buy 1.00 @ 36¢  filled 0.00  status open
  cancelled    order 73797746498585286  maker buy 1.00 @ 36¢  filled 0.00  status cancelled
  filled       order 73797746498585287  taker buy 1.00 @ 57¢  filled 1.00 avg 0.57  status filled
  PROVEN: a maker order rested, was cancelled, and an order was filled.
  not recorded (--no-record)
```

## 5. Ce que montre le Hedge desk

Le panneau **« Real orders on Gemini sandbox »** (`GET /api/hedge-desk`, champ `venueCheck`, la
dernière ligne de `venue_check_runs` et ses ordres) :

- **avant** toute exécution : « Not proven yet » en clair, « No real order has been placed on the
  sandbox yet. », et les trois étapes « Not yet » sans identifiant ;
- **après** une exécution réussie : l'heure de la vérification, « Proven », « Venue: Gemini
  sandbox, test funds », et pour chaque étape (« Maker order placed », « Order cancelled »,
  « Order filled ») l'heure, l'identifiant d'ordre de Gemini, le contrat, « Buy 1.00 @ $0.36 » et
  « Gemini says: open / cancelled / filled » ;
- **après** un échec : « Failed », l'étape où elle s'est arrêtée et la raison en une ligne, les
  étapes faites avec leurs ordres, les autres « Not yet ».

La capture `docs/receipts/ui/hd-venue-check.png` montre le panneau sur le scénario simulé
`venueCheckProven` : ses identifiants sont des exemples, pas la preuve.

Pour lire la preuve dans la base :

```sql
select r.finished_at, r.trigger, r.outcome, r.failed_step, r.failure, r.instrument,
       c.action, c.venue_order_id, c.side, c.kind, c.price_bps, c.qty, c.filled_qty, c.status
from venue_check_runs r left join venue_checks c on c.run_id = r.id
order by r.finished_at desc, c.at;
```

## Lire un échec

| Étape | Raison typique | Quoi faire |
| --- | --- | --- |
| `preflight` | `InvalidApiKey`, `InvalidSignature` | la clé ou le secret recopiés de travers, ou une clé du site de production (le sandbox a ses propres clés) |
| `preflight` | `MissingRole` | la clé n'a pas le rôle Trader |
| `preflight` | `InvalidNonce` | une clé « time-based » sans `GEMINI_SANDBOX_NONCE_MODE=time`, ou l'inverse |
| `preflight` | « has not accepted the latest Prediction Markets terms » | les accepter dans l'interface, ou `APP_VENUE_CHECK_ACCEPT_TERMS=true` |
| `preflight` | `ACCOUNT_GROUP_BLOCKED` | le compte n'a pas accès aux Prediction Markets : voir **Repli** |
| `instrument` | « no open crypto contract … has a two-sided book » | aucun carnet vivant à ce moment (les robots du sandbox dorment ?) : relancer plus tard ou imposer `--symbol` |
| `placed_maker` | `would_cross` deux fois | le carnet bougeait sous l'ordre : relancer |
| `placed_maker` | « Gemini shows the order filled » | l'ordre n'a pas reposé (un robot l'a pris) : relancer |
| `placed_maker` | `InsufficientFunds` | solde de test épuisé : écrire à trading@gemini.com (documentation du sandbox) |
| `cancelled` | « filled before it could be cancelled » | un robot a pris l'ordre entre la relecture et l'annulation : relancer |
| `filled` | « filled nothing, twice » ou « no ask » | l'ask a disparu : relancer |

Un échec laisse au plus un ordre au repos : la vérification l'annule avant de s'arrêter, et le dit
dans le log.

## Repli : pas de compte sandbox

Si Gemini refuse le compte ou la clé, HE-10 est remplacé par les tests
de l'adaptateur contre un **serveur Gemini simulé** (`apps/engine/src/venues/gemini/sim-server.ts`,
`node:http` sur 127.0.0.1). Ce serveur vérifie chaque requête privée comme la documentation le
décrit (clé, corps vide, charge utile base64 dont `request` est le chemin, nonce strictement
croissant, signature HMAC-SHA384 recalculée) et répond avec les formes de la spécification
OpenAPI, identifiants d'ordre au-delà de 2^53 compris. Les tests passent la séquence complète et
ses échecs : authentification refusée, 429 puis succès, ordre qui ne repose pas, maker refusé
parce qu'il croiserait, annulation d'un ordre déjà exécuté, conditions non acceptées, contrat
introuvable, arrêt du moteur pendant la vérification ; et que la clé, le secret, une charge utile
ou une signature n'apparaissent jamais dans un log, le rapport ou la base.

```bash
pnpm --filter engine exec vitest run src/venues/gemini
```

**Il faut alors le dire tel quel** : l'adaptateur est prouvé contre un serveur simulé d'après la
documentation, pas contre Gemini, et le Hedge desk garde « Not proven yet ».

## La couverture sur le sandbox (`APP_EXECUTION_VENUE=gemini-sandbox`)

Possible, mais **pas pour la production**, qui reste sur `paper` : le moteur couvre des contrats
sportifs que le sandbox ne liste pas, Gemini refuserait chaque ordre (`InvalidSymbol`, rendu comme
un rejet `invalid_order`). Ce réglage exige les deux clés (le moteur refuse de démarrer sans) et
envoie alors les ordres de couverture au sandbox par le même adaptateur. `gemini` (production,
argent réel) est refusé exprès par `createVenue`.

## Limites connues de l'adaptateur

- **Pas d'identifiant client dans l'ordre REST.** Le `OrderRequest` de la spécification n'en a
  pas (seul `order.place` du WebSocket en prend un). Le lien entre l'identifiant d'ordre du moteur
  et celui de Gemini est écrit dans `venue_order_links` **avant** l'envoi ; un placement dont la
  réponse s'est perdue est retrouvé chez Gemini par ses termes (contrat, sens, prix, quantité,
  créé après l'envoi, lié à aucun autre ordre), ou déclaré jamais créé après 30 s.
- **Pas de route « statut d'un ordre » pour les Prediction Markets.** Un ordre est relu dans
  `/orders/active` (filtré par contrat) puis, une fois fermé, dans `/orders/history` (par contrat
  et date de fermeture). Les ordres ouverts sont relus toutes les 2 s tant qu'il y en a ; le flux
  WebSocket `orders@account`, plus rapide, n'est pas utilisé.
- **Les exécutions sont déduites.** Gemini donne par ordre la quantité exécutée et le prix moyen :
  chaque hausse de la quantité est une exécution, à un prix tiré du prix moyen (arrondi au point
  de base). **Les frais ne sont pas donnés** par l'API d'ordres : ils sont calculés avec le barème
  publié (`packages/pricing`), et l'exécution le dit (`bookRef.source = "venue"`,
  `feeFromSchedule: true`). Une telle exécution n'est pas rejouable sur un carnet.
- **Limite de débit.** Au plus 4 requêtes privées par seconde (Gemini en recommande 5 au plus) ;
  une réponse 429 est attendue (`Retry-After`, sinon 1 s doublée jusqu'à 16 s) puis renvoyée avec
  un nouveau nonce, 5 essais au plus. Un placement ou une annulation sans réponse n'est jamais
  renvoyé (Gemini l'a peut-être traité) ; une lecture l'est.
- **Secrets.** La clé et le secret ne sortent pas du client : ni log, ni message d'erreur, ni
  table ; les logs nomment le chemin, le statut HTTP, la raison de Gemini et la durée.

## Sources (lues le 20 novembre 2026)

- Authentification par clé API, en-têtes, nonce, codes d'erreur :
  [developer.gemini.com/authentication/api-key](https://developer.gemini.com/authentication/api-key)
- Rôles (Trader par défaut) : [developer.gemini.com/roles](https://developer.gemini.com/roles)
- Codes et corps d'erreur : [developer.gemini.com/error-codes](https://developer.gemini.com/error-codes)
- Limites de débit et 429 : [developer.gemini.com/rate-limit](https://developer.gemini.com/rate-limit)
- Sandbox (URL, soldes de test, 2FA) :
  [developer.gemini.com/get-started/sandbox](https://developer.gemini.com/get-started/sandbox)
- Spécification OpenAPI des Prediction Markets (serveurs production et sandbox, `placeOrder`,
  `cancelOrder`, `getActiveOrders`, `getOrderHistory`, conditions, schémas `OrderRequest`,
  `OrderResponse`, erreurs) :
  [developer.gemini.com/specs/openapi/prediction-markets.yaml](https://developer.gemini.com/specs/openapi/prediction-markets.yaml)
- Placer un ordre (REST contre WebSocket, `makerOrCancel`) :
  [developer.gemini.com/rest-api/prediction-markets/order-management/place-order](https://developer.gemini.com/rest-api/prediction-markets/order-management/place-order)
- Démarrage rapide et cycle de vie d'un ordre :
  [developer.gemini.com/prediction-markets/trading-quickstart](https://developer.gemini.com/prediction-markets/trading-quickstart),
  [developer.gemini.com/prediction-markets/order-lifecycle](https://developer.gemini.com/prediction-markets/order-lifecycle)
- Identifiant client (WebSocket) : spécification AsyncAPI,
  [developer.gemini.com/specs/asyncapi/websocket.yaml](https://developer.gemini.com/specs/asyncapi/websocket.yaml)
