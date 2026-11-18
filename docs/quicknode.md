# QuickNode : endpoint Arc testnet et Stream des événements de l'escrow

> **Vérifié sur la documentation seulement, jamais contre le service.** Rien de cette page n'a été
> essayé sur un vrai compte QuickNode : le format des livraisons, la signature, les noms d'en-têtes,
> le nom du réseau (`arc-testnet`), les débits des offres. Le code est construit et testé contre le
> format documenté. La première livraison réelle (étape 5) est la preuve qui manque : si elle est
> refusée, le log de la route dit pourquoi.
>
> Pages lues le 18 novembre 2026, à travers les extraits d'un moteur de recherche (l'accès direct à
> quicknode.com était bloqué depuis la machine de travail) :
> [Streams, chaînes prises en charge](https://www.quicknode.com/docs/streams/supported-chains) ·
> [Arc chez QuickNode](https://www.quicknode.com/chains/arc) ·
> [Valider les livraisons webhook](https://www.quicknode.com/guides/quicknode-products/streams/validating-incoming-streams-webhook-messages) ·
> [Exemple de validation](https://www.quicknode.com/sample-app-library/streams-webhook-validate-signature) ·
> [Destination webhook](https://www.quicknode.com/docs/streams/destinations/webhooks) ·
> [Jeux de données et métadonnées](https://www.quicknode.com/docs/streams/data-sources) ·
> [Filtres](https://www.quicknode.com/docs/streams/filters) ·
> [Réorganisations](https://www.quicknode.com/docs/streams/reorg-handling) ·
> [Compression](https://www.quicknode.com/guides/quicknode-products/streams/reduce-streams-costs-with-data-compression).

Ce que ces pages disent, et ce que le code en fait :

- **Arc testnet** est listé pour les endpoints RPC (chain id 5042002) et pour Streams (jeux de
  données Block, Block with receipts, Transactions, Logs).
- **Signature** : trois en-têtes, `x-qn-nonce`, `x-qn-timestamp`, `x-qn-signature`. La signature
  est le HMAC-SHA256 en hexadécimal, avec le jeton de sécurité du Stream comme clé, de
  nonce + horodatage + corps JSON **non compressé**, collés sans séparateur. L'unité de
  l'horodatage n'est pas écrite (secondes supposées ; la route accepte aussi des millisecondes) ;
  la route refuse une livraison à plus de 5 minutes de son horloge.
- **Compression** : gzip en option, annoncé par `Content-Encoding: gzip`. La route décompresse
  avant de vérifier.
- **Réponse attendue** : un code 2xx. Sinon QuickNode réessaie, puis met le Stream en pause après
  plusieurs échecs (nombre et délai non publiés par QuickNode). Les blocs arrivent dans l'ordre ;
  une même livraison peut revenir (retentatives, re-livraison après une réorganisation) : la route
  est idempotente sur `(tx_hash, log_index)`.
- **Réorganisations** : Arc a une finalité déterministe et les lecteurs du moteur n'en gèrent pas ;
  un log marqué `removed` n'est jamais écrit (log d'erreur), comme rien ne l'efface côté moteur.

## 1. Créer le compte (téléphone)

1. Créer un compte sur quicknode.com. Les offres se comptent en crédits et en requêtes par
   seconde (sources tierces de novembre 2026, à vérifier sur la page des prix : essai d'un mois à
   15 requêtes/s, offre Build à 50 requêtes/s).
2. Rien d'autre à faire sur le téléphone avant l'étape 2 : la suite se fait dans le tableau de bord.

## 2. Créer l'endpoint HTTP Arc testnet

1. Tableau de bord → **Endpoints** → **Create** → chaîne **Arc**, réseau **Testnet**.
2. Copier l'URL HTTP (elle contient un jeton dans son chemin : c'est un secret, jamais dans le dépôt).
3. Sur l'hôte du **moteur** (Railway) : `ARC_RPC_URL=<cette URL>`, et
   `ARC_RPC_FALLBACK_URL=https://rpc.testnet.arc.io` (la valeur par défaut, à laisser).
4. Débit : le moteur ne dépasse jamais `ARC_RPC_MAX_REQUESTS_PER_SECOND` (défaut 10, dont 4
   `eth_getLogs` par `ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND`). Cette limite vaut pour les deux URL
   ensemble : quand QuickNode échoue, la même requête part vers le RPC public dans le même tour,
   et celui-ci a été mesuré à environ 10 requêtes/s (`apps/engine/src/chain/rpc-limiter.ts`).
   - essai ou offre à 15 requêtes/s : **ne rien changer** (10 reste sous les deux plafonds) ;
   - offre Build (50 requêtes/s) : `ARC_RPC_MAX_REQUESTS_PER_SECOND=20` au plus, la moitié du
     plafond, et `ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND` laissé à 4. Au-delà, une panne de
     QuickNode enverrait plus que le RPC public n'accepte (le limiteur temporise alors, sans perte).

## 3. Créer le Stream (ordinateur)

Tableau de bord → **Streams** → **Create Stream** :

| Réglage | Valeur |
| --- | --- |
| Chaîne et réseau | **Arc**, **Testnet** |
| Jeu de données | **Logs** |
| Début | le dernier bloc (**latest**) : l'historique est déjà lu par le moteur depuis `ARC_ESCROW_DEPLOY_BLOCK` |
| Taille des lots | 1 bloc (le défaut) |
| Distance au sommet, réorganisations | 0 et désactivé : Arc est final au bloc |
| Filtre | le code ci-dessous |
| Destination | **Webhook**, URL `https://<domaine>/api/webhooks/quicknode` |
| Métadonnées | **Body** (la route refuse une livraison qui ne nomme pas son réseau) |
| Compression | Aucune ou Gzip, les deux sont acceptées |

Le filtre garde les logs de l'escrow (`packages/contracts/deployments/5042002.json`) et ne livre
rien pour un bloc qui n'en a pas :

```js
function main(stream) {
  const escrow = "0x81d2d4050e617184b2b832c30be68f8811b37d2c";
  const blocks = Array.isArray(stream.data) ? stream.data : [stream.data];
  const kept = blocks.map((block) =>
    (Array.isArray(block) ? block : [block]).filter(
      (log) => log && typeof log.address === "string" && log.address.toLowerCase() === escrow,
    ),
  );
  if (kept.every((logs) => logs.length === 0)) return null;
  return { metadata: stream.metadata, data: kept };
}
```

Le **jeton de sécurité** du Stream (onglet de la destination) va dans `QUICKNODE_STREAMS_TOKEN`,
sur l'hôte de l'**application web** (Vercel), jamais préfixé `NEXT_PUBLIC_`. `ARC_ESCROW_ADDRESS`
doit y valoir l'adresse ci-dessus. Si la première livraison est refusée pour « another network »,
le log donne le nom reçu : le mettre dans `QUICKNODE_STREAMS_NETWORK` (défaut `arc-testnet`).

## 4. Vérifier qu'une livraison est arrivée

- Log de la route (Vercel → Logs), une ligne par livraison acceptée :
  `quicknode delivery stored`, avec `network`, `escrowEvents`, `inserted` et `delayMs` (de l'heure
  du bloc à la réception). Un refus dit sa raison : `signature not verified`, `another network`,
  `names no network`, `not configured`.
- En SQL :

  ```sql
  select source, count(*), max(block_number) from chain_events group by source;
  ```

  Une ligne `streams` apparaît dès que le webhook a écrit un événement avant le moteur ; un
  événement déjà écrit par le reçu ou par `eth_getLogs` garde sa source, ce qui est normal.

## 5. Enregistrer la première livraison réelle (tâche S-04)

Sur l'ordinateur, avec un tunnel HTTPS public vers le port local (cloudflared ou ngrok) :

```bash
export QUICKNODE_STREAMS_TOKEN=…   # le jeton du Stream ; jamais écrit sur disque par la commande
pnpm quicknode:record --port 8787 --out apps/engine/fixtures/quicknode --once
```

1. Pointer temporairement la destination du Stream (ou un second Stream identique) vers
   `https://<tunnel>/`.
2. Faire un achat sur la campagne de test, ou attendre un événement de l'escrow.
3. La commande vérifie la signature, écrit `apps/engine/fixtures/quicknode/delivery-….json` sans le
   jeton, affiche le délai entre l'heure de chaque bloc et la réception, répond 200 et s'arrête.
4. Remettre la destination sur `https://<domaine>/api/webhooks/quicknode`.
5. `pnpm --filter @winz/web exec vitest run lib/server/quicknode-webhook.fixtures.test.ts` rejoue
   le fichier dans la route : c'est le critère de fin de A-06. Format du fichier :
   `apps/engine/fixtures/quicknode/README.md`.
