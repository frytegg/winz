# Tâches : Winz

Découle de `SPEC.md` v1.1 (17 novembre 2026). Chaque tâche cite les exigences qu'elle couvre.
Rendu Devpost : **vendredi 20 novembre, 12 h CST**. Finale : samedi 21 novembre.

## Comment lire ce fichier

- **Qui** : `A` = Alexandre (back), `T` = Téo (front), `Agent` = agent de code, avec son type et la personne qui relit.
- **Types d'agent** (règle d'effort du projet) : `coder` (effort moyen, tâche bien cadrée), `coder-high` (effort élevé, tâche complexe ou critique), `verifier` (relecture indépendante, effort élevé). Jamais au-dessus.
- **Dép.** : tâches qui doivent être finies avant. Une tâche sans dépendance ouverte peut partir tout de suite.
- **Fini quand** : la condition vérifiable. « Écrit » ne suffit pas : il faut l'avoir exécuté et en garder la trace (sortie de test, hash de transaction, capture).
- ◇ = peut glisser sans casser le parcours de démo. C'est une proposition : le reclassement appartient à Alexandre et Téo.
- Cocher `- [x]` quand c'est fini. `pnpm completion-check` relit ces cases et le tableau de couverture en bas.

## Règles pour les agents

1. **Un couloir = un dossier = un agent à la fois.** Deux agents ne touchent jamais le même dossier en parallèle. Les dossiers de chaque couloir sont dans le tableau ci-dessous.
2. **`packages/shared` est figé après la porte G0.** Un agent qui a besoin d'y changer un schéma s'arrête et le demande : le front et le back en dépendent.
3. Chaque agent travaille sur sa branche `lane/<id-tâche>` (ou un worktree), et rend : ce qui est fait, ce qui ne l'est pas, les commandes lancées et leur résultat.
4. Avant de rendre : `pnpm lint && pnpm typecheck && pnpm test` au vert sur son périmètre. Ne jamais désactiver un test.
5. Toute tâche `coder-high` sur l'argent (contrat, tarification, tx-sender, job d'achat, allocation) passe par un `verifier` avant fusion.
6. Commits conventionnels, sans aucune mention d'IA.
7. Argent en `bigint` micro-USDC, probabilités en points de base, aucune clé dans le code, toute écriture on-chain par `tx-sender`.

| Couloir | Dossiers | Responsable |
|---|---|---|
| Partagé | `packages/shared` | A (figé après G0) |
| Contrat | `packages/contracts` | A |
| Tarification | `packages/pricing` | A |
| Données | `supabase/migrations` | A |
| Marché | `apps/engine/src/market-data` | A |
| Chaîne | `apps/engine/src/chain` | A |
| Jobs | `apps/engine/src/jobs`, `apps/engine/src/settlement` | A |
| Couverture | `apps/engine/src/hedging`, `apps/engine/src/venues` | A |
| API | `apps/web/app/api`, `apps/web/lib/server` | A |
| Écrans commerçant | `apps/web/app/(merchant)`, `apps/web/components` | T |
| Écrans client | `apps/web/app/(fan)` | T |
| Hedge desk et admin | `apps/web/app/hedge-desk`, `apps/web/app/admin` | T |
| Qualité | `e2e`, `scripts` | A et T |

## Portes

| Porte | Échéance (CST) | Condition |
|---|---|---|
| G0 | mardi 17, midi | Squelette en place, contrats d'API figés et relus par Téo, API simulée servie, sondes lancées |
| G1 | mercredi 18, midi | Une vente de bout en bout sur Arc testnet : campagne créée, paiement par carte de test, ticket on-chain, ticket affiché |
| G2 | mercredi 18, soir | Boucle complète en mode démo : vente, couverture papier, facturation, règlement YES et NO, remboursements, commerçant payé. C'est le « Must tourne mercredi soir » de la spec. **Passée le 18 nov. à 09:07 UTC sur Arc testnet** (reçus `docs/rehearsals/20261118T090535Z-5042002-yes.md` et `…090714Z-5042002-no.md`) |
| G3 | jeudi 19, soir | Preuves faites (300 tickets, e2e, deux répétitions), `completion-check` vert sur les Must, puis `/harden` et corrections |
| G4 | vendredi 20, 12 h | Vidéo et Devpost rendus |

Ordre imposé en fin de parcours : build complet → `/harden` → corrections → enregistrement → rendu. Aucun livrable (vidéo, pitch, README de présentation) avant G3.

---

## Vague 0 : fondations (mardi matin)

Tout le reste en dépend. F-02, puis F-03, sont les deux seules tâches vraiment en série.

- [ ] **F-01** · Qui : A · Dép. : aucune
  Comptes et clés côté back : projet Supabase, point d'accès QuickNode sur Arc testnet, service Render, compte sandbox Gemini (`exchange.sandbox.gemini.com`), clés relayer et oracle générées, premiers USDC du faucet sur le relayer.
  Fini quand : chaque secret est dans les variables d'environnement du service Render (page Environment) et du projet Vercel, `.env.example` liste toutes les variables sans valeur.
  État au 18 nov. : aucun compte n'existe encore. La marche à suivre, étape par étape avec la commande qui prouve chacune, est dans `docs/deploy.md` ; `pnpm env:check <engine|web>` dit si un environnement est complet.
- [ ] **F-02** · Qui : A · Dép. : aucune · Hypothèse 8
  Demander une allocation d'USDC testnet à l'équipe Circle/Arc sur place (besoin : environ 15 000).
  Fini quand : réponse obtenue et notée ici (oui avec montant, ou non → jeton de test, C-03).
- [ ] **F-03** · Qui : T · Dép. : aucune
  Comptes côté front : projet Vercel et domaine stable, compte Stripe en mode test avec le domaine enregistré pour Apple Pay, application Privy (e-mail OTP, passkey, chaîne Arc testnet).
  Fini quand : le domaine sert une page en HTTPS et apparaît comme domaine de paiement vérifié chez Stripe.
- [x] **F-04** · Qui : Agent `coder`, relu par A · Dép. : aucune · Sections 11 à 14
  Squelette du monorepo : pnpm + turbo, TypeScript strict, ESLint + Prettier, Vitest, `apps/web` (Next.js, App Router, Tailwind, PWA), `apps/engine`, `packages/{shared,pricing,contracts}`, validation des variables d'environnement par zod au démarrage, journalisation pino, CI (lint, typecheck, test).
  Fini quand : `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` passent sur un clone neuf, et la CI est verte.
- [ ] **F-05** · Qui : Agent `coder-high`, relu par A puis T · Dép. : F-04 · Section 10, PR-4
  `packages/shared` : types du domaine, unités (micro-USDC, points de base, micro-contrats) avec conversions testées, schémas zod de chaque requête et réponse de la section 10, une réponse d'exemple par route, interface Solidity `IWinzEscrow` et types des événements.
  Fini quand : chaque route de la section 10 a son schéma et son exemple, les exemples passent leur schéma en test, et **Téo a validé les formes** (porte G0).
  État au 18 novembre : les six ajouts demandés par Téo avant le gel sont faits et testés (`requestId` sur `POST /api/campaigns`, encore facultatif ; `event` ; `subjectName` et `resultLabel` ; `team` et `winProbabilityBps` ; `createdAt` et `liveAt` ; pas d'expiration des campagnes `funding`), liste dans `apps/web/README.md`. Reste pour cocher : le front envoie `requestId`, le champ devient obligatoire, Téo valide les formes.
- [x] **F-06** · Qui : Agent `coder`, relu par T · Dép. : F-05
  API simulée : avec `APP_API_MOCK=true`, chaque route renvoie son exemple, avec quelques scénarios (campagne ouverte, en pause, réglée YES, réglée NO).
  Fini quand : Téo construit ses écrans sans qu'aucun service du back ne tourne.
- [x] **F-07** · Qui : Agent `coder`, relu par A · Dép. : F-04
  `scripts/completion-check.mjs` : lit `TASKS.md` (cases et tableau de couverture) et vérifie que les fichiers attendus existent ; code de sortie non nul tant qu'un Must est ouvert. Hors CI.
  Fini quand : `pnpm completion-check` liste les Must ouverts et sort en erreur aujourd'hui.

### Sondes : prouver les points d'intégration (mardi, en parallèle, 2 h chacune au plus)

Chacune répond à une incertitude de la revue (question ouverte 9). Si une sonde échoue, on s'arrête et on en parle avant de construire dessus.

- [x] **S-01** · Qui : Agent `coder`, relu par A · Dép. : F-01
  Foundry sur Arc : déployer sur le testnet un contrat de 20 lignes qui fait un `transferFrom` d'USDC, et le vérifier sur l'explorer.
  Fini quand : adresse et transaction notées, avec le `foundry.toml` (version de l'EVM, frais) et la commande de vérification qui marchent.
- [ ] **S-02** · Qui : T (ou Agent `coder`) · Dép. : F-03 · ID-1
  Privy : pré-générer un wallet pour un e-mail depuis le serveur, puis se connecter avec cet e-mail par code. Tester aussi le compte de test à code fixe pour les e2e.
  Fini quand : les deux adresses sont identiques, et l'appel serveur exact est noté. Sinon : test de Circle Wallets (question ouverte 4).
- [ ] **S-03** · Qui : T · Dép. : F-03 · CO-2
  Stripe : Express Checkout avec `capture_method: manual` et `emailRequired`, sur un vrai iPhone avec Apple Pay.
  Fini quand : l'autorisation déclenche `payment_intent.amount_capturable_updated`, l'e-mail arrive, la capture puis l'annulation fonctionnent. Tester aussi l'ouverture depuis le navigateur d'Instagram.
- [ ] **S-04** · Qui : Agent `coder`, relu par A · Dép. : S-01 · HE-1
  QuickNode Streams : flux de logs sur Arc testnet filtré sur l'adresse du contrat de S-01, livré à un webhook de test.
  Fini quand : une livraison réelle est enregistrée comme fichier d'exemple, la vérification de signature passe, et le délai de livraison est mesuré.
- [ ] **S-05** · Qui : Agent `coder`, relu par A · Dép. : F-04 · MD-2
  Gemini temps réel : se connecter à `wss://ws.gemini.com`, s'abonner à `@bookTicker`, `@depth10` et au flux des transactions d'un instrument sportif coté ; enregistrer 10 minutes.
  Fini quand : l'enregistrement est commité comme jeu de carnets pour les tests, les formats de message sont documentés, et la connexion marche depuis Render.
- [ ] **S-06** · Qui : A · Dép. : F-01 · HE-10, question ouverte 1
  Sandbox Gemini : clé de rôle Trader, acceptation des conditions, un ordre `makerOrCancel` sur un marché crypto, puis son annulation.
  Fini quand : identifiants d'ordre notés. Si le compte est refusé : le noter ici, H-07 bascule sur un serveur simulé.

---

## Vague 1 : modules indépendants (mardi)

Tous parallèles entre eux dès que F-05 est figé. Lot à lancer ensemble : C-01, P-01, D-01, M-01, X-01, J-01.

### Contrat
- [x] **C-01** · Qui : Agent `coder-high`, puis `verifier`, relu par A · Dép. : F-05 · EC-1, EC-3, EC-4, EC-5, EC-6, EC-7, PR-3
  `WinzEscrow.sol` selon la section 8 : état, rôles, toutes les fonctions, devis EIP-712, événements, erreurs personnalisées, NatSpec.
  Fini quand : `forge test` couvre chaque fonction et chaque refus listé en section 15 (devis expiré ou rejoué, facturation au-delà de la réserve, `settle` avec réserve ouverte, double `settle`, vente après `salesClose`, remboursement vers une adresse bloquée).
- [x] **C-02** · Qui : Agent `coder-high`, relu par A · Dép. : C-01 · EC-2
  Tests d'invariants : solvabilité, `lockedRefunds == Σ refundable non payés`, `hedgeSpent + hedgeReserved ≤ hedgeBudget`, R jamais modifié.
  Fini quand : les invariants tiennent sur la campagne de fuzzing, couverture ≥ 90 % sur `WinzEscrow`.
- [x] **C-03** · Qui : Agent `coder`, relu par A · Dép. : C-01, S-01
  Script de déploiement (adresse du jeton en paramètre, test `decimals() == 6`), export de l'ABI vers `packages/shared`, jeton de test à 6 décimales que l'on peut émettre et qui sait bloquer une adresse (tests, et secours de F-02).
  Fini quand : le contrat est déployé et vérifié sur Arc testnet, son adresse est dans la config, l'ABI est importée par le moteur.

### Tarification
- [x] **P-01** · Qui : Agent `coder-high`, puis `verifier`, relu par A · Dép. : F-05 · PR-1, PR-2, PR-4, PR-5
  `packages/pricing` : frais taker et maker, seuil de pause, coût marginal, `limits` (c_max, p_max, coût par vente, capacité), calcul du devis (`maxHedgeCost`), modèles de promo pour un événement.
  Fini quand : l'exemple de Joe de la section 4.3 est un test (p_max = 18 %, vente à 12 % ≈ 2,55 $), les cas limites de la section 15 passent, couverture ≥ 90 %.

### Données
- [ ] **D-01** · Qui : Agent `coder`, relu par A · Dép. : F-05 · Section 10
  Migrations de toutes les tables de la section 10, tables publiques `live_*` avec lecture seule pour le rôle anonyme et Realtime activé, contraintes d'unicité des idempotences, données de démo (`pnpm db:seed`).
  Fini quand : `pnpm db:migrate` passe sur une base vide, le rôle anonyme lit `live_*` et rien d'autre (testé).

### Marché
- [x] **M-01** · Qui : Agent `coder`, relu par A · Dép. : F-05 · MD-1, MD-3
  Client REST Gemini : événements actifs avec leurs marchés enfants, carnet `GET /v1/book/{symbol}`, événements réglés ; validation zod, normalisation vers `events` et `instruments`, cache de 60 s, respect de la limite de 120 requêtes par minute.
  Fini quand : les tests tournent sur des réponses enregistrées, et une commande synchronise le catalogue réel en base.
- [x] **M-02** · Qui : Agent `coder-high`, relu par A · Dép. : M-01, S-05 · MD-2
  Flux de carnets : WebSocket avec reconnexion et attente exponentielle, repli sur le carnet REST, marqueur « périmé » au-delà de 10 s, abonnement limité aux instruments des campagnes actives, écriture dans `live_instruments`.
  Fini quand : coupure simulée → reconnexion, flux arrêté → marqué périmé en moins de 11 s, tests sur le jeu de carnets de S-05.
- [ ] **M-03** ◇ · Qui : Agent `coder` · Dép. : M-01 · MD-4 (Should)
  Score en direct si une source existe ; sinon le ticket ne l'affiche pas.

### Chaîne
- [x] **X-01** · Qui : Agent `coder-high`, puis `verifier`, relu par A · Dép. : F-05, D-01 · Section 7
  `tx-sender` : une file par clé, nonce géré localement, table `chain_txs` avec clé d'idempotence, frais au-dessus du plancher Arc, reprises, repli de RPC, reçu décodé vers `chain_events`.
  Fini quand : 50 envois concurrents sur Anvil passent sans conflit de nonce, un redémarrage au milieu ne renvoie aucune transaction en double.
- [x] **X-02** · Qui : Agent `coder`, relu par A · Dép. : X-01, C-03 · HE-1
  Ingestion des événements : relecture `eth_getLogs` toutes les 5 s avec curseur, écriture idempotente sur `(tx_hash, log_index)`, projection vers `tickets` et `campaigns`.
  Fini quand : le même événement reçu par deux sources ne crée qu'une ligne, un arrêt de 5 minutes est rattrapé au redémarrage.

### Jobs
- [x] **J-01** · Qui : Agent `coder`, relu par A · Dép. : D-01
  File de jobs sur Postgres : prise avec verrou, reprises avec attente, clé d'idempotence, journal des échecs.
  Fini quand : deux workers ne traitent jamais le même job, un job en échec est repris puis mis de côté après N essais.

### Identité
- [ ] **I-01** · Qui : T, avec Agent `coder` · Dép. : S-02, F-05 · ID-1, ID-2
  Privy côté client (connexion par code, wallet invisible) et côté serveur : vérification du jeton dans les routes, table `users`, rôles commerçant et client, recherche ou pré-génération d'un wallet par e-mail normalisé.
  Fini quand : une route protégée refuse un jeton absent ou faux, et le même e-mail donne toujours la même adresse.
- [ ] **I-02** ◇ · Qui : T · Dép. : I-01 · ID-3 (Should)
  Passkey proposée après le premier achat, liée au compte existant.

### Écrans, sur l'API simulée
- [ ] **U-01** · Qui : T · Dép. : F-04 · Section 2
  Direction visuelle et socle : jetons de couleur, typographie, composants de base, manifeste PWA, icône, `lib/copy.ts`.
  Fini quand : un écran témoin respecte la section 2 sur un viewport iPhone.
- [ ] **U-02** · Qui : T, avec Agent · Dép. : U-01, F-06 · M0 à M8, CA-1, CA-2
  Onboarding commerçant M0 à M8 sur l'API simulée, calculs de M6 par `packages/pricing`.
  Fini quand : le parcours va de M0 à M8 en moins de 15 taps sur données simulées.
- [ ] **U-03** · Qui : T, avec Agent · Dép. : U-01, F-06 · C1 à C3, CO-1, LT-1
  Page de campagne, paiement, ticket vivant (les cinq phases de 5.4) sur l'API simulée.
  Fini quand : chaque phase du ticket s'affiche à partir d'un scénario simulé, sans aucun mot crypto.

---

## Vague 2 : une vente de bout en bout (mardi soir à mercredi midi, porte G1)

- [x] **A-01** · Qui : Agent `coder`, relu par A · Dép. : M-01, P-01, I-01 · CA-1
  `GET /api/events` : catalogue et modèles calculés, limités aux contrats dont le carnet est coté des deux côtés ; `GET /api/me`, `POST /api/merchants`.
- [x] **A-02** · Qui : Agent `coder-high`, relu par A · Dép. : P-01, D-01, I-01 · CA-2, CA-4, M6, M7
  `POST /api/campaigns/preview`, `POST /api/campaigns` (brouillon + PaymentIntent du budget), liste et détail du commerçant, pause, reprise et clôture manuelles (jobs vers `setPaused` et `closeSales`).
  Fini quand : l'aperçu renvoie les mêmes chiffres que `packages/pricing` en test, et un commerçant ne voit que ses campagnes.
- [x] **J-02** · Qui : Agent `coder-high`, relu par A · Dép. : X-01, C-03, J-01, A-02 · CA-2
  Job de création : budget payé (webhook Stripe) → `createCampaignFor` → campagne `Live`, slug court.
  Fini quand : un paiement de budget en mode test produit une campagne on-chain et en base, une seule fois même si le webhook est rejoué.
- [x] **A-03** · Qui : Agent `coder-high`, relu par A · Dép. : D-01, S-03 · CO-2, CO-3
  `POST /api/checkout` (vérifie que la vente est ouverte, PaymentIntent en capture manuelle), `POST /api/checkout/:pi/confirm`, `GET /api/checkout/:pi`, `POST /api/webhooks/stripe` avec signature vérifiée sur le corps brut.
  Fini quand : webhook rejoué et confirmation du client mènent à un seul job ; une signature fausse est refusée.
- [x] **J-03** · Qui : Agent `coder-high`, puis `verifier`, relu par A · Dép. : A-03, X-01, C-03, P-01, M-02, I-01 · CO-2, CO-3, CO-4, PR-3, 9.2
  Job d'achat : wallet de l'acheteur (recherche ou pré-génération), devis calculé sur le carnet frais, signature EIP-712, `buyFor`, puis capture ; si la vente est fermée ou si `buyFor` échoue, annulation de l'autorisation. Écrit le ticket, son lot et son jeton d'accès.
  Fini quand : testé sur Anvil avec Stripe simulé pour les trois issues (ticket et capture ; pause et annulation ; échec on-chain et annulation), sans jamais capturer sans ticket ni émettre deux tickets.
- [x] **H-01** · Qui : Agent `coder-high`, relu par A · Dép. : X-02 · HE-1, HE-3
  Grand livre d'exposition : chaque `TicketPurchased` crée son lot et augmente l'exposition de l'instrument, toutes campagnes confondues ; écrit `positions` et `live_campaigns`.
  Fini quand : exposition = somme des montants remboursables des tickets, rejouable depuis `chain_events`.
- [x] **H-02** · Qui : Agent `coder-high`, relu par A · Dép. : M-02, P-01, H-01 · CA-5
  État de vente de chaque campagne (`sale_state`) : ouverte, en pause pour prix, budget, profondeur ou carnet périmé, pause manuelle, close ; reprise après 10 s stables avec un tick de marge ; fin des ventes 5 min avant `startTime`.
  Fini quand : une cote qui oscille autour de p_max ne fait pas clignoter l'état (test), et aucun devis n'est signé hors de l'état « ouverte ».
- [x] **A-04** · Qui : Agent `coder`, relu par A · Dép. : D-01, I-01 · LT-2, C3
  `GET /api/c/:slug`, `GET /api/t/:token`, `GET /api/tickets`.
- [ ] **U-04** · Qui : T · Dép. : U-02, U-03, A-01 à A-04
  Brancher les écrans sur l'API réelle : onboarding, page de campagne, paiement, ticket.
  Fini quand : **porte G1** passée sur le testnet, depuis un téléphone.

---

## Vague 3 : couvrir et régler (mercredi, porte G2)

Lots parallèles : (H-03 → H-04 → H-05, H-06), (R-01 → R-02), (A-05, A-06, A-07), (H-07), écrans de Téo.

### Couverture
- [x] **H-03** · Qui : Agent `coder-high`, puis `verifier`, relu par A · Dép. : M-02, S-05 · HE-8, 9.7
  Interface `ExecutionVenue` et exécution papier : règles taker et maker de 9.7, profondeur consommée retenue, frais, carnet de référence gardé avec chaque exécution.
  Fini quand : sur le jeu de carnets, un ordre taker ne dépasse jamais la profondeur affichée et un ordre maker n'est exécuté que si le marché l'a touché.
- [x] **H-04** · Qui : Agent `coder-high`, puis `verifier`, relu par A · Dép. : H-03, H-01 · HE-2, HE-3, 9.3
  Politique d'exécution : maker d'abord, plafond `U_max`, TTL, repli taker, taker forcé à 60 min du début, regroupement des ventes rapprochées ; paramètres en base et lisibles.
  Fini quand : chaque branche de 9.3 a son test sur carnets enregistrés, et `U × p` ne dépasse pas `U_max` plus de 5 s dans le scénario de démo (critère 4).
- [x] **H-05** · Qui : Agent `coder-high`, puis `verifier`, relu par A · Dép. : H-04, C-03 · HE-4, EC-5, 9.5
  Allocation FIFO des exécutions aux lots, facturation `chargeHedge` par lots de tickets plafonnée au coût garanti, P&L du moteur (économies maker, pertes de garantie).
  Fini quand : sur un scénario à deux commerçants, chacun ne paie que ses lots, jamais plus que son devis, et la somme facturée plus le P&L égale le coût réel.
- [x] **H-06** · Qui : Agent `coder`, relu par A · Dép. : H-04 · HE-5
  Coupe-circuit : Gemini muet, carnet périmé ou plafond dépassé → plus de devis, plus d'ordres, état visible.
  Fini quand : chaque déclencheur est testé, et aucun ordre ne part coupe-circuit actif.
- [x] **H-10** · Qui : Agent `coder`, relu par A · Dép. : H-03, H-04, H-05, M-02, X-02 · HE-2, HE-3, HE-4
  Brancher la couverture dans le moteur : un exécuteur par instrument alimenté par le flux de carnets et le grand livre d'exposition, ordres et exécutions enregistrés en base, allocation des exécutions aux lots, envoi des facturations `chargeHedge`, reprise après redémarrage, état public du Hedge desk.
  Fini quand : sur une chaîne locale, une vente déclenche un ordre papier, son exécution est allouée au lot, la facturation part on-chain, et un redémarrage au milieu ne double rien.
- [x] **H-08** · Qui : Agent `coder-high`, relu par A · Dép. : H-05 · HE-6
  Réconciliation à la fin des ventes : position ramenée à l'exposition à 0,01 contrat près, puis facturation de tous les lots restants.
  Fini quand : après clôture, `hedgeReserved == 0` on-chain pour chaque campagne de l'instrument.
- [ ] **H-07** ◇ · Qui : Agent `coder-high`, relu par A · Dép. : H-03, S-06 · HE-10
  Adaptateur d'ordres réels Gemini (authentification HMAC, `makerOrCancel`, annulation, suivi) derrière `ExecutionVenue`, et commande `venue:check` sur le sandbox avec un marché crypto.
  Fini quand : les identifiants des ordres du sandbox sont affichés sur le Hedge desk. Glisse seulement si S-06 a échoué.
- [ ] **H-09** ◇ · Qui : Agent `coder-high` · Dép. : H-05 · HE-7 (Should)
  Croisement interne des expositions complémentaires.
  État au 18 nov. : conçu et jugé (trois conceptions, trois juges, une synthèse), **non construit**. La version retenue est réduite : seulement les deux contrats YES d'un match à deux issues, avant le coup d'envoi, plafonnée par événement, derrière un réglage coupé par défaut. Elle demande 10 à 12 h d'agent, touche la décision d'achat de la politique de couverture (le cœur de la boucle prouvée), et ne se déclenche que si les deux côtés ont de l'exposition pas encore achetée. À décider après G3. La consigne de construction, avec les choix à confirmer et les risques qui restent, est dans `docs/design/he-7-internal-crossing.md`.

### Règlement
- [x] **R-01** · Qui : Agent `coder-high`, relu par A · Dép. : M-01, H-08, X-01 · MD-3, ST-1
  Surveillance des résultats toutes les 60 s après le début ; à la résolution, `settle` pour chaque campagne de l'événement.
  Fini quand : `resolutionSide` yes, no et événement invalide mènent à YES, NO et VOID sur des réponses enregistrées.
- [x] **R-02** · Qui : Agent `coder-high`, puis `verifier`, relu par A · Dép. : R-01 · ST-2, ST-3, ST-4, EC-7
  Après `settle` : `refundBatch` par lots de 50 envoyés sans attendre le précédent, `payMerchant`, `release` ; reprise des tickets dont le remboursement a échoué.
  Fini quand : sur Anvil, les trois issues laissent le contrat sans un centime dû, et un ticket vers une adresse bloquée reste dû sans bloquer les autres.

### API
- [x] **A-05** · Qui : Agent `coder`, relu par A · Dép. : H-05, D-01 · MDB-1, MDB-2, MDB-3
  `GET /api/hedge-desk`, détail de campagne en direct, bilan après règlement ; alimentation de `live_hedge_desk`.
- [ ] **A-06** · Qui : Agent `coder`, relu par A · Dép. : S-04, X-02 · HE-1
  `POST /api/webhooks/quicknode` : signature vérifiée, écriture dans `chain_events`.
  Fini quand : la livraison enregistrée en S-04 est acceptée, une signature fausse est refusée, un doublon est ignoré.
  État au 18 nov. : la route est écrite et testée contre le format documenté par QuickNode (signature fausse refusée, doublon ignoré, trois sources pour une seule ligne sur chaîne locale). Reste la preuve de S-04 : une vraie livraison, à enregistrer avec `pnpm quicknode:record` une fois le Stream créé (`docs/quicknode.md`). Rien n'a été vérifié contre le service réel.
- [x] **A-07** · Qui : Agent `coder-high`, relu par A · Dép. : M-02, R-01, J-03 · MDB-4
  Mode démo derrière la clé admin : carnet piloté pour un instrument, résultat forcé, vente rejouée ; le drapeau « démo » remonte dans toutes les réponses concernées.
  Fini quand : les trois actions marchent sur le testnet et font apparaître le bandeau.
  Fait le 18 nov. sur Arc testnet (reçus `docs/rehearsals/20261118T090535Z-5042002-yes.md` et `…090714Z-5042002-no.md`) : carnet piloté, vente rejouée, résultat forcé OUI puis NON ; chaque réponse sur la campagne porte `demo: true` (218 et 287 réponses, aucune fausse). Le bandeau lui-même est U-07.
- [x] **A-08** ◇ · Qui : Agent `coder` · Dép. : A-02 · CA-6 (Should)
  Recharge du budget (`topUpBudgetFor`).
  Fait le 18 nov. : `POST /api/campaigns/:id/top-up` (paiement par carte comme le premier budget, table `budget_top_ups`), job `campaign.top_up`, `topUpBudgetFor` envoyé seul par le relayer ; l'argent finit crédité sur la campagne ou remboursé sur la carte, jamais les deux ni aucun. Prouvé sur chaîne locale avec le vrai contrat (`apps/web/e2e/top-up.test.ts` : budget épuisé, rechargé, la vente reprend). Pas encore rejoué sur Arc testnet ; l'écran de recharge est côté front.
  Reste connu (19 nov.) : face au vrai Stripe, le second de deux taps simultanés sur une recharge peut encore recevoir une erreur `502` alors que le premier a réussi (un seul paiement dans tous les cas ; la création de campagne, elle, attend et répond comme le premier). Le même correctif reste à porter sur la recharge.

### Écrans
- [ ] **U-05** · Qui : T · Dép. : A-05 · MDB-1, MDB-2, 5.2
  Espace commerçant : liste, détail en direct, bilan ◇, réglages.
- [ ] **U-06** · Qui : T · Dép. : A-05 · MDB-3
  Hedge desk public : exposition, position, ordres, exécutions, économie maker, coupe-circuit, lieu d'exécution en clair, paramètres de risque.
- [ ] **U-07** · Qui : T · Dép. : A-07 · MDB-4
  Panneau admin du mode démo et bandeau « DEMO MODE ».
- [ ] **U-08** · Qui : T, avec Agent · Dép. : A-02 · CA-3, CO-1
  Lien court, QR plein écran, partage natif ; affiche PNG ◇ ; aperçu Open Graph ◇.
- [ ] **U-09** · Qui : T · Dép. : A-04 · LT-2, C4
  « My tickets » ◇.
- [ ] **U-10** ◇ · Qui : T · Dép. : U-03 · LT-3, LT-4 (Should)
  Notifications push et e-mails de confirmation et de résultat.

Fin de vague : **porte G2**, boucle complète en mode démo sur le testnet, issues YES et NO.

---

## Vague 4 : preuves, durcissement, rendu (jeudi et vendredi)

- [x] **Q-01** · Qui : Agent `coder-high`, relu par A · Dép. : G2 · Section 15
  Test d'intégration de bout en bout sur Anvil avec Gemini et Stripe simulés, chemin nominal et chemin « pause → autorisation annulée ».
- [ ] **Q-02** · Qui : Agent `coder`, relu par T · Dép. : G2 · Section 15
  Playwright sur viewport iPhone 15 : onboarding M0 à M8, achat C1 à C3 par carte de test, résultats YES et NO en mode démo.
- [ ] **Q-03** · Qui : A · Dép. : G2 · Critères 6 et 7
  Mesures sur Arc testnet : 300 tickets remboursés en moins de 10 s après `settle` ; vente visible au tableau de bord en moins de 3 s ; cote du ticket à moins de 2 s.
  Fini quand : les chiffres et les hash de transaction sont dans `docs/`.
  État au 18 nov. à 09 h UTC (reçus dans `docs/rehearsals/`) : vente visible sur le détail du commerçant en 1,2 à 2,3 s (médiane 1,9 s) une vente à la fois (`…090714Z-5042002-no.md`) ; 140 tickets remboursés en 3 lots, 10 blocs soit 5 s après `settle` (`…090924Z-5042002-yes.md`).
  État au 18 nov. à 13 h UTC, après l'envoi groupé des transactions indépendantes (`apps/engine/src/chain/tx-kinds.ts`) : vente visible en 1,2 à 2,5 s (médiane 1,5 s) une vente à la fois (`…124900Z-5042002-no.md`), en 1,7 à 4,9 s (médiane 2,5 s) sur 140 ventes à trois acheteurs en même temps, contre 4,3 s de médiane avant (`…125036Z-5042002-yes.md`) ; 140 tickets remboursés en 3 lots, 4 blocs soit 2 s après `settle`, les lots diffusés à 0,7 puis 0,3 s d'écart contre 1,0 puis 2,2 s avant. Restait alors la mesure à 300 tickets et le décalage de la cote du ticket.
  État au 18 nov. à 17 h UTC (`…170112Z-5042002-yes.md`) : **300 tickets remboursés en 6 lots, 8 blocs soit 4 s après `settle`** (4,4 s d'horloge), critère 6 tenu. Sur ces 300 ventes, à trois acheteurs en même temps sans pause, la vente est visible sur le détail du commerçant en 1,4 à 5,6 s, médiane 3,0 s : au-dessus des 3 s du critère 7 sous cette charge, alors qu'une vente à la fois reste entre 1,1 et 2,5 s. La limite vient du nœud public (environ 10 requêtes par seconde pour 8 requêtes par vente, facturation de la couverture comprise). Restait alors le décalage de la cote du ticket.
  État au 18 nov. à 17 h 30 UTC (`…172656Z-5042002-yes.md`, section « Ticket odds ») : **cote du ticket à moins de 2 s, critère 7 tenu sur ce que la répétition peut mesurer**. Flux Gemini réel : 117 mises à jour en 60 s, lues 42 ms (médiane) à 95 ms (max) après leur réception par le moteur. Carnet piloté : 10 prix, lisibles après 0,15 à 0,95 s (médiane 0,65 s), sur la ligne `live_instruments` lue avec le rôle anonyme comme sur `GET /api/t/:token`. Non compris : la poussée de Supabase Realtime jusqu'au téléphone, mesurable seulement une fois le projet déployé.
  **Reste ouvert** : le délai du tableau de bord sous charge (médiane 3,0 s à trois acheteurs en même temps sur le nœud public). Deux voies : un point d'accès dédié (QuickNode, F-01), ou faire passer les requêtes des ventes avant celles de la facturation de la couverture dans le limiteur du moteur. Décidé le 18 nov. : un point d'accès dédié (QuickNode). À remesurer dès qu'il existe.
- [x] **Q-04** · Qui : A · Dép. : G2 · Critères 3, 4, 5
  Relevé sur le scénario de démo : aucune vente au-delà de p_max ou du budget, `U × p` sous `U_max`, aucun lot facturé au-delà de son devis.
  Fait le 18 nov. sur Arc testnet : les onze invariants de la répétition (`apps/web/e2e/rehearsal/invariants.ts`) passent sur trois répétitions, OUI 12 ventes, NON 12 ventes, OUI 140 ventes (section « Invariants » de chaque reçu de `docs/rehearsals/`).
- [ ] **Q-05** · Qui : A et T · Dép. : G2 · Critères 1 et 2
  Chronométrage sur téléphone : campagne en ligne en moins de 2 minutes et 15 taps ; ticket en moins de 30 secondes après le scan ; Apple Pay réel.
- [ ] **Q-06** · Qui : A et T · Dép. : Q-01 à Q-05 · Critère 8
  Deux répétitions complètes de suite sur le testnet, sans correction manuelle.
- [ ] **Q-07** · Qui : A · Dép. : Q-06
  `pnpm completion-check` vert sur tous les Must, aucun TODO dans une page que le jury lit. Puis `/harden`, et corrections. **Porte G3.**
- [ ] **L-01** · Qui : A et T · Dép. : Q-07
  Choix du match de la vidéo (question ouverte 2) et tournage de la démo sur l'arbre durci.
- [ ] **L-02** · Qui : T, avec A · Dép. : L-01
  Devpost, README, pitch « ce n'est pas un pari » (question ouverte 5). **Porte G4.**
- [ ] **L-03** · Qui : A et T · Dép. : G4
  Finale du samedi : Arkansas–Texas se joue à 14 h 30 CST, campagne réelle possible si les carnets sont cotés (question ouverte 3).

### Bonus (Could)
- [ ] **B-01** ◇ · CA-7 · Dupliquer une campagne.
- [ ] **B-02** ◇ · CO-5 · Achat direct en USDC signé par le client.
- [ ] **B-03** ◇ · HE-9 · Ajustement de la couverture pendant le match.

---

## Couverture des exigences

Chaque exigence de la spec et les tâches qui la portent. Une exigence reste ouverte tant qu'une seule de ses tâches n'est pas cochée, y compris une tâche marquée ◇ : la faire glisser demande de reclasser l'exigence ici.

| Exigence | Priorité | Tâches |
|---|---|---|
| ID-1 | Must | S-02, I-01, J-03 |
| ID-2 | Must | I-01 |
| ID-3 | Should | I-02 |
| MD-1 | Must | M-01 |
| MD-2 | Must | S-05, M-02 |
| MD-3 | Must | M-01, R-01 |
| MD-4 | Should | M-03 |
| PR-1, PR-2, PR-4, PR-5 | Must | F-05, P-01 |
| PR-3 | Must | C-01, J-03 |
| CA-1 | Must | A-01, U-02 |
| CA-2 | Must | A-02, J-02, U-02 |
| CA-3 | Must | U-08 |
| CA-4 | Must | A-02, H-02 |
| CA-5 | Must | H-02 |
| CA-6 | Should | A-08 |
| CA-7 | Could | B-01 |
| CO-1 | Must | U-03, U-08 |
| CO-2 | Must | S-03, A-03, J-03, U-04 |
| CO-3 | Must | A-03, J-03 |
| CO-4 | Must | J-03 |
| CO-5 | Could | B-02 |
| EC-1, EC-3, EC-4, EC-6 | Must | C-01 |
| EC-5 | Must | C-01, H-05 |
| EC-7 | Must | C-01, R-02 |
| EC-2 | Must | C-02 |
| HE-1 | Must | X-02, H-01, S-04, A-06 |
| HE-2 | Must | H-04, H-10 |
| HE-3 | Must | H-01, H-04 |
| HE-4 | Must | H-05, H-10 |
| HE-5 | Must | H-06 |
| HE-6 | Must | H-08 |
| HE-7 | Should | H-09 |
| HE-8 | Must | H-03 |
| HE-9 | Could | B-03 |
| HE-10 | Must | S-06, H-07 |
| ST-1 | Must | R-01 |
| ST-2, ST-3, ST-4 | Must | R-02 |
| LT-1 | Must | U-03, M-02 |
| LT-2 | Must | A-04, U-09 |
| LT-3, LT-4 | Should | U-10 |
| MDB-1, MDB-2 | Must | A-05, U-05 |
| MDB-3 | Must | A-05, U-06 |
| MDB-4 | Must | A-07, U-07 |
| Critères de succès 1 à 8 | Must | Q-03, Q-04, Q-05, Q-06 |
| Fondations | Must | F-01, F-02, F-03, F-04, F-05, F-06, F-07, S-01, C-03, D-01, X-01, J-01, U-01 |
| Tests de bout en bout | Must | Q-01, Q-02 |
| Rendu | Must | Q-07, L-01, L-02 |
| Finale | Could | L-03 |

## Questions ouvertes qui bloquent une tâche

| Question (SPEC §19) | Bloque | Qui tranche |
|---|---|---|
| 1. Compte sandbox Gemini | H-07 | A (S-06) |
| 2. Match de la vidéo | L-01 | T |
| 3. Liquidité des écarts | Promo phare de la démo, L-03 | A, relevé quotidien |
| 4. Privy ou Circle Wallets | I-01 | T (S-02) |
| 6. Paramètres de risque | H-04 | A |
| 7. Règle des matchs annulés | R-01 (déclencheur du VOID) | A |
| 8. Allocation d'USDC testnet | C-03 (jeton), Q-03 | A (F-02) |
