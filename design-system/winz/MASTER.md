# Winz : direction visuelle (MASTER)

Source : `SPEC.md` §2 + maquettes Figma de Téo (`winz-front-kit/mockups/`). Ce fichier fait foi pour le style ;
la spec fait foi pour le contenu. Track **Consumer** : le design est noté. La barre est « app sportive premium
qu'on croirait sortie de l'App Store », pas « dashboard généré ».

## 1. Personnalité

Énergique, sportif, nocturne (ambiance bar un soir de match), simple. Noir profond + un seul accent lime néon.
Des titres en capitales, larges et confiants. Des pilules arrondies. Des diagonales fines comme des lignes de terrain.
Jamais de jargon : on parle de « promo », de « chance it's free », de « refunded », pas de marché ni de contrat.

## 2. Couleurs (jetons)

| Jeton | Valeur | Usage |
|---|---|---|
| `--color-lime` | `#D8FE35` | Accent unique : CTA principal, chiffres clés ($ des montants, % des remboursements), état actif, écran REFUNDED. Valeur exacte des SVG du logo. |
| `--color-lime-press` | `#C6EC22` | Lime pressé / survol |
| `--color-lime-dim` | `#788A1E` | CTA désactivé (maquettes M1b, M3 : lime à ~45 % sur fond). Texte `#131314` dessus : 4,8:1. Le `#6F7F1C` des maquettes ne donnait que 4,2:1 |
| `--color-lime-line` | `rgba(216,254,53,0.15)` | Diagonales du motif |
| `--color-ink` | `#131314` | Fond d'app (prélevé sur les maquettes ; la spec dit `#0B0B0C` pour le fond système : l'utiliser pour `theme-color` et le splash) |
| `--color-ink-deep` | `#0B0B0C` | Fond derrière la colonne sur desktop, barre d'état |
| `--color-card` | `#1C1C1F` | Cartes (spec) |
| `--color-card-raised` | `#2A2A2D` | Cartes surélevées, segmented control, champs pleins (maquettes ≈ `#2E2E2E`) |
| `--color-stroke` | `rgba(255,255,255,0.34)` | Contour des champs (maquettes : fin trait gris clair, à 0,28). À 0,34 le contour atteint 3,1:1 sur le fond (WCAG 1.4.11) ; à 0,28 il n'avait que 2,5:1 |
| `--color-text` | `#FFFFFF` | Texte |
| `--color-muted` | `#A1A1AA` | Texte secondaire (≥ AA sur ink) |
| `--color-subtle` | `#6B6B70` | Texte tertiaire, ≥ 18 px seulement |
| `--color-white-pill` | `#FFFFFF` | Pilules blanches (solde, bouton Apple Pay, Deposit) : texte `#131314` |
| `--color-danger` | `#FF5A5F` | Erreur, ligne « Auto-pause » du graphe |
| `--color-team-a` / `--color-team-b` | `#F5A524` / `#1A7F66` | Points de couleur des équipes (maquettes : orange / vert), générés par équipe si pas de couleur |

Règles : un seul gros élément lime par écran. Texte toujours noir (`#131314`) sur lime. Le blanc pur est réservé au texte et aux pilules blanches. Pas d'autres teintes vives, pas de dégradé violet/bleu.

## 3. Typographie

- **Famille** : géométrique grotesque large, celle des maquettes. Par défaut **Sora** (`next/font/google`, 300/400/600/700). Téo confirme dans Figma ; si c'est une autre (ex. Space Grotesk, Clash Display), on ne change que la variable `--font-sans`.
- Chiffres : `font-variant-numeric: tabular-nums` partout où ça bouge (cotes, compte à rebours, montants).
- Wordmark : **toujours le SVG** (`logo-winz-lime.svg`), jamais du texte (le « ı » sans point et le « w » sont dessinés).

| Rôle | Taille / interligne | Poids | Casse |
|---|---|---|---|
| Hero (M0, slides) | 32/36 | 600 | CAPITALES |
| Titre d'étape (« 1. PICK A GAME ») | 28/32 | 400 (le numéro en lime) ; les écrans M1–M2 en 700 | CAPITALES |
| Promesse (carte campagne, C1) | 24/30 → 32/38 sur C1 | 400–500 | CAPITALES |
| Grand chiffre (solde, stats) | 40/44 (36 sur cartes) | 600 | `$` en lime, chiffres en blanc |
| Compte à rebours | 32/36 (C1 : 44) | 300 | chiffres + libellés DAYS/HRS/MINS 11 px muted |
| Corps | 15/22 | 400 | phrase |
| Libellé de champ | 13/16 | 400 | CAPITALES, tracking +2 % |
| Légende | 12/16 | 400 | muted |

## 4. Formes, espacements, profondeur

- Grille 4 px. Marges latérales d'écran 20–24 px. Espacement entre blocs 16/24.
- Rayons : écran-carte 28 px, cartes 20–24 px, champs et boutons **pilule** (hauteur 48 px champs, 64 px CTA), petits boutons ronds 40–48 px.
- Pas d'ombres portées : la profondeur vient des niveaux de gris (`ink` → `card` → `card-raised`) et des bordures fines.
- **Motif diagonales** : 3–6 lignes de 1 px `--color-lime-line`, inclinées ~75°, en fond des cartes héros (campagne, solde), du splash et des écrans de succès. Un composant `<Diagonals />` en SVG absolu, `pointer-events:none`. Le grand « W » en traits (`icon-winz-background.svg`) sert de motif au splash et à M8.

## 5. Composants signature (à reproduire fidèlement)

- **CTA principal** : pilule lime pleine largeur, 64 px, libellé à gauche (17 px, noir), à droite un cercle noir 52 px avec une flèche ↗ lime (contour lime 1.5 px autour de la pilule côté droit dans les maquettes). Désactivé : lime-dim. Pressé : `scale(0.98)` 120 ms.
- **Bouton retour** : cercle 48 px, contour lime 1 px, chevron lime. En haut à gauche, avec à droite la **barre de progression** (pilule 8 px, piste `#2A2A2D`, remplissage lime animé).
- **Champ** : pilule 48 px, contour `--color-stroke`, placeholder muted, focus contour lime. Libellé en capitales au-dessus.
- **Stepper ±** : pilule avec ronds 40 px `+` et `−` aux extrémités, valeur centrée avec l'unité (`$`, `%`) en lime.
- **Segmented control** : piste `#2A2A2D` pilule, segment actif lime avec texte noir (Stats/Budget/Orders, This month/This week/Today, Live/Won/Past, In progress/Closed).
- **Chip** : pilule `#2A2A2D` avec icône ; active = contour lime 1 px (sports) ou lime plein (catégorie choisie).
- **MatchCard** : carte `card-raised` 20 px, deux équipes (illustration du sport + nom + abréviation + point de couleur + %), au centre l'heure 28 px + date + rond lime « VS ». Sélectionnée : fond lime, textes noirs, « VS » rond blanc.
- **PromoCard** (M4) : titre « 100% back » (le `%` en lime), description, deux métriques (« Margin cost ~12% », « Hedge cost ~$1.20 »), badge « Recommended ». Sélectionnée : fond lime. Indisponible : opacité 40 % + raison.
- **CampaignHero** : carte `card-raised` avec diagonales, pastille « ● LIVE CAMPAIGN », compte à rebours à droite, promesse en capitales, `📍 Joe's Pizza` (icône pin lime).
- **BalancePill** : pilule blanche « $2,145.45 » + rond lime ↗ (en-tête des écrans commerçant et fan) ; à droite cloche et avatar en ronds blancs.
- **BottomNav** : pilule blanche flottante (Home, Promos, Stats, Wallet), l'onglet actif est un rond lime 64 px qui déborde ; à droite un FAB rond lime « + » (nouvelle promo). Fan : Home, Tickets (pas de recherche dans le MVP).
- **Gauge** (ticket) : anneau 200 px, piste `#2A2A2D`, arc lime proportionnel à la chance, chiffre au centre 44 px lime + « CHANCE IT'S FREE ».
- **TicketCard** : carte avec encoches latérales (demi-cercles découpés) et pointillés séparant l'en-tête (commerçant, produit, prix payé) de la condition.
- **Pilules de paiement** : « Buy with Apple Pay » pilule blanche texte noir avec logo  ; « Pay with card » pilule `#2A2A2D`.

## 6. Illustrations

- Équipes : `logoUrl` est souvent `null`. Afficher l'illustration du sport (`/sports/football-*.png` casques, `basketball-*.png` baskets, `soccer-*.png` crampons), choisie de façon stable par équipe (hash de l'abréviation), sinon un monogramme rond (abréviation, fond couleur d'équipe). Jamais de logo officiel de ligue ou d'équipe.
- Photo héro M0 : `/onboarding/hero.png` (joueur en noir et blanc, dégradé vers le noir en bas). Vérifier les droits de l'image ; si doute, flouter le maillot ou la remplacer par une photo libre (Unsplash, mention dans le README).
- Slides M0 : `/onboarding/slide-*.png` (cartes de stats flottantes, mockups iPhone).

## 7. Mouvement

Vif mais sobre. `prefers-reduced-motion` : tout passe en fondu ≤ 150 ms.
- Entrée d'écran d'assistant : glissé 24 px + fondu, 240 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Barre de progression : largeur en 400 ms.
- Sélection de carte : fond qui passe au lime 180 ms + léger `scale(1.01)`.
- Chiffres qui changent (cote, ventes) : transition du nombre (compteur 400 ms) ; la jauge du ticket glisse en 600 ms.
- Pastille LIVE : pulsation 2 s.
- M8 « YOUR PROMO IS LIVE! » et REFUNDED : écran qui s'ouvre en balayage lime puis confettis **sobres** (15–20 losanges lime/blanc, 1,2 s, une fois).
- Feuilles (C2, partage) : bottom sheet qui monte en 280 ms avec un ressort léger, fond assombri.

## 8. Anti-modèles (refusés en revue)

Dégradés violets, cartes à ombre floue, emojis décoratifs, icônes de 4 styles différents (utiliser lucide, trait 1.5), texte blanc sur lime, plusieurs éléments lime géants sur un écran, données inventées (n° de table, code-barres, score), vocabulaire crypto côté fan, `Lorem`, `TODO` visibles, écrans vides sans état vide dessiné, spinners nus (utiliser des squelettes aux formes des cartes).
