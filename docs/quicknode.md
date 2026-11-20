# QuickNode : endpoint Arc testnet et Stream des événements de l'escrow

> **En production depuis le 20 novembre 2026.** Le Stream décrit ici tourne sur Arc testnet et a livré
> les règlements réels du 20 novembre à `POST /api/webhooks/quicknode` : signature vérifiée, et huit
> événements écrits par la livraison avant le reçu du relayer
> (`docs/receipts/prod/settlements-2026-11-19.md`, section « QuickNode Streams »). Aucune livraison n'a
> encore été enregistrée comme fichier d'exemple (étape 5). Les pages de QuickNode ont été lues en entier le 18 novembre
> 2026, et celles des limites d'`eth_getLogs`, de la facturation des Streams, de la taille des lots
> et des prix relues le 19 novembre (liste en fin de page). Trois points restent à confirmer sur la première livraison réelle
> (étape 5) parce que la documentation ne les écrit pas : le nom du réseau d'Arc testnet dans les
> métadonnées, la forme exacte du corps quand un filtre est actif, et si une nouvelle tentative
> porte un nouvel horodatage. Le code les accepte sous toutes les formes plausibles et le log de
> la route dit ce qu'il a reçu.

Ce que la documentation dit, et ce que le code en fait :

- **Arc testnet** (chain id 5042002) est offert pour les endpoints RPC (HTTP et WSS, archive, sans
  élagage) et pour Streams, avec tous les jeux de données EVM, dont **Logs** et **Block with
  Receipts**.
- **Signature** : trois en-têtes, `X-QN-Nonce`, `X-QN-Timestamp`, `X-QN-Signature`. La signature
  est le HMAC-SHA256, en hexadécimal, avec le jeton de sécurité du Stream comme clé, de
  nonce + horodatage + corps JSON **non compressé** (la chaîne UTF-8 signée avant compression),
  collés sans séparateur. L'horodatage est un temps Unix en **secondes** (l'exemple du guide :
  `1735613672`). Aucune tolérance n'est documentée, ni si une nouvelle tentative est signée à
  nouveau : la route **n'applique aucune fenêtre** à l'horodatage (elle le journalise comme
  `signedAgeMs`). Une fenêtre qui refuserait une nouvelle tentative ou la reprise d'un Stream en
  pause ferait repasser le Stream en pause ; une livraison rejouée, elle, ne contient que des logs
  signés et n'écrit rien de plus (insertion idempotente sur `(tx_hash, log_index)`).
- **Compression** : `None` ou `Gzip` (réglage de la destination), annoncée par
  `Content-Encoding: gzip`. La route décompresse avant de vérifier.
- **Métadonnées** : envoyées à **chaque** livraison, dans le corps (`{ "data": …, "metadata": … }`)
  **et** en en-têtes (`Stream-Network`, `Stream-Dataset`, `Batch-Start-Range`, …). Le nom de
  réseau documenté suit `<chaîne>-<réseau>` (`ethereum-mainnet`) ; celui d'Arc testnet n'est pas
  écrit : `arc-testnet` par défaut, à confirmer sur la première livraison réelle.
- **Forme de `data`** : pour Logs, un tableau par bloc de tableaux de logs (l'exemple imbrique sur
  trois niveaux) au format `eth_getLogs` ; pour Block with Receipts, un objet `{ block, receipts }`
  par bloc. Un filtre renvoie le JSON qu'il veut (`null` : rien n'est livré pour ce bloc). La route
  lit toute imbrication de tableaux, logs, reçus, blocs avec reçus et réponses de filtre
  `{ data, metadata }`, et refuse (400) un nombre que la table ne peut pas garder (numéro de bloc
  au-delà d'un `bigint`, index de log au-delà d'un `integer`, heure de bloc après l'an 9999).
- **Livraison et pauses** : réponse attendue 2xx dans le délai de la destination (Timeout, 30 s
  par défaut). Sinon QuickNode réessaie toutes les « Retry data fetch every » secondes (1 par
  défaut) et **met le Stream en pause après « Pause stream after » échecs (3 par défaut)**. Les
  blocs sont livrés dans l'ordre et le suivant attend l'accusé du précédent. Un Stream en pause se
  relance dans le tableau de bord ou par `POST /streams/{id}/activate` de l'API REST, et reprend
  là où il s'était arrêté. Toute réponse autre que 2xx compte comme un échec : un 400 (livraison
  illisible) ou un 401 (jeton faux) répétés mettent aussi le Stream en pause.
- **Réorganisations** : « Restream on reorg » est réservé aux offres payantes ; Arc a une finalité
  déterministe et les lecteurs du moteur n'en gèrent pas. Un log marqué `removed` n'est jamais
  écrit (log d'erreur).
- **Facturation** : Streams consomme des crédits par bloc traité, que le filtre garde quelque chose
  ou non : `crédits = blocs traités × multiplicateur`, **20 par bloc** pour Arc Testnet, jeu Logs.
  Streams et RPC puisent dans **le même** lot de crédits. Un Stream en pause ne consomme rien ; à
  la reprise, repartir du dernier bloc évite de payer les blocs manqués. Ce que cela coûte par
  jour, et donc quand créer le Stream : étape 3.
- **Origine** : les livraisons partent de l'adresse IP `141.148.40.227` (utile seulement pour un
  pare-feu ; Vercel n'en a pas besoin).

## 1. Créer le compte (téléphone)

1. Créer un compte sur quicknode.com. Page des prix, relue le 19 novembre 2026 : **Free trial**,
   un mois, 10 M de crédits sans dépassement possible, **15 requêtes/s**, sans carte ; **Build**,
   49 $/mois (34 $ par mois facturé à l'année), 80 M de crédits, **50 requêtes/s**.
2. Rien d'autre à faire sur le téléphone avant l'étape 2 : la suite se fait dans le tableau de bord.

## 2. Créer l'endpoint HTTP Arc testnet

1. Tableau de bord → **Endpoints** → **Create** → chaîne **Arc**, réseau **Testnet**.
2. Copier l'URL HTTP (de la forme `https://<nom>.quiknode.pro/<jeton>/` : le jeton est dans le
   chemin, c'est un secret, jamais dans le dépôt).
3. Sur l'hôte du **moteur** (Render, page Environment du service) : `ARC_RPC_URL=<cette URL>`, et
   `ARC_RPC_FALLBACK_URL=https://rpc.testnet.arc.io` (la valeur par défaut, à laisser). **Preuve**
   (une minute ; l'URL lue par `read -rs ARC_RPC_URL`, elle contient le jeton) :

   ```bash
   curl -s -X POST "$ARC_RPC_URL" -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
   ```

   Attendu : `"result":"0x4cef52"` (5042002). Une autre valeur : l'endpoint n'est pas Arc
   **testnet**, et le moteur refuserait de démarrer (`ChainIdMismatchError`).
4. Débit : le moteur ne dépasse jamais `ARC_RPC_MAX_REQUESTS_PER_SECOND` (défaut 10, dont 4
   `eth_getLogs` par `ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND`). Cette limite vaut pour les deux URL
   ensemble : quand QuickNode échoue, la même requête part vers le RPC public dans le même tour,
   et celui-ci a été mesuré à environ 10 requêtes/s (`apps/engine/src/chain/rpc-limiter.ts`).
   - Free trial (15 requêtes/s) : **ne rien changer** (10 reste sous les deux plafonds). **Mais
     sur le Free plan, QuickNode limite `eth_getLogs` à 5 blocs** (10 000 sur les offres payantes,
     page `eth_getLogs` d'Arc) : les lectures du moteur (une dizaine de blocs toutes les 5 s, et
     jusqu'à 2 000 blocs pendant un rattrapage) sont refusées par QuickNode et servies par le RPC
     public, dans le même tour (repli de viem). Rien ne se perd, mais le lecteur d'événements
     dépend alors du seul RPC public, et chaque lecture coûte deux requêtes. Le moteur le dit :
     `ARC_RPC_URL did not serve eth_getLogs: ARC_RPC_FALLBACK_URL serves the escrow's logs
     instead, and the event reader now depends on it (QuickNode's Free plan limits eth_getLogs to
     5 blocks)` (module `rpc`, niveau warn, avec l'hôte de chaque nœud et le nombre de refus ;
     une fois, puis au plus toutes les 10 minutes). Sur Free, cet avertissement est attendu. Si le
     RPC public tombe ou limite, les événements que le moteur n'a pas envoyés lui-même attendent
     son retour ; ses propres transactions sont enregistrées par leurs reçus et les achats
     continuent. Build lève la limite (10 000 blocs, le moteur en demande 2 000 au plus) ;
   - Build (50 requêtes/s) : `ARC_RPC_MAX_REQUESTS_PER_SECOND=20` au plus, la moitié du plafond,
     et `ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND` laissé à 4. Au-delà, une panne de QuickNode
     enverrait plus que le RPC public n'accepte (le limiteur temporise alors, sans perte).

## 3. Créer le Stream (ordinateur)

Tableau de bord → **Streams** → **Create Stream** :

| Réglage | Valeur |
| --- | --- |
| Chaîne et réseau | **Arc**, **Testnet** |
| Jeu de données | **Logs** |
| Début | le dernier bloc (**latest**) : l'historique est déjà lu par le moteur depuis `ARC_ESCROW_DEPLOY_BLOCK` |
| Taille des lots | **5**, avec **Elastic Batch** activé (voir dessous) |
| Distance au sommet, réorganisations | 0 et désactivé : Arc est final au bloc |
| Filtre | le code ci-dessous |
| Destination | **Webhook**, URL `https://<domaine>/api/webhooks/quicknode` |
| Timeout | 30 s (le défaut ; la route a `maxDuration = 30`) |
| Pause stream after | 3 (le défaut) ou plus |
| Compression | None ou Gzip, les deux sont acceptées |

Taille des lots : la documentation de l'API REST exige au moins 5 blocs par lot pour un Stream qui
suit le sommet d'un réseau aux blocs plus rapides qu'une seconde (refus 422 sinon) et conseille
Elastic Batch, qui livre sans attendre que le lot soit plein. **Arc testnet est dans ce cas** :
0,51 s par bloc, mesuré le 19 novembre sur `rpc.testnet.arc.io`
(251 587 blocs en 128 353 s depuis le bloc de déploiement de l'escrow ; pas refait depuis). Avec
Elastic Batch, un lot de 5 n'attend pas : les blocs partent dès qu'ils existent. La route lit les
lots de toute taille.

**Ce que le Stream coûte, et quand le créer.** À 1,96 bloc par seconde et 20 crédits par bloc
(jeu Logs, Arc Testnet, page de facturation des Streams ; le filtre ne réduit rien) :
3 600 × 1,96 × 20 ≈ **141 000 crédits par heure**, soit **≈ 3,4 M par jour**, avant les requêtes
RPC du moteur, qui puisent dans le même lot. Le Free trial (10 M, sans dépassement) est donc vidé
par le Stream seul en **moins de trois jours** ; Build (80 M par mois) le tient environ trois
semaines. Le moteur n'a pas besoin du Stream (il lit les événements par `eth_getLogs` et par les
reçus) : **ne pas le créer ce matin**. Sur le Free trial, le créer le plus tard possible (vendredi
soir pour le samedi), ou le laisser en pause jusqu'à la démo ; à la reprise, repartir du dernier
bloc. Preuve, une heure après sa création : le compteur de crédits du tableau de bord a avancé
d'environ 141 000 plus ce que le moteur consomme ; comparer avec le compteur relevé juste avant.
Ce qui se passe quand les crédits sont épuisés n'est pas écrit dans les pages lues : si QuickNode
répond alors une erreur, le moteur passe sur le RPC public ; s'il ne répondait plus du tout, le
moteur attendrait ses délais à chaque requête. Surveiller le compteur.

Le filtre garde les logs de l'escrow (`packages/contracts/deployments/5042002.json`), à quelque
profondeur qu'ils soient dans `data`, et ne livre rien pour un lot qui n'en a pas :

```js
function main(stream) {
  const escrow = "0x81d2d4050e617184b2b832c30be68f8811b37d2c";
  const kept = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node.address === "string" && node.address.toLowerCase() === escrow) {
      kept.push(node);
    }
  };
  visit(stream.data);
  return kept.length === 0 ? null : kept;
}
```

La documentation ne dit pas exactement comment QuickNode enveloppe la réponse d'un filtre dans le
corps livré (son guide des filtres la lit sous `data`) : la route accepte la liste de logs nue,
sous `data`, ou dans un tableau de plus. À confirmer sur la première livraison réelle.

Le **jeton de sécurité** du Stream (réglage « Security token » de la destination, bouton Rotate
pour en changer) va dans `QUICKNODE_STREAMS_TOKEN`, sur l'hôte de l'**application web**
(Vercel), jamais préfixé `NEXT_PUBLIC_`, puis Redeploy. `ARC_ESCROW_ADDRESS` y vaut déjà
l'adresse ci-dessus : elle est posée sur Vercel dès le premier déploiement, Stream ou pas
(`docs/deploy.md`, étape 4, point 2), parce qu'elle donne aussi le lien vers l'explorateur de
chaque promo.
Si la première livraison est refusée pour « another network », le log donne le nom reçu : le
mettre dans `QUICKNODE_STREAMS_NETWORK` (défaut `arc-testnet`) et redéployer. Les trois valeurs
sont lues par la configuration du serveur (`serverConfigOf`, `apps/web/lib/server/deps.ts`).

## 4. Vérifier qu'une livraison est arrivée

- Avant d'attendre un événement : le bouton **Send Payload** du Stream envoie une livraison de test
  signée (la page de l'exemple officiel de validation le décrit).
- Log de la route (Vercel → Logs), une ligne par livraison acceptée :
  `quicknode delivery stored`, avec `network`, `escrowEvents`, `inserted`, `delayMs` (de l'heure
  du bloc à la réception) et `signedAgeMs` (de la signature à la réception). Un refus dit sa
  raison : `signature not verified`, `not a documented shape` (avec le chemin et la cause),
  `another network`, `names no network`, `not configured`.
- Un Stream passé en pause (tableau de bord) après des refus : corriger la cause d'après le log,
  puis **Activate** ; il reprend au lot refusé.
- En SQL :

  ```sql
  select source, count(*), max(block_number) from chain_events group by source;
  ```

  Une ligne `streams` apparaît dès que le webhook a écrit un événement avant le moteur ; un
  événement déjà écrit par le reçu ou par `eth_getLogs` garde sa source, ce qui est normal.

## 5. Enregistrer la première livraison réelle

Sur l'ordinateur, avec un tunnel HTTPS public vers le port local (cloudflared ou ngrok) :

```bash
export QUICKNODE_STREAMS_TOKEN=…   # le jeton du Stream ; jamais écrit sur disque par la commande
pnpm quicknode:record --port 8787 --out apps/engine/fixtures/quicknode --once
```

1. Pointer temporairement la destination du Stream (ou un second Stream identique) vers
   `https://<tunnel>/` : mettre le Stream en pause, changer l'URL, le relancer.
2. Faire un achat sur la campagne de test, ou attendre un événement de l'escrow (Send Payload
   envoie un bloc d'exemple, pas forcément un log de l'escrow).
3. La commande vérifie la signature, écrit `apps/engine/fixtures/quicknode/delivery-….json` sans le
   jeton, affiche le délai entre l'heure de chaque bloc et la réception, répond 200 et s'arrête.
4. Remettre la destination sur `https://<domaine>/api/webhooks/quicknode`.
5. `pnpm --filter @winz/web exec vitest run lib/server/quicknode-webhook.fixtures.test.ts` rejoue
   le fichier dans la route : c'est la preuve attendue. Format du fichier :
   `apps/engine/fixtures/quicknode/README.md`. Y lire aussi les trois points encore ouverts : le
   nom du réseau (`network`), la forme du corps filtré, et l'unité de `x-qn-timestamp`.

## Sources

Pages relues en entier le 19 novembre 2026 :

- [Arc, `eth_getLogs`](https://www.quicknode.com/docs/arc/eth_getLogs) (5 blocs sur le Free plan,
  10 000 sur les offres payantes) ·
  [Streams, facturation](https://www.quicknode.com/docs/streams/billing) (crédits = blocs ×
  multiplicateur, 20 pour Arc Testnet Logs, un seul lot de crédits avec le RPC, filtres sans effet
  sur le coût, Stream en pause gratuit) ·
  [API REST, lots et Elastic Batch](https://www.quicknode.com/docs/streams/rest-api) (au moins 5
  blocs sous la seconde, refus 422) ·
  [Créer un Stream](https://www.quicknode.com/docs/streams/rest-api/create-stream) ·
  [Prix et offres](https://www.quicknode.com/pricing)

Pages lues en entier le 18 novembre 2026 :

- [Streams, chaînes prises en charge](https://www.quicknode.com/docs/streams/supported-chains) ·
  [Arc, API et réseaux](https://www.quicknode.com/docs/arc/api-overview) ·
  [Arc, endpoints](https://www.quicknode.com/docs/arc/endpoints)
- [Destination webhook](https://www.quicknode.com/docs/streams/destinations/webhooks) ·
  [Valider les livraisons webhook](https://www.quicknode.com/guides/quicknode-products/streams/validating-incoming-streams-webhook-messages) ·
  [Exemple officiel de validation](https://www.quicknode.com/sample-app-library/streams-webhook-validate-signature)
- [Jeux de données et métadonnées](https://www.quicknode.com/docs/streams/data-sources) ·
  [Ethereum et EVM](https://www.quicknode.com/docs/streams/data-sources/ethereum-evm) ·
  [Filtres](https://www.quicknode.com/docs/streams/filters) ·
  [Guide des filtres](https://www.quicknode.com/guides/quicknode-products/streams/how-to-use-filters-with-streams)
- [Compression](https://www.quicknode.com/guides/quicknode-products/streams/reduce-streams-costs-with-data-compression) ·
  [Réorganisations](https://www.quicknode.com/docs/streams/reorg-handling) ·
  [Relancer un Stream en pause](https://www.quicknode.com/docs/streams/rest-api/activate-stream) ·
  [FAQ](https://www.quicknode.com/docs/streams/faq)
