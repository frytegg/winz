# Spec : Winz

> **All the hype. None of the risk.**
> Promos « remboursé si l'équipe gagne », couvertes vente par vente sur Gemini Predictions, réglées en USDC sur Arc.

Version 1.1 · 17 novembre 2026 · Statut : **revue technique faite** (Alexandre), **à valider** (Téo)
Hackathon : UBC 2026 (Austin) · rendu Devpost vendredi 20 novembre, 12 h CST · finale samedi 21 novembre

Ce qui a changé depuis la v1.0, et pourquoi : section 20.

---

## 0. Hypothèses posées (à corriger avant de coder)

1. **Langue de l'app** : interface et textes produit en **anglais US** (jury et démo à Austin). La spec reste en français.
2. **Un seul monorepo TypeScript**, moteur de couverture compris (décidé le 17 novembre : `packages/pricing` est partagé entre le web et le moteur).
3. **Arc testnet uniquement** (chain id 5042002), aucun fonds réel. Gemini : **lecture en production** (catalogue, carnets, résultats, sans clé). **Exécution papier** : les ordres de couverture sont remplis par simulation sur le carnet réel de production, et affichés comme tels. Le sandbox Gemini ne liste aucun marché sportif (vérifié le 17 novembre), il sert seulement à prouver l'adaptateur d'ordres réels sur un marché crypto.
4. **Le paiement par carte est simulé de bout en bout** : Apple Pay via Stripe en mode test, en deux temps (autorisation, puis capture une fois le ticket émis). La trésorerie Winz paie à la place du client en USDC testnet. C'est annoncé comme tel dans la démo.
5. **Ni le client ni le commerçant ne signent de transaction.** Sur Arc le gas se paie en USDC : un wallet vide ne peut rien envoyer. Le wallet du client est créé côté serveur au premier achat, à partir de l'e-mail donné dans la feuille de paiement. Toutes les transactions partent des clés Winz (`buyFor`, `createCampaignFor`, etc.).
6. **Une campagne = une offre à prix fixe + une condition** (un contrat binaire Gemini) + **un taux de remboursement fixe**. Pas de campagne multi-événements ni de remboursement sur montant variable dans le MVP.
7. **L'oracle est une clé unique tenue par le backend Winz** pour le hackathon. C'est assumé et dit dans le pitch.
8. **Volume d'USDC testnet** : le faucet donne 20 USDC par adresse toutes les 2 heures, la démo en fait circuler environ 13 000. Alexandre demande une allocation à l'équipe Circle/Arc sur place. Le contrat reçoit l'adresse du jeton au déploiement : si la demande échoue, on déploie sur un jeton de test à 6 décimales que l'on peut émettre, et on le dit dans la démo.

---

## 1. Objectif

### Le problème
Une promo « remboursé si l'équipe gagne » fait venir du monde, mais un commerçant ne peut pas encaisser le risque d'un remboursement massif. Ce marché existe (SCA Promotions depuis des décennies, PlayAbly avec Kalshi en 2026), mais il est réservé aux grandes marques, passe par un courtier, et le client doit croire la marque sur parole.

### Ce qu'on construit
Une **app web mobile installable (PWA)** avec deux rôles :

- **Commerçant** : crée une campagne en un tap à partir d'un catalogue d'événements, fixe une promesse qui ne bougera plus (ex. « 100 % remboursé si Texas gagne de plus de 13,5 points »), sa marge minimale et son budget. Il partage ensuite un **lien** et un **QR code**.
- **Client** : scanne le QR ou ouvre le lien depuis les réseaux sociaux, paie avec **Apple Pay ou sa carte**, et reçoit un **ticket vivant** qui affiche ses chances d'être remboursé en direct, jusqu'au remboursement automatique.

Derrière, un **moteur de couverture** agrège l'exposition de toutes les campagnes d'un même contrat Gemini et la couvre :
- en **ordres maker** d'abord ;
- en **taker de secours** ensuite ;
- avec un **plafond de risque non couvert** et un **coût par vente garanti**.

### Pourquoi ça gagne
| Cible | Argument |
|---|---|
| Track Consumer | Onboarding sans aucun mot crypto, paiement Apple Pay, ticket vivant |
| Bounty Gemini | Gemini est le cœur du produit : catalogue, prix, capacité, politique d'exécution maker sur le carnet réel, règlement. Une page « Hedge desk » montre le moteur au jury, et une preuve d'ordres réels sur le sandbox |
| Prix Arc | Commerce réel en USDC, séquestre programmable, remboursements en masse en moins de 10 s |
| QuickNode | Streams alimente le grand livre d'exposition à chaque vente on-chain |

### Utilisateurs cibles
- **Joe**, gérant d'un bar ou d'une pizzeria à Austin. Pas crypto, sur son téléphone entre deux services. Il veut plus de clients les soirs de match sans risquer sa trésorerie.
- **Maya**, cliente et fan. Elle voit la promo sur Instagram ou au comptoir et veut payer en 10 secondes sans créer de compte compliqué.
- **Le jury Gemini et Arc** : il veut voir un usage sérieux de son API et de sa chaîne.

---

## 2. Identité (Winz)

| Élément | Valeur |
|---|---|
| Nom | **Winz** (wordmark en minuscules, « ı » sans point) |
| Signature | « All the hype. None of the risk. » |
| Couleur primaire | Lime néon, `#D8FF34` (à prélever exactement sur le fichier source) |
| Fonds | Noir chaud `#1C1C1F` (cartes), `#0B0B0C` (fond d'app) |
| Texte | Blanc `#FFFFFF`, gris `#A1A1AA` pour le secondaire |
| Motif | Fines diagonales lime à faible opacité (environ 15 %), en fond de cartes héros et d'écrans de succès |
| Icône | Carré arrondi lime, « W » noir, deux diagonales fines |
| Ton | Énergique, sportif, simple. Majuscules réservées aux titres héros. Jamais de jargon crypto côté client |
| Thème | Sombre par défaut (ambiance bar et match). Le clair n'est pas prévu dans le MVP |

**Règles d'usage** : le lime est l'accent, pas un fond partout. Un seul gros élément lime par écran (le CTA principal ou le statut « REFUNDED »). Texte noir sur lime, jamais blanc.

---

## 3. Carte des capacités

Les modules sont testables séparément. Ils restent dans **une seule spec** (contrainte de temps) mais chaque exigence porte son identifiant de module. Alexandre peut les découper en `SPEC-<module>.md` s'il le souhaite.

| Module id | Responsabilité | Dépend de |
|---|---|---|
| `identity` | Connexion e-mail ou passkey, wallet intégré invisible, rôles commerçant et client | — |
| `market-data` | Catalogue d'événements Gemini, cotes, carnets, résultats, normalisation | — |
| `escrow-contract` | Contrat `WinzEscrow` sur Arc : campagnes, séquestre, tickets, règlement, remboursements | — |
| `pricing` | Prix effectif, plafonds, capacité, calcul des devis (bibliothèque pure, sans I/O) | `market-data` |
| `campaigns` | Création en un tap, modèles, lien et QR, cycle de vie, arrêt automatique | `identity`, `pricing`, `escrow-contract` |
| `checkout` | Page de campagne, Apple Pay ou carte (test), achat par relayer | `identity`, `campaigns`, `escrow-contract` |
| `hedging-engine` | Grand livre d'exposition, exécution maker puis taker, croisement interne, allocation des coûts, coupe-circuit | `market-data`, `pricing`, `escrow-contract` |
| `settlement` | Lecture des résultats, `settle`, remboursements groupés, paiement du commerçant | `market-data`, `escrow-contract`, `hedging-engine` |
| `live-ticket` | Ticket vivant, espace client, notifications push | `checkout`, `market-data`, `settlement` |
| `merchant-dashboard` | Suivi en direct, bilan, page publique « Hedge desk » | `campaigns`, `hedging-engine`, `settlement` |

Ordre de construction : `identity`, `market-data`, `escrow-contract` (en parallèle) → `pricing` → `campaigns`, `checkout` → `hedging-engine` → `settlement` → `live-ticket`, `merchant-dashboard`. Le découpage en vagues et en couloirs parallèles est dans `TASKS.md`.

---

## 4. Concepts et règles métier

### 4.1 Vocabulaire
| Terme | Définition |
|---|---|
| Campagne | Une offre (produit, prix P), une condition (contrat binaire Gemini, résultat YES), un taux de remboursement **R fixe**, une période de vente |
| Condition | Le contrat Gemini dont le YES déclenche le remboursement (moneyline, écart, total de points) |
| Ticket | Le reçu on-chain d'un achat. Montant payé, montant remboursable = R × montant payé |
| Exposition | Ce que Winz doit compenser au commerçant si la condition est YES, soit la somme des montants remboursables |
| Couverture | Les contrats YES détenus. 1 contrat paie 1 $ si YES. Un contrat se fractionne au centième (quantité minimale 0,01, tick de prix 0,01 $) |
| p | Probabilité du marché = prix du contrat YES (mid ou ask selon l'usage) |
| p_eff | Prix effectif d'achat de la couverture : prix marginal sur le carnet pour la quantité voulue, frais Gemini compris |
| Frais | Taker : 0,07 × p × (1 − p) par contrat. Maker : 0,0175 × p × (1 − p), offerts jusqu'au 31 décembre 2026 (à confirmer par contrat). Pas de frais au règlement |

### 4.2 La promesse ne change jamais
- R est fixé à la création et **ne peut plus être modifié**, ni par le commerçant ni par Winz. Le contrat le refuse.
- La campagne **s'arrête** (pause automatique, ou fin définitive) quand continuer ferait passer le commerçant sous sa marge minimale ou au-delà de son budget.
- Pas de baisse silencieuse du remboursement. Le client voit toujours exactement la promesse affichée sur l'affiche.

### 4.3 Les deux réglages du commerçant
Le commerçant renseigne :
1. **Sa marge habituelle** sur l'offre, pré-remplie selon la catégorie (ex. pizza 65 %) et modifiable.
2. **La marge minimale qu'il veut garder par vente** (curseur, ex. 45 %).
3. **Son budget total de couverture** (ex. 1 000 $).

Winz en déduit le reste :

```
coût max par vente (part du prix)   c_max = marge_habituelle − marge_min
coût d'un contrat au prix p         c(p)  = p + frais_taker(p) = p + 0,07 × p × (1 − p)
probabilité max qui arrête la vente p_max = plus grand prix p (au tick 0,01) tel que R × c(p) ≤ c_max
coût d'une vente                    coût  = R × P × c(p_eff)
la vente est ouverte si             p_eff ≤ p_max   ET   coût garanti ≤ budget disponible
```

Exemple : Joe vend une pizza à 20 $, marge habituelle 65 %, marge minimale 45 %, R = 100 %.
- c_max = 20 %. À p = 0,18 le contrat coûte 0,1903 ; à p = 0,19 il coûte 0,2008. Donc p_max = 0,18.
- Avec « Texas gagne de plus de 13,5 points » à 12 %, la vente coûte environ 2,55 $ et Joe garde 10,45 $ de marge au lieu de 13 $.
- Si la cote monte au-dessus de 18 %, la campagne se met en pause.
- L'écran affiche : « Your promo pauses if Texas' chances go above 18 %. »

### 4.4 Garantie de coût par vente
Au moment de la vente, le devis fixe un **coût maximal garanti**. Ce montant est **réservé on-chain sur le budget** du commerçant dès l'achat, et le contrat refuse toute facturation au-delà :
- si le moteur couvre en maker moins cher, l'économie va au commerçant (la réserve non utilisée retourne au budget) ;
- s'il doit payer plus que ce coût garanti (le marché a bougé entre la vente et l'exécution), la différence est absorbée par la marge Winz et comptée dans le P&L du moteur.

C'est ce qui permet de promettre la marge minimale au commerçant.

### 4.5 Fin des ventes
Les ventes s'arrêtent **5 minutes avant le début de l'événement** (champ `startTime` de l'événement Gemini), ou plus tôt si le commerçant le décide. Aucune vente n'est possible après.

### 4.6 Ce que le commerçant et le client voient en argent
- **Commerçant** : tout en dollars. À chaque vente il reçoit tout de suite la part non remboursable, soit (1 − R) × prix. La part remboursable lui revient après le match : libérée du séquestre si NO, payée par la couverture si YES. Avec R = 100 %, il ne touche donc rien avant le règlement. L'écran affiche « Balance $ » (disponible) et « Pending $ » (en attente du match).
- **Client** : il paie en dollars par carte. Son remboursement arrive en USDC, affiché « $20.00 refunded ». Il peut le dépenser chez un commerçant Winz ou demander un virement (simulé, hors MVP).

---

## 5. Parcours et écrans

Principe : **aucun mot crypto côté client** (wallet, USDC, blockchain, gas, seed). Côté commerçant, « USDC » n'apparaît que dans les réglages avancés. Chaque écran a un seul appel à l'action principal.

### 5.1 Onboarding commerçant (objectif : campagne en ligne en moins de 2 minutes)

| # | Écran | Contenu | Règle |
|---|---|---|---|
| M0 | Accueil | Hero noir, motif diagonales, « All the hype. None of the risk. », CTA « Start a promo » | Lien « I'm a fan » vers l'espace client |
| M1 | Connexion | E-mail puis code à 6 chiffres, ou passkey (Face ID) | Le wallet est créé en arrière-plan, jamais montré |
| M2 | Ton commerce | Nom, catégorie (Bar, Pizza, Burger, Retail, Other), logo (optionnel) | 2 champs obligatoires |
| M3 | Choisis un match | Liste « This weekend » des événements Gemini, triés par date, avec logos d'équipes et heure de début | Recherche et filtre par sport |
| M4 | Choisis ta promo | 3 à 5 modèles calculés pour ce match. Ex. « Free if Texas wins by 14+ · ~13 % of price », « Half back if Texas wins · ~46 % » | Coût estimé affiché sur chaque carte. Un modèle n'est proposé que si son contrat a un carnet coté des deux côtés. Les modèles au-dessus de p_max sont grisés |
| M5 | Ton offre | Produit, prix, taux de remboursement (pré-rempli par le modèle, figé après publication) | |
| M6 | Ta marge | Marge habituelle (pré-remplie), curseur de marge minimale, budget. Résultat en direct : coût par vente, marge gardée, capacité (« up to 312 sales »), seuil de pause | Tout se recalcule à chaque mouvement. La capacité est souvent limitée par la profondeur du carnet, pas par le budget |
| M7 | Récap + financement | Récap lisible, bouton « Fund $1,000 with Apple Pay » (Stripe test) | Le budget est crédité en USDC testnet sur le contrat |
| M8 | C'est en ligne | Animation lime, QR plein écran, lien court `winz.app/c/joes-texas`, boutons Partager (feuille de partage native), Télécharger l'affiche (PNG), Copier le lien | L'affiche est générée avec le logo, la promesse et le QR |

### 5.2 Espace commerçant
- **Campagnes** : liste avec statut (Live, Paused, Sales closed, Won, Lost).
- **Détail de campagne** : ventes, encaissé, en attente, exposition, couverture (jauge 0 à 100 %), coût engagé, budget restant, capacité, cote en direct, seuil de pause, compte à rebours.
- **Bilan après le match** : ventes, nouveaux clients, coût réel de la promo en % et en $, comparaison avec une réduction équivalente, montant versé.
- **Réglages** : profil, solde, retrait (simulé), informations techniques (adresse, explorer) repliées.

### 5.3 Parcours client (objectif : du scan au ticket en moins de 30 secondes)

| # | Écran | Contenu | Règle |
|---|---|---|---|
| C1 | Page de campagne | Logo du commerçant, promesse en très gros (« 100 % back if Texas wins by 14+ »), produit et prix, chances en direct (« 12 % chance it's free »), compte à rebours de fin des ventes | Pas de connexion requise pour voir |
| C2 | Paiement | Quantité, bouton Apple Pay (ou Google Pay, ou carte), e-mail demandé dans la feuille de paiement | Aucun écran de connexion. Le wallet est créé côté serveur à partir de cet e-mail |
| C3 | Ticket | Ticket vivant plein écran (voir 5.4), bouton « Add Winz to Home Screen », activation des notifications | Montré aussi au comptoir comme preuve d'achat. Accessible sans connexion par un lien à jeton secret (`/t/<jeton>`) |
| C4 | Mes tickets | Liste des tickets (Live, Won, Not this time), solde remboursé, historique | Accès par e-mail + code ou passkey, avec le même e-mail que l'achat |

### 5.4 Ticket vivant
| Phase | Ce que voit le client |
|---|---|
| Avant le match | « 14 % chance this is free », jauge animée qui suit la cote en direct, compte à rebours |
| Pendant le match | Statut « Game on », cote en direct (le marché continue de bouger), score si disponible |
| Condition YES | Écran lime plein, « REFUNDED $20.00 », confettis sobres, notification push |
| Condition NO | « Not this time. Thanks for playing with Joe's », bouton « Find another promo » |
| Annulé ou reporté | « Game cancelled · your purchase stands », explication en une ligne |

---

## 6. Exigences fonctionnelles

Priorités : **Must** = dans la démo, **Should** = si le Must tourne mercredi soir, **Could** = bonus.

### `identity`
- **ID-1 (Must)** Connexion e-mail + code OTP, ou passkey. Le wallet EVM intégré est créé à la première connexion (commerçant), ou **pré-généré côté serveur au premier achat** à partir de l'e-mail de la feuille de paiement (client). L'e-mail est normalisé (minuscules, espaces retirés) avant toute recherche.
  - *Critère* : un nouvel utilisateur a une adresse Arc associée sans voir de phrase de récupération ni d'extension. Un client qui se connecte plus tard avec l'e-mail de son achat retrouve le même wallet et ses tickets.
- **ID-2 (Must)** Rôle commerçant ou client par compte. Un même e-mail peut avoir les deux.
- **ID-3 (Should)** Passkey proposée après le premier achat (« Use Face ID next time »), liée au compte existant. Jamais de création de compte par passkey seule.

### `market-data`
- **MD-1 (Must)** Synchroniser les événements Gemini actifs (sport d'abord) : ticker, titre, équipes, début (`startTime`), contrats et `instrumentSymbol`, y compris les marchés enfants (écarts, totaux). Cache de 60 s.
- **MD-2 (Must)** Flux temps réel du meilleur bid et ask et de la profondeur (10 niveaux) pour les instruments utilisés par au moins une campagne : WebSocket (`@bookTicker`, `@depth10`), avec en secours le carnet REST public `GET /v1/book/{instrumentSymbol}`.
- **MD-3 (Must)** Détecter le règlement d'un événement (YES, NO, annulé) via la liste des événements réglés de Gemini (`resolutionSide` du contrat), interrogée toutes les 60 s après le début.
- **MD-4 (Should)** Score en direct pour le ticket, si une source est disponible. Sinon le ticket ne l'affiche pas.

### `pricing`
- **PR-1 (Must)** `marginalTakerCost(book, skip, qty)` : coût, frais taker compris, des `qty` contrats suivants dans les asks, après avoir sauté `skip` contrats déjà promis à d'autres ventes. Retourne `null` si la profondeur est insuffisante.
- **PR-2 (Must)** `limits(offer, margins, budget, R)` : retourne `c_max`, `p_max`, le coût par vente au prix courant et la capacité restante (minimum entre la limite de budget et la limite de profondeur jusqu'à `p_max`).
- **PR-3 (Must)** Devis signé (EIP-712) : `campaignId, buyer, qty, maxHedgeCost, expiry (60 s), nonce`. Il est calculé et signé par le backend **au moment de l'achat on-chain**, jamais avant le paiement. Le contrat le vérifie et réserve `maxHedgeCost` sur le budget.
- **PR-4 (Must)** Tous les montants en entiers (micro-USDC, 6 décimales). Probabilités en points de base (0 à 10 000). Quantités de contrats en micro-contrats (1 micro-USDC d'exposition = 1 micro-contrat). Aucun flottant pour l'argent.
- **PR-5 (Must)** Sens des arrondis : un coût s'arrondit toujours au supérieur, une capacité toujours à l'inférieur.

### `campaigns`
- **CA-1 (Must)** Catalogue d'événements avec modèles calculés (M3, M4), limités aux contrats dont le carnet est coté.
- **CA-2 (Must)** Création : offre, condition, R figé, marges, budget, fin des ventes. Écrit la campagne on-chain et en base.
- **CA-3 (Must)** Lien court + QR + affiche PNG partageable (M8). Le lien ouvre C1 sur mobile et sur ordinateur.
- **CA-4 (Must)** Cycle de vie : `Draft → Live ⇄ Paused → SalesClosed → Settled(Yes|No|Void) → Closed`. La pause et la reprise sont automatiques (plafonds) ou manuelles (commerçant).
- **CA-5 (Must)** Arrêt automatique : pause si `p_eff > p_max`, si le coût garanti dépasse le budget disponible, ou si le carnet n'a pas la profondeur. Reprise automatique quand la condition redevient vraie depuis 10 s avec une marge d'un tick (pas d'oscillation). **Une pause automatique ne fait aucune transaction** : le backend cesse simplement de signer des devis, et sans devis signé `buyFor` est refusé. Seule la pause manuelle du commerçant est écrite on-chain. Fin des ventes 5 min avant l'événement.
- **CA-6 (Should)** Recharger le budget d'une campagne en cours.
- **CA-7 (Could)** Dupliquer une campagne pour le match suivant.

### `checkout`
- **CO-1 (Must)** Page de campagne publique (C1) rendue côté serveur, partageable avec un aperçu réseaux sociaux (Open Graph : promesse + logo).
- **CO-2 (Must)** Paiement Apple Pay, Google Pay ou carte via Stripe (mode test), en deux temps. La carte est **autorisée** (`capture_method: manual`). À l'autorisation, le backend calcule et signe le devis, puis le relayer appelle `buyFor(buyer, campaignId, qty, quote, sig)` avec des USDC de la trésorerie. Le paiement n'est **capturé** qu'une fois le ticket émis.
- **CO-3 (Must)** Idempotence : un paiement Stripe crée au plus un ticket (clé = id du PaymentIntent). Le traitement est déclenché par le webhook Stripe **et** par un appel de confirmation du client, les deux menant au même job.
- **CO-4 (Must)** Si la campagne est en pause au moment de l'achat on-chain, l'autorisation est annulée et le client voit « Promo just paused, you were not charged ».
- **CO-5 (Could)** Paiement direct en USDC pour les utilisateurs crypto (`buy`, signé par le client).

### `escrow-contract`
- **EC-1 (Must)** Contrat `WinzEscrow` (Solidity, Foundry, Arc testnet). Voir la section 8.
- **EC-2 (Must)** Invariant de solvabilité : le solde du contrat ≥ la somme, sur toutes les campagnes, des remboursements bloqués non payés et du budget non dépensé non rendu. Égalité stricte hors transferts directs vers le contrat.
- **EC-3 (Must)** R immuable après création, `buyFor` refusé après la fin des ventes, en pause manuelle ou sans devis valide, `settle` unique et seulement après la fin des ventes.
- **EC-4 (Must)** Sortie de secours : sans `settle` 7 jours après la fin des ventes, n'importe qui peut déclencher le remboursement d'un ticket vers son acheteur, pour le **montant remboursable** (le seul que le contrat détient), et le retour du budget restant au commerçant.
- **EC-5 (Must)** Garantie de coût on-chain : `buyFor` réserve `maxHedgeCost` sur le budget ; `chargeHedge` ne peut débiter un ticket qu'une fois et jamais au-delà de sa réserve.
- **EC-6 (Must)** Aucune fonction n'exige une transaction d'un commerçant ou d'un client. Les fonctions qui leur profitent sont appelées par le relayer, ou ouvertes à tous avec un bénéficiaire fixé par le contrat.
- **EC-7 (Must)** Un remboursement qui échoue (adresse sur la liste de blocage USDC) n'annule pas le lot : le ticket reste dû et les autres sont payés.

### `hedging-engine` (cœur du bounty Gemini)
- **HE-1 (Must)** Grand livre d'exposition par instrument : à chaque `TicketPurchased`, l'exposition de l'instrument augmente du montant remboursable. L'événement arrive par trois sources idempotentes sur `(tx_hash, log_index)` : le reçu de la transaction du relayer (chemin rapide), QuickNode Streams, et une relecture `eth_getLogs` toutes les 5 s.
- **HE-2 (Must)** Politique d'exécution (section 9.3) : maker d'abord, taker de secours, plafond d'exposition non couverte par instrument, passage en taker forcé à 60 min du début.
- **HE-3 (Must)** Agrégation : toutes les campagnes d'un même instrument partagent une position. Les ventes rapprochées sont regroupées en un ordre.
- **HE-4 (Must)** Allocation des coûts au commerçant par lot FIFO (section 9.5), plafonnée au coût garanti du devis.
- **HE-5 (Must)** Coupe-circuit : si Gemini ne répond pas, si le flux de prix est périmé (plus de 10 s) ou si l'exposition non couverte dépasse le plafond, plus aucun devis n'est signé pour les campagnes de l'instrument et aucun ordre n'est passé.
- **HE-6 (Must)** Réconciliation à la fin des ventes : position = exposition, à 0,01 contrat près. Le surplus est revendu, le manque acheté en taker. Tous les lots sont alors facturés (`chargeHedge`).
- **HE-7 (Should)** Croisement interne : si des campagnes sont exposées à des issues opposées du même événement (ex. « Texas wins » et « Texas loses »), l'exposition commune est compensée en interne sans passer d'ordre.
- **HE-8 (Must)** Exécution papier : adaptateur qui remplit les ordres sur le carnet réel de production en lecture seule (règles en 9.7). C'est le lieu d'exécution de la démo et l'adaptateur par défaut des tests.
- **HE-9 (Could)** Ajustement après le début du match : surcouverture ou revente selon la cote en cours de match. Hors MVP, à mentionner dans le pitch.
- **HE-10 (Must)** Adaptateur d'ordres réels Gemini derrière la même interface, prouvé par des ordres réels sur le sandbox avec un marché crypto : un ordre maker (`makerOrCancel`), une annulation, un ordre exécuté. La preuve (identifiants d'ordre) est visible sur le Hedge desk. Dépend de l'ouverture d'un compte sandbox (question ouverte 1).

### `settlement`
- **ST-1 (Must)** À la détection du résultat, l'oracle appelle `settle(campaignId, outcome)` pour toutes les campagnes de l'événement.
- **ST-2 (Must)** Résultat YES : remboursements poussés automatiquement (`refundBatch`, lots de 50) en moins de 10 s pour 300 tickets. Le commerçant reçoit en USDC le montant de son exposition, payé par la trésorerie (`payMerchant`), ainsi que son budget non dépensé (`release`).
- **ST-3 (Must)** Résultat NO : `release` verse le séquestre au commerçant, ainsi que le budget non dépensé.
- **ST-4 (Must)** Annulé (VOID) : traité comme NO pour le séquestre. Le coût de couverture déjà facturé est rendu au commerçant par la trésorerie (`payMerchant`).

### `live-ticket`
- **LT-1 (Must)** Ticket vivant (section 5.4) mis à jour en temps réel (cote toutes les 2 s maximum).
- **LT-2 (Must)** Espace « My tickets » (C4).
- **LT-3 (Should)** Notifications push web (PWA installée) : 1 h avant, au coup d'envoi, au résultat.
- **LT-4 (Should)** E-mail de confirmation d'achat et de résultat, en secours des notifications push.

### `merchant-dashboard`
- **MDB-1 (Must)** Détail de campagne en direct (section 5.2), latence inférieure à 3 s après une vente.
- **MDB-2 (Must)** Bilan de campagne après règlement.
- **MDB-3 (Must)** Page **Hedge desk** (publique, en lecture seule, pensée pour le jury) : pour chaque instrument actif, exposition et position, ordres maker en attente, exécutions, économie réalisée par rapport à une exécution 100 % taker, état du coupe-circuit, et **lieu d'exécution affiché en clair** (« PAPER · live Gemini book »).
- **MDB-4 (Must)** Mode démo (protégé par une clé admin, bandeau « DEMO MODE » visible) : faire bouger la cote simulée, forcer le résultat, rejouer une vente. Il sert aussi pour les contrats dont le carnet réel est vide.

---

## 7. Architecture

```
┌────────────── PWA Next.js (apps/web) ──────────────┐
│  Rôle commerçant · Rôle client · Hedge desk · Admin │
└───────┬─────────────────────┬──────────────────────┘
        │ API routes          │ Supabase Realtime (tables publiques, lecture seule)
        ▼                     ▼
┌──── Backend (apps/web/api) ────┐      ┌──── Moteur (apps/engine) ──────────┐
│ auth · campaigns · checkout    │      │ market-data (REST + WS Gemini)      │
│ webhooks Stripe et QuickNode   │─────►│ jobs : achat, création, règlement   │
│ → n'écrit que des jobs         │ jobs │ tx-sender (clés relayer et oracle)  │
└────────────────────────────────┘      │ exposure ledger · exécution papier  │
                                        │ coupe-circuit · réconciliation      │
                                        └──────┬──────────────────┬──────────┘
                                               │ viem             │
┌──── Arc testnet ────┐   reçu, Streams, logs  │         ┌─── Gemini ───────────┐
│ WinzEscrow · USDC   │◄───────────────────────┘         │ Prod : lecture seule  │
└─────────────────────┘                                  │ Sandbox : preuve ordres│
                                                         └──────────────────────┘
```

- **Postgres (Supabase)** est la source de vérité hors chaîne : campagnes, paiements, tickets indexés, exposition, lots, ordres, exécutions. Le contrat reste la source de vérité de l'argent.
- **Moteur** : processus long (WebSocket Gemini), déployé hors Vercel (Railway ou Fly.io). Il communique avec le web par Postgres (tables + Realtime) et une file de jobs (table `jobs`).
- **Un seul émetteur de transactions** : toutes les écritures on-chain passent par le module `tx-sender` du moteur, avec une file par clé. Les fonctions Vercel sont sans état et concurrentes : deux webhooks simultanés sur la même clé se voleraient le nonce. Les routes web ne font donc qu'insérer des jobs.
- **Relayer et oracle** : deux clés distinctes, en variables d'environnement du moteur, jamais côté client. L'oracle signe aussi les devis.
- **Temps réel** : le navigateur ne lit en Realtime que des tables publiques sans donnée personnelle (cotes, état public des campagnes, Hedge desk). Tout le reste passe par les routes API, qui vérifient le jeton Privy. Il n'existe pas de pont documenté entre un jeton Privy et les règles RLS de Supabase.

---

## 8. Contrat `WinzEscrow` (Arc testnet)

**USDC** : utiliser **uniquement l'interface ERC-20 de l'USDC sur Arc (6 décimales)**, à l'adresse `0x3600000000000000000000000000000000000000`, jamais le solde natif (18 décimales). L'adresse du jeton est un paramètre du constructeur, et un test vérifie `decimals() == 6` au déploiement.

**Rôles** : `relayer` (crée, achète, met en pause et clôt au nom du commerçant), `oracle` (signe les devis, facture la couverture, règle), `treasury` (adresse qui finance les achats et les budgets, reçoit le coût de couverture et paie le commerçant ; elle a approuvé le contrat). Pour le hackathon, la trésorerie est le compte du relayer.

### État
```solidity
enum Status { Live, Paused, SettledYes, SettledNo, Void }   // « ventes closes » se déduit de salesClose
struct Campaign {
  address merchant; bytes32 instrument; uint64 salesClose;
  uint128 unitPrice;      // micro-USDC
  uint16  refundBps;      // immuable
  uint128 hedgeBudget;    // total déposé
  uint128 hedgeReserved;  // somme des maxHedgeCost des tickets pas encore facturés
  uint128 hedgeSpent;     // somme facturée
  uint128 lockedRefunds;  // somme des refundable non payés
  uint128 merchantDue;    // dû par la trésorerie après settle (YES : exposition ; VOID : hedgeSpent)
  Status  status; bool released;
}
struct Ticket {
  uint64 campaignId; address buyer; uint128 paid; uint128 refundable;
  uint128 maxHedgeCost; bool hedgeCharged; bool paidOut;
}
```
Budget disponible = `hedgeBudget − hedgeSpent − hedgeReserved`.

### Fonctions
| Fonction | Appelant | Effet |
|---|---|---|
| `createCampaignFor(merchant, params, budget)` | Relayer | Enregistre les règles, prélève le budget de couverture sur la trésorerie |
| `topUpBudgetFor(id, amount)` | Relayer | Ajoute du budget depuis la trésorerie |
| `buyFor(buyer, id, qty, quote, sig)` | Relayer | Vérifie le devis EIP-712 (signataire oracle, expiration, nonce), exige `maxHedgeCost` ≤ budget disponible et le réserve, prélève `qty × unitPrice` sur la trésorerie, bloque la part remboursable, verse le reste au commerçant, émet le ticket |
| `buy(id, qty, quote, sig)` | Client (Could) | Idem, payé par le client |
| `setPaused(id, bool)` | Relayer | Pause ou reprise manuelle du commerçant (refusé après `salesClose`) |
| `closeSales(id)` | Relayer | Avance `salesClose` à maintenant, à la demande du commerçant. Ne peut jamais le reculer |
| `chargeHedge(ticketIds[], amounts[])` | Oracle | Pour chaque ticket, une seule fois et avant `settle` : débite `amount ≤ maxHedgeCost` vers la trésorerie et libère la réserve |
| `settle(id, outcome)` | Oracle | YES, NO ou VOID, une seule fois, après `salesClose`, et seulement si `hedgeReserved == 0`. Fixe `merchantDue` |
| `payMerchant(id)` | N'importe qui | Prélève `merchantDue` sur la trésorerie et le verse au commerçant |
| `refundBatch(id, ticketIds[])` | N'importe qui | Rembourse les tickets d'une campagne YES vers leur acheteur. Un transfert qui échoue laisse le ticket dû sans annuler le lot |
| `release(id)` | N'importe qui | Après `settle`, une seule fois : budget non dépensé au commerçant, plus le séquestre si NO ou VOID |
| `emergencyClaim(ticketId)` | N'importe qui | 7 jours après `salesClose` sans règlement : verse le montant remboursable à l'acheteur |
| `emergencyReleaseBudget(id)` | N'importe qui | Même délai : rend au commerçant le budget non dépensé, réserves comprises |

Le remboursement des clients vient du séquestre et ne dépend jamais de la trésorerie. `payMerchant` est séparé de `settle` pour qu'une trésorerie à sec ne puisse pas bloquer un règlement.

### Événements
`CampaignCreated(id, merchant, instrument, refundBps, salesClose, budget)` · `BudgetToppedUp(id, amount)` · `TicketPurchased(ticketId, id, buyer, paid, refundable, maxHedgeCost)` · `CampaignPaused(id, paused)` · `SalesClosedEarly(id, salesClose)` · `HedgeCharged(ticketId, id, amount)` · `CampaignSettled(id, outcome, merchantDue)` · `MerchantPaid(id, amount)` · `TicketRefunded(ticketId, amount)` · `RefundFailed(ticketId)` · `CampaignReleased(id, amount)`

### Spécificités Arc à respecter
- Gas payé en USDC, prix de base minimal de 20 gwei : fixer `maxFeePerGas` au moins à cette valeur. Limite de gas par bloc : 30 M (mesuré le 17 novembre).
- `block.timestamp` a une granularité d'une seconde alors que les blocs sortent toutes les 0,5 s : ordonner par numéro de bloc et index de log.
- Un transfert ERC-20 émet deux logs `Transfer` (un par interface). N'indexer que les événements de `WinzEscrow`.
- RPC public limité à environ 10 requêtes par seconde : utiliser le point d'accès QuickNode, le RPC public en secours.

---

## 9. Moteur de couverture (détail)

### 9.1 Données
- Carnet par instrument (bids et asks sur 10 niveaux), horodaté. Il est considéré **périmé à plus de 10 s**.
- Mid = (bid + ask) / 2 ; microprice = (ask × bidQty + bid × askQty) / (bidQty + askQty). Le ticket vivant affiche le mid ; la tarification utilise l'ask effectif.
- Unités : prix en points de base, quantités en micro-contrats. Les ordres sont arrondis à 0,01 contrat.

### 9.2 Devis (au moment de l'achat on-chain)
1. q = qty × unitPrice × refundBps / 10 000 = exposition du ticket en micro-USDC = nombre de micro-contrats nécessaires.
2. coût = `marginalTakerCost(carnet, en_attente, q)`, où `en_attente` est l'exposition déjà vendue et pas encore couverte. C'est le prix de la tranche que cette vente consommera vraiment, pas la moyenne depuis le haut du carnet.
3. Si le carnet est périmé ou trop peu profond, si p_eff > p_max ou si le coût garanti dépasse le budget disponible : pas de devis, l'achat est refusé et l'autorisation de paiement annulée.
4. Sinon, devis signé avec `maxHedgeCost = coût + tolérance (1 tick × q)`, valable 60 s.

### 9.3 Politique d'exécution, par instrument
Variables : `E` exposition (contrats), `H` position détenue, `W` ordres maker en attente, `U = E − H` non couvert.

```
à chaque nouvelle exposition ou tick de marché :
  si U ≤ 0 : rien
  si temps_avant_début < 60 min        → taker sur U (jusqu'au plafond de prix)
  sinon si U × p > U_max (ex. 300 $)    → taker sur U − U_max / p
  sinon                                 → maker : ordre limite au meilleur bid + 1 tick
                                          (sans croiser l'ask), quantité U − W
  un ordre maker non exécuté après TTL (90 s), ou si l'ask monte de 2 ticks
     → annuler et passer en taker sur le reste
  tout coût d'exécution > coût garanti du lot → la différence est à la charge de Winz (P&L)
```

Paramètres (`U_max`, TTL, tolérance, délai avant le début) en config et affichés sur le Hedge desk. La politique ne connaît que l'interface `ExecutionVenue` : elle est la même en papier et en réel.

### 9.4 Croisement interne (Should)
Si l'instrument A (« Texas wins ») et l'instrument B (« Texas loses ») sont complémentaires, une exposition sur les deux est compensée à hauteur du minimum des deux. Acheter YES sur A et YES sur B coûte p_A + p_B ≥ 1 pour un paiement certain de 1 : Winz garde donc les deux primes et paie lui-même le côté gagnant, sans passer d'ordre. Le moteur ne couvre sur Gemini que l'écart net. Le gain (spread et frais évités) est affiché sur le Hedge desk.

### 9.5 Allocation des coûts (FIFO)
- Chaque vente crée un **lot** de q micro-contrats, avec son `maxHedgeCost`.
- Les exécutions remplissent les lots **dans l'ordre d'arrivée**. Chaque lot reçoit le prix et les frais des contrats qui l'ont couvert.
- Coût facturé au commerçant pour le lot = `min(coût réel, maxHedgeCost)`, via `chargeHedge` (une fois par ticket, quand le lot est entièrement couvert).
- Résultat : chaque commerçant paie la couverture de **ses** ventes au moment où elles ont eu lieu, jamais celle des autres, et jamais plus que le devis.

### 9.6 Résultat et payout
- YES : Gemini paie 1 $ par contrat détenu. En exécution papier ce paiement est simulé : la trésorerie testnet verse au commerçant son exposition en USDC (`payMerchant`). NO : les contrats valent 0.
- Le P&L du moteur (économies maker, pertes de garantie, croisements internes) est suivi par événement et affiché sur le Hedge desk.

### 9.7 Exécution papier (lieu d'exécution de la démo)
- **Taker** : l'ordre parcourt les asks du dernier carnet frais, jusqu'à son prix limite, dans la limite des quantités affichées, avec les frais taker. La profondeur consommée est retenue jusqu'à la prochaine mise à jour du niveau, pour ne pas vendre deux fois la même liquidité.
- **Maker** : l'ordre repose virtuellement. Il est exécuté quand le meilleur ask descend à son prix ou en dessous, ou quand une transaction publique s'imprime à son prix ou en dessous (dans la limite de la taille imprimée). Frais maker du barème en vigueur.
- **Limite assumée** : la position dans la file d'attente n'est pas simulée, les exécutions maker sont donc optimistes. C'est écrit sur le Hedge desk.
- Chaque exécution papier garde le carnet contre lequel elle a été remplie, pour pouvoir être rejouée et vérifiée.

---

## 10. Données et API

### Tables principales
`users(id, email, wallet, roles)` · `merchants(id, user_id, name, category, logo)` · `events(ticker, title, sport, starts_at, status, result)` · `instruments(symbol, event_ticker, label, type, strike)` · `campaigns(id, onchain_id, merchant_id, instrument, product, unit_price, refund_bps, usual_margin_bps, min_margin_bps, budget, sales_close, status, sale_state, slug)` · `payments(stripe_pi, campaign_id, email, buyer, qty, status, ticket_id)` · `tickets(id, onchain_id, campaign_id, buyer, paid, refundable, max_hedge_cost, status, access_token, tx_hash)` · `chain_events(tx_hash, log_index, block_number, name, args, source)` · `chain_txs(id, idempotency_key, signer, kind, payload, nonce, tx_hash, status, attempts)` · `lots(id, ticket_id, instrument, qty, max_hedge_cost, filled_qty, cost, charged)` · `positions(instrument, exposure, held, working, venue)` · `orders(id, instrument, side, kind, price, qty, status, venue, venue_order_id)` · `fills(id, order_id, price, qty, fee, ts, book_ref)` · `engine_pnl(event_ticker, maker_savings, guarantee_losses, crossing_gains)` · `engine_params(key, value)` · `demo_overrides(instrument, book, forced_result)` · `push_subscriptions(user_id, endpoint, keys)` · `jobs(id, kind, payload, status, attempts, idempotency_key)`

Tables publiques pour le temps réel (lecture seule, aucune donnée personnelle) : `live_instruments(symbol, bid, ask, mid, ts, stale)` · `live_campaigns(slug, sale_state, sales, exposure, hedged_pct, outcome)` · `live_hedge_desk(instrument, exposure, held, working, venue, breaker, pnl)`

`quotes` disparaît comme table : le devis est créé et consommé dans le même job d'achat, sa trace est le ticket (`max_hedge_cost`) et la transaction.

### Endpoints (API routes Next.js)
| Route | Usage |
|---|---|
| `GET /api/me` · `POST /api/merchants` | Profil et rôles ; création du commerce (M2) |
| `GET /api/events?sport=` | Catalogue + modèles calculés pour un commerçant |
| `POST /api/campaigns/preview` | Coût par vente, marge gardée, capacité, seuil de pause |
| `POST /api/campaigns` | Crée le brouillon et le PaymentIntent du budget (M7) |
| `GET /api/campaigns` · `GET /api/campaigns/:id` | Liste et détail pour le commerçant connecté |
| `POST /api/campaigns/:id/pause` · `/resume` · `/close` | Pause, reprise et clôture manuelles |
| `GET /api/c/:slug` | Données publiques de la page de campagne |
| `POST /api/checkout` | Vérifie que la vente est ouverte, crée le PaymentIntent en capture manuelle |
| `POST /api/checkout/:pi/confirm` · `GET /api/checkout/:pi` | Déclenche le job d'achat (même job que le webhook) ; suit son état jusqu'au jeton du ticket |
| `GET /api/t/:token` | Ticket par lien à jeton secret, sans connexion |
| `GET /api/tickets` | Tickets de l'utilisateur connecté |
| `POST /api/webhooks/stripe` | Signature vérifiée sur le corps brut. Autorisation → job d'achat ; budget payé → job de création |
| `POST /api/webhooks/quicknode` | Signature HMAC vérifiée. `TicketPurchased` → `chain_events` (idempotent sur tx_hash + log_index) |
| `GET /api/hedge-desk` | État public du moteur |
| `POST /api/admin/demo/*` | Mode démo (clé admin) |

Les schémas zod de chaque requête et réponse vivent dans `packages/shared`. Ils sont figés en premier, avec des réponses d'exemple, pour que le front avance sur des données simulées pendant que le back se construit.

---

## 11. Stack technique

| Couche | Choix | Remarque |
|---|---|---|
| Front | Next.js 15 (App Router), React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui | PWA : manifest + service worker (`@serwist/next`) |
| Auth + wallet | Privy (e-mail OTP, passkey, wallet EVM intégré, pré-génération par e-mail côté serveur, chaîne personnalisée Arc testnet, id 5042002) | Alternative : Circle Wallets. Voir « Demander d'abord » |
| Paiement | Stripe (mode test), Express Checkout Element (Apple Pay, Google Pay, carte), `emailRequired`, capture manuelle | Un seul domaine stable, enregistré chez Stripe pour Apple Pay |
| On-chain | Solidity 0.8.24+, Foundry (Arc Foundry si l'amont ne suffit pas), `evm_version` fixé, OpenZeppelin (EIP-712, SafeERC20), viem (`arcTestnet`) | RPC `rpc.testnet.arc.io`, explorer `explorer.testnet.arc.io` |
| Indexation | Reçu du relayer, QuickNode Streams (Arc testnet) → webhook, relecture `eth_getLogs` toutes les 5 s | Trois sources, une seule table idempotente |
| Données | Supabase (Postgres + Realtime) | Migrations SQL versionnées |
| Moteur | Node 22 + TypeScript | Processus long, Railway ou Fly.io |
| Gemini | REST `api.gemini.com/v1/prediction-markets/*`, carnet `GET /v1/book/{symbol}`, WebSocket `wss://ws.gemini.com` ; sandbox `api.sandbox.gemini.com` pour la preuve d'ordres | Lecture sans clé. Clés sandbox en variables d'environnement |
| QR + affiche | `qrcode` + `@vercel/og` (image PNG générée) | |
| Hébergement | Vercel (web), Railway ou Fly.io (moteur) | |

---

## 12. Commandes

```bash
# Installation
pnpm install

# Développement
pnpm dev                                  # web + moteur en parallèle (turbo)
pnpm --filter web dev                     # PWA seule, http://localhost:3000
pnpm --filter engine dev                  # moteur seul (watch), exécution papier sur carnet réel
pnpm --filter engine dev -- --sim         # moteur sur carnets enregistrés ou pilotés (tests, mode démo)
pnpm --filter engine venue:check          # preuve d'ordres réels sur le sandbox Gemini (HE-10)

# Contrats
cd packages/contracts && forge build
cd packages/contracts && forge test -vvv
cd packages/contracts && forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL --broadcast

# Qualité
pnpm lint                                 # ESLint + Prettier --check
pnpm typecheck                            # tsc --noEmit sur tout le monorepo
pnpm test                                 # Vitest (unitaires + intégration)
pnpm test -- --coverage
pnpm e2e                                  # Playwright, parcours de démo complet
pnpm completion-check                     # relit TASKS.md contre l'arbre ; hors CI

# Base
pnpm db:migrate                           # supabase db push
pnpm db:seed                              # commerçant et campagne de démo

# Build
pnpm build
```

---

## 13. Structure du projet

```
winz/
├── SPEC.md
├── TASKS.md
├── apps/
│   ├── web/                      → PWA Next.js (commerçant, client, hedge desk, admin)
│   │   ├── app/(merchant)/       → onboarding M0–M8, campagnes, bilan
│   │   ├── app/(fan)/            → page de campagne C1, paiement, ticket, mes tickets
│   │   ├── app/hedge-desk/       → page publique du moteur
│   │   ├── app/api/              → routes API et webhooks
│   │   ├── components/           → composants UI (shadcn + Winz)
│   │   └── lib/                  → clients (supabase, stripe, privy, viem)
│   └── engine/                   → moteur de couverture et oracle
│       ├── src/market-data/      → adaptateurs Gemini (REST, WS) et carnets pilotés
│       ├── src/venues/           → ExecutionVenue : papier, Gemini réel
│       ├── src/hedging/          → grand livre, politique d'exécution, allocation FIFO
│       ├── src/chain/            → tx-sender, ingestion des événements
│       ├── src/settlement/       → surveillance des résultats, settle, refundBatch
│       └── src/jobs/             → file de jobs (achat, création, règlement)
├── packages/
│   ├── contracts/                → Foundry : src/WinzEscrow.sol, test/, script/
│   ├── pricing/                  → fonctions pures de tarification (partagées web + moteur)
│   └── shared/                   → types, schémas zod, constantes, ABI générées, réponses d'exemple
├── supabase/migrations/          → SQL versionné
├── scripts/                      → completion-check, outils de démo
├── e2e/                          → tests Playwright
└── docs/                         → architecture, pitch, notes de démo
```

---

## 14. Style de code

- TypeScript strict, ES modules, fonctions pures dans `packages/pricing` (aucune I/O).
- **Argent en `bigint` micro-USDC**, probabilités en **points de base entiers**, quantités en micro-contrats. Jamais de `number` pour un montant.
- Validation des entrées avec zod à chaque frontière (API, webhooks, messages Gemini).
- Nommage : `camelCase` (fonctions et variables), `PascalCase` (types et composants), `SCREAMING_SNAKE` (constantes), fichiers en `kebab-case`.
- Textes produit en anglais, centralisés dans `apps/web/lib/copy.ts`.

```ts
// packages/pricing/src/limits.ts
import type { Book } from "@winz/shared";

export const BPS = 10_000n;
export const TICK_BPS = 100n; // 0,01 $
export const TAKER_FEE_RATE_BPS = 700n; // 0,07

/** Coût max d'une vente en points de base du prix : marge habituelle − marge minimale. */
export function maxCostBps(usualMarginBps: bigint, minMarginBps: bigint): bigint {
  if (minMarginBps >= usualMarginBps) return 0n;
  return usualMarginBps - minMarginBps;
}

/** Frais taker par contrat, en bps du dollar, arrondis au supérieur : 0,07 × p × (1 − p). */
export function takerFeeBps(priceBps: bigint): bigint {
  const num = TAKER_FEE_RATE_BPS * priceBps * (BPS - priceBps);
  const den = BPS * BPS;
  return (num + den - 1n) / den;
}

/** Plus grand prix (bps, au tick) tel que R × (p + frais(p)) ≤ c_max ; 0 si aucun. */
export function pauseThresholdBps(costBps: bigint, refundBps: bigint): bigint {
  let best = 0n;
  for (let p = TICK_BPS; p < BPS; p += TICK_BPS) {
    if (refundBps * (p + takerFeeBps(p)) > costBps * BPS) break;
    best = p;
  }
  return best;
}

/**
 * Coût en micro-USDC, frais compris et arrondi au supérieur, des `qty` micro-contrats suivants
 * dans les asks après avoir sauté `skip` micro-contrats déjà promis ; null si le carnet est trop court.
 */
export function marginalTakerCost(book: Book, skip: bigint, qty: bigint): bigint | null {
  let toSkip = skip;
  let remaining = qty;
  let cost = 0n; // micro-contrats × bps
  for (const level of book.asks) {
    const skipped = toSkip < level.qty ? toSkip : level.qty;
    toSkip -= skipped;
    const available = level.qty - skipped;
    if (available === 0n) continue;
    const take = remaining < available ? remaining : available;
    cost += take * (level.priceBps + takerFeeBps(level.priceBps));
    remaining -= take;
    if (remaining === 0n) return (cost + BPS - 1n) / BPS;
  }
  return null;
}
```

Solidity : `custom errors`, `checks-effects-interactions`, `SafeERC20`, NatSpec sur chaque fonction externe, aucun `tx.origin`.

---

## 15. Stratégie de test

| Niveau | Outil | Cible |
|---|---|---|
| Contrat, unitaire | `forge test` | Chaque fonction, chaque refus (pause, `salesClose`, devis expiré ou rejoué, double `settle`, facturation au-delà de la réserve, `settle` avec réserve ouverte, remboursement vers une adresse bloquée) |
| Contrat, invariant | `forge test` (invariant) | Solvabilité (EC-2) ; `lockedRefunds == Σ refundable non payés` ; `hedgeSpent + hedgeReserved ≤ hedgeBudget` ; R jamais modifié ; aucune sortie d'argent sans règle |
| Tarification | Vitest | Frais, seuil de pause, coût marginal, capacité, arrondis (cas limites : carnet vide, profondeur exacte, R = 0, `skip` supérieur à la profondeur) |
| Moteur | Vitest + carnets enregistrés | Politique maker puis taker, TTL, `U_max`, forçage avant le début, coupe-circuit, FIFO, réconciliation, règles de l'exécution papier |
| Intégration | Vitest + Anvil (fork local) + Gemini simulé | Autorisation Stripe → devis → `buyFor` → capture → exposition → ordre → `chargeHedge` → `settle` → remboursements ; et le chemin « pause → autorisation annulée » |
| E2E | Playwright (viewport iPhone 15) | Onboarding commerçant M0–M8 ; achat client C1–C3 par carte de test ; résultat YES et NO en mode démo |

- Couverture visée : **≥ 90 %** sur `packages/pricing` et `WinzEscrow`, ≥ 70 % sur le moteur.
- Aucun test n'appelle Gemini en réseau : ils tournent sur des carnets enregistrés.
- Apple Pay ne s'automatise pas : il se teste à la main sur un iPhone, avec une vraie carte dans Wallet (non débitée en mode test).
- Avant la démo : deux répétitions complètes, sans intervention manuelle autre que le mode démo.

---

## 16. Limites

### Toujours
- Montants en `bigint` micro-USDC, probabilités en points de base.
- Webhooks idempotents et à signature vérifiée (Stripe : id du PaymentIntent ; QuickNode : tx_hash + log_index).
- Garder R immuable une fois la campagne publiée.
- Afficher le bandeau « DEMO MODE » dès qu'une action du mode démo est utilisée, et le lieu d'exécution sur le Hedge desk.
- Tester sur un viewport iPhone avant de considérer un écran comme fini.
- Lancer `pnpm lint && pnpm typecheck && pnpm test` avant chaque commit.
- Passer par `tx-sender` pour toute écriture on-chain.

### Demander d'abord
- Choix final du fournisseur de wallet (Privy par défaut, Circle Wallets en alternative).
- Toute modification du schéma de base ou de l'interface du contrat après le déploiement.
- Toute modification d'un schéma de `packages/shared` une fois figé : le front et le back en dépendent.
- Ajout d'une dépendance hors stack listée.
- Valeurs des paramètres de risque (`U_max`, TTL, tolérance, délai avant le début).
- Direction visuelle détaillée : aucun `design-system/*/MASTER.md` n'existe. Lancer `/design:start` avec l'identité de la section 2 avant de coder les écrans.
- Polices exactes du wordmark et de l'interface (à identifier dans le fichier source de l'identité).

### Jamais
- Mainnet, ou fonds réels.
- Clés (oracle, relayer, Gemini, Stripe) dans le code ou côté client.
- Mot crypto dans le parcours client (wallet, USDC, gas, blockchain, seed).
- Modifier le taux de remboursement d'une campagne publiée, ou facturer un lot au-delà de son coût garanti.
- Vendre après `salesClose`, ou passer des ordres quand le coupe-circuit est actif.
- Présenter une exécution papier comme un ordre réel.
- Supprimer ou désactiver un test qui échoue sans validation.

---

## 17. Critères de succès

1. **Onboarding commerçant** : de M0 à une campagne en ligne (QR affiché) en **moins de 2 minutes** et **moins de 15 taps**, sans aucune explication orale.
2. **Achat client** : du scan du QR au ticket affiché en **moins de 30 secondes**, sans aucun mot crypto à l'écran.
3. **Promesse** : sur l'ensemble des tests, R ne change jamais après la publication, et aucune vente n'a lieu au-delà de `p_max` ou du budget.
4. **Couverture** : en conditions de démo, `U × p` ne dépasse jamais `U_max` plus de 5 secondes, et à la fin des ventes `|H − E| ≤ 1` contrat.
5. **Coût** : aucun commerçant n'est facturé au-delà du coût garanti de ses devis. Le Hedge desk affiche l'économie maker par rapport au taker.
6. **Règlement** : 300 tickets remboursés en **moins de 10 secondes** après `settle` sur Arc testnet.
7. **Live** : le tableau de bord commerçant reflète une vente en **moins de 3 secondes** ; le ticket vivant suit la cote avec **moins de 2 secondes** de décalage.
8. **Robustesse** : le parcours complet de démo passe **deux fois de suite** sur le testnet sans correction manuelle.

---

## 18. Hors périmètre

- App native iOS ou Android : la PWA suffit pour la démo.
- Ajustement automatique du taux de remboursement : casse la promesse marketing.
- Le client choisit son camp : bonne idée, mais complique le contrat et le message.
- Bot Grok et ElevenLabs : écartés.
- Conversion carte vers USDC réelle et retrait vers carte : simulés.
- Ordres réels sur les marchés sportifs de production : demandent un compte américain vérifié et des fonds réels.
- Fil des promos autour de soi, campagnes multi-événements, remboursement sur montant variable.
- Winz qui garantit lui-même un prix fixe (rôle d'assureur).
- Conformité juridique par État (loteries, promotions) : à étudier après le hackathon.

---

## 19. Questions ouvertes

1. **Compte Gemini sandbox** : peut-on ouvrir un compte sandbox avec une clé de rôle Trader sans identité américaine ? À tester dès maintenant (Alexandre). Si non, HE-10 est remplacé par des tests de l'adaptateur contre un serveur simulé, et on le dit.
2. **Marchés Gemini pour la démo** : Arkansas–Texas se joue samedi 21 novembre à 14 h 30 CST, donc après le rendu Devpost. Pour la vidéo, choisir un match de basket universitaire ou NBA de mercredi ou jeudi soir (Téo), ou forcer le résultat en mode démo.
3. **Liquidité des écarts** : le 17 novembre, les 26 contrats d'écart d'Arkansas–Texas avaient un carnet vide, alors que le moneyline cotait 0,90 / 0,92 avec environ 2 000 contrats à l'ask. Vérifier chaque jour quand les écarts se remplissent. S'ils restent vides, la promo phare se fait sur un moneyline d'outsider, ou en mode démo.
4. **Fournisseur de wallet** : Privy ou Circle Wallets, selon le support du testnet Arc et le temps d'intégration (test de connexion en 2 h).
5. **Pitch « ce n'est pas un pari »** : le client ne mise rien, il achète un produit au prix normal. C'est le commerçant qui se couvre, comme avec une assurance de promotion. Formulation exacte à valider.
6. **Paramètres de risque** : valeurs par défaut proposées (`U_max` 300 $, TTL 90 s, taker forcé à 60 min du début), à valider par Alexandre.
7. **Match annulé ou reporté** : la règle de Gemini (remboursement, dernier prix, NO) n'a pas été trouvée. Le chemin VOID existe, mais ce qui le déclenche (statut `invalid` ?) reste à confirmer dans le règlement des contrats.
8. **Allocation d'USDC testnet** : réponse de Circle/Arc attendue (hypothèse 8).
9. **Points d'intégration à prouver le premier jour** : pré-génération Privy puis connexion sur le même wallet ; capture manuelle Stripe avec Apple Pay ; déploiement Foundry sur Arc ; jeu de données `logs` de Streams sur Arc testnet. Chacun a une tâche dédiée dans `TASKS.md`.

---

## 20. Journal des modifications (v1.0 → v1.1)

Revue technique du 17 novembre 2026. Les faits marqués « vérifié » ont été lus en direct sur les API publiques de Gemini et sur le RPC d'Arc testnet ce jour-là. Les autres viennent de la documentation officielle lue à travers des résultats de recherche, et doivent être confirmés par les tâches de la question ouverte 9.

### Décisions d'Alexandre
| Sujet | Décision |
|---|---|
| Lieu d'exécution | Papier sur le carnet réel de production, plus un adaptateur d'ordres réels prouvé sur le sandbox (HE-8 passe en Must, HE-10 ajouté) |
| Langage du moteur | TypeScript |
| USDC testnet | Demander une allocation à Circle ; adresse du jeton en paramètre ; jeton de test en secours |
| Paiement | Autoriser, acheter on-chain, puis capturer |

### Hypothèses de la v1.0 contredites par les faits
| v1.0 | Constat | Correction |
|---|---|---|
| Ordres sur le sandbox Gemini | Vérifié : le sandbox liste 106 événements, 88 crypto et 18 matières premières, aucun sport | Hypothèse 3, HE-8, HE-10, 9.7 |
| Carnets assez profonds pour « up to 312 sales » | Vérifié : écarts d'Arkansas–Texas vides à J−4 ; quelques centaines à 2 000 contrats en haut de carnet sur les moneylines | M4, M6, CA-1, CA-5, question 3 |
| La trésorerie paie en USDC testnet sans limite | Faucet : 20 USDC par adresse toutes les 2 h | Hypothèse 8 |
| Le commerçant et le client appellent le contrat | Le gas se paie en USDC : un wallet vide ne peut rien envoyer | Hypothèse 5, EC-6, section 8 |
| Frais en points de base fixes | Frais taker = 0,07 × p × (1 − p) par contrat | 4.1, 4.3 (p_max de l'exemple : 18 % et non 20 %), section 14 |
| Contrats entiers, écart de 1 contrat | Vérifié : quantité minimale et pas de 0,01 contrat | 4.1, PR-4, HE-6, 9.5 |

### Défauts du contrat corrigés
| Défaut | Correction |
|---|---|
| `emergencyClaim` rendait le montant payé alors que seul le montant remboursable est en séquestre : avec R < 100 %, il vidait les autres campagnes | Rend le montant remboursable (EC-4) |
| Le budget n'était pas réservé à la vente : plusieurs ventes pouvaient engager le même budget, et le plafond par devis n'était vérifiable nulle part | Réserve par ticket, facturation plafonnée on-chain (EC-5) |
| `chargeHedge` ne disait pas où va l'argent | Vers la trésorerie |
| Aucun moyen on-chain de payer l'exposition au commerçant si YES | `merchantDue` + `payMerchant` |
| Budget restant bloqué à jamais si YES ; coût de couverture non remboursable si VOID | `release` sur toutes les issues ; `merchantDue` si VOID |
| Invariant EC-2 faux : le contrat détient aussi les budgets | Invariant de solvabilité |
| Un remboursement vers une adresse bloquée annulait tout le lot de 50 | Échec isolé (EC-7) |
| Pas de clôture anticipée des ventes ; statut `SalesClosed` impossible à maintenir sans transaction | `closeSales` ; statut déduit de `salesClose` |

### Flux corrigés
| v1.0 | Problème | Correction |
|---|---|---|
| Devis de 30 s signé avant le paiement | Face ID plus le webhook Stripe dépassent souvent 30 s : l'achat on-chain échouait après le paiement | Devis signé au moment de l'achat ; capture manuelle (PR-3, CO-2, CO-4, 9.2) |
| p_eff = VWAP(en attente + q) | C'est une moyenne depuis le haut du carnet : elle sous-estime le prix de la tranche vraiment consommée | `marginalTakerCost` (PR-1, 9.2) |
| Pause automatique écrite on-chain | Une transaction à chaque oscillation de la cote | Refus de signer, avec hystérésis (CA-5) |
| Relayer dans les routes Vercel | Fonctions concurrentes sur une même clé : conflits de nonce | `tx-sender` unique dans le moteur (section 7) |
| Streams, puis `eth_getLogs` toutes les 60 s | Incompatible avec le critère « vente visible en 3 s » si Streams tarde | Trois sources, relecture à 5 s (HE-1) |
| Realtime Supabase pour tout | Pas de pont documenté entre Privy et RLS | Tables publiques sans donnée personnelle (section 7) |
| Wallet créé à la connexion du client | Le client ne se connecte pas avant de payer | Pré-génération par e-mail, ticket par lien à jeton (hypothèse 5, ID-1, C3) |
| Webhooks idempotents | Rien sur l'authenticité | Signature vérifiée (section 10, 16) |

### Risque de périmètre, non tranché
La v1.0 compte une quarantaine de Must pour trois jours à deux. La v1.1 n'en retire aucun : `TASKS.md` les ordonne pour que le parcours de démo tienne debout en premier, et marque ce qui peut glisser sans casser la démo. C'est à Alexandre et Téo de reclasser.
