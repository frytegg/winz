# Mettre la pile en ligne

Une seule page, dans l'ordre : Supabase, puis le moteur sur Railway, puis l'application web sur
Vercel, Stripe, et le premier essai depuis un téléphone. Chaque étape finit par une commande qui
prouve qu'elle a marché. Qui fait quoi (TASKS.md) : Alexandre (A) Supabase, Railway, QuickNode
(F-01) ; Téo (T) Vercel, son domaine, Stripe et Privy (F-03).

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
QuickNode hébergés, donc chaque commande de preuve ci-dessous lancée contre eux. Les pages de
documentation de Railway, Vercel et Supabase n'ont pas pu être relues depuis l'environnement où
cette page a été écrite (pas d'accès réseau à ces domaines) : les réglages ci-dessous viennent de
leur documentation telle qu'elle était connue, et les endroits où un nom de réglage peut avoir
changé le disent.

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
   supabase link --project-ref <ref-du-projet>
   pnpm db:migrate
   ```

   `pnpm db:migrate` lance `supabase db push`. Le seed (un commerçant de démo, un match et ses
   quatre instruments, aucune campagne) est facultatif : `supabase db push --include-seed`.

3. **Preuve.** `pnpm db:test` ne vise jamais le projet hébergé : il démarre son propre Postgres
   jetable (et il passe en CI). Sur le projet hébergé, seulement des lectures, dans le SQL Editor
   de Supabase ou avec `psql "$DB_URL"` :

   ```sql
   -- Les 7 migrations sont appliquées.
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
   public.live_campaigns, public.live_hedge_desk;` (Database → Publications dans le tableau de
   bord montre la même chose).

4. **`DB_URL`**, dans Connect (en haut du tableau de bord) : prendre la chaîne du **transaction
   pooler** (Supavisor, port **6543**, hôte `aws-0-<région>.pooler.supabase.com`, utilisateur
   `postgres.<ref>`), pour le moteur **et** pour le web. Pourquoi :
   - la connexion directe (`db.<ref>.supabase.co:5432`) n'a qu'une adresse IPv6, que les fonctions
     Vercel ne joignent pas (et Railway seulement s'il sort en IPv6) ;
   - le session pooler (port 5432 de l'hôte pooler) réserve une connexion serveur par client, et le
     moteur en ouvre jusqu'à `DB_POOL_MAX` (20 par défaut), plus 5 par instance web : la petite
     instance d'un projet gratuit n'en a pas autant ;
   - le transaction pooler convient aux deux, vérifié dans le code : les deux clients ont
     `prepare: false` (`apps/engine/src/db.ts`, `apps/web/lib/server/db.ts`), tous les verrous
     consultatifs sont de transaction (`pg_advisory_xact_lock`, `pg_try_advisory_xact_lock`),
     `statement_timeout` et `lock_timeout` sont posés avec `set_config(…, true)` (locaux à la
     transaction), et rien n'utilise `LISTEN`, `NOTIFY`, `SET` de session ni un verrou de session.
     Un verrou de session ajouté un jour (par exemple pour interdire deux moteurs) demanderait la
     connexion directe ou le session pooler pour le moteur.

   Remplacer `[YOUR-PASSWORD]` par le mot de passe de l'étape 1.

5. **`NEXT_PUBLIC_SUPABASE_URL`** et la clé publique, dans Project Settings → API (ou « API
   Keys ») : l'URL `https://<ref>.supabase.co` et la clé anonyme (`anon`, ou la clé « publishable »
   `sb_publishable_…` des projets récents ; l'ancienne clé `anon` reste sous « Legacy API keys »)
   dans `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Jamais la clé `service_role` ni la clé « secret » : elles
   ignorent la RLS. Aujourd'hui aucun code ne lit encore ces deux variables (le temps réel côté
   front n'est pas branché) : `pnpm env:check web` les signale comme « front-end ».

## 2. Le moteur sur Railway (A)

Ce qui est dans le dépôt : `apps/engine/Dockerfile` (Node 22, pnpm 10.28.0 par corepack,
installation `--frozen-lockfile` filtrée sur le moteur, utilisateur non root, `node --import tsx
src/index.ts` sans shell, donc SIGTERM arrive au moteur), `.dockerignore`, et `railway.json` à la
racine (Dockerfile, contrôle de santé `/healthz`, redémarrage `ON_FAILURE`, **une** réplique).
Le moteur n'a pas d'étape de build : il exécute ses sources TypeScript avec tsx.

1. New Project → Deploy from GitHub repo → ce dépôt. Railway lit `railway.json` à la racine du
   dépôt (Settings → Config-as-code : chemin `/railway.json`). Ne pas définir de Root Directory :
   le Dockerfile se construit depuis la racine.
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
   | `DB_POOL_MAX` | non | `20` |
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

3. **Une seule réplique.** Settings → Deploy → Replicas : 1 (`railway.json` dit `numReplicas: 1`).
   Le moteur détient les nonces de deux clés et le seul worker des transactions : deux moteurs sur
   la même base se disputeraient les mêmes nonces. Ce que le code garantit et ne garantit pas :
   - l'index unique `(signer_address, chain_id, nonce)` de `chain_txs` et le `where status =
     'queued'` du passage à `sent` empêchent qu'un même nonce soit enregistré deux fois ou qu'une
     même ligne soit envoyée par les deux : le second moteur échoue sur ces gardes au lieu de
     signer en double ;
   - les jobs sont pris avec `for update skip locked` et les écritures sensibles sont sous verrou
     consultatif de transaction : deux workers ne prennent jamais le même job ;
   - mais **rien n'empêche deux moteurs de tourner** : pas de verrou de singleton. Deux couvertures
     tourneraient par instrument, et les files des deux expéditeurs se bloqueraient l'une l'autre.
   - Un déploiement Railway démarre le nouveau conteneur avant d'arrêter l'ancien : les deux
     tournent ensemble jusqu'à ce que le nouveau réponde 200 sur `/healthz` (quelques secondes).
     `overlapSeconds: 0` limite ce chevauchement à ce délai, sans l'annuler ; `drainingSeconds: 30`
     laisse à l'ancien ses 15 s d'arrêt propre avant le SIGKILL. Si ces deux clés sont refusées par
     Railway (leur nom a pu changer), les retirer de `railway.json` : rien d'autre n'en dépend.
4. Contrôle de santé : `/healthz` (dans `railway.json`, délai 120 s). Le moteur n'écoute un port
   que si `PORT` est défini (Railway le définit) ; en local, rien n'écoute.
5. **Preuve.** Deployments → le déploiement → Deploy Logs. Un bon démarrage ressemble à ceci
   (lignes réelles d'un démarrage local, adresses remplacées) :

   ```text
   {"level":"info","module":"tx-sender","chainId":5042002,"relayer":"0x…","oracle":"0x…","escrow":"0x…","msg":"transaction sender started"}
   {"level":"info","module":"chain-ingest","escrow":"0x…","fromBlock":"72727350","cursor":"escrow-logs:0x…","msg":"chain ingest started"}
   {"level":"info","module":"hedging","venue":"paper","label":"PAPER · live Gemini book","msg":"hedging started"}
   {"level":"info","module":"settlement","escrow":"0x…","intervalMs":15000,"msg":"settlement watcher started"}
   {"level":"info","module":"jobs","workerId":"engine-…","concurrency":4,"msg":"job worker started"}
   {"level":"info","module":"engine","chainId":5042002,"venue":"paper","msg":"engine running"}
   {"level":"info","module":"health","port":8080,"path":"/healthz","msg":"health listener started"}
   ```

   Puis, pour un appel depuis l'extérieur, Settings → Networking → Generate Domain (la réponse de
   `/healthz` ne contient ni secret, ni adresse de clé, ni e-mail) :

   ```bash
   curl -s https://<moteur>.up.railway.app/healthz
   ```

   Attendu : HTTP 200 et `{"status":"ok", …, "chain":{"id":5042002,"head":…,"cursor":…},
   "db":"ok","sender":"running","jobs":"running"}`. `cursor` rattrape `head` au premier
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

## 3. L'application web sur Vercel (T)

Pas de `vercel.json` : avec un monorepo pnpm, le projet Vercel pointe sur `apps/web`, et un
`vercel.json` y serait lu, pas à la racine ; tout ce qu'il porterait se règle dans le tableau de
bord.

1. Add New → Project → importer ce dépôt. Réglages (Settings → Build and Deployment) :
   - **Root Directory** : `apps/web`, avec « Include files outside the root directory » activé
     (les paquets `@winz/shared` et `@winz/pricing` sont lus en source) ;
   - **Framework Preset** : Next.js ; Install Command et Build Command : laisser les valeurs par
     défaut (Vercel trouve `pnpm-lock.yaml` à la racine et lance `pnpm install` à la racine, puis
     `next build` dans `apps/web`) ;
   - **Node.js Version** : 22.x ;
   - variable `ENABLE_EXPERIMENTAL_COREPACK=1` pour que Vercel prenne la version de pnpm de
     `packageManager` (10.28.0) plutôt que celle qu'il déduit du lockfile ;
   - Settings → Functions → **Region** : la région de Supabase (étape 1) ;
   - **Fluid compute : activé, obligatoire** (Settings → Functions ; c'est le défaut des nouveaux
     projets, avec une durée par défaut de 300 s). Plusieurs routes attendent : le webhook Stripe,
     le paiement et sa confirmation lisent Stripe (délai 15 s, 2 nouvelles tentatives : jusqu'à
     45 s), la création de campagne et la recharge créent un paiement Stripe (jusqu'à 20 s), la
     vente démo attend jusqu'à 8 s le ticket. Sans Fluid, le défaut de 10 s sur Hobby les
     couperait, et aucune route ne fixe encore `maxDuration` (un test du dépôt n'autorise que
     `dynamic` et les méthodes dans un fichier de route).
2. Variables (Settings → Environment Variables, environnement Production), à partir de `web.env` :

   ```bash
   pnpm env:check web --file web.env
   ```

   Doit finir par `result: complete for the web`. Elle échoue aussi si une clé du moteur
   (`ARC_*_PRIVATE_KEY`, `APP_DEMO_WALLET_SEED`) est dans le fichier, ou un secret sous
   `NEXT_PUBLIC_`. Variables du serveur web (`pnpm env:check web --list`) :

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
   | `QUICKNODE_STREAMS_TOKEN` | oui |  |
   | `ARC_ESCROW_ADDRESS` | non |  |

   Plus, pour le front : `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_…`),
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Mettre `APP_ENV=production`,
   `APP_BASE_URL=https://<domaine>`, `APP_EXECUTION_VENUE` égal à celui du moteur, et **ne pas**
   définir `APP_API_MOCK` (en production il est ignoré de toute façon).

   **Construction et exécution.** `next build` ne lit aucune variable du serveur (vérifié : la
   construction passe avec un environnement vide) : elles ne servent qu'à l'exécution, lues à la
   première requête. Les `NEXT_PUBLIC_*` sont, elles, recopiées dans le JavaScript au moment de la
   construction : les définir avant le premier déploiement, et redéployer après tout changement.
   `QUICKNODE_STREAMS_TOKEN` est exigé par le schéma alors que `POST /api/webhooks/quicknode`
   n'est pas encore implémenté (il répond 501) : y mettre une valeur aléatoire
   (`openssl rand -hex 32`) en attendant.
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

QuickNode Streams (`/api/webhooks/quicknode`, jeton dans `QUICKNODE_STREAMS_TOKEN`) : ne pas
créer le flux tant que la route répond 501. Le moteur lit déjà les événements de l'escrow par
`eth_getLogs` : le flux ne ferait qu'accélérer.

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

- Deux répliques du moteur, ou un second moteur (local, autre service) sur la même base.
- Une clé Stripe live (`sk_live_`, `pk_live_`) : les deux services la refusent, ne pas essayer.
- Une clé privée, la graine démo ou la clé `service_role` dans une variable `NEXT_PUBLIC_*`, ou
  sur Vercel tout court. `pnpm env:check web` le refuse quand le NOM de la variable le trahit (une
  variable du moteur posée sur le web, un nom en `NEXT_PUBLIC_` qui contient `SECRET`, `KEY` privé,
  `SEED`, `TOKEN`...) ; il ne lit pas les valeurs, donc une clé secrète collée sous un nom public
  ordinaire (la clé secrète Stripe à la place de la clé publiable, par exemple) lui échappe :
  relire chaque valeur `NEXT_PUBLIC_*` avant d'enregistrer.
- `APP_API_MOCK=true` en production.
- Coller `engine.env`, une clé privée, la graine démo (`APP_DEMO_WALLET_SEED`) ou le mot de passe
  de la base dans une discussion, une issue ou un commit.
