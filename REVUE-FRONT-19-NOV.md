# Revue du front, nuit du 18 au 19 novembre

Pour Téo. Deux passes en lecture seule, sur la tête de ta PR n°10 (`teo/u-04-live-api`, commit `e97634c`), fusionnée depuis sur `main` : tout ce qui suit est donc sur `main` aujourd'hui.

1. une revue de la PR sur quatre angles (argent côté commerçant, paiement fan, identité et temps réel, contrat d'API), où chaque constat sérieux a ensuite été attaqué par un second relecteur chargé de le réfuter ;
2. un contrôle de sept tâches (U-01 à U-06, I-01) contre leur ligne « Fini quand » de `TASKS.md` et les écrans de `SPEC.md`.

Aucun de tes fichiers n'a été modifié. Les relecteurs de la passe 1 n'avaient pas de terminal : ils ont lu le code, sans lancer les tests. Les cinq premiers constats ci-dessous ont été confirmés par un vérificateur qui, lui, a suivi le chemin complet et parfois rejoué le cas contre les vraies routes. Les autres ne sont pas revérifiés : à relire avant de corriger.

Les chemins sont relatifs à `apps/web/`.

## 1. À corriger avant la démo : l'argent

**1.1 Le `requestId` du bouton « Fund » ne vit qu'en mémoire.** *Confirmé.*
`components/wizard/step-review.tsx:59`, `lib/merchant/funding.ts:66-84`.
Le commerçant paie, la réponse se perd (réseau, onglet gelé par iOS). Il recharge la page, ou revient à M6 puis à M7 : le brouillon revient de `sessionStorage`, mais `StepReview` est remonté et tire un nouvel uuid. Nouveau `requestId`, donc seconde campagne et second paiement.
Correction : garder la demande (`clé des réglages`, `id`) dans `sessionStorage`, écrite **de façon synchrone avant le `fetch`** (pas via `update()` du contexte : React peut exécuter cette mise à jour après le départ de la requête). La relire au montage ; l'effacer sur un `409`, et après le succès comme aujourd'hui.

**1.2 Chaque nouvel essai de paiement d'un fan crée un nouveau PaymentIntent.** *Confirmé.*
`components/winz/checkout-sheet.tsx:212-242`, `lib/fan/checkout-flow.ts:124`.
Le fan tape Pay, Stripe autorise la carte, la réponse se perd. La feuille revient sur le récapitulatif avec une erreur. Il retape Pay : `runCheckout` rappelle `POST /api/checkout`, qui crée un second PaymentIntent. Le webhook traite les deux : deux tickets, deux débits.
Correction : garder la réponse de `POST /api/checkout` dans une ref de la feuille (clé : slug et quantité) et la réutiliser à l'essai suivant ; ne la jeter qu'après un refus définitif ou un changement de quantité.

**1.3 Une erreur de Stripe après une autorisation réussie est affichée comme un échec.** *Confirmé.*
`lib/stripe/payment.ts:82-98`.
Même scénario, vu depuis `confirmIntent` : quand `confirmPayment` renvoie une erreur (ou lève), la carte est parfois bel et bien autorisée.
Correction : dans ce cas, relire une fois le PaymentIntent (`stripe.retrievePaymentIntent(clientSecret)`) ; s'il est autorisé, continuer comme un succès. Avec 1.2, le second tap retombe sur le même paiement.

**1.4 Recharge : après une carte refusée, le tap suivant échoue en `409`.** *Confirmé, mais mineur : personne n'est débité deux fois.*
`components/winz/top-up-sheet.tsx:92-103`.
La demande refusée est finie côté serveur ; le même `requestId` renvoyé répond « This top-up request is over », et il faut un troisième tap.
Correction : sur ce `409`, renouveler l'id et renvoyer la demande une fois dans le même geste.

## 2. À corriger avant la démo : une personne bloquée ou mal informée

Non revérifiés, sauf mention.

**2.1 Un fan qui perd la page pendant « Securing your promo… » n'a aucun chemin vers son ticket.**
`lib/copy.ts:508`, `components/winz/campaign-page.tsx`.
Le texte dit « We send your ticket link here » : c'est faux, ni l'API ni le moteur n'envoient d'e-mail (les notifications sont la tâche U-10, facultative). Et rien ne retient l'achat : au retour sur `/c/<slug>`, la page propose d'acheter à nouveau.
Correction : enregistrer `{slug, paymentIntentId}` dans `localStorage` dès la réponse de `POST /api/checkout`, et au montage reprendre le suivi (`GET /api/checkout/:pi`) puis ouvrir le ticket. Rendre le texte vrai.

**2.2 Un `5xx` ou une coupure sur `GET /api/me` déconnecte le commerçant.**
`lib/auth/privy-auth-provider.tsx:269`.
Au rechargement pendant un démarrage à froid de l'API, `meFailed` passe à vrai, le garde renvoie vers `/start`, et la saisie d'un e-mail y ferme la session Privy encore valide.
Correction : ne passer en « anonyme » que sur `401` ou `403` ; pour `0` ou `≥ 500`, rester en chargement, réessayer (1 s, 2 s, 4 s), puis afficher « can't reach Winz ».

**2.3 Création du commerce : un second tap après une réponse perdue reste bloqué.**
`app/(merchant)/business/business-form.tsx:73`.
Le serveur a créé le commerce ; le second tap reçoit `409 You already have a business` et l'écran ne bouge plus.
Correction : sur ce `409`, appeler `refreshMe()` : le garde voit le commerce et avance.

**2.4 Quand les relectures échouent, les écrans gardent l'ancienne valeur comme si elle était fraîche.**
`components/winz/campaign-page.tsx:168`, `ticket-screen.tsx`, `campaign-detail-screen.tsx:102`.
`live.error` n'est lu que s'il n'y a aucune donnée. Réseau coupé : « 12 % chance it's free » reste affiché indéfiniment, alors que le serveur cacherait ce chiffre après 10 s.
Correction : erreur avec données = cote inconnue (« updating ») et un état « reconnecting », comme sur le Hedge desk ; sur C1, désactiver l'achat tant que la dernière lecture réussie est trop vieille.

**2.5 Si `POST /api/checkout/:pi/confirm` échoue, plus rien ne le rappelle, et l'attente n'a pas de fin.**
`lib/fan/checkout-flow.ts:141`.
Le suivi ne fait que des `GET`, qui restent sur `requires_payment` tant que le webhook n'est pas arrivé. Webhook en retard ou mal configuré : « Still working on it » pour toujours.
Correction : tant que l'état est `requires_payment`, rappeler `confirm` (il est idempotent) à la place du `GET` ; fixer un plafond et un message.

**2.6 Le lien « I'm a fan » de l'accueil ouvre une page 404.**
`components/winz/start-screen.tsx:68-77` pointe vers `/tickets`, qui n'existe pas encore (U-09).

**2.7 Un fan qui se connecte est envoyé créer un commerce.**
`lib/auth/route-guard.ts:30-45` ne connaît que « commerçant » et « pas commerçant » : tout connecté sans commerce va sur `/business`. L'exigence ID-1 veut qu'un fan retrouve ses tickets avec son e-mail.

**2.8 M7 n'a pas d'état d'erreur quand le calcul échoue.**
`components/wizard/step-review.tsx:136-138` : rien n'est affiché, le bouton reste gris. Reprendre le message et le « retry » de M6.

**2.9 M8 attend « Putting your promo live… » sans limite**, et traite un match annulé (`void`) comme un échec de création.
`components/winz/live-screen.tsx:119-168`.

**2.10 Détail d'une campagne (espace commerçant).**
- La vente doit être visible en moins de 3 s (critère 7) : `lib/merchant/use-campaign-detail.ts:13` relit toutes les 3 s et rien ne s'abonne à `live_campaigns`. S'abonner à la table par slug, comme `use-live-odds` le fait pour les cotes.
- `exposure`, que l'API envoie et que la SPEC 5.2 demande, n'est affiché nulle part.
- Le bilan d'un match annulé affiche « Lost / The promo didn't hit » (`components/winz/campaign-tabs.tsx:31`) ; le texte `report.cancelled` existe et n'est pas utilisé.
- La couverture est un nombre, pas la jauge 0-100 % de la SPEC.

**2.11 C1 n'affiche pas le logo du commerçant** (`components/winz/campaign-page.tsx:217-220`), que la SPEC demande et que l'API envoie (`merchant.logoUrl`).

## 3. Mineur

- Retour d'une redirection de paiement (3-D Secure) : l'URL de retour est la page de la promo et rien n'y lit `payment_intent` (`components/winz/stripe-payment.tsx:133`).
- La feuille de paiement peut être fermée pendant le paiement ; un refus n'a alors plus de message (`checkout-sheet.tsx:275`).
- Une promo qui ferme pendant que la feuille est ouverte est dite « Paused for now » (`checkout-sheet.tsx:300`).
- Une cote poussée par le socket n'est remplacée que si la valeur de l'API change (`lib/realtime/use-live-odds.ts:54`).
- Les erreurs internes de schéma sont montrées telles quelles aux fans (`lib/api/client.ts:230`).
- Les totaux de l'accueil et des stats excluent les ventes d'un match annulé, alors que le commerçant garde cet argent ; un test fige cette omission (`lib/merchant/stats.ts:8`).
- « Find another promo » sur un ticket perdu renvoie vers la même promo réglée (`ticket-screen.tsx:235`).
- Le bouton principal dit toujours « Buy with Apple Pay », y compris sur Android (`campaign-page.tsx:284-292`).
- M2 : le logo est un champ URL, pas un envoi de fichier.
- M8 : « Download the poster » télécharge un QR nu ; pas d'affiche avec logo et promesse (aussi dans U-08).
- Sur l'écran du code, un renvoi de code qui échoue est invisible (`sign-in-flow.tsx:118`) ; après un échec de passkey, un refus du serveur s'affiche « Face ID didn't work » (`:128`).
- `manifest.ts:16` : couleur de fond `#131314`, alors que `design-system/winz/MASTER.md` demande `#0B0B0C`.

## 4. Peut-on cocher les tâches ?

Pas encore, pour aucune des sept. Le code existe et il est branché sur de vraies routes ; ce qui manque est surtout la preuve.

| Tâche | Verdict | Ce qui manque en premier |
| --- | --- | --- |
| U-01 socle visuel | non | la capture d'un écran témoin sur un viewport iPhone, demandée par son « Fini quand » ; la police (Sora) n'est pas confirmée |
| U-02 parcours commerçant | non | 2.6, 2.8 ; pas de preuve « moins de 15 taps » (la lecture du code en donne environ 9) ; M4 ne grise pas les promos au-dessus du plafond de probabilité |
| U-03 parcours fan | non | 2.11 ; aucun test ne rend C1 ni les cinq phases du ticket |
| U-04 vraie API | non | la porte G1 (campagne créée, payée par carte de test, ticket affiché, depuis un téléphone) n'a jamais été passée ; 1.1 à 1.3 |
| U-05 espace commerçant | non | 2.10 |
| U-06 Hedge desk | oui, après une vérification sur viewport iPhone (393 × 852) | rien d'autre de bloquant |
| I-01 Privy | non | 2.7 ; l'intégration n'a jamais parlé au vrai Privy (pas encore d'application) |

Le point commun : **aucun test ne rend un écran** (il n'y a pas un seul `*.test.tsx`), et il n'y a ni Playwright ni capture. Les tests couvrent les fonctions pures. Un défaut dans un composant passe donc toute la suite ; un relecteur a planté deux défauts dans les règles de statut de l'espace commerçant, et la suite est restée verte.

## 5. Corrigé côté back cette nuit, à récupérer

- **Les cotes en direct.** Les lignes poussées par Supabase Realtime étaient toutes rejetées par leur schéma (horodatage au format de Postgres, avec un décalage, alors que le schéma n'acceptait que le `Z`). Dès que Supabase aurait été branché, les écrans auraient affiché « updating » à la place du pourcentage. Corrigé dans `packages/shared` (`pgTimestampSchema`). Ce n'était pas dans ta PR : c'était déjà sur `main`.
- **`NEXT_PUBLIC_APP_API_MOCK`** est maintenant dans `.env.example`, le README du web et la page de déploiement.

## 6. Le reste

- M4, griser les promos au-dessus du plafond : pas besoin de changer l'API. Chaque promo porte déjà son coût estimé (`costBps`) ; la griser quand ce coût dépasse l'écart entre les deux marges par défaut du commerçant (marge habituelle moins marge minimale), qui est le coût maximal accepté. C'est donc pour toi, et c'est petit.
- U-05 et U-06 n'ont pas de ligne « Fini quand » dans `TASKS.md`, et U-04 n'est pas suivie par le compteur.
- Le Hedge desk affichera « Not run yet » pour la preuve d'ordres réels tant que le sandbox Gemini n'est pas fait (facultatif).
