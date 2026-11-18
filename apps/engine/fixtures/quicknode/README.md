# Livraisons QuickNode Streams enregistrées

Ce dossier reçoit les livraisons **réelles** d'un Stream QuickNode sur Arc testnet, écrites par
`pnpm quicknode:record` (tâche S-04, mode d'emploi dans `docs/quicknode.md`). Il est vide tant
qu'aucune livraison n'a été enregistrée.

Chaque fichier `delivery-<heure de réception>-<premier bloc>-<dernier bloc>.json` contient une
livraison dont la signature a été vérifiée à la réception avec le jeton du Stream. **Le jeton
n'est jamais écrit** : il reste dans l'environnement de celui qui enregistre.

| Champ               | Contenu                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `format`            | `winz.quicknode-delivery.v1`                                                                                                                                 |
| `receivedAt`        | heure de réception, UTC ISO 8601, horloge de la machine qui enregistre                                                                                       |
| `method`, `path`    | la requête telle que reçue                                                                                                                                   |
| `headers`           | les en-têtes qui permettent de la vérifier et de la relire : `x-qn-nonce`, `x-qn-timestamp`, `x-qn-signature`, `content-type`, `content-encoding`, `stream-*`, `batch-*`, `user-agent` |
| `signatureVerified` | toujours `true` : une livraison non vérifiée n'est pas écrite                                                                                                |
| `signedOver`        | `uncompressed` (le JSON décompressé, ce que la doc QuickNode annonce) ou `compressed` (les octets reçus)                                                     |
| `bodyEncoding`      | `base64`                                                                                                                                                     |
| `body`              | le corps **tel qu'il est arrivé**, octet pour octet (compressé en gzip si `content-encoding` le dit)                                                         |
| `bodyBytes`, `inflatedBytes` | tailles reçue et décompressée                                                                                                                       |
| `network`           | le réseau que nomme la livraison (métadonnées du corps ou en-tête `stream-network`)                                                                          |
| `blocks`            | pour chaque bloc dont la livraison porte l'heure : numéro, heure du bloc, délai jusqu'à la réception en ms                                                   |

Le test `apps/web/lib/server/quicknode-webhook.fixtures.test.ts` rejoue chaque fichier de ce
dossier dans la route `POST /api/webhooks/quicknode` contre une vraie base Postgres : le corps
enregistré est signé de nouveau avec un jeton de test (le vrai jeton n'est pas là), les
événements de l'escrow de `packages/contracts/deployments/5042002.json` sont écrits une fois,
une deuxième livraison ne change rien, et la signature enregistrée est refusée sous le jeton de
test. Avec zéro fichier, il passe et le dit dans son nom.

Un fichier ajouté ici est relu tel quel : ne pas le reformater (le dossier est exclu de Prettier).
