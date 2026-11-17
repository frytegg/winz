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
`{ "error": { "code": "internal", "message": "Not implemented yet" } }`.

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
| `POST /api/admin/demo/sale`      | `default`                                                                  |
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
