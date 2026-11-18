# Mettre la pile en ligne

Une seule page, dans l'ordre : Supabase, puis le moteur sur Railway, puis l'application web sur
Vercel, Stripe, et le premier essai depuis un téléphone. Chaque étape finit par une commande qui
prouve qu'elle a marché. Qui fait quoi : Alexandre (A) Supabase, Railway, QuickNode (F-01) et le
projet Vercel (le dépôt est dans son compte GitHub, celui de Téo ne le voit pas) ; Téo (T) Stripe,
Privy et l'enregistrement du domaine chez eux (F-03).

**La branche à déployer est `frytegg/modest-bohr-wipl43`, pas `main`** : `main` ne contient pas
encore le code. Railway et Vercel déploient la branche par défaut du dépôt si on ne leur dit rien ;
les étapes 2 et 3 disent où la choisir.

## Ce qui a été exécuté ici, et ce qui ne l'a pas été

Exécuté, en local, sans aucun compte ni service hébergé :

- l'image du moteur construite avec `apps/engine/Dockerfile` (Docker 29, contexte = racine du dépôt),
  lancée contre un Postgres 16 local (les 7 migrations et le seed appliqués) et une chaîne anvil
  locale avec l'escrow de test : `/healthz` répond 200, `docker stop` (SIGTERM) déroule l'arrêt du
  moteur et le conteneur sort avec le code 0 ; la même chose sans conteneur, avec la même commande
  (`node --import tsx src/index.ts`) ;
- l'image lancée sans variable : elle refuse de démarrer et nomme chaque variable manquante ;
- `pnpm --filter @winz/web build` avec un environnement vide (`env -i`) : la construction passe,
  elle ne lit aucun secret ;
- `next start` avec un environnement de production (clés factices) contre ce Postgres local, puis
  `pnpm smoke` contre lui et contre le moteur : toutes les vérifications passent ;
- `pnpm env:check` sur des fichiers complets, incomplets et faux.

Pas exécuté (il faut les comptes) : tout ce qui touche Supabase, Railway, Vercel, Stripe, Privy et
QuickNode hébergés, donc chaque commande de preuve ci-dessous lancée contre eux. Les réglages de
Railway, Vercel et Supabase ont été relus le 18 novembre 2026 sur leur documentation actuelle
(pages lues en entier, liste en fin de page) ; rien n'a été essayé sur un compte. Trois choses
y ont changé depuis la première version de cette page : Railway ne lit plus `railway.json` pour un
service créé maintenant (étape 2), `supabase db push` vise la base locale sans `--remote`
(étape 1), et Supabase met en garde contre Postgres.js sur le transaction pooler : les deux
services passent donc par le session pooler (étape 1, point 4).

## 0. Avant de commencer

```bash
pnpm install
```

Outils sur le poste : la CLI Supabase (`scoop install supabase` sous Windows, `brew install
supabase/tap/supabase` sous macOS) et `psql` (client Postgres) pour les vérifications.

Préparer, hors du dépôt, deux fichiers que personne ne commite et que personne ne colle dans une
discussion : `engine.env` et `web.env` (format `NOM=valeur`, une ligne par variable). Ce sont eux
que `pnpm env:check` relit avant chaque collage dans Railway ou Vercel.

## 1. Supabase (A)

1. Créer le projet sur supabase.com. **Région** : la même zone que le moteur et les fonctions
   Vercel (par exemple Europe de l'Ouest partout, ou `us-east-1` avec Vercel `iad1` et Railway
   US East). Noter le mot de passe de la base.
2. Lier le dépôt au projet et appliquer les migrations :

   ```bash
   supabase login
   supabase link <ref-du-projet>
   supabase db push --remote
   ```

   **`--remote` est indispensable** : la référence actuelle de la CLI dit que `supabase db push`
   pousse vers la base **locale** par défaut, et vers le projet lié avec `--remote` ; la commande
   affiche sur stderr une ligne `Target:` qui nomme la base visée, la lire avant de confirmer (elle
   demande une confirmation, « No » par défaut). `pnpm db:migrate` lance `supabase db push` sans
   ce drapeau : `pnpm db:migrate --remote` le lui passe. Avec une CLI plus ancienne qui ne
   connaîtrait pas `--remote`, `--linked` (déprécié en v3, retiré en v4) fait la même chose.
   `supabase link --project-ref <ref>` marche encore. Le seed (un commerçant de démo, un match et
   ses quatre instruments, aucune campagne) est facultatif : `supabase db push --remote
   --include-seed`.

3. **Preuve.** `pnpm db:test` ne vise jamais le projet hébergé : il démarre son propre Postgres
   jetable (et il passe en CI). Sur le projet hébergé, seulement des lectures, dans le SQL Editor
   de Supabase ou avec `psql "$DB_URL"` :

   ```sql
   -- Toutes les migrations de supabase/migrations sont appliquées (une ligne par fichier).
   select version from supabase_migrations.schema_migrations order by version;
   -- Aucune table publique sans RLS : doit répondre 0 ligne.
   select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
   -- Realtime publie exactement les trois tables live_* :
   -- live_campaigns, live_hedge_desk, live_instruments.
   select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;
   ```

   Si la dernière requête ne répond rien, la publication n'existait pas quand la migration a
   tourné : `alter publication supabase_realtime add table public.live_instruments,
   public.live_campaigns, public.live_hedge_desk;` (Database → Publications, ligne
   `supabase_realtime`, montre et bascule la même chose table par table).

4. **`DB_URL`**, dans **Connect** (en haut du tableau de bord), méthode choisie dans la boîte de
   dialogue. Recopier l'hôte, le port et l'utilisateur de la chaîne affichée : l'hôte des poolers
   partagés est `aws-<index>-<région>.pooler.supabase.com`, où `<index>` est un numéro de grappe
   qui ne se déduit pas de la région. Ce que dit la documentation actuelle :

   | Méthode | Hôte:port | IP (gratuit) | Requêtes préparées, état de session |
   | --- | --- | --- | --- |
   | Connexion directe | `db.<ref>.supabase.co:5432` | IPv6 seulement | oui |
   | Session pooler | `aws-<index>-<région>.pooler.supabase.com:5432` | IPv4 | oui |
   | Transaction pooler | `aws-<index>-<région>.pooler.supabase.com:6543` | IPv4 | non (ni `SET`, ni verrou de session, ni `LISTEN`/`NOTIFY`, ni pipelining) |

   L'utilisateur est `postgres` en direct, `postgres.<ref>` par les poolers. Le module IPv4 (offres
   payantes) remplace l'IPv6 de la connexion directe par une IPv4, il n'ajoute pas l'une à l'autre.
   Instance gratuite (Nano) : 60 connexions Postgres, 200 clients de pooler, 15 connexions par
   pool par défaut (Database settings).

   - **Moteur (Railway) et web (Vercel) : tous les deux le session pooler** (port 5432 de l'hôte
     des poolers), jamais le transaction pooler.
     - Pourquoi pas le transaction pooler, que Supabase recommande d'ordinaire pour des fonctions
       serverless : leur page sur Postgres.js, le client du moteur comme du web, écrit qu'il
       « pipeline les requêtes par défaut » et que, sur le transaction pooler, cela « peut bloquer
       des requêtes ou renvoyer des lignes mélangées », sans option qui le désactive
       (`max_pipeline: 0` casse `sql.begin()`). Des lignes mélangées dans une application de
       paiement, c'est la réponse d'une requête servie à une autre : on ne prend pas ce risque.
       En mode session, chaque connexion du client garde sa propre connexion Postgres et les
       réponses ne peuvent pas se croiser.
     - Le prix : les connexions sont comptées. Chaque connexion d'un client de session occupe
       une connexion du pool (15 par défaut sur l'instance gratuite). Régler **`DB_POOL_MAX=8`
       sur le moteur** (Railway) ; le web en prend **3 par instance** par défaut (`DB_POOL_MAX`
       sur Vercel pour changer) et rend celles qu'il n'utilise plus après 20 s. 8 + deux
       instances web à 3 = 14, sous les 15.
     - Si les logs de Vercel montrent des refus de connexion (« max clients », `53300`) sous
       charge, c'est ce plafond : augmenter la taille du pool dans **Database → Settings →
       Connection pooling** (l'instance gratuite a 60 connexions Postgres en tout), pas le mode.
     - La connexion directe irait aussi pour le moteur, mais elle est en IPv6 seulement sur
       l'offre gratuite, et les pages de Railway lues ici ne disent pas qu'un service sort en IPv6.

   Remplacer `[YOUR-PASSWORD]` (ou `[YOUR-DATABASE-PASSWORD]`) par le mot de passe de l'étape 1,
   en encodant les caractères réservés (`&`, `#`, `?`, espace).

5. **`NEXT_PUBLIC_SUPABASE_URL`** et la clé publique : la boîte **Connect** affiche l'URL
   `https://<ref>.supabase.co` et la clé publiable ; toutes les clés sont sous **Settings → API
   Keys** (il n'y a plus de page « Settings → API » à part). Mettre dans
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` la clé **publishable** (`sb_publishable_…`) ou, à défaut,
   l'ancienne clé `anon` (un JWT `eyJ…`) ; Supabase retire `anon` et `service_role` d'ici fin 2026.
   Jamais une clé **secret** (`sb_secret_…`) ni `service_role` : elles passent outre la RLS.
   `pnpm env:check web` refuse une valeur `NEXT_PUBLIC_*` qui a la forme d'un secret (voir la
   fin de la page). Aujourd'hui aucun code ne lit encore ces deux variables (le temps réel côté
   front n'est pas branché) : `pnpm env:check web` les signale comme « front-end ».

## 2. Le moteur sur Railway (A)

Ce qui est dans le dépôt : `apps/engine/Dockerfile` (Node 22, pnpm 10.28.0 par corepack,
installation `--frozen-lockfile` filtrée sur le moteur, utilisateur non root, `node --import tsx
src/index.ts` sans shell, donc SIGTERM arrive au moteur), `.dockerignore`, et `railway.json` à la
racine (Dockerfile, contrôle de santé `/healthz`, redémarrage `ON_FAILURE`, chevauchement et
draining), que Railway ne lit plus pour un nouveau service : voir l'étape 1.
Le moteur n'a pas d'étape de build : il exécute ses sources TypeScript avec tsx.

1. New Project → Deploy from GitHub repo → ce dépôt, puis dans le service : Settings → Source →
   branche `frytegg/modest-bohr-wipl43` (pas `main`, qui n'a pas le code). Ne pas définir de Root Directory : le
   Dockerfile se construit depuis la racine. **Railway ne lira pas `railway.json`** : sa
   documentation dit que Config as Code est déprécié, qu'un nouveau service ne peut plus s'y
   inscrire et que les fichiers existants cessent d'être lus le 1er décembre 2026 ; son remplaçant
   (`.railway/railway.ts`, appliqué par la CLI) demande le paquet npm `railway`, absent du dépôt.
   Le fichier reste comme trace des réglages ; les poser à la main, dans les Settings du service ou
   en variables de service (documentées comme équivalentes) :

   | Réglage | Où | Valeur |
   | --- | --- | --- |
   | Dockerfile | variable `RAILWAY_DOCKERFILE_PATH` | `apps/engine/Dockerfile` |
   | Healthcheck Path | Settings → Deploy | `/healthz` |
   | Healthcheck Timeout | Settings, ou variable `RAILWAY_HEALTHCHECK_TIMEOUT_SEC` | `120` (défaut 300) |
   | Restart Policy | Settings → Deploy | On Failure, 10 essais (le défaut ; 10 est le plafond des offres Free et Trial) |
   | Overlap | variable `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` | `0` (le défaut) |
   | Draining | variable `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `30` (défaut **0** : SIGKILL aussitôt après SIGTERM) |
   | Replicas | Settings → Deploy | 1 (le défaut) |

   Watch paths (Settings → Build) : facultatif, les motifs de `railway.json` (`apps/engine/**`,
   `packages/shared/**`, `packages/pricing/**`, les fichiers de la racine) évitent de redéployer
   le moteur pour un commit du web seul.
2. Variables (Variables → Raw Editor), à partir de `engine.env`, vérifié d'abord :

   ```bash
   pnpm env:check engine --file engine.env
   ```

   La commande doit finir par `result: complete for the engine`. Ne pas mettre `PORT` : Railway le
   fixe lui-même, et c'est le port du contrôle de santé. Valeurs : `APP_ENV=production` ;
   `DB_URL` de l'étape 1 ; `ARC_ESCROW_ADDRESS` et `ARC_ESCROW_DEPLOY_BLOCK` depuis
   `packages/contracts/deployments/5042002.json` (ne rien redéployer) ; `ARC_RPC_URL` le point
   d'accès QuickNode d'Arc testnet (`ARC_RPC_FALLBACK_URL` reste le RPC public par défaut) ;
   `APP_ADMIN_DEMO_KEY` la même valeur que sur Vercel ; Privy (les deux variables) ou, à défaut,
   `APP_DEMO_WALLET_SEED`.

   Variables du moteur (générées par `pnpm env:check engine --list`, depuis le schéma que le moteur
   valide au démarrage) :

   | Variable | Requise | Défaut |
   | --- | --- | --- |
   | `APP_ENV` | non | `development` |
   | `APP_LOG_LEVEL` | non | `info` |
   | `APP_EXECUTION_VENUE` | non | `paper` |
   | `APP_ADMIN_DEMO_KEY` | oui |  |
   | `DB_URL` | oui |  |
   | `DB_POOL_MAX` | non | `20` (mettre `8` derrière le session pooler, étape 1.4) |
   | `ARC_CHAIN_ID` | non | `5042002` |
   | `ARC_RPC_URL` | oui |  |
   | `ARC_RPC_FALLBACK_URL` | non | `https://rpc.testnet.arc.io` |
   | `ARC_ESCROW_ADDRESS` | oui |  |
   | `ARC_ESCROW_DEPLOY_BLOCK` | oui |  |
   | `ARC_USDC_ADDRESS` | non | `0x3600000000000000000000000000000000000000` |
   | `ARC_RELAYER_PRIVATE_KEY` | oui |  |
   | `ARC_ORACLE_PRIVATE_KEY` | oui |  |
   | `ARC_RPC_MAX_REQUESTS_PER_SECOND` | non |  |
   | `ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND` | non |  |
   | `ARC_RPC_HEAVY_METHODS` | non |  |
   | `ARC_TX_MAX_IN_FLIGHT` | non |  |
   | `ENGINE_LEASE_TTL_MS` | non | `15000` |
   | `ENGINE_LEASE_RENEW_MS` | non | `3000` |
   | `ENGINE_LEASE_STANDBY_POLL_MS` | non | `1000` |
   | `GEMINI_API_URL` | non | `https://api.gemini.com` |
   | `GEMINI_WS_URL` | non | `wss://ws.gemini.com` |
   | `GEMINI_SANDBOX_API_URL` | non | `https://api.sandbox.gemini.com` |
   | `APP_HTTPS_PROXY_URL` | non |  |
   | `APP_PROXY_CA_FILE` | non |  |
   | `GEMINI_SANDBOX_API_KEY` | non |  |
   | `GEMINI_SANDBOX_API_SECRET` | non |  |
   | `STRIPE_SECRET_KEY` | non |  |
   | `NEXT_PUBLIC_PRIVY_APP_ID` | non |  |
   | `PRIVY_APP_SECRET` | non |  |
   | `APP_DEMO_WALLET_SEED` | non |  |
   | `APP_API_MOCK` | non | `false` |
   | `PORT` | non |  |

   « non » ne veut pas dire « inutile » : sans `STRIPE_SECRET_KEY` le moteur ne vend que les ventes
   rejouées par le mode démo, et Privy ou la graine démo est exigé (le schéma refuse l'un sans
   l'autre). Pour la porte G1, `STRIPE_SECRET_KEY` (la même clé `sk_test_` que Vercel) est requise.

3. **Une seule réplique**, et un seul moteur au travail par base. Settings → Deploy → Replicas : 1
   (le défaut). Le moteur détient les nonces de deux clés, le seul worker des transactions, une
   couverture par instrument et le chargeur des couvertures : deux moteurs au travail sur la même
   base se disputeraient les nonces et couvriraient deux fois la même exposition. Le code
   l'empêche par un **bail** (table `engine_lease`, une ligne, décidé sur l'horloge de la base, en
   requêtes d'une seule instruction qui marchent derrière n'importe quel pooler ;
   `apps/engine/README.md`, « One engine per database ») :
   - un moteur démarre en **standby** : il a validé ses variables et joint la base, il n'a démarré
     aucun service (ni expéditeur, ni worker, ni couverture, ni règlement, ni lecteur), et il
     demande le bail tout de suite puis chaque seconde. Dès qu'il l'a, il démarre le moteur comme
     avant et le renouvelle toutes les 3 s (`ENGINE_LEASE_RENEW_MS`) pour 15 s
     (`ENGINE_LEASE_TTL_MS`) ;
   - s'il ne peut plus le renouveler (base injoignable), il arrête ses services de lui-même après
     10 s sans renouvellement (15 s moins 5 s de marge pour l'arrêt) et redevient standby ; si son
     arrêt n'a pas fini 1 s avant que le bail puisse expirer, le processus s'arrête (code 1) et
     Railway le relance en standby ; si le bail est au nom d'un autre, il s'arrête tout de suite ;
   - au SIGTERM, il arrête ses services, puis libère le bail : le standby prend la main à son
     interrogation suivante, sans attendre l'expiration.

   **La table du bail fait partie des migrations de l'étape 1 : les appliquer avant de déployer
   le moteur, et avant chaque push qui en ajoute une.** Un push sur la branche suivie redéploie le
   moteur tout seul, alors que les migrations s'appliquent à la main (`supabase db push
   --remote`). Un moteur déployé sans la table reste un standby dont chaque demande de bail échoue
   (`relation "engine_lease" does not exist`) : son `/healthz` répond 503 (`"role":"standby"`, et
   la ligne `health check failed` du log dit `standby: its latest ask for the engine lease was not
   answered`), et Railway marque le déploiement en échec en gardant l'ancien. Vérifier avant de
   pousser : `select 1 from engine_lease` dans le SQL Editor répond sans erreur.

   Un **redéploiement** se passe ainsi : Railway démarre le nouveau conteneur, qui est un standby
   en bonne santé (`/healthz` répond 200 avec `"role":"standby"`) ; Railway arrête l'ancien
   (SIGTERM), qui s'arrête et libère le bail ; le nouveau travaille dans la seconde (mesuré en
   local : 0,2 s entre l'arrêt des services de l'ancien et le démarrage de ceux du nouveau). À
   aucun moment deux moteurs n'ont leurs services en marche (les tests de `apps/engine/src/leader`
   le vérifient, avec deux moteurs réels et deux processus réels). Deux réglages de l'étape 1
   comptent ici : `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` à 0 (le défaut) raccourcit l'attente, et
   **`RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` est à poser à la main** (le défaut est 0) : il
   laisse à l'ancien ses 15 s d'arrêt propre avant le SIGKILL. Un SIGKILL ne libère pas le bail :
   le nouveau attend alors son expiration, 15 s au plus.

   Deux répliques ne casseraient plus rien : la seconde attendrait en standby sans rien faire. Elle
   ne ferait que coûter un conteneur, sans haute disponibilité de plus que le redémarrage
   « On Failure » : garder 1. Ce que le bail ne couvre pas : un processus gelé plus longtemps que
   le bail (machine suspendue) ne peut pas s'arrêter de lui-même ; à son réveil il s'arrête au
   premier tour de minuterie, mais ce qu'il faisait au moment du gel se termine. Les nonces (index
   unique `(signer_address, chain_id, nonce)`, passage à `sent` sous `where status = 'queued'`),
   les jobs (`for update skip locked`, verrou consultatif par sujet, clés d'idempotence) et les
   charges de couverture (clés de lot, refus `HedgeAlreadyCharged` de l'escrow) restent protégés ;
   les ordres de couverture ne le sont pas (deux couvertures peuvent acheter pour la même
   exposition).
4. Contrôle de santé : `/healthz`, délai 120 s. Railway injecte `PORT` et interroge ce port-là,
   depuis l'hôte `healthcheck.railway.app`, seulement au déploiement (pas de surveillance
   ensuite). Le moteur n'écoute un port que si `PORT` est défini ; en local, rien n'écoute. Un
   standby en bonne santé répond 200 lui aussi (c'est ce qui permet la relève).
5. **Preuve.** Deployments → le déploiement → Deploy Logs. Un bon démarrage ressemble à ceci
   (lignes réelles d'un démarrage local, adresses remplacées) :

   ```text
   {"level":"info","module":"leader","holder":"eng-…","ttlMs":15000,"renewMs":3000,"standbyPollMs":1000,"fenceAfterMs":10000,"msg":"standby: no service runs until this engine holds the lease"}
   {"level":"info","module":"health","port":8080,"path":"/healthz","msg":"health listener started"}
   {"level":"info","module":"leader","holder":"eng-…","msg":"lease acquired: starting the engine"}
   {"level":"info","module":"tx-sender","chainId":5042002,"relayer":"0x…","oracle":"0x…","escrow":"0x…","msg":"transaction sender started"}
   {"level":"info","module":"chain-ingest","escrow":"0x…","fromBlock":"72727350","cursor":"escrow-logs:0x…","msg":"chain ingest started"}
   {"level":"info","module":"hedging","venue":"paper","label":"PAPER · live Gemini book","msg":"hedging started"}
   {"level":"info","module":"settlement","escrow":"0x…","intervalMs":15000,"msg":"settlement watcher started"}
   {"level":"info","module":"jobs","workerId":"engine-…","concurrency":4,"msg":"job worker started"}
   {"level":"info","module":"engine","chainId":5042002,"venue":"paper","msg":"engine running"}
   {"level":"info","module":"leader","holder":"eng-…","msg":"engine running under the lease"}
   ```

   Pendant un redéploiement, le nouveau conteneur écrit d'abord `standby: the lease is held by
   another engine` (avec l'identifiant de l'ancien), puis, une fois l'ancien arrêté, `lease
   acquired: starting the engine`. L'ancien finit par `engine services stopped`, `lease released`,
   `health listener stopped`.

   Puis, pour un appel depuis l'extérieur, Settings → Networking → Generate Domain (la réponse de
   `/healthz` ne contient ni secret, ni adresse de clé, ni e-mail) :

   ```bash
   curl -s https://<moteur>.up.railway.app/healthz
   ```

   Attendu : HTTP 200 et `{"status":"ok","role":"leader", …, "chain":{"id":5042002,"head":…,
   "cursor":…},"db":"ok","sender":"running","jobs":"running","lease":{"holder":"eng-…",
   "heldForS":…,"renewedAgoMs":…}}`. `"role":"standby"` (200 aussi, `sender` et `jobs` à
   `"stopped"`) veut dire que ce conteneur attend le bail : `lease.holder` dit quel moteur le
   détient. Un standby qui ne peut pas lire le bail (migration absente, droits manquants) répond
   503 : il ne prendrait jamais la main. Les lectures de la base et du nœud servent toutes les
   requêtes pendant 2 s ; le rôle et l'état des services sont relus à chaque requête. `cursor` rattrape `head` au premier
   démarrage (par plages de 2 000 blocs). 503 dit ce qui manque : `db: "down"` (mauvais `DB_URL`
   ou base injoignable), `head: null` (nœud injoignable), `sender: "stopped"` (arrêt en cours).
   Ce même appel prouve la moitié « depuis Railway » de S-05 : `book-feed` ne doit pas journaliser
   d'erreur WebSocket répétée vers `wss://ws.gemini.com`.
6. **Quand il refuse de démarrer**, la première ligne des logs est `Invalid environment:` suivie
   d'une ligne par variable (`- DB_URL: Invalid input: expected string, received undefined`).
   Corriger `engine.env`, relancer `pnpm env:check engine --file engine.env`, recoller. Un
   `engine could not start` avec `ChainIdMismatchError` veut dire que `ARC_RPC_URL` ne sert pas la
   chaîne 5042002 ; `SignerHistoryMismatchError` : une clé a changé alors que la base garde des
   transactions envoyées par l'ancienne (son message dit quoi faire).

## 3. L'application web sur Vercel (A)

Pas de `vercel.json` : avec un monorepo pnpm, le projet Vercel pointe sur `apps/web`, et un
`vercel.json` y serait lu, pas à la racine ; tout ce qu'il porterait se règle dans le tableau de
bord.

1. Add New → Project → importer ce dépôt. Réglages (Settings → Build and Deployment) :
   - **Branche de production** : `frytegg/modest-bohr-wipl43` (Settings → Environments →
     Production → Branch Tracking). Le premier déploiement, fait sur `main` à l'import, échoue :
     c'est attendu, `main` n'a pas `apps/web`. Changer la branche puis redéployer ;
   - **Root Directory** : `apps/web` (bouton Edit à l'import, ou Settings → Build and
     Deployment → Root Directory). « Include files outside the root directory in the Build Step »
     doit rester **activé**, ce qui est le défaut : les paquets `@winz/shared` et `@winz/pricing`
     sont lus en source hors de `apps/web` ;
   - **Framework Preset** : Next.js ; Install Command et Build Command : laisser les valeurs par
     défaut (Vercel trouve `pnpm-lock.yaml` et le workspace pnpm, lance `pnpm install`, puis
     `next build` dans `apps/web`) ;
   - **Node.js Version** : 22.x. Le défaut d'un nouveau projet est la dernière LTS (26.x
     aujourd'hui) ; un champ `engines.node` dans le `package.json` du Root Directory passerait
     avant ce réglage (`apps/web/package.json` n'en a pas) ;
   - variable `ENABLE_EXPERIMENTAL_COREPACK=1` : c'est toujours la façon documentée de faire
     prendre à Vercel la version de `packageManager` du `package.json` racine (`pnpm@10.28.0`).
     Sans elle, un lockfile `lockfileVersion: '9.0'` donne pnpm 9 ou 10 selon l'âge du projet (le
     journal de build dit lequel) ;
   - Settings → Functions → **Function Regions** : la région de Supabase (étape 1) ; le défaut
     des nouveaux projets est `iad1` (Washington) ;
   - **Fluid compute : laisser activé** (Settings → Functions ; le défaut des projets créés depuis
     le 23 avril 2025). Les routes qui attendent fixent leur `maxDuration`, tiré du pire cas lu
     dans le code (le commentaire de chaque fichier le détaille) :

     | Route | `maxDuration` | Ce qui l'occupe au pire |
     | --- | --- | --- |
     | `POST /api/webhooks/stripe` | 120 s | relire, annuler, relire une recharge échouée (≈ 114 s) |
     | `POST /api/checkout` | 60 s | créer le PaymentIntent (15 s × 3 essais ≈ 47 s) |
     | `POST /api/checkout/:pi/confirm` | 60 s | relire le PaymentIntent (≈ 47 s) |
     | `POST /api/campaigns` (et son `GET`) | 30 s | créer le paiement du budget (10 s × 2 ≈ 21 s) |
     | `POST /api/campaigns/:id/top-up` | 300 s | ≈ 356 s si Stripe expirait à chaque appel ; 68 s d'ordinaire |
     | `POST /api/admin/demo/sale` | 15 s | attendre le ticket (8 s) |
     | `POST /api/webhooks/quicknode` | 30 s | aucun appel extérieur ; QuickNode attend 30 s par défaut |

     Avec Fluid, la documentation donne : Hobby 300 s par défaut et au plus ; Pro et Enterprise
     300 s par défaut, 800 s au plus. Toutes ces valeurs tiennent donc dans **Hobby avec Fluid**.
     Sans Fluid, la documentation actuelle ne publie plus de chiffres ; le dernier connu pour Hobby
     est 60 s au plus (annonce de Vercel « Hobby can now run up to 60 seconds ») : le webhook Stripe
     et la recharge le dépassent, d'où Fluid toujours requis sur Hobby. La recharge plafonnée à
     300 s : une coupure au-delà peut laisser un paiement créé et non enregistré, dont le client
     n'a pas reçu le secret ; payé malgré tout, il serait enregistré `refunding` et remboursé
     (`budget-top-up.ts`).
2. Variables (Settings → Environment Variables, environnement Production), à partir de `web.env` :

   ```bash
   pnpm env:check web --file web.env
   ```

   Doit finir par `result: complete for the web`. Elle échoue aussi si une clé du moteur
   (`ARC_*_PRIVATE_KEY`, `APP_DEMO_WALLET_SEED`) est dans le fichier, si le nom d'une variable
   `NEXT_PUBLIC_` est celui d'un secret, ou si la valeur d'une `NEXT_PUBLIC_` a la forme d'un
   secret (voir la fin de la page). Variables du serveur web (`pnpm env:check web --list`) :

   | Variable | Requise | Défaut |
   | --- | --- | --- |
   | `APP_ENV` | non | `development` |
   | `APP_LOG_LEVEL` | non | `info` |
   | `APP_BASE_URL` | oui |  |
   | `APP_API_MOCK` | non | `false` |
   | `APP_ADMIN_DEMO_KEY` | oui |  |
   | `APP_EXECUTION_VENUE` | non | `paper` |
   | `DB_URL` | oui |  |
   | `STRIPE_SECRET_KEY` | oui |  |
   | `STRIPE_WEBHOOK_SECRET` | oui |  |
   | `PRIVY_APP_SECRET` | oui |  |
   | `NEXT_PUBLIC_PRIVY_APP_ID` | oui |  |
   | `QUICKNODE_STREAMS_TOKEN` | non |  |
   | `QUICKNODE_STREAMS_NETWORK` | non | `arc-testnet` |
   | `ARC_ESCROW_ADDRESS` | non |  |

   Plus, pour le front : `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_…`),
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Mettre `APP_ENV=production`,
   `APP_BASE_URL=https://<domaine>`, `APP_EXECUTION_VENUE` égal à celui du moteur, et **ne pas**
   définir `APP_API_MOCK` (en production il est ignoré de toute façon).

   **Construction et exécution.** `next build` ne lit aucune variable du serveur (vérifié : la
   construction passe avec un environnement vide) : elles ne servent qu'à l'exécution, lues à la
   première requête. Les `NEXT_PUBLIC_*` sont, elles, recopiées dans le JavaScript au moment de la
   construction : les définir avant le premier déploiement, et redéployer après tout changement.
   `QUICKNODE_STREAMS_TOKEN` (le jeton de sécurité du Stream) et `ARC_ESCROW_ADDRESS` : tant que
   l'un manque, `POST /api/webhooks/quicknode` répond 503 et le moteur lit les événements par ses
   deux autres sources ; les poser en créant le Stream (`docs/quicknode.md`).
3. Domaine : Settings → Domains → le domaine stable (F-03), puis `APP_BASE_URL` à jour et
   Redeploy.
4. **Preuve** :

   ```bash
   pnpm smoke https://<domaine>
   ```

   Attendu : quatre lignes `ok` (page d'accueil, `/api/health`, `/api/events` qui répond 401 sans
   jeton, donc pas l'API simulée, `/api/hedge-desk` qui lit la base) et `result: 4 checks passed`.
   `HTTP 500` sur le Hedge desk : `DB_URL` faux ou base injoignable (Vercel → Logs montre
   `Invalid environment:` si une variable manque).

## 4. Stripe, en mode test uniquement (T)

1. Mode test activé. Developers → Webhooks → Add endpoint (ou « Add destination ») :
   `https://<domaine>/api/webhooks/stripe`, avec exactement ces quatre événements :
   `payment_intent.succeeded`, `payment_intent.amount_capturable_updated`,
   `payment_intent.canceled`, `payment_intent.payment_failed`.
2. Copier le signing secret (`whsec_…`) dans `STRIPE_WEBHOOK_SECRET` sur Vercel, Redeploy.
   `STRIPE_SECRET_KEY` (`sk_test_…`) va sur Vercel **et** sur Railway.
3. **Preuve** : dans la page du webhook, « Send test event » → `payment_intent.succeeded` :
   réponse 200 (l'événement ne correspond à aucun paiement, il est accepté et ignoré). Une réponse
   400 veut dire que le secret ne correspond pas.

QuickNode Streams (`/api/webhooks/quicknode`, jeton dans `QUICKNODE_STREAMS_TOKEN`) : la route
est en place, la création du Stream est dans `docs/quicknode.md`. Le moteur lit déjà les
événements de l'escrow par `eth_getLogs` : le flux ne fait qu'accélérer.

## 5. Premier essai depuis un téléphone (porte G1)

```bash
pnpm smoke https://<domaine> --engine https://<moteur>.up.railway.app
```

Six lignes `ok` attendues (avec `--campaign <slug>` une fois la campagne créée). Puis, sur le
téléphone :

1. Se connecter en commerçant, créer une campagne sur un match coté, payer le budget avec
   `4242 4242 4242 4242`.
2. La campagne passe `Live` (Railway : `campaign.create` traité, `createCampaignFor` miné).
3. Ouvrir le lien public `/c/<slug>` sur un autre téléphone, payer un produit avec la carte de test.
4. Le ticket s'affiche (`/t/<jeton>`) ; Railway journalise `buyFor` miné, puis la capture.
5. La transaction `buyFor` est visible sur `https://explorer.testnet.arc.io`.
6. `pnpm smoke https://<domaine> --campaign <slug> --engine https://<moteur>.up.railway.app` passe.

## Ce qu'il ne faut jamais faire

- Brancher un moteur local (ou un autre service) sur la base de production : il attendrait en
  standby, puis prendrait le bail dès qu'il est libre (pendant un redéploiement, par exemple) et
  deviendrait le moteur de production, depuis un poste. Une seconde réplique, elle, ne casse plus
  rien (elle attend sans rien faire) mais ne sert à rien : garder `numReplicas: 1`.
- Écrire ou effacer à la main la ligne `engine_lease` pendant qu'un moteur tourne : un bail réécrit
  au nom d'un autre, effacé ou expiré arrête le moteur à son renouvellement suivant (3 s au plus),
  et un bail effacé ou expiré peut être pris par un standby dans cet intervalle, qui démarre alors
  à côté du moteur en place.
- Lancer la répétition (`tsx e2e/rehearsal/run.ts` depuis `apps/web`) avec `--db-url` ou `DB_URL`
  pointant sur une base où travaille un moteur déployé : elle démarre son propre moteur sans
  demander le bail, à côté de celui de Railway (deux expéditeurs sur les mêmes clés, deux
  couvertures). La répétition a sa propre base.
- Pousser le moteur avec le bail avant d'avoir appliqué sa migration (voir l'étape 3).
- Une clé Stripe live (`sk_live_`, `pk_live_`) : les deux services la refusent, ne pas essayer.
- Une clé privée, la graine démo ou la clé `service_role` dans une variable `NEXT_PUBLIC_*`, ou
  sur Vercel tout court. `pnpm env:check web` le refuse quand le NOM de la variable le trahit (une
  variable du moteur posée sur le web, un nom en `NEXT_PUBLIC_` qui contient `SECRET`,
  `PRIVATE_KEY`, `SEED`, `TOKEN`...) et quand la VALEUR d'une `NEXT_PUBLIC_*` a la forme d'un
  secret : `sk_`, `rk_`, `whsec_` (Stripe), `sb_secret_` (Supabase), 64 chiffres hexadécimaux avec
  ou sans `0x` (clé privée, graine), un JWT dont le `role` est `service_role`. Il nomme la variable
  sans jamais afficher la valeur. Un secret d'une autre forme lui échappe encore : relire chaque
  valeur `NEXT_PUBLIC_*` avant d'enregistrer.
- `APP_API_MOCK=true` en production.
- Coller `engine.env`, une clé privée, la graine démo (`APP_DEMO_WALLET_SEED`) ou le mot de passe
  de la base dans une discussion, une issue ou un commit.

## Sources

Pages lues en entier le 18 novembre 2026 (pas des extraits de moteur de recherche) :

- Railway : [Config as Code, référence](https://docs.railway.com/reference/config-as-code) ·
  [Using Config as Code](https://docs.railway.com/config-as-code) ·
  [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code) ·
  [Healthchecks](https://docs.railway.com/deployments/healthchecks) ·
  [Deployment teardown](https://docs.railway.com/deployments/deployment-teardown) ·
  [Deployments, référence](https://docs.railway.com/deployments/reference) ·
  [Restart policy](https://docs.railway.com/deployments/restart-policy) ·
  [Scaling](https://docs.railway.com/deployments/scaling) ·
  [Dockerfiles](https://docs.railway.com/builds/dockerfiles) ·
  [Monorepo](https://docs.railway.com/deployments/monorepo) ·
  [Build configuration](https://docs.railway.com/builds/build-configuration) ·
  [Variables, référence](https://docs.railway.com/variables/reference).
- Vercel : [Configuring maximum duration](https://vercel.com/docs/functions/configuring-functions/duration) ·
  [Functions limitations](https://vercel.com/docs/functions/limitations) ·
  [Fluid compute](https://vercel.com/docs/fluid-compute) ·
  [Hobby can now run up to 60 seconds](https://vercel.com/changelog/vercel-functions-for-hobby-can-now-run-up-to-60-seconds) ·
  [Configure a build (Corepack, Root Directory)](https://vercel.com/docs/builds/configure-a-build) ·
  [Package managers](https://vercel.com/docs/package-managers) ·
  [Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) ·
  [Function region](https://vercel.com/docs/functions/configuring-functions/region) ·
  [Monorepos](https://vercel.com/docs/monorepos).
- Supabase : [Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres) ·
  [Pooling and limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits) ·
  [Postgres.js](https://supabase.com/docs/guides/database/postgres-js) ·
  [Compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk) ·
  [API keys](https://supabase.com/docs/guides/api/api-keys) ·
  [Postgres Changes (publication)](https://supabase.com/docs/guides/realtime/postgres-changes) ·
  [CLI : supabase link](https://supabase.com/docs/reference/cli/supabase-link) ·
  [CLI : supabase db push](https://supabase.com/docs/reference/cli/supabase-db-push).
