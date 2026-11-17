# Spec : Winz

> **All the hype. None of the risk.**
> Promos « remboursé si l'équipe gagne », couvertes vente par vente sur Gemini Predictions, réglées en USDC sur Arc.

Version 1.0 · 16 novembre 2026 · Statut : **à valider** (Téo), puis revue technique (Alexandre)
Hackathon : UBC 2026 (Austin) · rendu Devpost vendredi 20 novembre, 12 h CST · finale samedi 21 novembre

---

## 0. Hypothèses posées (à corriger avant de coder)

1. **Langue de l'app** : interface et textes produit en **anglais US** (jury et démo à Austin). La spec reste en français.
2. **Un seul monorepo TypeScript**, sauf le moteur de couverture : Alexandre peut le passer en **Rust**. C'est le seul point de stack laissé ouvert (voir « Demander d'abord »).
3. **Arc testnet uniquement**, aucun fonds réel. Gemini : **lecture en production** (cotes, carnets, résultats), **ordres sur le sandbox Gemini**, avec un compte ouvert sur place aux États-Unis.
4. **Le paiement par carte est simulé de bout en bout** : Apple Pay via Stripe en mode test, puis la trésorerie Winz paie à la place du client en USDC testnet. C'est annoncé comme tel dans la démo.
5. **Le client ne signe jamais de transaction** dans le parcours carte. Son wallet est créé à la connexion par e-mail, et c'est le relayer Winz qui achète en son nom (`buyFor`).
6. **Une campagne = une offre à prix fixe + une condition** (un contrat binaire Gemini) + **un taux de remboursement fixe**. Pas de campagne multi-événements ni de remboursement sur montant variable dans le MVP.
7. **L'oracle est une clé unique tenue par le backend Winz** pour le hackathon. C'est assumé et dit dans le pitch.

---

## 1. Objectif

### Le problème
Une promo « remboursé si l'équipe gagne » fait venir du monde, mais un commerçant ne peut pas encaisser le risque d'un remboursement massif. Ce marché existe (SCA Promotions depuis des décennies, PlayAbly avec Kalshi en 2026), mais il est réservé aux grandes marques, passe par un courtier, et le client doit croire la marque sur parole.

### Ce qu'on construit
Une **app web mobile installable (PWA)** avec deux rôles :

- **Commerçant** : crée une campagne en un tap à partir d'un catalogue d'événements, fixe une promesse qui ne bougera plus (ex. « 100 % remboursé si Texas gagne de plus de 14 points »), sa marge minimale et son budget. Il partage ensuite un **lien** et un **QR code**.
- **Client** : scanne le QR ou ouvre le lien depuis les réseaux sociaux, paie avec **Apple Pay ou sa carte**, et reçoit un **ticket vivant** qui affiche ses chances d'être remboursé en direct, jusqu'au remboursement automatique.

Derrière, un **moteur de couverture** agrège l'exposition de toutes les campagnes d'un même contrat Gemini et la couvre :
- en **ordres maker** d'abord ;
- en **taker de secours** ensuite ;
- avec un **plafond de risque non couvert** et un **coût par vente garanti**.

### Pourquoi ça gagne
| Cible | Argument |
|---|---|
| Track Consumer | Onboarding sans aucun mot crypto, paiement Apple Pay, ticket vivant |
| Bounty Gemini | Gemini est le cœur du produit : catalogue, prix, capacité, exécution maker, règlement. Une page « Hedge desk » montre le moteur au jury |
| Prix Arc | Commerce réel en USDC, séquestre programmable, remboursements en masse en moins de 10 s |
| QuickNode | Streams déclenche la couverture à chaque vente on-chain |

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
| `pricing` | Prix effectif, plafonds, capacité, devis signés (bibliothèque pure, sans I/O) | `market-data` |
| `campaigns` | Création en un tap, modèles, lien et QR, cycle de vie, arrêt automatique | `identity`, `pricing`, `escrow-contract` |
| `checkout` | Page de campagne, Apple Pay ou carte (test), achat par relayer | `identity`, `campaigns`, `escrow-contract` |
| `hedging-engine` | Grand livre d'exposition, exécution maker puis taker, croisement interne, allocation des coûts, coupe-circuit | `market-data`, `pricing`, `escrow-contract` |
| `settlement` | Lecture des résultats, `settle`, remboursements groupés, paiement du commerçant | `market-data`, `escrow-contract`, `hedging-engine` |
| `live-ticket` | Ticket vivant, espace client, notifications push | `checkout`, `market-data`, `settlement` |
| `merchant-dashboard` | Suivi en direct, bilan, page publique « Hedge desk » | `campaigns`, `hedging-engine`, `settlement` |

Ordre de construction : `identity`, `market-data`, `escrow-contract` (en parallèle) → `pricing` → `campaigns`, `checkout` → `hedging-engine` → `settlement` → `live-ticket`, `merchant-dashboard`.

---

## 4. Concepts et règles métier

### 4.1 Vocabulaire
| Terme | Définition |
|---|---|
| Campagne | Une offre (produit, prix P), une condition (contrat binaire Gemini, résultat YES), un taux de remboursement **R fixe**, une période de vente |
| Condition | Le contrat Gemini dont le YES déclenche le remboursement (moneyline, écart, total de points) |
| Ticket | Le reçu on-chain d'un achat. Montant payé, montant remboursable = R × montant payé |
| Exposition | Ce que Winz doit compenser au commerçant si la condition est YES, soit la somme des montants remboursables |
| Couverture | Les contrats YES détenus. 1 contrat paie 1 $ si YES |
| p | Probabilité du marché = prix du contrat YES (mid ou ask selon l'usage) |
| p_eff | Prix effectif d'achat de la couverture : VWAP sur le carnet pour la quantité voulue, frais compris |

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
probabilité max qui arrête la vente p_max = c_max / R     (frais déduits)
coût d'une vente                    coût = R × P × p_eff
la vente est ouverte si             p_eff ≤ p_max   ET   coût ≤ budget_restant
```

Exemple : Joe vend une pizza à 20 $, marge habituelle 65 %, marge minimale 45 %, R = 100 %.
- c_max = 20 %, donc p_max = 0,20.
- Avec Texas +14 à 12 %, la vente coûte environ 2,50 $ et Joe garde 10,50 $ de marge au lieu de 13 $.
- Si la cote monte au-dessus de 20 %, la campagne se met en pause.
- L'écran affiche : « Your promo pauses if Texas' chances go above 20 %. »

### 4.4 Garantie de coût par vente
Au moment de la vente, le devis fixe un **coût maximal garanti**. Le moteur ne peut pas facturer plus au commerçant :
- s'il couvre en maker moins cher, l'économie va au commerçant ;
- s'il doit payer plus que ce coût garanti (le marché a bougé entre la vente et l'exécution), la différence est absorbée par la marge Winz et comptée dans le P&L du moteur.

C'est ce qui permet de promettre la marge minimale au commerçant.

### 4.5 Fin des ventes
Les ventes s'arrêtent **5 minutes avant le début de l'événement** (heure fournie par Gemini), ou plus tôt si le commerçant le décide. Aucune vente n'est possible après.

### 4.6 Ce que le commerçant et le client voient en argent
- **Commerçant** : tout en dollars. Il reçoit ses ventes en USDC dans son wallet intégré, affiché comme « Balance $ ».
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
| M4 | Choisis ta promo | 3 à 5 modèles calculés pour ce match. Ex. « Free if Texas wins by 14+ · ~12 % of price », « Half back if Texas wins · ~31 % » | Coût estimé affiché sur chaque carte. Les modèles au-dessus de p_max sont grisés |
| M5 | Ton offre | Produit, prix, taux de remboursement (pré-rempli par le modèle, figé après publication) | |
| M6 | Ta marge | Marge habituelle (pré-remplie), curseur de marge minimale, budget. Résultat en direct : coût par vente, marge gardée, capacité (« up to 312 sales »), seuil de pause | Tout se recalcule à chaque mouvement |
| M7 | Récap + financement | Récap lisible, bouton « Fund $1,000 with Apple Pay » (Stripe test) | Le budget est crédité en USDC testnet sur le contrat |
| M8 | C'est en ligne | Animation lime, QR plein écran, lien court `winz.app/c/joes-texas`, boutons Partager (feuille de partage native), Télécharger l'affiche (PNG), Copier le lien | L'affiche est générée avec le logo, la promesse et le QR |

### 5.2 Espace commerçant
- **Campagnes** : liste avec statut (Live, Paused, Sales closed, Won, Lost).
- **Détail de campagne** : ventes, encaissé, exposition, couverture (jauge 0 à 100 %), coût engagé, budget restant, capacité, cote en direct, seuil de pause, compte à rebours.
- **Bilan après le match** : ventes, nouveaux clients, coût réel de la promo en % et en $, comparaison avec une réduction équivalente, montant versé.
- **Réglages** : profil, solde, retrait (simulé), informations techniques (adresse, explorer) repliées.

### 5.3 Parcours client (objectif : du scan au ticket en moins de 30 secondes)

| # | Écran | Contenu | Règle |
|---|---|---|---|
| C1 | Page de campagne | Logo du commerçant, promesse en très gros (« 100 % back if Texas wins by 14+ »), produit et prix, chances en direct (« 12 % chance it's free »), compte à rebours de fin des ventes | Pas de connexion requise pour voir |
| C2 | Paiement | Quantité, bouton Apple Pay (ou Google Pay, ou carte), e-mail demandé dans la feuille de paiement | Connexion et création du wallet faites en même temps, sans écran supplémentaire |
| C3 | Ticket | Ticket vivant plein écran (voir 5.4), bouton « Add Winz to Home Screen », activation des notifications | Montré aussi au comptoir comme preuve d'achat |
| C4 | Mes tickets | Liste des tickets (Live, Won, Not this time), solde remboursé, historique | Accès par lien magique ou passkey |

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
- **ID-1 (Must)** Connexion e-mail + code OTP, ou passkey. Le wallet EVM intégré est créé à la première connexion.
  - *Critère* : un nouvel utilisateur se connecte et a une adresse Arc associée sans voir de phrase de récupération ni d'extension.
- **ID-2 (Must)** Rôle commerçant ou client par compte. Un même e-mail peut avoir les deux.
- **ID-3 (Should)** Passkey proposée après le premier achat (« Use Face ID next time »).

### `market-data`
- **MD-1 (Must)** Synchroniser les événements Gemini actifs (sport d'abord) : ticker, titre, équipes, début, contrats et symboles d'instrument. Cache de 60 s.
- **MD-2 (Must)** Flux temps réel du meilleur bid et ask et de la profondeur (10 niveaux) pour les instruments utilisés par au moins une campagne.
- **MD-3 (Must)** Détecter le règlement d'un événement (YES, NO, annulé) via la liste des événements réglés de Gemini, interrogée toutes les 60 s après le début.
- **MD-4 (Should)** Score en direct pour le ticket, si une source est disponible. Sinon le ticket ne l'affiche pas.

### `pricing`
- **PR-1 (Must)** `effectivePrice(book, qty, fees)` : VWAP sur les asks pour `qty` contrats, frais compris. Retourne `null` si la profondeur est insuffisante.
- **PR-2 (Must)** `limits(offer, margins, budget, R)` : retourne `c_max`, `p_max`, le coût par vente au prix courant et la capacité restante (minimum entre la limite de budget et la limite de profondeur jusqu'à `p_max`).
- **PR-3 (Must)** Devis signé (EIP-712) : `campaignId, qty, maxCostPerUnit, expiry (30 s), nonce`. Le contrat le vérifie lors de l'achat.
- **PR-4 (Must)** Tous les montants en entiers (micro-USDC, 6 décimales). Probabilités en points de base (0 à 10 000). Aucun flottant pour l'argent.

### `campaigns`
- **CA-1 (Must)** Catalogue d'événements avec modèles calculés (M3, M4).
- **CA-2 (Must)** Création : offre, condition, R figé, marges, budget, fin des ventes. Écrit la campagne on-chain et en base.
- **CA-3 (Must)** Lien court + QR + affiche PNG partageable (M8). Le lien ouvre C1 sur mobile et sur ordinateur.
- **CA-4 (Must)** Cycle de vie : `Draft → Live ⇄ Paused → SalesClosed → Settled(Yes|No|Void) → Closed`. La pause et la reprise sont automatiques (plafonds) ou manuelles (commerçant).
- **CA-5 (Must)** Arrêt automatique : pause si `p_eff > p_max` ou si `coût > budget_restant`, reprise automatique si la condition redevient vraie. Fin des ventes 5 min avant l'événement.
- **CA-6 (Should)** Recharger le budget d'une campagne en cours.
- **CA-7 (Could)** Dupliquer une campagne pour le match suivant.

### `checkout`
- **CO-1 (Must)** Page de campagne publique (C1) rendue côté serveur, partageable avec un aperçu réseaux sociaux (Open Graph : promesse + logo).
- **CO-2 (Must)** Paiement Apple Pay, Google Pay ou carte via Stripe (mode test). Sur paiement confirmé (webhook Stripe), le relayer appelle `buyFor(buyer, campaignId, qty, quote, sig)` avec des USDC de la trésorerie.
- **CO-3 (Must)** Idempotence : un paiement Stripe crée au plus un ticket (clé = id du PaymentIntent).
- **CO-4 (Must)** Si la campagne s'est mise en pause entre le devis et le paiement, le paiement est annulé automatiquement et le client voit « Promo just paused, you were not charged ».
- **CO-5 (Could)** Paiement direct en USDC pour les utilisateurs crypto (`buy`, signé par le client).

### `escrow-contract`
- **EC-1 (Must)** Contrat `WinzEscrow` (Solidity, Foundry, Arc testnet). Voir la section 8.
- **EC-2 (Must)** Invariant : pour chaque campagne non réglée, le solde bloqué = la somme des montants remboursables des tickets non payés.
- **EC-3 (Must)** R immuable après création, `buyFor` refusé après la fin des ventes ou en pause, `settle` unique et seulement après la fin des ventes.
- **EC-4 (Must)** Sortie de secours : sans `settle` 7 jours après la fin des ventes, chaque client peut récupérer son paiement (`emergencyClaim`).

### `hedging-engine` (cœur du bounty Gemini)
- **HE-1 (Must)** Grand livre d'exposition par instrument : à chaque `TicketPurchased` (reçu par QuickNode Streams, avec relecture des logs en secours), l'exposition de l'instrument augmente du montant remboursable.
- **HE-2 (Must)** Politique d'exécution (section 9.3) : maker d'abord, taker de secours, plafond d'exposition non couverte par instrument, passage en taker forcé à 60 min du début.
- **HE-3 (Must)** Agrégation : toutes les campagnes d'un même instrument partagent une position. Les ventes rapprochées sont regroupées en un ordre.
- **HE-4 (Must)** Allocation des coûts au commerçant par lot FIFO (section 9.5), plafonnée au coût garanti du devis.
- **HE-5 (Must)** Coupe-circuit : si Gemini ne répond pas, si le flux de prix est périmé (plus de 10 s) ou si l'exposition non couverte dépasse le plafond, toutes les campagnes de l'instrument passent en pause.
- **HE-6 (Must)** Réconciliation à la fin des ventes : position = exposition, à 1 contrat près. Le surplus est revendu, le manque acheté en taker.
- **HE-7 (Should)** Croisement interne : si des campagnes sont exposées à des issues opposées du même événement (ex. « Texas wins » et « Texas loses »), l'exposition commune est compensée en interne sans passer d'ordre.
- **HE-8 (Should)** Mode carnet simulé : adaptateur d'exécution qui remplit les ordres sur le carnet réel en lecture seule. Sert aux tests et de plan B.
- **HE-9 (Could)** Ajustement après le début du match : surcouverture ou revente selon la cote en cours de match. Hors MVP, à mentionner dans le pitch.

### `settlement`
- **ST-1 (Must)** À la détection du résultat, l'oracle appelle `settle(campaignId, outcome)` pour toutes les campagnes de l'événement.
- **ST-2 (Must)** Résultat YES : remboursements poussés automatiquement (`refundBatch`, lots de 50) en moins de 10 s pour 300 tickets. Le commerçant reçoit en USDC le montant de son exposition, payé par la trésorerie grâce au payout Gemini.
- **ST-3 (Must)** Résultat NO : `release` verse le séquestre au commerçant, ainsi que le budget non consommé.
- **ST-4 (Must)** Annulé (VOID) : traité comme NO pour le séquestre. Les contrats sont remboursés ou revendus par Gemini, et le coût de couverture est rendu au commerçant.

### `live-ticket`
- **LT-1 (Must)** Ticket vivant (section 5.4) mis à jour en temps réel (cote toutes les 2 s maximum).
- **LT-2 (Must)** Espace « My tickets » (C4).
- **LT-3 (Should)** Notifications push web (PWA installée) : 1 h avant, au coup d'envoi, au résultat.
- **LT-4 (Should)** E-mail de confirmation d'achat et de résultat, en secours des notifications push.

### `merchant-dashboard`
- **MDB-1 (Must)** Détail de campagne en direct (section 5.2), latence inférieure à 3 s après une vente.
- **MDB-2 (Must)** Bilan de campagne après règlement.
- **MDB-3 (Must)** Page **Hedge desk** (publique, en lecture seule, pensée pour le jury) : pour chaque instrument actif, exposition et position, ordres maker en attente, exécutions, économie réalisée par rapport à une exécution 100 % taker, et état du coupe-circuit.
- **MDB-4 (Must)** Mode démo (protégé par une clé admin, bandeau « DEMO MODE » visible) : faire bouger la cote simulée, forcer le résultat, rejouer une vente.

---

## 7. Architecture

```
┌────────────── PWA Next.js (apps/web) ──────────────┐
│  Rôle commerçant · Rôle client · Hedge desk · Admin │
└───────┬─────────────────────┬──────────────────────┘
        │ API routes          │ Supabase Realtime (live)
        ▼                     ▼
┌──── Backend (apps/web/api) ────┐      ┌──── Moteur (apps/engine) ────┐
│ auth · campaigns · quotes      │      │ market-data (REST + WS Gemini)│
│ Stripe webhooks · relayer      │◄────►│ exposure ledger · exécution   │
│ QuickNode webhook → file d'attente│   │ coupe-circuit · réconciliation│
└───────┬────────────────────────┘      │ settlement watcher · oracle   │
        │ viem                           └──────┬───────────────┬───────┘
        ▼                                       │               │
┌──── Arc testnet ────┐   QuickNode Streams     │      ┌── Gemini ──┐
│ WinzEscrow · USDC   │──── TicketPurchased ────┘      │ Prod : data │
└─────────────────────┘                                │ Sandbox : ordres │
        ▲                                              └────────────┘
        └─ settle / refundBatch / release (oracle) ◄── moteur
```

- **Postgres (Supabase)** est la source de vérité hors chaîne : campagnes, devis, tickets indexés, exposition, ordres, exécutions, allocations. Le contrat reste la source de vérité de l'argent.
- **Moteur** : processus long (WebSocket Gemini), déployé hors Vercel (Railway ou Fly.io). Il communique avec le web par Postgres (tables + Realtime) et une file d'attente de jobs (table `jobs` ou pg-boss).
- **Relayer et oracle** : deux clés distinctes, en variables d'environnement, jamais côté client.

---

## 8. Contrat `WinzEscrow` (Arc testnet)

**USDC** : utiliser **uniquement l'interface ERC-20 de l'USDC sur Arc (6 décimales)**, jamais le solde natif (18 décimales). Un test vérifie les décimales au déploiement.

### État
```solidity
enum Status { Live, Paused, SalesClosed, SettledYes, SettledNo, Void }
struct Campaign {
  address merchant; bytes32 instrument; uint64 salesClose;
  uint128 unitPrice;      // micro-USDC
  uint16  refundBps;      // immuable
  uint128 hedgeBudget; uint128 hedgeSpent;
  uint128 lockedRefunds;  // = somme des refundable non payés
  Status  status;
}
struct Ticket { uint64 campaignId; address buyer; uint128 paid; uint128 refundable; bool paidOut; }
```

### Fonctions
| Fonction | Appelant | Effet |
|---|---|---|
| `createCampaign(params)` | Commerçant (via relayer) | Enregistre les règles, verse le budget de couverture |
| `topUpBudget(id, amount)` | Commerçant | Ajoute du budget |
| `buyFor(buyer, id, qty, quote, sig)` | Relayer | Vérifie le devis EIP-712 (signataire oracle, expiration, nonce), prélève `qty × unitPrice` sur la trésorerie, bloque la part remboursable, verse le reste au commerçant, émet le ticket |
| `buy(id, qty, quote, sig)` | Client (Could) | Idem, payé par le client |
| `setPaused(id, bool)` | Oracle ou commerçant | Pause ou reprise (refusé après `salesClose`) |
| `chargeHedge(id, amount)` | Oracle | Débite le budget du coût de couverture alloué (≤ budget restant) |
| `settle(id, outcome)` | Oracle | YES, NO ou VOID, une seule fois, après `salesClose` |
| `refundBatch(id, ticketIds[])` | N'importe qui | Rembourse les tickets d'une campagne YES |
| `release(id)` | N'importe qui | NO ou VOID : séquestre et budget restant au commerçant |
| `emergencyClaim(ticketId)` | Client | 7 jours après `salesClose` sans règlement : remboursement du montant payé |

### Événements
`CampaignCreated(id, merchant, instrument, refundBps, salesClose)` · `TicketPurchased(ticketId, id, buyer, paid, refundable)` · `CampaignPaused(id, paused)` · `HedgeCharged(id, amount)` · `CampaignSettled(id, outcome)` · `TicketRefunded(ticketId, amount)` · `CampaignReleased(id, amount)`

---

## 9. Moteur de couverture (détail)

### 9.1 Données
- Carnet par instrument (bids et asks sur 10 niveaux), horodaté. Il est considéré **périmé à plus de 10 s**.
- Mid = (bid + ask) / 2 ; microprice = (ask × bidQty + bid × askQty) / (bidQty + askQty). Le ticket vivant affiche le mid ; la tarification utilise l'ask effectif.

### 9.2 Devis (avant chaque vente)
1. q = qty × unitPrice × refundBps / 10 000 / 1 $ = nombre de contrats nécessaires.
2. p_eff = VWAP_ask(exposition_en_attente + q) + frais. L'exécution déjà en file est incluse, pour ne pas se tromper sur le prix marginal.
3. Si p_eff > p_max ou si coût > budget_restant : pas de devis, campagne en pause.
4. Sinon, devis signé avec `maxCostPerUnit = p_eff + tolérance (1 tick)`, valable 30 s.

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
  tout prix d'exécution > maxCostPerUnit du lot → la différence est à la charge de Winz (P&L)
```

Paramètres (`U_max`, TTL, tolérance, délai avant le début) en config et affichés sur le Hedge desk.

### 9.4 Croisement interne (Should)
Si l'instrument A (« Texas wins ») et l'instrument B (« Texas loses ») sont complémentaires, une exposition sur les deux est compensée à hauteur du minimum des deux : quel que soit le résultat, l'argent bloqué d'un côté finance l'autre. Le moteur ne couvre sur Gemini que l'écart net. Le gain est affiché sur le Hedge desk.

### 9.5 Allocation des coûts (FIFO)
- Chaque vente crée un **lot** de q contrats, avec son `maxCostPerUnit`.
- Les exécutions remplissent les lots **dans l'ordre d'arrivée**. Chaque lot reçoit le prix des contrats qui l'ont couvert.
- Coût facturé au commerçant pour le lot = `min(coût réel, q × maxCostPerUnit)`, via `chargeHedge`.
- Résultat : chaque commerçant paie la couverture de **ses** ventes au moment où elles ont eu lieu, jamais celle des autres, et jamais plus que le devis.

### 9.6 Résultat et payout
- YES : Gemini paie 1 $ par contrat détenu (sur le compte Winz). La trésorerie verse au commerçant son exposition en USDC (en démo, le virement depuis Gemini est simulé). NO : les contrats valent 0.
- Le P&L du moteur (économies maker, pertes de garantie, croisements internes) est suivi par événement et affiché sur le Hedge desk.

---

## 10. Données et API

### Tables principales
`users(id, email, wallet, roles)` · `merchants(id, user_id, name, category, logo)` · `events(ticker, title, sport, starts_at, status, result)` · `instruments(symbol, event_ticker, label, type)` · `campaigns(id, onchain_id, merchant_id, instrument, product, unit_price, refund_bps, usual_margin_bps, min_margin_bps, budget, sales_close, status, slug)` · `quotes(id, campaign_id, qty, max_cost_per_unit, expiry, nonce, sig, used)` · `payments(stripe_pi, campaign_id, buyer, qty, status, ticket_id)` · `tickets(id, campaign_id, buyer, paid, refundable, status, tx_hash)` · `lots(id, ticket_id, instrument, qty, max_cost_per_unit, filled_qty, cost)` · `orders(id, instrument, side, kind, price, qty, status, gemini_id)` · `fills(id, order_id, price, qty, fee, ts)` · `book_snapshots(instrument, ts, bids, asks)` · `jobs(id, kind, payload, status, attempts)`

### Endpoints (API routes Next.js)
| Route | Usage |
|---|---|
| `GET /api/events?sport=` | Catalogue + modèles calculés pour un commerçant |
| `POST /api/campaigns/preview` | Coût par vente, marge gardée, capacité, seuil de pause |
| `POST /api/campaigns` | Crée la campagne (on-chain + base), retourne slug, lien, QR |
| `GET /api/c/:slug` | Données publiques de la page de campagne |
| `POST /api/quotes` | Devis signé pour un achat |
| `POST /api/checkout` | Crée le PaymentIntent Stripe lié au devis |
| `POST /api/webhooks/stripe` | Paiement confirmé → job `buyFor` |
| `POST /api/webhooks/quicknode` | `TicketPurchased` → job exposition (idempotent sur tx_hash + log_index) |
| `GET /api/tickets` | Tickets de l'utilisateur connecté |
| `GET /api/hedge-desk` | État public du moteur |
| `POST /api/admin/demo/*` | Mode démo (clé admin) |

---

## 11. Stack technique

| Couche | Choix | Remarque |
|---|---|---|
| Front | Next.js 15 (App Router), React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui | PWA : manifest + service worker (`@serwist/next`) |
| Auth + wallet | Privy (e-mail OTP, passkey, wallet EVM intégré, chaîne personnalisée Arc testnet, id 5042002) | Alternative : Circle Wallets. Voir « Demander d'abord » |
| Paiement | Stripe (mode test), Express Checkout Element (Apple Pay, Google Pay, carte) | Domaine à vérifier pour Apple Pay |
| On-chain | Solidity 0.8.24+, Foundry, OpenZeppelin (EIP-712, SafeERC20), viem | |
| Indexation | QuickNode Streams (Arc testnet) → webhook ; relecture `eth_getLogs` toutes les 60 s en secours | |
| Données | Supabase (Postgres + Realtime) | Migrations SQL versionnées |
| Moteur | Node 22 + TypeScript (par défaut) ou Rust/Tokio (choix d'Alexandre) | Processus long, Railway ou Fly.io |
| Gemini | REST et WebSocket prediction markets (prod en lecture, sandbox pour les ordres) | Clés API en variables d'environnement |
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
pnpm --filter engine dev                  # moteur seul (watch)
pnpm --filter engine dev -- --sim         # moteur avec carnet simulé (HE-8)

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
├── apps/
│   ├── web/                      → PWA Next.js (commerçant, client, hedge desk, admin)
│   │   ├── app/(merchant)/       → onboarding M0–M8, campagnes, bilan
│   │   ├── app/(fan)/            → page de campagne C1, paiement, ticket, mes tickets
│   │   ├── app/hedge-desk/       → page publique du moteur
│   │   ├── app/api/              → routes API et webhooks
│   │   ├── components/           → composants UI (shadcn + Winz)
│   │   └── lib/                  → clients (supabase, stripe, privy, viem)
│   └── engine/                   → moteur de couverture et oracle
│       ├── src/market-data/      → adaptateurs Gemini (REST, WS) et carnet simulé
│       ├── src/hedging/          → grand livre, politique d'exécution, allocation FIFO
│       ├── src/settlement/       → surveillance des résultats, settle, refundBatch
│       └── src/jobs/             → file de jobs
├── packages/
│   ├── contracts/                → Foundry : src/WinzEscrow.sol, test/, script/
│   ├── pricing/                  → fonctions pures de tarification (partagées web + moteur)
│   └── shared/                   → types, schémas zod, constantes, ABI générées
├── supabase/migrations/          → SQL versionné
├── e2e/                          → tests Playwright
└── docs/                         → architecture, pitch, notes de démo
```

---

## 14. Style de code

- TypeScript strict, ES modules, fonctions pures dans `packages/pricing` (aucune I/O).
- **Argent en `bigint` micro-USDC**, probabilités en **points de base entiers**. Jamais de `number` pour un montant.
- Validation des entrées avec zod à chaque frontière (API, webhooks, messages Gemini).
- Nommage : `camelCase` (fonctions et variables), `PascalCase` (types et composants), `SCREAMING_SNAKE` (constantes), fichiers en `kebab-case`.
- Textes produit en anglais, centralisés dans `apps/web/lib/copy.ts`.

```ts
// packages/pricing/src/limits.ts
import type { Book } from "@winz/shared";

export const BPS = 10_000n;

/** Coût max d'une vente en points de base du prix : marge habituelle − marge minimale. */
export function maxCostBps(usualMarginBps: bigint, minMarginBps: bigint): bigint {
  if (minMarginBps >= usualMarginBps) return 0n;
  return usualMarginBps - minMarginBps;
}

/** Probabilité maximale (bps) au-delà de laquelle la campagne se met en pause. */
export function pauseThresholdBps(costBps: bigint, refundBps: bigint, feeBps: bigint): bigint {
  if (refundBps === 0n) return BPS;
  const p = (costBps * BPS) / refundBps - feeBps;
  return p > 0n ? p : 0n;
}

/** VWAP des asks pour `qty` contrats ; null si le carnet n'a pas la profondeur. */
export function effectiveAskBps(book: Book, qty: bigint): bigint | null {
  let remaining = qty;
  let cost = 0n;
  for (const level of book.asks) {
    const take = remaining < level.qty ? remaining : level.qty;
    cost += take * level.priceBps;
    remaining -= take;
    if (remaining === 0n) return cost / qty;
  }
  return null;
}
```

Solidity : `custom errors`, `checks-effects-interactions`, `SafeERC20`, NatSpec sur chaque fonction externe, aucun `tx.origin`.

---

## 15. Stratégie de test

| Niveau | Outil | Cible |
|---|---|---|
| Contrat, unitaire | `forge test` | Chaque fonction, chaque refus (pause, `salesClose`, devis expiré ou rejoué, double `settle`) |
| Contrat, invariant | `forge test` (invariant) | `lockedRefunds == Σ refundable non payés` ; R jamais modifié ; aucune sortie d'argent sans règle |
| Tarification | Vitest | `effectiveAskBps`, seuils, capacité, arrondis (cas limites : carnet vide, profondeur exacte, R = 0) |
| Moteur | Vitest + carnets enregistrés | Politique maker puis taker, TTL, `U_max`, forçage avant le début, coupe-circuit, FIFO, réconciliation |
| Intégration | Vitest + Anvil (fork local) + Gemini simulé | Webhook Stripe → `buyFor` → Streams (simulé) → exposition → ordre → `settle` → remboursements |
| E2E | Playwright (viewport iPhone 15) | Onboarding commerçant M0–M8 ; achat client C1–C3 ; résultat YES et NO en mode démo |

- Couverture visée : **≥ 90 %** sur `packages/pricing` et `WinzEscrow`, ≥ 70 % sur le moteur.
- Le carnet simulé (HE-8) est l'adaptateur par défaut des tests : aucun test n'appelle Gemini en réseau.
- Avant la démo : deux répétitions complètes, sans intervention manuelle autre que le mode démo.

---

## 16. Limites

### Toujours
- Montants en `bigint` micro-USDC, probabilités en points de base.
- Webhooks idempotents (Stripe : id du PaymentIntent ; QuickNode : tx_hash + log_index).
- Garder R immuable une fois la campagne publiée.
- Afficher le bandeau « DEMO MODE » dès qu'une action du mode démo est utilisée.
- Tester sur un viewport iPhone avant de considérer un écran comme fini.
- Lancer `pnpm lint && pnpm typecheck && pnpm test` avant chaque commit.

### Demander d'abord
- Choix final du fournisseur de wallet (Privy par défaut, Circle Wallets en alternative).
- Moteur en Rust plutôt qu'en TypeScript.
- Toute modification du schéma de base ou de l'interface du contrat après le déploiement.
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
- Fil des promos autour de soi, campagnes multi-événements, remboursement sur montant variable.
- Winz qui garantit lui-même un prix fixe (rôle d'assureur).
- Conformité juridique par État (loteries, promotions) : à étudier après le hackathon.

---

## 19. Questions ouvertes

1. **Compte Gemini sandbox sur place** : l'ouverture d'un compte capable de passer des ordres demande-t-elle une résidence ou une identité US ? À vérifier dès l'arrivée. Sinon, le carnet simulé (HE-8) sert de plan B, avec cotes et profondeur réelles.
2. **Marchés Gemini pour la démo** : liste à fournir (Téo). Il faut au moins un événement qui se règle avant le 20 novembre, sinon le résultat est forcé en mode démo.
3. **Frais Gemini et taille minimale d'ordre** : à relever pour paramétrer `pricing`.
4. **Fournisseur de wallet** : Privy ou Circle Wallets, selon le support du testnet Arc et le temps d'intégration (test de connexion en 2 h).
5. **Pitch « ce n'est pas un pari »** : le client ne mise rien, il achète un produit au prix normal. C'est le commerçant qui se couvre, comme avec une assurance de promotion. Formulation exacte à valider.
6. **Paramètres de risque** : valeurs par défaut proposées (`U_max` 300 $, TTL 90 s, taker forcé à 60 min du début), à valider par Alexandre.
