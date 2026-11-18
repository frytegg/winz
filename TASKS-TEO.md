# Tâches de Téo (front)

Extrait de `TASKS.md`, qui reste la source de vérité : on coche les cases là-bas. La spec est `SPEC.md` v1.1.
Rendu Devpost : **vendredi 20 novembre, 12 h CST**.

## Accès au dépôt

- Dépôt : https://github.com/frytegg/winz (Alexandre t'invite comme collaborateur, tu acceptes l'invitation reçue par e-mail ou sur https://github.com/frytegg/winz/invitations).
- Le code est sur `main` depuis le 18 novembre au soir : tes branches partent de `main` et tes PR visent `main`.

```bash
git clone https://github.com/frytegg/winz.git
```

```bash
cd winz && git checkout main
```

```bash
git checkout -b teo/<nom-de-la-tache>
```

```bash
pnpm install
```

- Tes dossiers : `apps/web/app/(merchant)`, `apps/web/app/(fan)`, `apps/web/app/hedge-desk`, `apps/web/app/admin`, `apps/web/components`.
- Les dossiers d'Alexandre, à ne pas modifier sans lui : `apps/web/app/api`, `apps/web/lib/server`, `packages/*`, `apps/engine`, `supabase`.
- Une PR par tâche, vers la branche de travail. Commits conventionnels (`feat:`, `fix:`…), sans mention d'IA.

## Ce que tu dois lire en premier (20 minutes)

1. `SPEC.md` section 20 : ce qui a changé depuis ta v1.0, et pourquoi.
2. Sections 2 (identité), 5 (écrans) et 10 (API) : c'est ce que tu construis et ce que tu consommes.
3. Quatre changements qui touchent tes écrans :
   - **M4** : un modèle de promo n'est proposé que si son contrat est coté. Les écarts de points peuvent être vides plusieurs jours avant le match.
   - **M6** : le seuil de pause de l'exemple de Joe passe à 18 % (les frais Gemini sont comptés). La capacité est souvent limitée par la profondeur du marché, pas par le budget.
   - **C2 et C3** : aucune connexion avant le paiement. L'e-mail vient de la feuille Apple Pay. Le ticket s'ouvre par un lien secret `/t/<jeton>`, sans connexion.
   - **Commerçant** : il touche tout de suite la part non remboursable, le reste après le match. L'écran montre « Balance » et « Pending ».

## Ce que tu dois valider tout de suite

- [ ] **La spec v1.1** : un oui, ou la liste de ce qui ne va pas.
- [ ] **Les formes de l'API** (tâche F-05) : Alexandre te livre les schémas et une réponse d'exemple par route dans `packages/shared`. Une fois que tu as dit oui, elles sont figées : tout changement se demande.

## Tes tâches, dans l'ordre

### Mardi matin : comptes et sondes
- [ ] **F-03** Projet Vercel et **un domaine stable**, compte Stripe en mode test avec ce domaine enregistré pour Apple Pay, application Privy (e-mail + code, passkey, chaîne Arc testnet, id 5042002).
  Fini quand : le domaine sert une page en HTTPS et Stripe le montre comme domaine de paiement vérifié.
- [ ] **S-02** Sonde Privy : pré-générer un wallet pour un e-mail depuis le serveur, puis se connecter avec cet e-mail par code. Tester aussi le compte de test à code fixe.
  Fini quand : les deux adresses sont identiques. Sinon, on teste Circle Wallets et on en parle.
- [ ] **S-03** Sonde Stripe sur un vrai iPhone : Express Checkout avec `capture_method: manual` et `emailRequired`, payé avec Apple Pay.
  Fini quand : l'autorisation arrive, l'e-mail aussi, et la capture comme l'annulation fonctionnent. Teste aussi l'ouverture depuis le navigateur d'Instagram.

### Mardi : écrans sur l'API simulée
Tu n'attends pas le back : avec `APP_API_MOCK=true`, chaque route renvoie une réponse d'exemple (tâche F-06, livrée à la porte G0).

- [ ] **U-01** Direction visuelle et socle : couleurs, typographie, composants de base, manifeste PWA, icône, textes dans `apps/web/lib/copy.ts`.
- [ ] **U-02** Onboarding commerçant M0 à M8. Les calculs de M6 viennent de `packages/pricing`, ne les réécris pas.
  Fini quand : de M0 à M8 en moins de 15 taps.
- [ ] **U-03** Page de campagne C1, paiement C2, ticket vivant C3 avec ses cinq phases.
  Fini quand : chaque phase s'affiche, sans aucun mot crypto à l'écran.
- [ ] **I-01** Connexion Privy côté client. La vérification du jeton côté serveur est faite avec Alexandre.

### Mercredi matin : brancher le réel (porte G1, mercredi midi)
- [ ] **U-04** Remplacer l'API simulée par la vraie : onboarding, page de campagne, paiement, ticket.
  Fini quand : depuis un téléphone, sur le testnet, une campagne est créée, payée par carte de test, et le ticket s'affiche.

### Mercredi : le reste des écrans (porte G2, mercredi soir)
- [ ] **U-05** Espace commerçant : liste des campagnes, détail en direct, réglages. Bilan après match ◇.
- [ ] **U-06** Hedge desk public : exposition, position, ordres, exécutions, économie maker, coupe-circuit, et la mention « PAPER · live Gemini book » bien visible.
- [ ] **U-07** Panneau admin du mode démo et bandeau « DEMO MODE ».
- [ ] **U-08** Lien court, QR plein écran, partage natif. Affiche PNG ◇, aperçu réseaux sociaux ◇.
- [ ] **U-09** « My tickets » ◇.
- [ ] **U-10** ◇ Notifications push et e-mails (seulement si tout le reste tourne).
- [ ] **I-02** ◇ Passkey proposée après le premier achat.

◇ = peut glisser sans casser la démo. À décider avec Alexandre.

### Jeudi et vendredi : preuves et rendu
- [ ] **Q-02** Relire les tests Playwright du parcours (viewport iPhone 15).
- [ ] **Q-05** Chronométrer sur téléphone, avec Alexandre : campagne en ligne en moins de 2 minutes, ticket en moins de 30 secondes après le scan, Apple Pay réel.
- [ ] **Q-06** Deux répétitions complètes de suite, sans correction à la main.
- [ ] **L-01** Choisir le match de la vidéo : un match de basket universitaire ou NBA de mercredi ou jeudi soir (Arkansas–Texas se joue samedi, après le rendu). Tourner la démo **après** le durcissement du code, pas avant.
- [ ] **L-02** Devpost, README, pitch « ce n'est pas un pari ».

## Ce que tu reçois d'Alexandre, et quand

| Quand | Quoi |
|---|---|
| Mardi midi (G0) | Squelette du projet, formes de l'API figées, API simulée |
| Mercredi midi (G1) | API réelle pour créer une campagne, payer, afficher un ticket |
| Mercredi soir (G2) | Couverture, règlement, Hedge desk, mode démo |

## Règles communes

- Aucun mot crypto côté client : wallet, USDC, blockchain, gas, seed.
- Tester chaque écran sur un viewport iPhone avant de le dire fini.
- `pnpm lint && pnpm typecheck && pnpm test` avant chaque commit.
- Aucune vidéo, aucun pitch avant que le parcours complet passe deux fois de suite.
