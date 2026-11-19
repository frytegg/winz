# Mettre la pile en ligne

Une seule page, dans l'ordre : Supabase, puis le moteur sur Render, puis l'application web sur
Vercel, Stripe, et le premier essai depuis un téléphone. Chaque étape finit par une commande qui
prouve qu'elle a marché. Qui fait quoi : Alexandre (A) Supabase, Render, QuickNode (F-01) et le
projet Vercel (le dépôt est dans son compte GitHub, celui de Téo ne le voit pas) ; Téo (T) Stripe,
Privy et l'enregistrement du domaine chez eux (F-03).

**La branche à déployer est `main`**, pour Render comme pour Vercel : le code y est depuis le
18 novembre 2026. Les étapes 2 et 3 disent où la vérifier.

## Ce qui a été exécuté ici, et ce qui ne l'a pas été

Exécuté, en local, sans aucun compte ni service hébergé :

- l'image du moteur construite avec `apps/engine/Dockerfile` (Docker 29, contexte = racine du
  dépôt), lancée contre un Postgres 16 local (les 7 migrations et le seed appliqués) et une
  chaîne anvil locale avec l'escrow de test : `/healthz` répond 200, `docker stop` (SIGTERM)
  déroule l'arrêt du moteur et le conteneur sort avec le code 0 ; la même chose sans conteneur,
  avec la même commande (`node --import tsx src/index.ts`) ;
- l'image lancée sans variable : elle refuse de démarrer et nomme chaque variable manquante ;
- `pnpm --filter @winz/web build` avec un environnement vide (`env -i`) : la construction passe,
  elle ne lit aucun secret ;
- `next start` avec un environnement de production (clés factices) contre ce Postgres local, puis
  `pnpm smoke` contre lui et contre le moteur : toutes les vérifications passent ;
- `pnpm env:check` sur des fichiers complets, incomplets et faux.

Pas exécuté (il faut les comptes) : tout ce qui touche Supabase, Render, Vercel, Stripe, Privy et
QuickNode hébergés, donc chaque commande de preuve ci-dessous lancée contre eux. **Rien de Render
n'a été exécuté** : aucun compte, aucun service, aucun déploiement ; l'étape 2 est écrite
d'après la documentation actuelle de Render, téléchargée depuis render.com le 18 novembre 2026
(pages en fin de page, pas des extraits de moteur de recherche). Les réglages de Vercel et
Supabase avaient été relus le même jour pour la version précédente de cette page ; rien n'a été
essayé sur un compte. Le moteur était d'abord prévu sur Railway, dont l'essai gratuit est
épuisé : `railway.json` est supprimé et l'étape 2 est réécrite pour Render. Deux choses ont
changé côté Supabase depuis la première version de cette page : `supabase db push` vise la base
locale sans `--remote` (étape 1), et Supabase met en garde contre Postgres.js sur le transaction
pooler : les deux services passent donc par le session pooler (étape 1, point 4).

Exécuté ici pour l'étape 2, sans Render : un serveur `node:http` ouvert sans adresse, comme
l'écouteur du moteur, répond sur `127.0.0.1` (Node 22.23.4) ; `pnpm env:check engine --list`,
dont la sortie est recopiée à l'étape 2. Mesuré ici avant cette page, sur le vrai processus
(trois démarrages courts) : 160 à 185 Mo au pic du démarrage, 1,7 s de CPU pour démarrer.

## 0. Avant de commencer

```bash
pnpm install
```

Outils sur le poste : la CLI Supabase (`scoop install supabase` sous Windows, `brew install
supabase/tap/supabase` sous macOS) et `psql` (client Postgres) pour les vérifications.

Préparer, hors du dépôt, deux fichiers que personne ne commite et que personne ne colle dans une
discussion : `engine.env` et `web.env` (format `NOM=valeur`, une ligne par variable). Ce sont eux
que `pnpm env:check` relit avant chaque collage dans Render ou Vercel.

## 1. Supabase (A)

1. Créer le projet sur supabase.com. **Région** : la même zone que le moteur et les fonctions
   Vercel, et une région que Render a aussi (Oregon, Ohio, Virginia, Frankfurt, Singapore) : par
   exemple `eu-central-1` avec Render Frankfurt, ou `us-east-1` avec Vercel `iad1` et Render
   Virginia. Noter le mot de passe de la base.
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
       une connexion du pool (15 par défaut sur l'instance gratuite), et le moteur garde ouvertes
       celles qu'il a ouvertes (son client, `apps/engine/src/db.ts`, n'a pas de délai
       d'inactivité). Régler **`DB_POOL_MAX=8` sur le moteur** (Render) ; le web en prend **3 par
       instance** par défaut (`DB_POOL_MAX` sur Vercel pour changer) et rend celles qu'il
       n'utilise plus après 20 s. Un standby en ouvre 2 au plus : sa demande de bail, une par
       seconde, et la sonde de `/healthz` peuvent se croiser. Le compte, au plus, avec deux
       instances web à 3 et le second moteur du Mac de l'étape 2 (point 1) :

       | Moment | Moteurs | Web | Total |
       | --- | --- | --- | --- |
       | Render leader, rien d'autre | 8 | 6 | 14 |
       | Render leader, Mac en standby | 8 + 2 | 6 | 16 |
       | déploiement Render : l'ancien leader vit 60 s à côté du nouveau standby (étape 2, point 4) | 8 + 2 | 6 | 16 |
       | déploiement Render pendant que le Mac tourne en standby | 8 + 2 + 2 | 6 | 18 |
       | Mac leader, Render en standby | 6 + 2 | 6 | 14 |
       | Mac leader pendant un déploiement Render (deux standbys Render) | 6 + 2 + 2 | 6 | 16 |

       Et pendant la passation elle-même, quelques secondes : l'ancien leader ferme sa base
       après avoir libéré le bail (5 s au plus pour `db.end`) pendant que le nouveau démarre ses
       services et ouvre les siennes à la demande, jusqu'à 8 + 8 (+ 2 pour le Mac) + 6 = 24.
       Au-delà de la taille du pool, le pooler refuse les nouveaux clients (« max clients »,
       `53300`), et ceux qui arrivent après sont ceux du web : paiement, webhook Stripe, ticket.
       Les 15 par défaut ne suffisent donc pas, même sans le Mac : un simple déploiement les
       dépasse. **Avant le premier déploiement du moteur, porter la taille du pool à 25**,
       dans **Database → Settings → Connection pooling** : le pire compte ci-dessus (24) y
       tient, et c'est moins de la moitié des 60 connexions Postgres de l'instance gratuite (la
       documentation de Supabase conseille de rester sous 40 % quand l'API PostgREST est très
       utilisée, ce qui n'est pas le cas ici, et jusqu'à 80 % sinon ; la taille vaut par
       utilisateur de base, et le moteur et le web se connectent avec le même).
       Si ce réglage n'a pas pu être changé : `DB_POOL_MAX=6` sur Render aussi (un déploiement
       fait alors 6 + 2 + 6 = 14) et le Mac arrêté avant tout push sur `main` (sinon 16) ; la
       passation, quelques secondes, peut encore monter à 6 + 6 + 6 = 18 et refuser une requête
       du web à ce moment-là.
     - Si les logs de Vercel montrent des refus de connexion (« max clients », `53300`) sous
       charge, c'est ce plafond : vérifier la taille du pool (ci-dessus), pas le mode. Plus
       d'instances web que deux ajoutent 3 chacune au compte.
     - La connexion directe n'est pas possible depuis Render : elle est en IPv6 seulement sur
       l'offre gratuite, et Render « doesn't support outbound IPv6 » (étape 2, point 3).

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
     espacé de 250 ms) en plus du flux WebSocket des carnets Gemini. Mesuré ici sur le vrai
     processus (`node --import tsx src/index.ts`, trois démarrages courts) : 1,7 s de CPU pour
     démarrer, soit de l'ordre de 17 s à 0,1 CPU si Render plafonne strictement (estimation, pas
     une mesure) ; l'état stable n'a pas été mesuré ;
   - **la clause de suspension** : « Render may suspend a Free web service that initiates an
     uncommonly high volume of traffic over the public internet », avec comme exemples
     « Accessing an external database » et « Invoking external APIs ». C'est exactement ce que
     fait le moteur : Supabase toutes les secondes au moins (bail), le nœud Arc jusqu'à 10
     requêtes par seconde, Gemini. La documentation ne chiffre pas « uncommonly high ».

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
   migrations appliquées (étape 1).

3. **Variables d'environnement**, à partir de `engine.env`, vérifié d'abord :

   ```bash
   pnpm env:check engine --file engine.env
   ```

   La commande doit finir par `result: complete for the engine`. Puis, sur la page
   **Environment** du service (le formulaire de création a aussi une section Environment
   Variables sous Advanced, que la documentation ne détaille pas) : **Add from .env** et choisir
   `engine.env`, qui ajoute toutes ses lignes d'un coup (syntaxe `.env` : `NOM=valeur`,
   guillemets si la valeur contient un espace), ou **+ Add Environment Variable** une par une.
   À l'enregistrement, **Save, rebuild, and deploy** (ou **Save and deploy**) applique ; **Save
   only** attend le prochain déploiement. Un **Restart service**
   reprend la configuration du déploiement en cours, sans les variables changées depuis.

   - **`PORT` : ne pas le mettre.** Render le fixe à 10000 pour tout web service, et le moteur
     ouvre son écouteur `/healthz` sur `PORT` : c'est le port que Render sonde et vers lequel il
     envoie les requêtes. Le poser à une autre valeur marche aussi, mais n'apporte rien.
   - **Secrets** (aucune valeur dans une discussion, une issue ou un commit) : `DB_URL` (contient
     le mot de passe), `ARC_RPC_URL` (le jeton QuickNode est dans le chemin),
     `ARC_RELAYER_PRIVATE_KEY`, `ARC_ORACLE_PRIVATE_KEY`, `APP_ADMIN_DEMO_KEY`,
     `STRIPE_SECRET_KEY`, `PRIVY_APP_SECRET`, `APP_DEMO_WALLET_SEED`, `GEMINI_SANDBOX_API_KEY`,
     `GEMINI_SANDBOX_API_SECRET`. La documentation de Render ne montre pas de case « secret » :
     toutes les variables se posent de la même façon.
   - **`DB_URL` : le session pooler de Supabase** (étape 1, point 4 : port 5432 de l'hôte
     `aws-<index>-<région>.pooler.supabase.com`, utilisateur `postgres.<ref>`), pour les raisons
     de l'étape 1 (Postgres.js pipeline ses requêtes, ce que le transaction pooler ne supporte
     pas). Render ajoute une raison de plus d'écarter la connexion directe : il « doesn't support
     outbound IPv6 » (son article sur Supabase), et la connexion directe de Supabase est en IPv6
     seulement sans le module IPv4 payant. Le même article recommande le session pooler pour un
     processus long. `DB_POOL_MAX=8`, avec la taille du pool Supabase portée à 25 (étape 1,
     point 4 : le compte des connexions pendant un déploiement).
   - Valeurs : `APP_ENV=production` ; `ARC_ESCROW_ADDRESS` et `ARC_ESCROW_DEPLOY_BLOCK` depuis
     `packages/contracts/deployments/5042002.json` (ne rien redéployer) ; `ARC_RPC_URL` le point
     d'accès QuickNode d'Arc testnet (`docs/quicknode.md` ; `ARC_RPC_FALLBACK_URL` reste le RPC
     public par défaut) ; `APP_ADMIN_DEMO_KEY` la même valeur que sur Vercel ; Privy (les deux
     variables) ou, à défaut, `APP_DEMO_WALLET_SEED`.

   **La liste fait foi telle que `pnpm env:check engine --list` l'imprime** (elle est tirée du
   schéma que le moteur valide au démarrage) ; sa sortie le 18 novembre 2026 :

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
   rejouées par le mode démo, et Privy ou la graine démo est exigé (le schéma refuse l'un sans
   l'autre). Pour la porte G1, `STRIPE_SECRET_KEY` (la même clé `sk_test_` que Vercel) est requise.
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
   - un moteur démarre en **standby** : il a validé ses variables et joint la base, il n'a démarré
     aucun service (ni expéditeur, ni worker, ni couverture, ni règlement, ni lecteur), et il
     demande le bail tout de suite puis chaque seconde. Dès qu'il l'a, il démarre le moteur comme
     avant et le renouvelle toutes les 3 s (`ENGINE_LEASE_RENEW_MS`) pour 15 s
     (`ENGINE_LEASE_TTL_MS`) ;
   - s'il ne peut plus le renouveler (base injoignable), il arrête ses services de lui-même après
     10 s sans renouvellement (15 s moins 5 s de marge pour l'arrêt) et redevient standby ; si
     cet arrêt n'a pas fini 1 s avant que le bail puisse expirer, le processus s'arrête (code 1),
     voir plus bas ; si le bail est au nom d'un autre, il s'arrête tout de suite ;
   - au SIGTERM, il arrête ses services, puis libère le bail : le standby prend la main à son
     interrogation suivante, sans attendre l'expiration.

   **La table du bail fait partie des migrations de l'étape 1 : les appliquer avant de déployer
   le moteur, et avant chaque push qui en ajoute une.** Un push sur `main` redéploie le moteur
   tout seul, alors que les migrations s'appliquent à la main (`supabase db push --remote`). Un
   moteur déployé sans la table reste un standby dont chaque demande de bail échoue (`relation
   "engine_lease" does not exist`) : son `/healthz` répond 503 (`"role":"standby"`, et la ligne
   `health check failed` du log dit `standby: its latest ask for the engine lease was not
   answered`) ; Render n'envoie jamais de trafic à une nouvelle instance qui échoue à son
   contrôle de santé, annule le déploiement au bout de 15 minutes et garde l'ancienne. Vérifier
   avant de pousser : `select 1 from engine_lease` dans le SQL Editor répond sans erreur.

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

   Les nombres, les uns contre les autres : l'arrêt du vrai processus mesure 0,5 à 3,1 s (table
   de `apps/engine/README.md`), dominé par la requête de catalogue Gemini en cours, qui n'est pas
   interrompue et peut durer 10 s ; quoi qu'il arrive, `src/index.ts` sort au plus tard **15 s**
   après le SIGTERM (`SHUTDOWN_GRACE_MS`). Les 30 s par défaut de Render le couvrent avec 15 s
   de marge : **rien à régler**, là où la version Railway de cette page demandait de poser 30 s
   à la main (le défaut y était 0). La documentation ne donne d'ailleurs que deux façons de le
   changer, l'API de Render ou un `render.yaml` (`maxShutdownDelaySeconds`, 1 à 300 s), aucune
   dans le tableau de bord. Pendant les 60 s où l'ancienne et la nouvelle instance tournent
   ensemble (3. ci-dessus), chacune a ses connexions à la base : c'est pour elles que la taille
   du pool Supabase passe à 25 (étape 1, point 4). Un SIGKILL ne libérerait pas le bail : le
   nouveau attendrait alors son expiration, 15 s au plus.

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
   bloqué (README, « Self-fencing »), quand une variable manque, ou quand la base ne répond pas
   au démarrage. Render inscrit un événement `Instance Failed` avec le code de sortie dans la
   page **Events**, et « automatically manages the instance lifecycle » ; il ne publie ni délai
   ni nombre d'essais pour relancer un processus sorti. Ce qui est écrit : une instance qui
   échoue à ses contrôles de santé pendant 60 s est redémarrée, et un processus sorti n'y répond
   plus. Le moteur relancé repart en standby.

   Ce que le bail ne couvre pas : un processus gelé plus longtemps que le bail (machine
   suspendue) ne peut pas s'arrêter de lui-même ; à son réveil il s'arrête au premier tour de
   minuterie, mais ce qu'il faisait au moment du gel se termine. Les nonces (index unique
   `(signer_address, chain_id, nonce)`, passage à `sent` sous `where status = 'queued'`), les
   jobs (`for update skip locked`, verrou consultatif par sujet, clés d'idempotence) et les
   charges de couverture (clés de lot, refus `HedgeAlreadyCharged` de l'escrow) restent protégés ;
   les ordres de couverture ne le sont pas (deux couvertures peuvent acheter pour la même
   exposition).

5. **Preuve.** Page **Logs** du service (ou **Deploys** → le déploiement). Un bon démarrage
   ressemble à ceci (lignes réelles d'un démarrage local, adresses remplacées ; sur Render, le
   port est 10000) :

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

   Pendant un déploiement, la nouvelle instance écrit d'abord `standby: the lease is held by
   another engine` (avec l'identifiant de l'ancien), puis, une soixantaine de secondes plus tard,
   `lease acquired: starting the engine`. L'ancienne finit par `engine services stopped`, `lease
   released`, `health listener stopped`.

   **Où il écoute.** Render écrit qu'un web service « must bind to a port on host 0.0.0.0 ».
   L'écouteur du moteur (`src/health/server.ts`, ouvert par `src/index.ts`) appelle
   `server.listen(PORT)` sans adresse : Node écoute alors sur toutes les interfaces, `0.0.0.0`
   (ou `::`, qui accepte aussi l'IPv4, là où l'IPv6 existe). C'est la même forme que l'exemple
   Express de la page Web Services de Render (`app.listen(port)`), et c'est joignable : vérifié
   ici avec Node 22, un serveur `node:http` ouvert sans adresse répond à une requête sur
   `127.0.0.1`.

   Puis, depuis l'extérieur (l'URL est en haut de la page du service, de la forme
   `https://<nom>.onrender.com` ; la réponse de `/healthz` ne contient ni secret, ni adresse de
   clé, ni e-mail) :

   ```bash
   curl -s https://<moteur>.onrender.com/healthz
   pnpm smoke https://<domaine> --engine https://<moteur>.onrender.com
   ```

   Attendu : HTTP 200 et `{"status":"ok","role":"leader", …, "chain":{"id":5042002,"head":…,
   "cursor":…},"db":"ok","sender":"running","jobs":"running","lease":{"holder":"eng-…",
   "heldForS":…,"renewedAgoMs":…}}`. `"role":"standby"` (200 aussi, `sender` et `jobs` à
   `"stopped"`) veut dire que cette instance attend le bail : `lease.holder` dit quel moteur le
   détient (le Mac, s'il tourne et l'a pris). Un standby qui ne peut pas lire le bail (migration
   absente, droits manquants) répond 503 : il ne prendrait jamais la main. Les lectures de la
   base et du nœud servent toutes les requêtes pendant 2 s ; le rôle et l'état des services sont
   relus à chaque requête. `cursor` rattrape `head` au premier démarrage (par plages de 2 000
   blocs). 503 dit ce qui manque : `db: "down"` (mauvais `DB_URL` ou base injoignable), `head:
   null` (nœud injoignable), `sender: "stopped"` (arrêt en cours).

   `pnpm smoke … --engine` vérifie le corps de `/healthz` contre le schéma exporté par
   l'écouteur et exige HTTP 200 ; il imprime la chaîne, `head`, `cursor` et l'uptime. Il ne
   regarde pas le rôle : un standby passe aussi, lire `role` dans la réponse du `curl`. Ce même
   appel prouve la moitié « depuis Render » de S-05 : les logs ne doivent pas montrer d'erreur
   WebSocket répétée de `book-feed` vers `wss://ws.gemini.com`.

   Page **Metrics** : la mémoire doit rester sous 512 Mo (mesuré en local : 160 à 185 Mo au
   démarrage, arbre de processus compris ; l'état stable n'a pas été mesuré), et le CPU, affiché
   aussi en pourcentage du plan, dit si 0,1 CPU suffit. Page **Events** : les déploiements, les
   redémarrages (`Instance Failed`, avec le code de sortie), les suspensions. Les notifications
   par e-mail (Integrations → Notifications de l'espace de travail, réglage Default Service
   Notifications sur « Only failure notifications ») signalent un déploiement raté, un service
   devenu malade et une suspension.

6. **Le pinger, seulement pour une instance Free.** Créer chez un service de surveillance
   extérieur (la page « Best Practices for Maximizing Uptime » de Render en cite deux, Better
   Stack et HeyOnCall ; leurs offres gratuites n'ont pas été vérifiées ici) un contrôle HTTP
   `GET https://<moteur>.onrender.com/healthz` **toutes les 5 minutes**. Pourquoi 5 : Render
   endort après 15 minutes sans trafic entrant, donc trois appels par fenêtre : un appel perdu
   est toléré (10 minutes sans trafic) ; deux de suite font exactement les 15 minutes du seuil,
   et c'est alors une course. Si l'offre gratuite du service permet un intervalle plus court (3
   minutes, par exemple), le prendre : deux appels perdus restent sous le seuil. Choisir un
   service qui permet 5 minutes ou moins sur son offre gratuite. `/healthz` est public et ne
   coûte presque rien : une sonde (une requête à la base, un `eth_blockNumber`) sert toutes les
   requêtes pendant 2 s (`DEFAULT_HEALTH_CACHE_MS` dans `src/health/server.ts`). L'alerte du
   pinger sert aussi : un 503 qui dure, c'est le moteur malade (point 7).

7. **Vu de l'extérieur, et quoi faire.**

   | Ce qu'on voit | Ce que c'est | Quoi faire |
   | --- | --- | --- |
   | `/healthz` répond 200 avec un `startedAt` récent et un nouveau `lease.holder` | un redémarrage ou un déploiement : nouvelle instance, bail repris | rien ; page Events pour la cause (`Instance Failed` et son code, health checks) |
   | `/healthz` répond 503 en JSON | le moteur tourne mais `db`, `head`, `sender` ou le bail manquent | lire `db`/`chain.head`/`role`, puis la ligne `health check failed` des logs ; au-delà de 60 s, Render le redémarre seul |
   | la première requête attend environ une minute, puis 200 (Free) | il dormait : Render montre une page de chargement à un navigateur, et sa page de dépannage range ce réveil parmi les causes d'un 503 | le pinger s'est arrêté : le relancer ; pendant le sommeil, aucun moteur ne travaillait |
   | 503 qui ne vient pas du moteur (pas le JSON de `/healthz`), service marqué suspendu | suspension : heures Free épuisées, bande passante épuisée sans carte, clause de trafic, ou échecs de démarrage pendant 24 h | Compute → un plan payant (`0.5c-512mb`) rétablit le service pour la clause de trafic ; sinon lire la raison sur la page du service |
   | rien ne répond, le Mac tourne | le Mac a le bail (`role` leader dans ses logs) | normal tant que Render est arrêté ; Ctrl-C sur le Mac quand Render est revenu |

   Render peut aussi couper les connexions sortantes longues (changement de routage de ses IP
   sortantes) : le moteur s'en remet comme d'une coupure réseau (le flux Gemini se reconnecte
   avec un backoff exponentiel, le pool de la base rouvre ses connexions, les renouvellements du
   bail réessaient ; une coupure de plus de 10 s arrête ses services jusqu'au bail suivant).

8. **Quand il refuse de démarrer**, la première ligne des logs est `Invalid environment:` suivie
   d'une ligne par variable (`- DB_URL: Invalid input: expected string, received undefined`).
   Corriger `engine.env`, relancer `pnpm env:check engine --file engine.env`, recoller. Un
   `engine could not start` avec `ChainIdMismatchError` veut dire que `ARC_RPC_URL` ne sert pas la
   chaîne 5042002 ; `SignerHistoryMismatchError` : une clé a changé alors que la base garde des
   transactions envoyées par l'ancienne (son message dit quoi faire). Un déploiement qui échoue
   sur `Port scan timeout reached` : le processus n'a ouvert aucun port, le plus souvent parce
   qu'il s'est arrêté avant (lire les lignes qui précèdent : variable, base).

## 3. L'application web sur Vercel (A)

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
   - **Fluid compute : laisser activé** (Settings → Functions ; le défaut des projets créés depuis
     le 23 avril 2025). Les routes qui attendent fixent leur `maxDuration`, tiré du pire cas lu
     dans le code (le commentaire de chaque fichier le détaille) :

     | Route | `maxDuration` | Ce qui l'occupe au pire |
     | --- | --- | --- |
     | `POST /api/webhooks/stripe` | 120 s | relire, annuler, relire une recharge échouée (≈ 114 s) |
     | `POST /api/checkout` | 60 s | créer le PaymentIntent (15 s × 3 essais ≈ 47 s) |
     | `POST /api/checkout/:pi/confirm` | 60 s | relire le PaymentIntent (≈ 47 s) |
     | `POST /api/campaigns` (et son `GET`) | 120 s | créer le paiement du budget (≈ 21 s), relire son état (≈ 47 s), et pour le second de deux taps simultanés attendre le premier (≈ 13 s) puis créer (≈ 21 s) : ≈ 102 s |
     | `POST /api/campaigns/:id/top-up` | 300 s | ≈ 356 s si Stripe expirait à chaque appel, plus, pour le second de deux taps simultanés, attendre le premier (≈ 13 s) : ≈ 369 s ; 68 s d'ordinaire |
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
   définir `APP_API_MOCK` (en production il est ignoré de toute façon) **ni
   `NEXT_PUBLIC_APP_API_MOCK`** : celle-ci est recopiée dans le JavaScript à la construction, le
   serveur ne peut pas l'ignorer, et un front de production construit avec elle proposerait la
   connexion simulée devant une API réelle.

   **Mode simulé, pour l'environnement Preview seulement** (voir les écrans avec les données
   d'exemple, sans base ni Stripe ni Privy) : `APP_API_MOCK=true` et
   `NEXT_PUBLIC_APP_API_MOCK=true`, toujours les deux ensemble, en ne cochant que **Preview**.
   Chaque push sur une branche autre que `main` donne alors une version simulée.

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
   `STRIPE_SECRET_KEY` (`sk_test_…`) va sur Vercel **et** sur Render.
3. **Preuve** : dans la page du webhook, « Send test event » → `payment_intent.succeeded` :
   réponse 200 (l'événement ne correspond à aucun paiement, il est accepté et ignoré). Une réponse
   400 veut dire que le secret ne correspond pas.

QuickNode Streams (`/api/webhooks/quicknode`, jeton dans `QUICKNODE_STREAMS_TOKEN`) : la route
est en place, la création du Stream est dans `docs/quicknode.md`. Le moteur lit déjà les
événements de l'escrow par `eth_getLogs` : le flux ne fait qu'accélérer.

## 5. Premier essai depuis un téléphone (porte G1)

```bash
pnpm smoke https://<domaine> --engine https://<moteur>.onrender.com
```

Six lignes `ok` attendues (avec `--campaign <slug>` une fois la campagne créée). Puis, sur le
téléphone :

1. Se connecter en commerçant, créer une campagne sur un match coté, payer le budget avec
   `4242 4242 4242 4242`.
2. La campagne passe `Live` (logs du moteur sur Render : `campaign.create` traité,
   `createCampaignFor` miné).
3. Ouvrir le lien public `/c/<slug>` sur un autre téléphone, payer un produit avec la carte de test.
4. Le ticket s'affiche (`/t/<jeton>`) ; les logs du moteur montrent `buyFor` miné, puis la
   capture.
5. La transaction `buyFor` est visible sur `https://explorer.testnet.arc.io`.
6. `pnpm smoke https://<domaine> --campaign <slug> --engine https://<moteur>.onrender.com` passe.

## Ce qu'il ne faut jamais faire

- Brancher un moteur local sur la base de production **sans le vouloir** (un `.env` de
  développement qui pointe sur la prod, un essai oublié) : il attendrait en standby, puis
  prendrait le bail dès qu'il est libre (pendant un déploiement, par exemple) et deviendrait le
  moteur de production, depuis un poste. Le second moteur du Mac de l'étape 2 (point 1) est le
  même mécanisme, voulu : lancé exprès, avec `engine.env`, Mac sur secteur et couvercle ouvert,
  arrêté par Ctrl-C, et la taille du pool Supabase portée à 25 (étape 1, point 4). Une seconde
  instance sur Render ne casse rien non plus (elle attend sans rien faire) mais coûte une
  instance de plus, et deux connexions de plus au pool : garder 1 instance.
- Attacher un disque persistant au service du moteur : Render désactive alors les déploiements
  sans interruption et le réglage du délai d'arrêt, et le moteur n'écrit rien sur disque.
- Écrire ou effacer à la main la ligne `engine_lease` pendant qu'un moteur tourne : un bail réécrit
  au nom d'un autre, effacé ou expiré arrête le moteur à son renouvellement suivant (3 s au plus),
  et un bail effacé ou expiré peut être pris par un standby dans cet intervalle, qui démarre alors
  à côté du moteur en place.
- Lancer la répétition (`tsx e2e/rehearsal/run.ts` depuis `apps/web`) avec `--db-url` ou `DB_URL`
  pointant sur une base où travaille un moteur déployé : elle démarre son propre moteur sans
  demander le bail, à côté de celui de Render (deux expéditeurs sur les mêmes clés, deux
  couvertures). La répétition a sa propre base.
- Pousser le moteur avec le bail avant d'avoir appliqué sa migration (étape 2, point 4).
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

Pages lues le 18 novembre 2026, jamais des extraits de moteur de recherche. Render : chaque page
téléchargée en entier depuis render.com, lue pour tout ce que l'étape 2 en cite. Vercel et
Supabase : lues en entier pour la version précédente de cette page.

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
  outbound IPv6 » ; la page Troubleshooting Deploys dit « Render doesn't support IPv6 addresses »
  à propos de l'adresse d'écoute).
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
  [Connection management](https://supabase.com/docs/guides/database/connection-management)
  (relue le 18 novembre 2026 pour la taille du pool : elle se change dans « Connection pooling »
  des réglages de la base, vaut par utilisateur de base, et la règle donnée est 40 % des
  connexions maximales si l'API PostgREST est très utilisée, 80 % sinon) ·
  [API keys](https://supabase.com/docs/guides/api/api-keys) ·
  [Postgres Changes (publication)](https://supabase.com/docs/guides/realtime/postgres-changes) ·
  [CLI : supabase link](https://supabase.com/docs/reference/cli/supabase-link) ·
  [CLI : supabase db push](https://supabase.com/docs/reference/cli/supabase-db-push).
