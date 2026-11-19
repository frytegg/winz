# Mettre la pile en ligne

Une seule page, dans l'ordre : Supabase, le moteur sur Render, Privy, l'application web sur
Vercel, Stripe, et le premier essai depuis un téléphone. Chaque étape finit par une commande qui
prouve qu'elle a marché. Qui fait quoi : Alexandre (A) Supabase, QuickNode, Render et le projet
Vercel (le dépôt est dans son compte GitHub, celui de Téo ne le voit pas) ; Téo (T) Privy, Stripe
et l'enregistrement du domaine chez eux (F-03).

**La branche à déployer est `main`**, pour Render comme pour Vercel. Les étapes 2 et 4 disent où
la vérifier.

## L'ordre de la matinée

Chaque ligne : qui, combien de temps environ, ce qui prouve que c'est fait. Ne pas passer à la
ligne suivante sans la preuve.

1. **A, 15 min — Supabase** (étape 1, points 1 à 5) : base vide vérifiée, migrations, pool à 30. Preuve : 10 versions dans `schema_migrations` (point 3), 0 table sans RLS, 3 tables publiées.
2. **A, 5 min — endpoint QuickNode** (`docs/quicknode.md`, étapes 1 et 2). Preuve : `eth_chainId` répond `0x4cef52` (5042002).
3. **T, 20 min, pendant 1 et 2 — Privy** (étape 3, points 1 à 4). Preuve : le jeu de clés répond, le secret donne 200.
4. **T, 5 min — Stripe, clés et moyens de paiement** (étape 5, point 1). Preuve : `pk_test_`/`sk_test_` du même environnement ; Cards, Apple Pay et Google Pay actifs, rien d'autre.
5. **A, 25 min — moteur sur Render** (étape 2), avec Privy, **sans** `APP_DEMO_WALLET_SEED`. Preuve : `/healthz` `"role":"leader"` et le log `start checks passed`.
6. **A, 2 min, une minute après 5 — catalogue** (étape 2, point 5). Preuve : le match de samedi a ses instruments actifs.
7. **A, 20 min — web sur Vercel** (étape 4) avec `STRIPE_WEBHOOK_SECRET=whsec_placeholder`. Preuve : `pnpm smoke https://<domaine>` → `4 checks passed`.
8. **T, 10 min — webhook Stripe et domaine de paiement** (étape 5, points 2 à 5), puis A Redeploy. Preuve : POST non signé → `400` ; domaine `active`.
9. **A ou T, 5 min — première connexion** (étape 3, point 5). Preuve : `/api/me` répond 200 avec `authorization: Bearer`.
10. **A et T, 20 min — porte G1 depuis deux téléphones** (étape 6). Preuve : ticket affiché, `buyFor` sur l'explorateur, livraison Stripe en 200, `6 checks passed`.
11. **A, 5 min — Realtime et RLS** (étape 1, point 6), sur la campagne de G1. Preuve : `200` sur `live_instruments`, `42501` sur `users`, une trame WebSocket.
12. **A, pas ce matin — Stream QuickNode** (`docs/quicknode.md`, étape 3) : facultatif, et il use les crédits (vendredi soir au plus tôt).

## Ce qui a été exécuté ici, et ce qui ne l'a pas été

**Rien de cette page n'a été essayé sur un compte** : ni Supabase, ni Render, ni Vercel, ni
Stripe, ni Privy, ni QuickNode hébergés. Chaque commande de preuve est à lancer par vous contre
eux ; c'est pour cela qu'elle est écrite.

Mise à jour du 19 novembre 2026, sans compte : les pages des fournisseurs citées en fin de page
relues ce jour-là (Supabase, Vercel, QuickNode ; Render n'a pas été relu, son étape n'a pas changé
sur ce point) ; `docs.stripe.com` et `docs.privy.io` ne sont pas joignables d'ici, donc chaque
réglage Stripe et Privy est écrit d'après les SDK installés (versions en fin de page) et
accompagné d'une preuve d'une minute, jamais comme une certitude. Exécuté ici ce jour-là :
`pnpm env:check engine --list` et `pnpm env:check web --list` (sortie recopiée aux étapes 2 et 4),
et `pnpm env:check` sur des fichiers aux valeurs factices : `web` est complet avec
`STRIPE_WEBHOOK_SECRET=whsec_placeholder` (étape 4), et `engine` sans Privy ni graine répond
`MISSING APP_DEMO_WALLET_SEED` (étape 2, point 3 : la réponse est Privy, pas la graine). Les
changements du code du 19 novembre (TLS vers la base, attente des connexions inactives côté web,
vérifications de démarrage du moteur, catalogue par ligue) ont été testés en local par leurs
auteurs ; ils n'ont pas été refaits pour cette page.

Exécuté le 18 novembre, en local : l'image du moteur (`apps/engine/Dockerfile`, Docker 29,
contexte = racine du dépôt) contre un Postgres 16 local (les 7 migrations d'alors et le seed) et
une chaîne anvil avec l'escrow de test : `/healthz` répond 200, `docker stop` (SIGTERM) déroule
l'arrêt et le conteneur sort avec le code 0 ; l'image sans variable refuse de démarrer en nommant
chacune ; `pnpm --filter @winz/web build` avec un environnement vide passe ; `next start` avec un
environnement de production (clés factices) contre ce Postgres, puis `pnpm smoke` : toutes les
vérifications passent. Un serveur `node:http` ouvert sans adresse, comme l'écouteur du moteur,
répond sur `127.0.0.1` (Node 22.23.4). Mesuré sur le vrai processus : 160 à 185 Mo au pic du
démarrage, 1,7 s de CPU pour démarrer.

## 0. Avant de commencer

```bash
pnpm install
```

Outils sur le poste : la CLI Supabase (`scoop install supabase` sous Windows, `brew install
supabase/tap/supabase` sous macOS), `psql` (client Postgres) et `curl` pour les vérifications.

Préparer, hors du dépôt, deux fichiers que personne ne commite et que personne ne colle dans une
discussion : `engine.env` et `web.env` (format `NOM=valeur`, une ligne par variable). Ce sont eux
que `pnpm env:check` relit avant chaque collage dans Render ou Vercel.

Pour les preuves qui demandent un secret (`curl` vers Stripe ou Privy), le lire sans l'écrire
dans l'historique du terminal : `read -rs STRIPE_SECRET_KEY && export STRIPE_SECRET_KEY` (coller,
Entrée), et de même pour `PRIVY_APP_SECRET`.

## 1. Supabase (A)

1. **Le projet.** Le créer sur supabase.com s'il n'existe pas. **Région** : la même zone que le
   moteur et les fonctions Vercel, et une région que Render a aussi (Oregon, Ohio, Virginia,
   Frankfurt, Singapore) : par exemple `eu-central-1` avec Render Frankfurt, ou `us-east-1` avec
   Vercel `iad1` et Render Virginia. Noter le mot de passe de la base.

   **S'il existe déjà, vérifier qu'il est vide avant tout.** Le moteur d'essai d'un autre
   développeur a écrit dans la base hébergée la nuit du 18 au 19 novembre. Une base qui garde le
   travail d'une autre chaîne ou d'un autre escrow est refusée par le moteur au démarrage (étape 2,
   point 8), et un moteur qui y tourne encore garde le bail : le vôtre resterait en standby. Dans
   le SQL Editor :

   ```sql
   select (select count(*) from users) as users, (select count(*) from campaigns) as campaigns,
          (select count(*) from chain_txs) as chain_txs, (select count(*) from jobs) as jobs;
   select * from engine_identity;   -- erreur « does not exist » : migration pas encore appliquée
   select holder, renewed_at, expires_at, released_at from engine_lease;
   ```

   Attendu : quatre zéros (ou une erreur « relation does not exist » si rien n'a jamais été
   poussé), aucune ligne d'identité, aucun bail. Un bail dont `renewed_at` a moins d'une minute
   et `released_at` vide : un moteur tourne encore sur cette base, le faire arrêter par celui qui
   l'a lancé avant de continuer. Si la base n'est pas vide, **repartir d'une base vide**, de
   préférence un **nouveau projet** (vide par construction, et rien à effacer) ; sinon, sur le
   projet lié (point 2), `supabase db reset --remote` : la référence actuelle de la CLI dit qu'il
   supprime toutes les entités créées par l'utilisateur dans la base liée puis réapplique les
   migrations (et le seed, sauf `--no-seed`), qu'il imprime une ligne `Target:` et demande une
   confirmation (« No » par défaut). Lire `Target:` avant de répondre. La même page dit aussi
   qu'il demande la pile locale (`supabase start`, qui exige `supabase/config.toml`) : si la
   commande l'exige, prendre le nouveau projet.

2. **Lier le dépôt et appliquer les migrations**, d'abord à blanc :

   ```bash
   supabase login
   supabase link <ref-du-projet>
   supabase db push --remote --dry-run
   supabase db push --remote
   ```

   - **`--remote` est indispensable** : sans lui, `supabase db push` vise la base **locale** ; avec
     lui, le projet lié. La commande écrit sur stderr une ligne `Target:` qui nomme la base visée :
     la lire. `--dry-run` liste, sans rien appliquer, les migrations **qui manquent** à la base
     visée : sur un projet neuf, les **10**, de `20261117000000_init.sql` à
     `20261119020000_engine_identity.sql` ; sur un projet déjà utilisé, seulement celles qu'il n'a
     pas encore (aucune si tout y est). La dernière est exigée par le moteur : sans elle il refuse
     de démarrer (étape 2, point 8). Le vrai `push` liste ce qu'il va faire et demande une
     confirmation (« No » par défaut). Ce qui compte n'est pas le nombre listé ici mais les 10
     versions du point 3, après le `push`.
   - `pnpm db:migrate` lance `supabase db push` sans `--remote` : `pnpm db:migrate --remote` le lui
     passe. `supabase link --project-ref <ref>` marche encore. Avec une CLI ancienne qui ne
     connaîtrait pas `--remote`, `--linked` (déprécié en v3, retiré en v4) fait la même chose.
   - **Le dépôt n'a pas de `supabase/config.toml`.** La référence de la CLI ne l'exige que pour
     `start` et `stop` et ne dit rien pour `link` ou `db push`. Si l'une des deux commandes se
     plaint de `config.toml` ou demande `supabase init` : lancer `supabase init` à la racine
     (répondre No aux questions d'éditeur), relancer, et ne pas commiter le fichier créé sans en
     parler (il change le comportement local de la CLI pour tout le monde).
   - **Le seed n'est pas nécessaire** : il crée un commerçant de démo (une adresse e-mail
     d'exemple, qui ne pourra jamais se connecter), le match de samedi et quatre de ses instruments,
     aucune campagne. Le premier passage du catalogue du moteur crée le même match avec tous ses
     instruments (étape 2, point 5), et garde actifs les quatre du seed. Pour l'appliquer quand
     même : `pnpm db:seed` (il lit `DB_URL`, point 4).

3. **Preuve.** `pnpm db:test` ne vise jamais le projet hébergé : il démarre son propre Postgres
   jetable (et il passe en CI). Sur le projet hébergé, seulement des lectures, dans le SQL Editor
   ou avec `psql "$DB_URL"` :

   ```sql
   -- 10 lignes, une par fichier de supabase/migrations, la dernière 20261119020000.
   select version from supabase_migrations.schema_migrations order by version;
   -- Aucune table publique sans RLS : doit répondre 0 ligne.
   select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
   -- Realtime publie exactement live_campaigns, live_hedge_desk, live_instruments.
   select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;
   -- Les deux tables du moteur existent (aucune ligne avant son premier démarrage).
   select * from engine_lease; select * from engine_identity;
   ```

   Si la publication ne répond rien, elle n'existait pas quand la migration a tourné : `alter
   publication supabase_realtime add table public.live_instruments, public.live_campaigns,
   public.live_hedge_desk;` (Database → Publications, ligne `supabase_realtime`, montre et bascule
   la même chose table par table).

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

   Remplacer `[YOUR-PASSWORD]` (ou `[YOUR-DATABASE-PASSWORD]`) par le mot de passe du point 1, en
   encodant les caractères réservés (`&`, `#`, `?`, espace).

   - **TLS : rien à ajouter à l'URL.** Les deux clients (`apps/engine/src/db.ts`,
     `apps/web/lib/server/db.ts`) exigent TLS pour tout hôte qui n'est pas local : ils demandent
     le chiffrement avant tout et refusent de continuer si le serveur ne l'accepte pas ; le
     certificat n'est pas vérifié (comme `sslmode=require`, le mode que Supabase documente pour son
     pooler). Un `sslmode=` dans `DB_URL` l'emporte : `sslmode=disable` couperait TLS, ne pas
     l'écrire. Vérifier aussi le certificat demanderait `sslmode=verify-full&sslrootcert=<fichier>`
     avec le certificat racine de Supabase présent sur l'hôte : pas fait ici. Supabase accepte par
     défaut les connexions sans TLS ; **Database → Settings → SSL Configuration → « Enforce SSL on
     incoming connections »** les refuse, pour le pooler partagé aussi (sur ses deux tronçons).
     L'activer est facultatif et sans danger pour ces deux services ; Supabase prévient que
     l'activer redémarre la base (« fast database reboot », quelques secondes sur un petit
     projet) : le faire avant le moteur, ou accepter que `/healthz` réponde 503 quelques secondes.
     C'est aussi la preuve que les deux services chiffrent : avec ce réglage actif, `pnpm smoke`
     (étape 4) et `/healthz` (étape 2) passent encore.

   - **Moteur (Render) et web (Vercel) : tous les deux le session pooler** (port 5432 de l'hôte
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
       une connexion du pool (15 par défaut sur l'instance gratuite).
       - **Le moteur** garde ouvertes celles qu'il a ouvertes (son client n'a pas de délai
         d'inactivité) : régler **`DB_POOL_MAX=8` sur Render**. Un standby en ouvre 2 au plus :
         sa demande de bail, une par seconde, et la sonde de `/healthz` peuvent se croiser ; ses
         vérifications de démarrage (étape 2, point 8) passent une par une avant.
       - **Le web** en prend **3 par instance** au plus (`DB_POOL_MAX`, défaut 3) et ferme une
         connexion inutilisée après **5 s**. Vercel gèle une instance juste après sa réponse, et
         un client gelé ne ferme rien (le minuteur ne tourne pas) : chaque route API garde donc
         son instance éveillée après sa réponse (`after`, c'est-à-dire `waitUntil`) jusqu'à ce que
         ses connexions soient fermées, **6 s au plus** (5 s plus 1 s de marge). Une instance
         gelée, ou celle d'un déploiement remplacé, ne garde donc aucune connexion plus de 6 s
         après sa dernière réponse. Les connexions du web portent le nom `winz-web` dans
         `pg_stat_activity` (celles du moteur : `postgres.js`).
     - Le compte, au plus, avec **deux instances web actives** (une instance n'est comptée que
       pendant ses requêtes et les 6 s qui suivent) et le second moteur du Mac de l'étape 2
       (point 1) :

       | Moment | Moteurs | Web | Total |
       | --- | --- | --- | --- |
       | Render leader, rien d'autre | 8 | 6 | 14 |
       | Render leader, Mac en standby | 8 + 2 | 6 | 16 |
       | déploiement Render : l'ancien leader vit 60 s à côté du nouveau standby (étape 2, point 4) | 8 + 2 | 6 | 16 |
       | déploiement Render pendant que le Mac tourne en standby | 8 + 2 + 2 | 6 | 18 |
       | Mac leader, Render en standby | 6 + 2 | 6 | 14 |
       | Mac leader pendant un déploiement Render (deux standbys Render) | 6 + 2 + 2 | 6 | 16 |
       | déploiement Vercel, au pire : les instances de l'ancien déploiement finissent leurs requêtes (et leurs 6 s) pendant que celles du nouveau commencent | 8 | 6 + 6 | 20 |
       | un push sur `main` redéploie Render **et** Vercel : si les deux se croisent | 8 + 2 | 6 + 6 | 22 |

       Et pendant la passation elle-même, quelques secondes : l'ancien leader ferme sa base
       après avoir libéré le bail (5 s au plus pour `db.end`) pendant que le nouveau démarre ses
       services et ouvre les siennes à la demande, jusqu'à 8 + 8 (+ 2 pour le Mac) + 6 = 24 ;
       et **28** (30 avec le Mac) si cette passation tombe pendant un déploiement Vercel, ce
       qu'un seul push sur `main` peut produire puisqu'il redéploie les deux.
       Au-delà de la taille du pool, le pooler refuse les nouveaux clients (« max clients »,
       `53300`), parfois après une attente : la requête du web pend, puis échoue. Les 15 par
       défaut ne suffisent donc pas, même sans le Mac : un simple déploiement les dépasse.
       **Avant le premier déploiement du moteur, porter la taille du pool à 30**, dans
       **Database → Settings → Connection pooling** : le pire compte ci-dessus (28, 30 avec le
       Mac) y tient, et c'est la moitié des 60 connexions Postgres de l'instance gratuite (la
       documentation de Supabase conseille de rester sous 40 % quand l'API PostgREST est très
       utilisée, ce qui n'est pas le cas ici, et jusqu'à 80 % sinon ; la taille vaut par
       utilisateur de base, et le moteur et le web se connectent avec le même).
       Si ce réglage n'a pas pu être changé : `DB_POOL_MAX=6` sur Render aussi (un déploiement
       fait alors 6 + 2 + 6 = 14) et le Mac arrêté avant tout push sur `main` (sinon 16) ; la
       passation, quelques secondes, peut encore monter à 6 + 6 + 6 = 18 (24 si elle croise un
       déploiement Vercel) et refuser une requête du web à ce moment-là. Plus de deux instances web actives ajoutent 3 chacune.
     - **Vérification après un redéploiement du web** (deux minutes après, dans le SQL Editor) :

       ```sql
       select application_name, state, count(*), max(now() - state_change) as idle_for
       from pg_stat_activity where usename like 'postgres%' group by 1, 2 order by 1, 2;
       ```

       Une ligne `winz-web` `idle` dont `idle_for` dépasse 6 s, alors que personne n'utilise
       l'application, veut dire que l'attente ne marche pas sur cette plateforme : le dire avant
       la démo (chaque instance gelée garderait jusqu'à 3 connexions). Les lignes `postgres.js`
       sont le moteur (8 au plus pour le leader).
     - Si les logs de Vercel montrent des refus de connexion (« max clients », `53300`), c'est ce
       plafond : vérifier la taille du pool et la requête ci-dessus, pas le mode.
     - La connexion directe n'est pas possible depuis Render : elle est en IPv6 seulement sur
       l'offre gratuite, et Render « doesn't support outbound IPv6 » (étape 2, point 3).

5. **`NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`**, pour Vercel. La boîte
   **Connect** affiche l'URL `https://<ref>.supabase.co` et la clé publiable ; toutes les clés sont
   sous **Settings → API Keys**. **Le nom diffère** : l'extrait que Connect propose pour Next.js
   appelle la clé `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, le code lit
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Mettre la valeur **publishable** (`sb_publishable_…`) sous le
   nom `NEXT_PUBLIC_SUPABASE_ANON_KEY` (ou, à défaut, l'ancienne clé `anon`, un JWT `eyJ…` ;
   Supabase retire `anon` et `service_role` d'ici fin 2026). Jamais une clé **secret**
   (`sb_secret_…`) ni `service_role` : elles passent outre la RLS ; `pnpm env:check web` refuse
   une valeur `NEXT_PUBLIC_*` qui a la forme d'un secret.

   **Ces deux variables sont lues** : `apps/web/lib/realtime/use-live-odds.ts` s'en sert pour
   recevoir les cotes en direct (Supabase Realtime, table `live_instruments`) sur la page de
   campagne et le ticket. Sans elles, ou sous un autre nom, rien ne casse visiblement : chaque page
   ouverte interroge l'API toutes les 2 s au lieu de recevoir les cotes. `pnpm env:check web` ne
   les exige pas (il les signale en `note`, « front-end build-time variable ») : les vérifier à
   l'œil, et prouver le flux au point 6.

6. **Preuve du temps réel et de la RLS** (après l'étape 6, sur la campagne qu'elle a créée). Avec
   `URL` et `KEY` les deux valeurs du point 5 :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$URL/rest/v1/live_instruments?select=symbol&limit=1" -H "apikey: $KEY"
   curl -s "$URL/rest/v1/users?select=id&limit=1" -H "apikey: $KEY"
   ```

   Attendu : `200`, puis une erreur dont `code` est `42501` (permission refusée : la clé
   publique ne lit aucune table privée). Puis, sur un ordinateur, ouvrir la page publique d'une
   campagne en ligne (`/c/<slug>`, étape 6) avec les outils de développement → Network → filtre
   **WS** ; dans le SQL Editor :

   ```sql
   update live_instruments set observed_at = now() where symbol = '<symbole de la promo>';
   ```

   Une trame `postgres_changes` doit arriver sur la WebSocket de Supabase, et les requêtes vers
   `/api/c/<slug>` passer d'une toutes les 2 s à une interrogation lente. Rien sur la WebSocket :
   les deux variables manquent ou sont fausses (le flux ne démarre pas), ou la publication du
   point 3 est vide.

## 2. Le moteur sur Render (A)

Ce qui est dans le dépôt : `apps/engine/Dockerfile` (Node 22, pnpm 10.28.0 par corepack,
installation `--frozen-lockfile` filtrée sur le moteur, utilisateur non root, `node --import tsx
src/index.ts` sans shell, donc SIGTERM arrive au moteur) et `.dockerignore`. Le moteur n'a pas
d'étape de build : il exécute ses sources TypeScript avec tsx. Le service Render est un **web
service** (le seul type de service à processus qui existe en instance gratuite : les autres
types gratuits sont le site statique, Postgres et Key Value ; et le seul qui a un contrôle de
santé HTTP) construit depuis ce Dockerfile ; tous ses réglages se font dans le formulaire de
création, ci-dessous.

Pas de `render.yaml` (Blueprint) : le seul réglage qu'il poserait et que le tableau de bord ne
pose pas est le délai d'arrêt (`maxShutdownDelaySeconds`), dont le défaut de 30 s suffit
(point 4), et la documentation des Blueprints ne dit pas si leur création demande une carte, ce
que le formulaire ne fait pas pour une instance gratuite.

Pour suivre la page sans se tromper de nom : depuis le 26 août 2026, Render appelle les
« instance types » des **compute plans** et leur donne des identifiants tirés de leurs specs.
L'ancienne **Starter** s'appelle `0.5c-512mb` (mêmes specs, même prix) ; **Free** garde son nom
(`free`). L'écran peut montrer l'un ou l'autre nom.

Avant cette étape : l'endpoint QuickNode (`docs/quicknode.md`, étapes 1 et 2 : il donne
`ARC_RPC_URL`), les deux valeurs Privy de Téo (étape 3) et sa clé `sk_test_` (étape 5, point 1).

1. **Quelle instance.** Deux façons, avec leurs vrais pièges :

   | | Starter (`0.5c-512mb`) | Free (`free`) |
   | --- | --- | --- |
   | CPU, mémoire | 0,5 CPU, 512 Mo | 0,1 CPU, 512 Mo |
   | Prix | 7 $ par mois, facturé à la seconde | 0 $ |
   | Carte | non documenté : l'écran du choix de l'instance le dira | aucun paiement demandé (« No payment is required », tutoriel du premier déploiement) |
   | Mise en veille | jamais | après 15 min sans trafic **entrant** |
   | Redémarrage imposé | aucune clause ; une instance malade peut être remplacée | « Render might restart a Free web service at any time » |

   **Recommandé pour une démo jugée : Starter.** Coût du jeudi 19 novembre au samedi 21 au
   soir : le prix est 7 $ par mois « prorated by the second », et la page des prix ne dit pas sur
   quelle durée de mois elle divise. Sur les 720 heures de novembre : créé jeudi 19 à 8 h,
   supprimé samedi 21 à 22 h, c'est 62 h, soit 7 × 62 / 720 = **0,60 $** ; trois jours entiers
   (72 h) font 7 × 72 / 720 = **0,70 $** au plus (0,68 $ sur un mois de 744 h). L'espace de
   travail Hobby coûte 0 $ par mois en plus de ce calcul. La facture court tant que le service
   existe : après la démo, le supprimer ou repasser son compute plan à `free` (page Compute),
   sinon c'est 7 $ par mois.
   Si une carte est ajoutée, Render la vérifie par une transaction de 1 $ remboursée (FAQ de la
   page des prix).

   **Free avec un pinger extérieur** (0 $, sans carte) : un service de surveillance hors de
   Render appelle `/healthz` toutes les 5 minutes pour empêcher la mise en veille (point 6).
   Trois risques, à accepter en connaissance de cause :
   - **il dort si le pinger s'arrête** : Render endort une instance Free après 15 minutes sans
     requête HTTP ni message WebSocket entrant ; le trafic que le moteur émet lui-même (base,
     nœud, Gemini) ne compte pas. Endormi, le moteur ne fait plus rien : ni transaction, ni
     couverture, ni job (les jobs attendent dans leur table). Le web ne l'appelle jamais (ils
     passent par Postgres), donc rien d'autre que le pinger ou un `curl` ne le réveille, et le
     réveil prend « about one minute » ;
   - **0,1 CPU** pour un moteur dont les minuteries tournent toutes les 100 à 250 ms (sonde des
     ordres de couverture toutes les 100 ms, chargeur toutes les 200 ms, lecteur d'événements
     espacé de 250 ms) en plus du flux WebSocket des carnets Gemini et d'un catalogue qui
     télécharge environ 1 400 événements par minute (point 5). Mesuré ici sur le vrai processus
     (trois démarrages courts) : 1,7 s de CPU pour démarrer, soit de l'ordre de 17 s à 0,1 CPU si
     Render plafonne strictement (estimation, pas une mesure) ; l'état stable n'a pas été mesuré ;
   - **la clause de suspension** : « Render may suspend a Free web service that initiates an
     uncommonly high volume of traffic over the public internet », avec comme exemples
     « Accessing an external database » et « Invoking external APIs ». C'est exactement ce que
     fait le moteur : Supabase toutes les secondes au moins (bail), le nœud Arc jusqu'à 10
     requêtes par seconde, Gemini (des pages de plusieurs Mo chaque minute). La documentation ne
     chiffre pas « uncommonly high ».

   La sortie documentée, pour les trois : changer le compute plan **du même service** (page
   **Compute** du service → Compute → Edit → `0.5c-512mb`, Save). Render redéploie aussitôt, sans
   interruption pour un service sans disque, même URL, mêmes variables. Un service suspendu pour
   la clause de trafic se rétablit de la même façon (« you can restore it by moving it to any
   paid compute plan »). Les heures gratuites, 750 par espace de travail et par mois, couvrent un
   service allumé tout le mois (744 h au plus) s'il est le seul service Free de l'espace.

   **Le Mac à côté, pas à la place.** Le Mac d'Alexandre peut faire tourner un second moteur sur
   la même base de production, en plus de celui de Render : c'est sans danger pour l'exclusivité,
   parce que seul le détenteur du bail travaille (point 4), l'autre attend en
   standby sans aucun service démarré. Il prend la main quand celui de Render s'arrête (mise en
   veille, redémarrage, déploiement : celui qui demande le bail le premier le prend). Depuis
   `apps/engine`, avec une copie de `engine.env` (hors du dépôt, étape 0) où `DB_POOL_MAX=6`, et
   Node 22 ou plus :

   ```bash
   caffeinate -is node --env-file=<chemin>/engine-mac.env --import tsx src/index.ts
   ```

   **Mac sur secteur, couvercle ouvert, tant que ce moteur tourne.** `caffeinate -i` n'empêche
   que la veille pour inactivité, et `-s` n'agit que sur secteur ; ni l'un ni l'autre n'empêche
   la veille quand on ferme le couvercle. Or un processus gelé plus longtemps que le bail ne
   peut pas s'arrêter de lui-même : si le Mac s'endort pendant qu'il est leader, Render reprend
   le bail, et au réveil ce que le Mac faisait au moment du gel se termine à côté du nouveau
   leader, ordres de couverture compris, qui ne sont pas protégés contre un doublon (point 4,
   « Ce que le bail ne couvre pas »). Un Mac qui s'est endormi en leader : Ctrl-C dès le réveil,
   puis vérifier dans le sandbox Gemini qu'aucune exposition n'a été couverte deux fois. Ctrl-C
   l'arrête proprement et libère le bail.

   `DB_POOL_MAX=6` (le minimum accepté) parce que ses connexions comptent dans le pool Supabase :
   le compte complet, avec et sans le Mac, pendant un déploiement ou non, et la taille de pool à
   régler pour qu'il tienne, sont à l'étape 1, point 4. Jamais le Mac seul : il dort, il change
   de réseau, et la démo dépendrait d'un portable.

2. **Créer le web service** : tableau de bord Render → **New** → **Web Service** → **Git
   Provider** (connecter GitHub si ce n'est pas fait) → ce dépôt. Le formulaire :

   | Champ | Valeur | Pourquoi |
   | --- | --- | --- |
   | Name | `winz-engine` (libre) | l'URL `onrender.com` du service reprend ce nom |
   | Language | **Docker** | construit l'image depuis le Dockerfile du dépôt |
   | Branch | **`main`** | le code est sur `main` |
   | Region | celle de Supabase, voir sous le tableau | elle ne peut plus changer après la création |
   | Root Directory | **vide** | les fichiers hors de ce dossier ne sont pas disponibles au build ; l'image a besoin de la racine (`pnpm-lock.yaml`, `packages/`) |
   | Dockerfile Path | `apps/engine/Dockerfile` | relatif au Root Directory, donc à la racine |
   | Docker Build Context Directory | `.` (la racine, le défaut) | le Dockerfile copie depuis la racine du dépôt |
   | Docker Command (Advanced) | vide | Render lance alors le `CMD` du Dockerfile |
   | Compute plan | `0.5c-512mb` (Starter) ou `free`, point 1 | |
   | Environment Variables (Advanced) | point 3 | |
   | Health Check Path (Advanced) | **`/healthz`** | sans lui, Render ne vérifie qu'une connexion TCP |
   | Auto-Deploy (Settings, après la création) | **After CI Checks Pass** | voir sous le tableau |
   | Build Filters (Settings → Build & Deploy) | facultatif, voir sous le tableau | |

   - **Region** : les régions de Render sont Oregon, Ohio, Virginia, Frankfurt et Singapore.
     La région du projet Supabase se lit dans l'hôte du pooler de sa boîte **Connect**
     (`aws-<index>-<région>.pooler.supabase.com`, étape 1, point 4) : `eu-central-1` → Frankfurt,
     `us-east-1` → Virginia, `us-east-2` → Ohio, `us-west-1` ou `us-west-2` → Oregon,
     `ap-southeast-1` → Singapore. Chaque requête du moteur traverse Internet jusqu'à Supabase :
     la région la plus proche raccourcit chacune.
   - **Auto-Deploy** : le défaut est **On Commit** (chaque push sur `main` déploie). Avec
     **After CI Checks Pass**, Render attend que les vérifications GitHub du commit aient
     réussi, et ne déploie pas si l'une échoue ; la CI du dépôt (`.github/workflows/ci.yml`)
     tourne sur chaque push sur `main`. Render ne déploie pas non plus un commit sans aucune
     vérification : si un push sur `main` ne déploie pas, c'est la cause probable, revenir à On
     Commit. Dans les deux cas, **appliquer les migrations avant de pousser** (point 4).
     `[skip render]` dans le message d'un commit empêche son déploiement.
   - **Build Filters**, pour ne pas redéployer le moteur pour un commit du web seul : chemins
     inclus `apps/engine/**`, `packages/shared/**`, `packages/pricing/**`, `package.json`,
     `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.dockerignore`,
     `apps/web/package.json`, `packages/contracts/package.json` (les deux derniers : le
     Dockerfile les copie pour que `--frozen-lockfile` vérifie le lockfile de tout le workspace).
     Ils sont relatifs à la racine du dépôt et ne jouent que sur les déploiements automatiques.
   - Le Dockerfile ne déclare aucun `ARG` : Render passe chaque variable d'environnement comme
     argument de build, mais aucune n'entre dans l'image, qui ne contient ni `.env` ni secret.

   **Create Web Service** lance le premier build et le premier déploiement (page **Deploys**).
   Le premier déploiement passe seulement si les variables sont posées (point 3) et les
   10 migrations appliquées (étape 1).

3. **Variables d'environnement**, à partir de `engine.env`, vérifié d'abord :

   ```bash
   pnpm env:check engine --file engine.env
   ```

   La commande doit finir par `result: complete for the engine`. Si elle répond `MISSING
   APP_DEMO_WALLET_SEED … required when Privy is not configured`, **la réponse est d'ajouter les
   deux variables Privy, pas la graine** (ci-dessous). Puis, sur la page **Environment** du
   service (le formulaire de création a aussi une section Environment Variables sous Advanced,
   que la documentation ne détaille pas) : **Add from .env** et choisir `engine.env`, qui ajoute
   toutes ses lignes d'un coup (syntaxe `.env` : `NOM=valeur`, guillemets si la valeur contient
   un espace), ou **+ Add Environment Variable** une par une. À l'enregistrement, **Save,
   rebuild, and deploy** (ou **Save and deploy**) applique ; **Save only** attend le prochain
   déploiement. Un **Restart service** reprend la configuration du déploiement en cours, sans les
   variables changées depuis.

   - **`PORT` : ne pas le mettre.** Render le fixe à 10000 pour tout web service, et le moteur
     ouvre son écouteur `/healthz` sur `PORT` : c'est le port que Render sonde et vers lequel il
     envoie les requêtes.
   - **Secrets** (aucune valeur dans une discussion, une issue ou un commit) : `DB_URL` (contient
     le mot de passe), `ARC_RPC_URL` (le jeton QuickNode est dans le chemin),
     `ARC_RELAYER_PRIVATE_KEY`, `ARC_ORACLE_PRIVATE_KEY`, `APP_ADMIN_DEMO_KEY`,
     `STRIPE_SECRET_KEY`, `PRIVY_APP_SECRET`, `GEMINI_SANDBOX_API_KEY`,
     `GEMINI_SANDBOX_API_SECRET`. La documentation de Render ne montre pas de case « secret » :
     toutes les variables se posent de la même façon.
   - **`DB_URL` : le session pooler de Supabase** (étape 1, point 4 : port 5432 de l'hôte
     `aws-<index>-<région>.pooler.supabase.com`, utilisateur `postgres.<ref>`), recopié tel quel
     (TLS est exigé par le client, étape 1, point 4). Render ajoute une raison d'écarter la
     connexion directe : il « doesn't support outbound IPv6 » (son article sur Supabase), et la
     connexion directe de Supabase est en IPv6 seulement sans le module IPv4 payant. Le même
     article recommande le session pooler pour un processus long. `DB_POOL_MAX=8`, avec la
     taille du pool Supabase portée à 30 (étape 1, point 4).
   - **Privy : `NEXT_PUBLIC_PRIVY_APP_ID` et `PRIVY_APP_SECRET`, les mêmes valeurs que sur
     Vercel** (étape 3). Le moteur s'en sert pour créer, à partir de l'e-mail, l'utilisateur et
     le portefeuille d'un fan qui paie, et pour trouver le portefeuille d'un commerçant.
   - **`APP_DEMO_WALLET_SEED` : ne pas le mettre.** Sans Privy, le moteur crée pour chaque
     acheteur un utilisateur `demo:<…>` avec un portefeuille dérivé de la graine. Or le web
     n'existe qu'avec Privy : quand cette personne se connecte ensuite avec son e-mail, la ligne
     garde l'identifiant `demo:`, différent de celui de Privy, et `/api/me` répond `409` « This
     e-mail belongs to another account » ; le front la déconnecte. Ajouter Privy au moteur plus
     tard ne répare pas ces lignes, et leurs remboursements sont partis vers un portefeuille que
     seul le moteur détient. Si le moteur a déjà tourné sur cette base avec la graine : `select
     count(*) from users where privy_id like 'demo:%'` doit répondre 0 avant d'ouvrir les
     connexions, sinon repartir d'une base vide (étape 1, point 1).
   - Valeurs : `APP_ENV=production` ; `ARC_ESCROW_ADDRESS` et `ARC_ESCROW_DEPLOY_BLOCK` depuis
     `packages/contracts/deployments/5042002.json` (ne rien redéployer) ; `ARC_RPC_URL` le point
     d'accès QuickNode d'Arc testnet (`docs/quicknode.md` ; `ARC_RPC_FALLBACK_URL` reste le RPC
     public par défaut) ; `ARC_RELAYER_PRIVATE_KEY` et `ARC_ORACLE_PRIVATE_KEY` les clés des deux
     rôles de cet escrow (le moteur refuse de démarrer sinon, point 8) ; `APP_ADMIN_DEMO_KEY` la
     même valeur que sur Vercel ; `STRIPE_SECRET_KEY` la même `sk_test_` que Vercel.

   **La liste fait foi telle que `pnpm env:check engine --list` l'imprime** (elle est tirée du
   schéma que le moteur valide au démarrage) ; sa sortie le 19 novembre 2026 :

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
   rejouées par le mode démo (il le dit au démarrage : `Stripe is not configured`), et le schéma
   exige Privy (les deux variables ensemble) ou la graine ; ici, **Privy**. Pour la porte G1, les
   deux sont requis. Au démarrage, `Privy is not configured: buyers get demo wallets` dans les
   logs veut dire que la graine a été posée à la place de Privy : corriger avant toute vente.
   `APP_HTTPS_PROXY_URL` et `APP_PROXY_CA_FILE` restent vides : ils ne servent que derrière un
   proxy sortant, et Render n'en impose aucun.

4. **Une seule instance, et ce qu'un déploiement fait au moteur.** Render lance une instance
   par service par défaut (page **Compute** → Manual Scaling ; une instance Free ne peut pas en
   avoir plus) : la laisser à 1. Le moteur détient les nonces de deux clés, le seul worker des
   transactions, une couverture par instrument et le chargeur des couvertures : deux moteurs au
   travail sur la même base se disputeraient les nonces et couvriraient deux fois la même
   exposition. Le code l'empêche par un **bail** (table `engine_lease`, une ligne, décidé sur
   l'horloge de la base, en requêtes d'une seule instruction qui marchent derrière n'importe quel
   pooler ; `apps/engine/README.md`, « One engine per database ») :
   - un moteur démarre en **standby** : il a validé ses variables, joint la base, passé ses
     vérifications de démarrage (point 8), il n'a démarré aucun service (ni expéditeur, ni
     worker, ni couverture, ni règlement, ni lecteur), et il demande le bail tout de suite puis
     chaque seconde. Dès qu'il l'a, il refait les vérifications, démarre le moteur et le renouvelle
     toutes les 3 s (`ENGINE_LEASE_RENEW_MS`) pour 15 s (`ENGINE_LEASE_TTL_MS`) ;
   - s'il ne peut plus le renouveler (base injoignable), il arrête ses services de lui-même après
     10 s sans renouvellement (15 s moins 5 s de marge pour l'arrêt) et redevient standby ; si
     cet arrêt n'a pas fini 1 s avant que le bail puisse expirer, le processus s'arrête (code 1),
     voir plus bas ; si le bail est au nom d'un autre, il s'arrête tout de suite ;
   - au SIGTERM, il arrête ses services, puis libère le bail : le standby prend la main à son
     interrogation suivante, sans attendre l'expiration.

   **Les migrations d'abord, à chaque fois : avant de déployer le moteur, et avant chaque push
   qui en ajoute une.** Un push sur `main` redéploie le moteur tout seul, alors que les
   migrations s'appliquent à la main (`supabase db push --remote`). Un moteur déployé sans
   `engine_identity` s'arrête au démarrage (`engine could not start: engine_identity cannot be
   read (is every migration applied?)`, code 1) ; sans `engine_lease`, il reste un standby dont
   chaque demande de bail échoue et dont `/healthz` répond 503. Dans les deux cas Render
   n'envoie aucun trafic à la nouvelle instance, annule le déploiement au bout de 15 minutes et
   garde l'ancienne. Vérifier avant de pousser : `select 1 from engine_lease; select 1 from
   engine_identity;` répond sans erreur.

   **Un déploiement**, dans l'ordre que décrit la documentation de Render (« Zero-downtime
   deploys »), avec le bail :
   1. Render construit l'image ; si le build échoue, l'ancienne instance continue.
   2. Il démarre la nouvelle instance : un standby, dont `/healthz` répond 200 avec
      `"role":"standby"` dès qu'il joint sa base, son nœud et le bail. Render envoie des
      contrôles de santé (réussis s'ils répondent 2xx ou 3xx en moins de 5 s) et, quand ils
      passent, bascule le trafic entrant vers elle. L'ancienne travaille toujours.
   3. **60 secondes après**, Render envoie SIGTERM à l'ancienne. Elle arrête ses services, libère
      le bail, ferme son écouteur puis sa base, et sort avec le code 0.
   4. Le nouveau prend le bail à sa demande suivante, dans la seconde (mesuré en local : 0,2 s
      entre l'arrêt des services de l'ancien et le démarrage de ceux du nouveau). À aucun moment
      deux moteurs n'ont leurs services en marche (les tests de `apps/engine/src/leader` le
      vérifient, avec deux moteurs réels et deux processus réels).
   5. Si l'ancienne n'est pas sortie après le **délai d'arrêt (30 s par défaut)**, Render
      envoie SIGKILL.

   Les nombres, les uns contre les autres : l'arrêt du vrai processus mesurait 0,5 à 3,1 s
   (table de `apps/engine/README.md`, avant le catalogue par ligue), dominé par la requête de
   catalogue Gemini en cours, qui n'est pas interrompue et peut durer 10 s ; un passage du
   catalogue fait maintenant environ 27 requêtes (21 à 43 s mesurés) mais un arrêt le termine
   entre deux requêtes, donc une seule requête au plus est attendue. Quoi qu'il arrive,
   `src/index.ts` sort au plus tard **15 s** après le SIGTERM (`SHUTDOWN_GRACE_MS`). Les 30 s par
   défaut de Render le couvrent avec 15 s de marge : **rien à régler**. La documentation ne donne
   que deux façons de le changer, l'API de Render ou un `render.yaml` (`maxShutdownDelaySeconds`,
   1 à 300 s), aucune dans le tableau de bord. Pendant les 60 s où l'ancienne et la nouvelle
   instance tournent ensemble (3. ci-dessus), chacune a ses connexions à la base : c'est pour
   elles que la taille du pool Supabase passe à 30 (étape 1, point 4). Un SIGKILL ne libérerait
   pas le bail : le nouveau attendrait alors son expiration, 15 s au plus.

   **Sur une instance Free** : la documentation applique ce déroulé à tous les web services et
   n'en exclut que les services avec un disque persistant ; elle ne dit rien de particulier pour
   Free, rien n'a été essayé. Si l'ancienne instance était arrêtée avant que la nouvelle démarre,
   il y aurait un trou de quelques secondes (le démarrage du nouveau, plus long à 0,1 CPU) sans
   aucun moteur au travail : sans danger, puisque l'ancien a libéré le bail en s'arrêtant et que
   le nouveau le prend dès sa première demande ; pendant le trou, les jobs attendent dans leur
   table et rien n'est envoyé deux fois.

   **Contrôles de santé en continu.** Render sonde aussi les instances en marche, toutes les
   quelques secondes : après 15 s d'échecs il cesse de leur envoyer du trafic, après **60 s il
   redémarre l'instance**. Le leader répond 503 quand sa base ou son nœud ne répond pas en 2 s :
   une panne de Supabase, ou de QuickNode et du RPC public ensemble, de plus d'une minute
   redémarre donc le moteur. Sans danger avec le bail (l'instance arrêtée libère le bail ; base
   injoignable, elle avait déjà arrêté ses services au bout de 10 s), mais un redémarrage
   pendant que la base ne répond toujours pas finit en `engine could not start: the database
   does not answer` (code 1). Render suspend un service qui « repeatedly fails to start and
   become healthy over a 24-hour period » (page des notifications).

   **Sortie avec le code 1.** Le moteur sort avec le code 1 quand un arrêt sur bail perdu reste
   bloqué (README, « Self-fencing »), quand une variable manque, quand la base ne répond pas au
   démarrage, ou quand une vérification de démarrage échoue (point 8). Render inscrit un
   événement `Instance Failed` avec le code de sortie dans la page **Events**, et « automatically
   manages the instance lifecycle » ; il ne publie ni délai ni nombre d'essais pour relancer un
   processus sorti. Le moteur relancé repart en standby.

   Ce que le bail ne couvre pas : un processus gelé plus longtemps que le bail (machine
   suspendue) ne peut pas s'arrêter de lui-même ; à son réveil il s'arrête au premier tour de
   minuterie, mais ce qu'il faisait au moment du gel se termine. Les nonces (index unique
   `(signer_address, chain_id, nonce)`, passage à `sent` sous `where status = 'queued'`), les
   jobs (`for update skip locked`, verrou consultatif par sujet, clés d'idempotence) et les
   charges de couverture (clés de lot, refus `HedgeAlreadyCharged` de l'escrow) restent protégés ;
   les ordres de couverture ne le sont pas (deux couvertures peuvent acheter pour la même
   exposition).

5. **Preuve.** Page **Logs** du service (ou **Deploys** → le déploiement). Un bon premier
   démarrage ressemble à ceci (lignes d'un démarrage local, adresses remplacées ; sur Render, le
   port est 10000) :

   ```text
   {"level":"info","module":"leader","holder":"eng-…","ttlMs":15000,"renewMs":3000,"standbyPollMs":1000,"fenceAfterMs":10000,"msg":"standby: no service runs until this engine holds the lease"}
   {"level":"info","module":"health","port":8080,"path":"/healthz","msg":"health listener started"}
   {"level":"info","module":"leader","holder":"eng-…","msg":"lease acquired: starting the engine"}
   {"level":"info","module":"engine","chainId":5042002,"escrow":"0x…","relayer":"0x…","oracle":"0x…","identityRecordedAt":"…","msg":"start checks passed: this database is now recorded for this chain and escrow"}
   {"level":"info","module":"tx-sender","chainId":5042002,"relayer":"0x…","oracle":"0x…","escrow":"0x…","msg":"transaction sender started"}
   {"level":"info","module":"chain-ingest","escrow":"0x…","fromBlock":"72727350","cursor":"escrow-logs:0x…","msg":"chain ingest started"}
   {"level":"info","module":"hedging","venue":"paper","label":"PAPER · live Gemini book","msg":"hedging started"}
   {"level":"info","module":"settlement","escrow":"0x…","intervalMs":15000,"msg":"settlement watcher started"}
   {"level":"info","module":"jobs","workerId":"engine-…","concurrency":4,"msg":"job worker started"}
   {"level":"info","module":"engine","chainId":5042002,"venue":"paper","msg":"engine running"}
   {"level":"info","module":"leader","holder":"eng-…","msg":"engine running under the lease"}
   ```

   La ligne `start checks passed` est nouvelle : au premier démarrage sur une base vide elle finit
   par `this database is now recorded for this chain and escrow` (la ligne `engine_identity` est
   écrite), aux suivants par `the keys are the escrow's relayer and oracle, the database is this
   chain's and escrow's`. Pendant un déploiement, la nouvelle instance écrit d'abord `standby: the
   lease is held by another engine` (avec l'identifiant de l'ancien), puis, une soixantaine de
   secondes plus tard, `lease acquired: starting the engine`. L'ancienne finit par `engine
   services stopped`, `lease released`, `health listener stopped`.

   Sur le plan Free de QuickNode, un avertissement du module `rpc` est attendu peu après : `ARC_RPC_URL
   did not serve eth_getLogs: ARC_RPC_FALLBACK_URL serves the escrow's logs instead…` (une fois,
   puis au plus toutes les 10 minutes) : `docs/quicknode.md`, étape 2, point 4.

   **Le catalogue (une minute après).** Le premier passage lit Gemini ligue par ligue : environ
   27 requêtes, 21 à 43 s mesurés le 19 novembre, environ 300 matchs et 5 300 instruments ; il
   finit par `catalogue synced` (une ligue lue à moitié est une erreur qui la nomme, `gemini
   league listing …`). Puis, dans le SQL Editor :

   ```sql
   select count(*) filter (where active) as actifs, count(*) as total
   from instruments where event_ticker = 'NCAAF-2611212030-ARK-TEX-M';
   ```

   Attendu : des dizaines d'instruments, tous ou presque actifs (45 le 19 novembre à 12 h 31 UTC ;
   avec le seed, ses quatre en font partie). 0 ligne : le catalogue n'a pas tourné (logs
   `catalogue sync failed`).

   **Où il écoute.** Render écrit qu'un web service « must bind to a port on host 0.0.0.0 ».
   L'écouteur du moteur (`src/health/server.ts`, ouvert par `src/index.ts`) appelle
   `server.listen(PORT)` sans adresse : Node écoute alors sur toutes les interfaces, `0.0.0.0`
   (ou `::`, qui accepte aussi l'IPv4, là où l'IPv6 existe). C'est la même forme que l'exemple
   Express de la page Web Services de Render (`app.listen(port)`).

   Puis, depuis l'extérieur (l'URL est en haut de la page du service, de la forme
   `https://<nom>.onrender.com` ; la réponse de `/healthz` ne contient ni secret, ni adresse de
   clé, ni e-mail) :

   ```bash
   curl -s https://<moteur>.onrender.com/healthz
   ```

   Attendu : HTTP 200 et `{"status":"ok","role":"leader", …, "chain":{"id":5042002,"head":…,
   "cursor":…},"db":"ok","sender":"running","jobs":"running","lease":{"holder":"eng-…",
   "heldForS":…,"renewedAgoMs":…}}`. `"role":"standby"` (200 aussi, `sender` et `jobs` à
   `"stopped"`) veut dire que cette instance attend le bail : `lease.holder` dit quel moteur le
   détient (le Mac, s'il tourne ; ou un autre moteur resté sur cette base, étape 1, point 1). Un
   standby qui ne peut pas lire le bail (migration absente, droits manquants) répond 503 : il ne
   prendrait jamais la main. `cursor` rattrape `head` au premier démarrage (par plages de 2 000
   blocs). 503 dit ce qui manque : `db: "down"` (mauvais `DB_URL` ou base injoignable), `head:
   null` (nœud injoignable), `sender: "stopped"` (arrêt en cours).

   `pnpm smoke https://<domaine> --engine https://<moteur>.onrender.com` (une fois le web en
   ligne, étape 4) vérifie aussi le corps de `/healthz` contre le schéma de l'écouteur et exige
   HTTP 200 ; il ne regarde pas le rôle : lire `role` dans la réponse du `curl`. Les logs ne
   doivent pas montrer d'erreur WebSocket répétée de `book-feed` vers `wss://ws.gemini.com`
   (S-05).

   Page **Metrics** : la mémoire doit rester sous 512 Mo (mesuré en local : 160 à 185 Mo au
   démarrage, arbre de processus compris, avant le catalogue par ligue ; l'état stable n'a pas
   été mesuré), et le CPU, affiché aussi en pourcentage du plan, dit si 0,1 CPU suffit. Page
   **Events** : les déploiements, les redémarrages (`Instance Failed`, avec le code de sortie),
   les suspensions. Les notifications par e-mail (Integrations → Notifications de l'espace de
   travail, réglage Default Service Notifications sur « Only failure notifications ») signalent
   un déploiement raté, un service devenu malade et une suspension.

6. **Le pinger, seulement pour une instance Free.** Créer chez un service de surveillance
   extérieur (la page « Best Practices for Maximizing Uptime » de Render en cite deux, Better
   Stack et HeyOnCall ; leurs offres gratuites n'ont pas été vérifiées ici) un contrôle HTTP
   `GET https://<moteur>.onrender.com/healthz` **toutes les 5 minutes**. Pourquoi 5 : Render
   endort après 15 minutes sans trafic entrant, donc trois appels par fenêtre : un appel perdu
   est toléré (10 minutes sans trafic) ; deux de suite font exactement les 15 minutes du seuil,
   et c'est alors une course. Si l'offre gratuite du service permet un intervalle plus court (3
   minutes, par exemple), le prendre. `/healthz` est public et ne coûte presque rien : une sonde
   (une requête à la base, un `eth_blockNumber`) sert toutes les requêtes pendant 2 s
   (`DEFAULT_HEALTH_CACHE_MS` dans `src/health/server.ts`). L'alerte du pinger sert aussi : un
   503 qui dure, c'est le moteur malade (point 7).

7. **Vu de l'extérieur, et quoi faire.**

   | Ce qu'on voit | Ce que c'est | Quoi faire |
   | --- | --- | --- |
   | `/healthz` répond 200 avec un `startedAt` récent et un nouveau `lease.holder` | un redémarrage ou un déploiement : nouvelle instance, bail repris | rien ; page Events pour la cause (`Instance Failed` et son code, health checks) |
   | `/healthz` répond 503 en JSON | le moteur tourne mais `db`, `head`, `sender` ou le bail manquent | lire `db`/`chain.head`/`role`, puis la ligne `health check failed` des logs ; au-delà de 60 s, Render le redémarre seul |
   | `/healthz` répond 200 `"role":"standby"` et rien ne travaille | un autre moteur a le bail : le Mac, ou un moteur d'essai resté sur cette base | `lease.holder` le nomme ; l'arrêter (Ctrl-C) ; étape 1, point 1 |
   | la première requête attend environ une minute, puis 200 (Free) | il dormait : Render montre une page de chargement à un navigateur, et sa page de dépannage range ce réveil parmi les causes d'un 503 | le pinger s'est arrêté : le relancer ; pendant le sommeil, aucun moteur ne travaillait |
   | 503 qui ne vient pas du moteur (pas le JSON de `/healthz`), service marqué suspendu | suspension : heures Free épuisées, bande passante épuisée sans carte, clause de trafic, ou échecs de démarrage pendant 24 h | Compute → un plan payant (`0.5c-512mb`) rétablit le service pour la clause de trafic ; sinon lire la raison sur la page du service |
   | rien ne répond, le Mac tourne | le Mac a le bail (`role` leader dans ses logs) | normal tant que Render est arrêté ; Ctrl-C sur le Mac quand Render est revenu |

   Render peut aussi couper les connexions sortantes longues (changement de routage de ses IP
   sortantes) : le moteur s'en remet comme d'une coupure réseau (le flux Gemini se reconnecte
   avec un backoff exponentiel, le pool de la base rouvre ses connexions, les renouvellements du
   bail réessaient ; une coupure de plus de 10 s arrête ses services jusqu'au bail suivant).

8. **Quand il refuse de démarrer.** Le moteur vérifie sa configuration avant de démarrer quoi
   que ce soit, et sort avec le code 1 en nommant le problème ; les messages donnent des adresses
   et des chain ids, jamais une clé. Dans l'ordre où ils peuvent arriver :

   | Première ligne `fatal` des logs | Ce que c'est | Quoi faire |
   | --- | --- | --- |
   | `Invalid environment:` suivi d'une ligne par variable (`- DB_URL: Invalid input: expected string, received undefined`) | variable manquante ou malformée | corriger `engine.env`, relancer `pnpm env:check engine --file engine.env`, recoller |
   | `engine could not start: the database does not answer` | `DB_URL` faux, mot de passe, pooler injoignable | refaire l'étape 1, point 4 |
   | `engine could not start: engine_identity cannot be read (is every migration applied?)` | migration `engine_identity` absente | `supabase db push --remote` (étape 1, point 2), redéployer |
   | `engine could not start: this database belongs to another chain or escrow`, erreur `EngineIdentityMismatchError` | la base a été enregistrée pour une autre paire chaîne + escrow (le message donne les deux paires et la date) | si la base est la bonne, corriger `ARC_CHAIN_ID` ou `ARC_ESCROW_ADDRESS` ; sinon `DB_URL` vers la bonne base, ou repartir d'une base vide (étape 1, point 1) |
   | `engine could not start` (sans suite), au moment de prendre le bail, avec dans `err` le type `EngineIdentityForeignHistoryError` et le message « This database records no engine identity yet but already holds the work of another chain or escrow » | base d'avant la table qui contient déjà des `chain_txs` ou un curseur d'une autre chaîne ou d'un autre escrow (le message les liste) | repartir d'une base vide (étape 1, point 1) |
   | `engine could not start: the keys or the escrow do not fit the chain`, erreur `EscrowRolesMismatchError` | les clés ne sont pas les rôles de l'escrow ; le message donne, pour chaque rôle, l'adresse attendue et celle de la clé, et dit si les deux sont **inversées** | inversées : échanger `ARC_RELAYER_PRIVATE_KEY` et `ARC_ORACLE_PRIVATE_KEY` ; sinon mettre les clés des adresses attendues |
   | même ligne, `EscrowNotFoundError` | aucun contrat à `ARC_ESCROW_ADDRESS` sur cette chaîne : adresse fausse, ou nœud d'un autre réseau | l'adresse de `packages/contracts/deployments/5042002.json` ; `ARC_RPC_URL` d'Arc **testnet** |
   | même ligne, `EscrowRolesUnreadableError` | le contrat à cette adresse n'est pas un WinzEscrow | même correction que la ligne précédente |
   | même ligne, `ChainIdMismatchError` | `ARC_RPC_URL` ne sert pas la chaîne 5042002 | l'endpoint QuickNode d'Arc testnet |
   | `SignerHistoryMismatchError` | une clé a changé alors que la base garde des transactions envoyées par l'ancienne | son message dit quoi faire |
   | `Port scan timeout reached` (déploiement) | le processus n'a ouvert aucun port, le plus souvent parce qu'il s'est arrêté avant | lire les lignes qui précèdent |

   Au démarrage, un nœud qui ne répond pas n'est qu'un avertissement (`the escrow could not be
   checked at boot: checked again under the lease`) : la vérification est refaite quand il prend
   le bail, et la même erreur l'arrête alors.

## 3. Privy (T)

Rien de Privy ne se règle dans le code au-delà de ce que le tableau de bord autorise
(`apps/web/lib/auth/privy-config.ts` ne peut que restreindre). La liste ci-dessous est tirée du
code et des SDK (`@privy-io/react-auth` 3.52.0, `@privy-io/node` 0.40.0) ; la documentation de
Privy n'a pas pu être lue d'ici, donc les noms exacts des écrans peuvent différer, et chaque
réglage a sa preuve.

1. **Les deux valeurs**, dans les réglages de l'application Privy :

   | Valeur Privy | Variable | Où |
   | --- | --- | --- |
   | App ID (25 caractères) | `NEXT_PUBLIC_PRIVY_APP_ID` | Vercel (Production, **avant** le premier build : elle est recopiée dans le JavaScript) **et** Render |
   | App secret | `PRIVY_APP_SECRET` | Vercel (Production) **et** Render ; jamais sous un nom `NEXT_PUBLIC_` |

   Un App ID d'une autre longueur fait échouer le rendu de chaque page qui charge Privy (le SDK
   lève « Cannot initialize the Privy provider with an invalid Privy app ID ») : accueil,
   `/start` et pages commerçant en 500. `pnpm env:check` le signale par une ligne `CHECK
   NEXT_PUBLIC_PRIVY_APP_ID` (sans échouer) : la lire.

2. **Les réglages du tableau de bord** :
   - (a) les deux valeurs ci-dessus, de la **même** application sur les deux hôtes ;
   - (b) **méthodes de connexion : Email et Passkey activés.** Le code demande `["email",
     "passkey"]` ; une méthode coupée dans le tableau de bord ne s'affiche pas (e-mail coupé : « We couldn't send the code » à
     l'écran M1) ;
   - (c) **origines autorisées** : `https://<domaine>` exactement (l'hôte qui reste après une
     éventuelle redirection `www`), plus `http://localhost:3000` pour le développement si besoin.
     Les déploiements Preview sont en mode simulé (étape 4) et n'ont pas besoin de Privy. Une
     origine refusée est silencieuse dans le SDK (l'iframe du portefeuille échoue sans erreur) :
     `/start` reste sur son écran de chargement ;
   - (d) **portefeuilles intégrés : Ethereum**, créés pour les utilisateurs qui n'en ont pas, sans
     fenêtre de portefeuille (le code pose `createOnLogin: "users-without-wallets"` et
     `showWalletUIs: false`). Le moteur crée aussi, côté serveur, l'utilisateur et son
     portefeuille à partir de l'e-mail d'un fan qui paie (`users().create` avec un portefeuille
     Ethereum, `pregenerateWallets`) : si le tableau de bord propose un mode d'exécution des
     portefeuilles, garder celui qui permet de pré-générer un portefeuille côté serveur. Preuve :
     le premier achat de l'étape 6 (log `ticket issued and payment captured`, pas
     `IdentityConflictError` ni une erreur Privy) ;
   - (e) **cookies HttpOnly désactivés.** Le serveur ne lit que l'en-tête `Authorization: Bearer`,
     jamais un cookie ; le front obtient le jeton par `getAccessToken`. Avec les cookies HttpOnly,
     chaque `/api/me` serait un 401 et la personne serait déconnectée aussitôt ;
   - (f) un **compte de test à code fixe** pour la démo (S-02), si le tableau de bord le
     propose : pas nécessaire ce matin ;
   - (g) **protection anti-robot / captcha désactivée.** L'écran M1 envoie le code sans
     l'interface de Privy (`sendCode`), et le SDK sait passer un jeton de captcha que notre
     écran ne demande jamais. Preuve : le code arrive par e-mail au point 5.

3. **Preuve du jeu de clés** (une minute, sans secret ; l'App ID est public) :

   ```bash
   curl -s https://api.privy.io/v1/apps/<app id>/jwks.json
   ```

   Attendu : un JSON avec `"keys":[…]`. C'est l'adresse que le serveur web interroge pour
   vérifier chaque jeton (`apps/web/lib/server/privy.ts`). Une erreur : l'App ID est faux. Quand
   ces clés sont injoignables, le serveur répond `503` « try again » et ne déconnecte personne ;
   seul un jeton invalide ou expiré donne `401`.

4. **Preuve du secret** (une minute ; `PRIVY_APP_SECRET` lu par `read -rs`, étape 0) :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -u "<app id>:$PRIVY_APP_SECRET" \
     -H "privy-app-id: <app id>" "https://api.privy.io/v1/users?limit=1"
   ```

   Attendu : `200`. `401` ou `403` : le secret n'est pas celui de cette application. C'est
   l'authentification que le SDK serveur envoie (Basic `app id:secret` et l'en-tête
   `privy-app-id`, `@privy-io/node` 0.40.0, `client.js`), sur la liste des utilisateurs qu'il
   expose (`GET /v1/users`).

5. **Preuve de la première connexion** (après l'étape 4) : sur un ordinateur, ouvrir
   `https://<domaine>/start` avec les outils de développement. Se connecter avec un e-mail et le
   code reçu. Attendu : aucune erreur Privy d'origine dans la console ; dans Network, la requête
   `/api/me` porte `authorization: Bearer ey…` et répond 200 (l'utilisateur est créé à ce
   premier appel, avec son e-mail, et son portefeuille dès que Privy l'a créé). `401` : cookies HttpOnly activés (e) ou
   App ID/secret de deux applications différentes (a) ; `409` « This e-mail belongs to another
   account » : la graine démo a tourné sur cette base (étape 2, point 3) ; `503` : les clés de
   Privy injoignables depuis Vercel, réessayer.

## 4. L'application web sur Vercel (A)

Pas de `vercel.json` : avec un monorepo pnpm, le projet Vercel pointe sur `apps/web`, et un
`vercel.json` y serait lu, pas à la racine ; tout ce qu'il porterait se règle dans le tableau de
bord.

1. Add New → Project → importer ce dépôt. Réglages (Settings → Build and Deployment) :
   - **Branche de production** : `main` (Settings → Environments → Production → Branch
     Tracking ; c'est la branche par défaut du dépôt, que Vercel prend à l'import : vérifier
     seulement) ;
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
   - **Fluid compute : laisser activé** (Settings → Functions ; le modèle par défaut des nouveaux
     projets). Les routes qui attendent fixent leur `maxDuration`, tiré du pire cas lu dans le
     code (le commentaire de chaque fichier le détaille) :

     | Route | `maxDuration` | Ce qui l'occupe au pire |
     | --- | --- | --- |
     | `POST /api/webhooks/stripe` | 120 s | relire, annuler, relire une recharge échouée (≈ 114 s) |
     | `POST /api/checkout` | 60 s | créer le PaymentIntent (15 s × 3 essais ≈ 47 s) |
     | `POST /api/checkout/:pi/confirm` | 60 s | relire le PaymentIntent (≈ 47 s) |
     | `GET /api/checkout/:pi` | 60 s | un paiement resté `requires_payment` 5 s : relire le PaymentIntent (≈ 47 s) puis enregistrer l'achat ; toute autre interrogation, deux requêtes courtes |
     | `POST /api/campaigns` (et son `GET`) | 120 s | créer le paiement du budget (≈ 21 s), relire son état (≈ 47 s), et pour le second de deux taps simultanés attendre le premier (≈ 13 s) puis créer (≈ 21 s) : ≈ 102 s |
     | `POST /api/campaigns/:id/top-up` | 300 s | ≈ 356 s si Stripe expirait à chaque appel, plus, pour le second de deux taps simultanés, attendre le premier (≈ 13 s) : ≈ 369 s ; 68 s d'ordinaire |
     | `POST /api/admin/demo/sale` | 15 s | attendre le ticket (8 s) |
     | `POST /api/webhooks/quicknode` | 30 s | aucun appel extérieur ; QuickNode attend 30 s par défaut |

     Avec Fluid, la documentation donne : Hobby 300 s par défaut et au plus ; Pro et Enterprise
     300 s par défaut, 800 s au plus. Toutes ces valeurs tiennent donc dans **Hobby avec Fluid**.
     Sans Fluid, le dernier chiffre connu pour Hobby est 60 s au plus (annonce de Vercel « Hobby
     can now run up to 60 seconds ») : le webhook Stripe, la création de campagne et la recharge
     le dépassent, d'où Fluid toujours requis sur Hobby. La recharge plafonnée à 300 s : une
     coupure au-delà ne laisse rien de cet appel (ses créations ont été refusées), et le même
     `requestId` renvoyé répond la recharge du premier appel.

     Deux taps simultanés sur « Fund » (création de campagne) ou sur une recharge : le second
     attend le premier (pauses de 1 s, 8 au plus) et répond ce qu'il a obtenu ; si le premier
     n'a toujours pas fini, il répond `503` « This promo is still being created » ou « This
     top-up is still being created; try again in a moment », et le front renvoie le **même**
     `requestId`. Ce 503 n'est pas une panne.

2. Variables (Settings → Environment Variables, environnement **Production**), à partir de
   `web.env` :

   ```bash
   pnpm env:check web --file web.env
   ```

   Doit finir par `result: complete for the web`. **Le webhook Stripe n'existe pas encore** (il
   lui faut le domaine, point 3, et c'est Téo qui le crée à l'étape 5) : mettre pour l'instant
   **`STRIPE_WEBHOOK_SECRET=whsec_placeholder`** dans `web.env` et sur Vercel. Toute valeur non
   vide passe la vérification et laisse démarrer chaque route ; seule la route du webhook la lit,
   et elle répondra 400 aux événements jusqu'au remplacement (étape 5, point 2). Sans cette ligne,
   chaque route API répond 500 `Invalid environment` et `pnpm smoke` échoue au point 4.

   La vérification échoue aussi si une clé du moteur (`ARC_*_PRIVATE_KEY`, `APP_DEMO_WALLET_SEED`)
   est dans le fichier, si le nom d'une variable `NEXT_PUBLIC_` est celui d'un secret, ou si la
   valeur d'une `NEXT_PUBLIC_` a la forme d'un secret (voir la fin de la page). Elle imprime
   toujours une ligne `note: NEXT_PUBLIC_APP_API_MOCK must not be set for production … not set
   here` : en production, elle doit dire `not set here`. Variables vérifiées (`pnpm env:check
   web --list`, sortie du 19 novembre 2026 ; chaque ligne « oui » est exigée) :

   | Variable | Requise | Défaut |
   | --- | --- | --- |
   | `APP_ENV` | non | `development` |
   | `APP_LOG_LEVEL` | non | `info` |
   | `APP_BASE_URL` | oui |  |
   | `APP_API_MOCK` | non | `false` |
   | `APP_ADMIN_DEMO_KEY` | oui |  |
   | `APP_EXECUTION_VENUE` | non | `paper` |
   | `DB_URL` | oui |  |
   | `DB_POOL_MAX` | non | `3` |
   | `STRIPE_SECRET_KEY` | oui |  |
   | `STRIPE_WEBHOOK_SECRET` | oui |  |
   | `PRIVY_APP_SECRET` | oui |  |
   | `NEXT_PUBLIC_PRIVY_APP_ID` | oui |  |
   | `QUICKNODE_STREAMS_TOKEN` | non |  |
   | `QUICKNODE_STREAMS_NETWORK` | non | `arc-testnet` |
   | `ARC_ESCROW_ADDRESS` | non |  |
   | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | oui |  |

   Les valeurs :
   - `APP_ENV=production`, `APP_BASE_URL=https://<domaine>` (le domaine stable du point 3, connu
     d'avance), `APP_EXECUTION_VENUE` égal à celui du moteur, `APP_ADMIN_DEMO_KEY` la même valeur
     que sur Render, `DB_URL` celui de l'étape 1 point 4 (le même que le moteur) ;
   - `STRIPE_SECRET_KEY` (`sk_test_…`) et **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_…`)**,
     de Téo (étape 5, point 1) : `env:check` exige la seconde et refuse une clé `pk_live_` ou un
     secret (`sk_`) sous ce nom ; sans elle, chaque écran de paiement afficherait « paiement
     indisponible » ;
   - `NEXT_PUBLIC_PRIVY_APP_ID` et `PRIVY_APP_SECRET`, de Téo (étape 3) ;
   - `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` (étape 1, point 5 : la clé
     `sb_publishable_…` sous ce nom-là) ;
   - **`ARC_ESCROW_ADDRESS=0x81d2d4050E617184b2B832c30BE68f8811b37D2c`, toujours**, avec ou sans
     Stream QuickNode : c'est elle qui donne le lien vers l'explorateur dans les « détails
     techniques » d'une promo (écran des réglages), la seule preuve on-chain qu'un juge voit
     dans l'application ; sans elle, rien ne le signale. `QUICKNODE_STREAMS_TOKEN` attend le
     Stream (`docs/quicknode.md`, étape 3) : sans lui, `POST /api/webhooks/quicknode` répond 503
     et le moteur lit les événements par ses deux autres sources ;
   - **ne pas** définir `APP_API_MOCK` (en production il est ignoré de toute façon) **ni
     `NEXT_PUBLIC_APP_API_MOCK`** : celle-ci est recopiée dans le JavaScript à la construction, le
     serveur ne peut pas l'ignorer, et un front de production construit avec elle proposerait la
     connexion simulée devant une API réelle.

   **Mode simulé, pour l'environnement Preview seulement** (voir les écrans avec les données
   d'exemple, sans base ni Stripe ni Privy) : `APP_API_MOCK=true` et
   `NEXT_PUBLIC_APP_API_MOCK=true`, toujours les deux ensemble, en ne cochant que **Preview**.
   Chaque push sur une branche autre que `main` donne alors une version simulée. Toutes les
   autres variables ci-dessus ne sont cochées que pour **Production** : une Preview n'a ni
   `DB_URL` ni secret, et n'ouvre donc aucune connexion à la base.

   **Construction et exécution.** `next build` ne lit aucune variable du serveur (vérifié : la
   construction passe avec un environnement vide) : elles ne servent qu'à l'exécution, lues à la
   première requête. Les `NEXT_PUBLIC_*` sont, elles, recopiées dans le JavaScript au moment de la
   construction : les définir avant le premier déploiement, et **redéployer après tout
   changement** (Deployments → … → Redeploy).

3. Domaine : Settings → Domains → le domaine stable (F-03). Vercel propose d'ajouter aussi la
   variante `www` et d'en rediriger une vers l'autre : **noter l'hôte final**, celui qui sert la
   page après redirection ; c'est lui, et lui seul, qui va dans `APP_BASE_URL`, dans les origines
   de Privy (étape 3), et chez Stripe pour le webhook et le domaine de paiement (étape 5). Puis
   `APP_BASE_URL` à jour si besoin et Redeploy.

4. **Preuve** :

   ```bash
   pnpm smoke https://<domaine>
   ```

   Attendu : quatre lignes `ok` (page d'accueil, `/api/health`, `/api/events` qui répond 401 sans
   jeton, donc pas l'API simulée, `/api/hedge-desk` qui lit la base) et `result: 4 checks
   passed`. `HTTP 500` sur le Hedge desk : `DB_URL` faux ou base injoignable, ou une variable
   manque (Vercel → Logs montre `Invalid environment:` et la liste). `HTTP 500` sur la page
   d'accueil : le plus souvent un `NEXT_PUBLIC_PRIVY_APP_ID` qui n'a pas 25 caractères (étape 3,
   point 1), puis Redeploy. Puis `pnpm smoke https://<domaine> --engine
   https://<moteur>.onrender.com` : `5 checks passed`. Enfin, deux minutes après, la requête
   `pg_stat_activity` de l'étape 1, point 4.

## 5. Stripe, en mode test uniquement (T)

Tout se fait dans **un seul environnement de test** (le mode test du compte, ou un même
sandbox) : les clés `pk_test_`/`sk_test_`, l'endpoint du webhook et son `whsec_`, et le domaine
de paiement. Un endpoint créé dans un autre environnement que les clés ne reçoit jamais les
événements de leurs paiements. `docs.stripe.com` n'a pas pu être lu d'ici : les emplacements
dans le tableau de bord sont donnés tels qu'ils étaient connus, et chaque point a sa preuve.

1. **Clés et moyens de paiement** (avant l'étape 2) :
   - Developers → API keys : `sk_test_…` → `STRIPE_SECRET_KEY` sur Vercel **et** sur Render ;
     `pk_test_…` → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` sur Vercel. Les deux services refusent une
     clé live.
   - **Settings → Payment methods : garder « Cards », « Apple Pay » et « Google Pay », désactiver
     tout le reste.** Les deux portefeuilles ont chacun leur ligne dans cette page : les laisser
     activés, sinon aucun bouton de paiement rapide n'apparaît sur le téléphone, même avec le
     domaine enregistré (point 4). Pourquoi désactiver le reste : le serveur crée les paiements avec les moyens automatiques du tableau de
     bord (`automatic_payment_methods`), et le front n'en écarte que huit types ; un moyen à
     redirection resté actif (crypto, Alipay, WeChat Pay, Zip…) apparaîtrait comme un onglet, et
     la page où il ramène l'acheteur ne reprend pas le paiement : il resterait en suspens à
     l'écran. Preuve (étape 6) : la feuille de paiement par carte de l'écran M7 n'a qu'un onglet,
     Card.

2. **Le webhook** (une fois le domaine en ligne, étape 4 point 3). Developers → Webhooks → Add
   endpoint (ou « Add destination ») : `https://<domaine>/api/webhooks/stripe`, sur l'hôte final
   (jamais celui qui redirige : Stripe recevrait une redirection au lieu de notre réponse), avec
   exactement ces quatre événements : `payment_intent.succeeded`,
   `payment_intent.amount_capturable_updated`, `payment_intent.canceled`,
   `payment_intent.payment_failed`. Copier le signing secret (`whsec_…`) dans
   `STRIPE_WEBHOOK_SECRET` sur Vercel **à la place de `whsec_placeholder`**, puis Redeploy (A).

   **Ce qui dépend du webhook, et de lui seul** : la création d'une campagne (le paiement du
   budget réussi met en file le job `campaign.create`, `apps/web/lib/server/stripe-webhook.ts`) et
   les recharges de budget (job `campaign.top_up`). Webhook absent ou cassé : le commerçant paie,
   la campagne reste `funding` et l'écran M8 dit au bout d'une minute « Your promo isn't live
   yet ».
   **L'achat d'un fan, lui, aboutit sans le webhook** : le front appelle `POST
   /api/checkout/:pi/confirm` dès que Stripe a confirmé, et `GET /api/checkout/:pi`, qu'il
   interroge chaque seconde, relit le paiement chez Stripe s'il est resté `requires_payment` 5 s
   et lance le même achat ; le webhook fait le même travail, une seule fois en tout.

3. **Preuve que de vrais événements arrivent**, en deux temps :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<domaine>/api/webhooks/stripe \
     -H 'stripe-signature: t=1,v1=x' -d '{}'
   ```

   Attendu : `400` (la route est atteinte, sans redirection ni protection Vercel, et refuse une
   signature fausse). `3xx` : l'hôte redirige, enregistrer l'autre ; `401`/`403` : une protection
   de déploiement couvre le domaine (Settings → Deployment Protection : « Standard Protection »
   laisse passer les domaines de production) ; `500` : une variable manque (Vercel → Logs). Puis
   le vrai : le **paiement du budget de l'étape 6** (carte `4242 4242 4242 4242`) doit apparaître
   dans la page de l'endpoint, livraisons (« Event deliveries ») en **200**, et Vercel → Logs doit
   montrer `campaign creation enqueued`. Le bouton « Send test event » du tableau de bord, s'il
   existe encore, ne prouve que la signature : un 400 y veut dire que le secret ne correspond pas
   (ou que le Redeploy n'a pas eu lieu).

4. **Le domaine de paiement** (sans lui, ni Apple Pay ni Google Pay ne s'affichent sur un vrai
   téléphone ; le front tombe alors sur la carte, avec la ligne « Apple Pay isn't available here.
   Pay with your card instead. »). Dans le même environnement de test : **Settings → Payment
   method domains → Add a new domain → `<domaine>`**, l'hôte final, sans `https://`. Le SDK
   Stripe (stripe-node 23.1.0, `PaymentMethodDomains.d.ts`) dit qu'un moyen de paiement
   « doesn't appear in Elements … for this domain until it is active », avec un statut séparé
   pour Apple Pay et Google Pay. Preuve (une minute, `STRIPE_SECRET_KEY` lu par `read -rs`) :

   ```bash
   curl -s -u "$STRIPE_SECRET_KEY:" https://api.stripe.com/v1/payment_method_domains
   ```

   Attendu : une entrée dont `domain_name` est l'hôte final, `enabled: true`, `livemode: false`,
   `apple_pay.status` et `google_pay.status` à `active`. Puis, sur l'iPhone, Safari,
   `https://<domaine>/c/<slug>` (étape 6) : le bouton noir Apple Pay s'affiche au lieu de la ligne
   « isn't available ».

5. **Le fichier d'association Apple Pay : à vérifier, pas à deviner.** L'application ne sert pas
   `/.well-known/apple-developer-merchantid-domain-association`. Le SDK dit seulement que
   certains moyens demandent des étapes de plus et restent `inactive` sur le domaine tant
   qu'elles ne sont pas faites. Lire `apple_pay` dans la réponse du point 4 :
   - `active` : rien à faire, le fichier n'est pas demandé ;
   - `inactive` avec un `status_details.error_message` qui parle du fichier d'association :
     télécharger le fichier depuis la page Payment method domains, le placer dans
     `apps/web/public/.well-known/apple-developer-merchantid-domain-association` (un commit, donc
     une demande au propriétaire du dépôt), redéployer, vérifier qu'il est servi (`curl -sI
     https://<domaine>/.well-known/apple-developer-merchantid-domain-association` → 200), puis
     `curl -s -X POST -u "$STRIPE_SECRET_KEY:"
     https://api.stripe.com/v1/payment_method_domains/<id pmd_…>/validate` et relire le statut ;
   - `inactive` pour une autre raison : lire le message ; la carte reste disponible, la démo ne
     s'arrête pas.

QuickNode Streams (`/api/webhooks/quicknode`, jeton dans `QUICKNODE_STREAMS_TOKEN`) : la route
est en place, la création du Stream est dans `docs/quicknode.md`. Le moteur lit déjà les
événements de l'escrow par `eth_getLogs` : le flux ne fait qu'accélérer.

## 6. Premier essai depuis un téléphone (porte G1)

Ce qui est déjà prouvé ailleurs, et ce qui ne l'est pas : `pnpm e2e:ui` (Playwright,
`apps/web/README.md`) parcourt tous les écrans au format d'un iPhone 15, taps comptés, sur l'API
**simulée** et dans **Chromium** : il prouve la mise en page et les parcours, pas Safari, ni
Privy, ni Stripe, ni Apple Pay, ni le moteur, ni la chaîne. C'est ce que cette porte prouve.

```bash
pnpm smoke https://<domaine> --engine https://<moteur>.onrender.com
```

Cinq lignes `ok` attendues. Puis, sur les téléphones :

1. **Commerçant** (iPhone, Safari) : `https://<domaine>`, se connecter par e-mail et code,
   créer le commerce, choisir le match **Arkansas at Texas** (samedi).
2. **Choisir une promo qui se vendra.** Chaque modèle de l'écran M4 affiche « N% chance it's
   free » ; une promo se met en pause dès que cette chance dépasse son seuil, et le seuil vient
   du coût que le commerçant accepte (marge habituelle moins marge minimale, écran M6) : pour un
   remboursement de 100 %, c'est le plus haut prix tel que prix + frais ≤ ce coût
   (`pauseThresholdBps`, `packages/pricing/src/limits.ts`). Avec 65 % et 45 % de marges, la promo
   se met en pause au-dessus de **18 %** ; 23 % avec 70 % et 45 % ; 33 % avec 65 % et 30 %.
   Le 19 novembre à 12 h 31 UTC, Texas était à 91-92 % et Arkansas à 8-9 % : **« si Arkansas
   gagne » se vend, « si Texas gagne » jamais** (il faudrait accepter un coût de plus de 92 % du
   prix). À l'écran M6, « Chance right now » doit être sous « Your promo pauses if … above P% » ;
   sinon l'écran dit « At today's odds this promo would be paused » : prendre un autre modèle.
3. **Payer le budget** à l'écran M7 : Apple Pay si le bouton s'affiche (étape 5, point 4), sinon
   la carte `4242 4242 4242 4242`. La feuille par carte ne doit avoir qu'un onglet, Card.
4. **La promo passe en ligne** (M8) en moins d'une minute.
5. **Fan** (un autre téléphone) : ouvrir le lien public `/c/<slug>`, payer un produit avec Apple
   Pay ou la carte de test, avec un e-mail qui n'a jamais servi.
6. **Le ticket s'affiche** (`/t/<jeton>`), en moins de 30 s.
7. **La transaction `buyFor`** est visible sur `https://explorer.testnet.arc.io` (lien dans les
   détails techniques de la promo, côté commerçant).
8. `pnpm smoke https://<domaine> --campaign <slug> --engine https://<moteur>.onrender.com` :
   `6 checks passed`. Et l'étape 5, point 3 : la livraison du paiement du budget en 200.

**Quand une étape échoue**, où lire. Logs du web : Vercel → projet → Logs (filtrer sur la
route). Logs du moteur : Render → service → Logs (chercher le `campaignId` ou le `kind` du job).
Livraisons Stripe : Developers → Webhooks → l'endpoint.

| Étape | Ce qu'on voit | Lire | Cause probable |
| --- | --- | --- | --- |
| 1 | le code n'arrive pas, « We couldn't send the code » | console du navigateur | Email coupé chez Privy, captcha actif (étape 3, b et g) |
| 1 | `/start` reste sur l'écran de chargement | console : erreur d'origine Privy | origine non autorisée (étape 3, c), ou une Preview au lieu du domaine |
| 1 | connecté puis aussitôt déconnecté | Network : `/api/me` | `401` : cookies HttpOnly (e) ou deux applications Privy ; `409` : graine démo (étape 2, point 3) |
| 1 | « try again » à la connexion | Vercel Logs, route `/api/me` | `503` : clés Privy injoignables depuis Vercel ; réessayer |
| 1 | le match de samedi n'est pas dans la liste | SQL de l'étape 2 point 5 ; logs moteur `catalogue …` | catalogue pas encore passé, ou ligue NCAAF en erreur |
| 2 | M6 « The market for this game isn't ready » | logs moteur `book-feed` | carnet Gemini pas encore suivi ou sans offre : attendre, « Check again » |
| 2 | M6 « would be paused » | — | chance au-dessus du seuil : autre modèle (point 2) |
| 3 | pas de bouton Apple Pay | réponse `payment_method_domains` | domaine non enregistré ou `inactive` (étape 5, points 4 et 5) ; payer par carte |
| 3 | onglets autres que Card | — | moyens de paiement du tableau de bord (étape 5, point 1) |
| 3 | `503` « still being created » | — | second tap pendant le premier : attendre, le front renvoie la même demande |
| 4 | M8 dit au bout d'une minute « Your promo isn't live yet » | Stripe : livraisons de l'endpoint ; Vercel : `campaign creation enqueued` | pas de livraison : webhook (étape 5, points 2 et 3) ; livraison en 400 : secret encore `whsec_placeholder` ou Redeploy oublié |
| 4 | livraison en 200, toujours pas en ligne | moteur : `job started` `kind: "campaign.create"`, puis `campaign live on-chain` | moteur en standby ou arrêté (`/healthz`) ; job en erreur (`job failed; retry scheduled`, `job dead`) : lire son erreur |
| 5 | la page publique dit que les ventes sont en pause | page de la promo côté commerçant (« Paused: … », avec la raison) | la chance a dépassé le seuil, le budget est épuisé, ou le carnet n'est pas prêt |
| 6 | l'attente dépasse 30 s, ou « failed » | moteur : `job started` `kind: "purchase"`, `ticket issued and payment captured` ou `buyFor failed; authorization released` | moteur arrêté ; Privy refuse la création du fan (étape 3, d) ; erreur de transaction (lire la suivante) |
| 7 | pas de transaction | moteur : lignes du module `tx-sender` | une transaction refusée ou en attente (le log la nomme), nœud injoignable (`/healthz` `head`) |
| 8 | `GET /api/c/<slug>` échoue | Vercel Logs | slug mal recopié, campagne pas encore `live` |

## Ce qu'il ne faut jamais faire

- Brancher un moteur local sur la base de production **sans le vouloir** (un `.env` de
  développement qui pointe sur la prod, un essai oublié) : il attendrait en standby, puis
  prendrait le bail dès qu'il est libre (pendant un déploiement, par exemple) et deviendrait le
  moteur de production, depuis un poste. Le second moteur du Mac de l'étape 2 (point 1) est le
  même mécanisme, voulu : lancé exprès, avec `engine.env`, Mac sur secteur et couvercle ouvert,
  arrêté par Ctrl-C, et la taille du pool Supabase portée à 30 (étape 1, point 4). Une seconde
  instance sur Render ne casse rien non plus (elle attend sans rien faire) mais coûte une
  instance de plus, et deux connexions de plus au pool : garder 1 instance.
- Poser `APP_DEMO_WALLET_SEED` sur le moteur déployé (étape 2, point 3).
- Attacher un disque persistant au service du moteur : Render désactive alors les déploiements
  sans interruption et le réglage du délai d'arrêt, et le moteur n'écrit rien sur disque.
- Écrire ou effacer à la main la ligne `engine_lease` pendant qu'un moteur tourne : un bail réécrit
  au nom d'un autre, effacé ou expiré arrête le moteur à son renouvellement suivant (3 s au plus),
  et un bail effacé ou expiré peut être pris par un standby dans cet intervalle, qui démarre alors
  à côté du moteur en place. Modifier la ligne `engine_identity` : rien ne la met à jour, et
  changer de chaîne ou d'escrow, c'est une base vide.
- Lancer la répétition (`tsx e2e/rehearsal/run.ts` depuis `apps/web`) avec `--db-url` ou `DB_URL`
  pointant sur une base où travaille un moteur déployé : elle démarre son propre moteur sans
  demander le bail, à côté de celui de Render (deux expéditeurs sur les mêmes clés, deux
  couvertures). La répétition a sa propre base.
- Pousser sur `main` un moteur qui demande une migration avant de l'avoir appliquée (étape 2,
  point 4).
- Écrire `sslmode=disable` dans `DB_URL` (étape 1, point 4).
- Une clé Stripe live (`sk_live_`, `pk_live_`) : les deux services la refusent, ne pas essayer.
- Une clé privée, la graine démo ou la clé `service_role` dans une variable `NEXT_PUBLIC_*`, ou
  sur Vercel tout court. `pnpm env:check web` le refuse quand le NOM de la variable le trahit (une
  variable du moteur posée sur le web, un nom en `NEXT_PUBLIC_` qui contient `SECRET`,
  `PRIVATE_KEY`, `SEED`, `TOKEN`...) et quand la VALEUR d'une `NEXT_PUBLIC_*` a la forme d'un
  secret : `sk_`, `rk_`, `whsec_` (Stripe), `sb_secret_` (Supabase), 64 chiffres hexadécimaux avec
  ou sans `0x` (clé privée, graine), un JWT dont le `role` est `service_role`. Il nomme la variable
  sans jamais afficher la valeur. Un secret d'une autre forme lui échappe encore : relire chaque
  valeur `NEXT_PUBLIC_*` avant d'enregistrer.
- `APP_API_MOCK=true` ou `NEXT_PUBLIC_APP_API_MOCK=true` en production.
- Coller `engine.env`, une clé privée, la graine démo, un secret Privy ou Stripe ou le mot de
  passe de la base dans une discussion, une issue ou un commit.

## Sources

Pages lues le 19 novembre 2026 (téléchargées en entier, jamais des extraits de moteur de
recherche), pour ce que cette version ajoute ou corrige :

- Supabase : [CLI reference](https://supabase.com/llms/cli.txt) (link, `db push --remote`,
  `--dry-run`, `db reset --remote`, `config.toml` demandé par `start`) ·
  [CLI : supabase db push](https://supabase.com/docs/reference/cli/supabase-db-push) (drapeaux
  `--dry-run`, `--include-seed`) ·
  [CLI : supabase db reset](https://supabase.com/docs/reference/cli/supabase-db-reset) ·
  [API keys](https://supabase.com/docs/guides/api/api-keys) (nom
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` de l'exemple Next.js, retrait d'`anon` fin 2026,
  connexions Realtime publiques de 24 h au plus) ·
  [SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement) ·
  [Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres)
  (`sslmode=require`, `verify-full`) ·
  [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) (chaque événement
  autorisé pour chaque abonné).
- Vercel : [Connection Pooling with Vercel Functions](https://vercel.com/kb/guide/connection-pooling-with-functions)
  (connexions « phantom » des instances suspendues, délai d'inactivité de 5 s, `waitUntil`) ·
  [Deploying and redirecting domains](https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting)
  (`www` proposé à l'ajout d'un apex) ·
  [Configuring maximum duration](https://vercel.com/docs/functions/configuring-functions/duration) ·
  [Deployment Protection](https://vercel.com/docs/deployment-protection) (« Standard Protection »
  laisse passer les domaines de production).
- SDK installés, lus faute de documentation joignable : `stripe` 23.1.0
  (`cjs/resources/PaymentMethodDomains.d.ts`, `PaymentIntents.d.ts`), `@stripe/stripe-js` 10.3.0
  (`express-checkout.d.ts`), `@privy-io/node` 0.40.0 (`client.js` : authentification Basic et
  `privy-app-id` ; `resources/users/users.js` : `GET /v1/users`), `@privy-io/react-auth` 3.52.0
  (`dist/esm/index-CfOzwxvP.mjs` : App ID de 25 caractères, HTTPS exigé), `postgres` 4.1.1.

Pages lues le 18 novembre 2026, toujours citées :

- Render, documentation : [Deploy for Free](https://render.com/docs/free) ·
  [Compute Plans](https://render.com/docs/compute-plans) ·
  [Updates to Render Compute Plans](https://render.com/docs/compute-plans-update) ·
  [Your First Render Deploy](https://render.com/docs/your-first-deploy) ·
  [Web Services](https://render.com/docs/web-services) ·
  [Docker on Render](https://render.com/docs/docker) ·
  [Monorepo Support](https://render.com/docs/monorepo-support) ·
  [Deploying on Render (zero-downtime, graceful shutdown)](https://render.com/docs/deploys) ·
  [Health Checks](https://render.com/docs/health-checks) ·
  [Troubleshooting Deploys](https://render.com/docs/troubleshooting-deploys) ·
  [Environment Variables and Secrets](https://render.com/docs/configure-environment-variables) ·
  [Default Environment Variables](https://render.com/docs/environment-variables) ·
  [Regions](https://render.com/docs/regions) ·
  [Scaling](https://render.com/docs/scaling) ·
  [Service Metrics](https://render.com/docs/service-metrics) ·
  [Logs](https://render.com/docs/logging) ·
  [Email and Slack Notifications](https://render.com/docs/notifications) ·
  [Best Practices for Maximizing Uptime](https://render.com/docs/uptime-best-practices) ·
  [Handling Outbound Network Changes](https://render.com/docs/outbound-connection-resets) ·
  [Outbound IP Addresses](https://render.com/docs/outbound-ip-addresses) ·
  [Render Blueprints (IaC)](https://render.com/docs/infrastructure-as-code) ·
  [Blueprint YAML Reference](https://render.com/docs/blueprint-spec) ·
  [FAQ](https://render.com/docs/faq).
- Render, autres pages : [Pricing (compute, facturation à la seconde, FAQ)](https://render.com/pricing) ·
  [How to connect a Render service to Supabase Postgres](https://render.com/articles/how-to-connect-a-render-service-to-supabase-postgres)
  (article de Render daté du 23 octobre 2026 : seule source lue qui dit « Render doesn't support
  outbound IPv6 »).
- Vercel : [Functions limitations](https://vercel.com/docs/functions/limitations) ·
  [Fluid compute](https://vercel.com/docs/fluid-compute) ·
  [Hobby can now run up to 60 seconds](https://vercel.com/changelog/vercel-functions-for-hobby-can-now-run-up-to-60-seconds) ·
  [Configure a build (Corepack, Root Directory)](https://vercel.com/docs/builds/configure-a-build) ·
  [Package managers](https://vercel.com/docs/package-managers) ·
  [Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) ·
  [Function region](https://vercel.com/docs/functions/configuring-functions/region) ·
  [Monorepos](https://vercel.com/docs/monorepos).
- Supabase : [Pooling and limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits) ·
  [Postgres.js](https://supabase.com/docs/guides/database/postgres-js) ·
  [Compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk) ·
  [Connection management](https://supabase.com/docs/guides/database/connection-management)
  (taille du pool : « Connection pooling » des réglages de la base, par utilisateur de base,
  40 % des connexions maximales si l'API PostgREST est très utilisée, 80 % sinon) ·
  [CLI : supabase link](https://supabase.com/docs/reference/cli/supabase-link).
