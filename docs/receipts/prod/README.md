# Reçus de production

Relevés faits en lecture seule contre la pile déployée (web `https://winz-nu.vercel.app`, moteur
`https://winz-kfwm.onrender.com`, Supabase hébergé, Arc testnet). Rien de ce dossier n'est réécrit
par un test : chaque fichier date du relevé qui l'a produit.

| Fichier | Ce qu'il montre | Relevé |
| --- | --- | --- |
| [`g1-2026-11-19.md`](./g1-2026-11-19.md) | La promo de test du 19 novembre (campagne on-chain 15) : création, achat, ticket, couverture, transactions, et `pnpm smoke` contre la production. | 2026-11-20 00:30 UTC |
| [`poster-buzzballs-shop-over-169-5-points.png`](./poster-buzzballs-shop-over-169-5-points.png) | L'affiche de cette promo, servie par `GET /poster/buzzballs-shop-over-169-5-points` : `200`, `image/png`, 83 451 octets, 1080 × 1350. | 2026-11-20 00:30:11 UTC |
| [`og-buzzballs-shop-over-169-5-points.png`](./og-buzzballs-shop-over-169-5-points.png) | L'aperçu Open Graph de la page de la promo : `200`, `image/png`, 63 476 octets, 1200 × 630. | 2026-11-20 00:30:23 UTC |

L'aperçu Open Graph n'est pas servi à `/c/<slug>/opengraph-image` (cette adresse répond `404`) :
Next.js lui donne un suffixe, et l'adresse exacte est celle que la page publique annonce dans
`<meta property="og:image">`, ici
`https://winz-nu.vercel.app/c/buzzballs-shop-over-169-5-points/opengraph-image-1dvuez?a2e3a1e0ec7e6bdc`.
C'est cette adresse que lit un réseau social ; elle a été relevée sur la page, puis téléchargée :

```bash
curl -sS https://winz-nu.vercel.app/c/buzzballs-shop-over-169-5-points | grep -o '<meta property="og:image"[^>]*>'
curl -sS -o poster-buzzballs-shop-over-169-5-points.png -w "%{http_code} %{content_type} %{size_download}\n" \
  https://winz-nu.vercel.app/poster/buzzballs-shop-over-169-5-points
curl -sS -o og-buzzballs-shop-over-169-5-points.png -w "%{http_code} %{content_type} %{size_download}\n" \
  "https://winz-nu.vercel.app/c/buzzballs-shop-over-169-5-points/opengraph-image-1dvuez?a2e3a1e0ec7e6bdc"
```

Sorties : `200 image/png 83451` et `200 image/png 63476`. SHA-256 :
`0840b3929a183fc96cd90e19827687473b9dde60ebd8c78b96521de041a5b2df` (affiche),
`510550fbf8626310ff642b469cfcf3b28ba877bf480f03e0d58537bdf4302162` (aperçu).
