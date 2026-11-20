# Règlements réels du 19-20 novembre 2026 (production, Arc testnet)

Fiche écrite à partir de lectures seules : base Supabase de production (`campaigns`, `instruments`, `chain_events`, `tickets`), `GET https://winz-nu.vercel.app/api/hedge-desk`. Aucune adresse d'acheteur, aucun e-mail, aucun jeton de ticket.

Commerçant : Buzzball’s shop, produit : Smash burger. Paiements Stripe en mode test (Apple Pay, filmés sur iPhone). Couverture : exécution papier sur le carnet réel de Gemini. Règlement : résultat publié par Gemini, lu par le moteur, réglé on-chain par l’escrow `0x81d2d4050E617184b2B832c30BE68f8811b37D2c`.

## Synthèse

| Promo | Condition | Prix | Budget | Tickets | Résultat Gemini (UTC) | Statut | Réglée on-chain | Délai |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 15 | Over 169.5 points (50 % remboursé) | $10 | $50 | 1 | NON · 2026-11-20T02:47:40.335Z | `settled_no` | 2026-11-20T02:50:52Z | 192 s |
| 16 | Golden State wins (50 % remboursé) | $12 | $60 | 1 | NON · 2026-11-20T03:32:07.743Z | `settled_no` | 2026-11-20T03:32:20Z | 12 s |
| 17 | Memphis wins by 15+ (50 % remboursé) | $12 | $60 | 2 | OUI · 2026-11-20T03:32:08.335Z | `settled_yes` | 2026-11-20T03:32:22Z | 14 s |
| 18 | New York wins by 10+ (50 % remboursé) | $12 | $60 | 1 | NON · 2026-11-20T03:25:08.904Z | `settled_no` | 2026-11-20T03:25:26Z | 17 s |
| 19 | Minnesota wins by 9+ (50 % remboursé) | $12 | $60 | 1 | NON · 2026-11-20T03:25:08.904Z | `settled_no` | 2026-11-20T03:25:24Z | 15 s |

Le délai va de la publication du résultat par Gemini (`instruments.settled_at`, lu par le moteur) à l’heure du bloc de `CampaignSettled`. La promo 15 a été réglée par le moteur démarré à 01:02 UTC (192 s) ; les quatre autres par le moteur redéployé à 02:55 UTC (12 à 17 s).

## Événements on-chain, par promo

`source` dit quel chemin a écrit l’événement en premier : `receipt` (le reçu de la transaction du relayer), `streams` (une livraison QuickNode Streams reçue par `POST /api/webhooks/quicknode`), `logs` (la relecture `eth_getLogs`). Chaque événement n’est écrit qu’une fois, par le premier arrivé (`(tx_hash, log_index)`).

### Promo 15 · Over 169.5 points

| Événement | Bloc | Heure du bloc (UTC) | Arguments | Écrit par | Transaction |
| --- | --- | --- | --- | --- | --- |
| CampaignCreated | 73097020 | 2026-11-19T23:38:48Z | budget=50000000, refundBps=5000, unitPrice=10000000, salesClose=1795132500 | `receipt` | [0x77a40f65…](https://explorer.testnet.arc.io/tx/0x77a40f65259ab437199deea39848c514c4cda64cb1318dd1953c4e2d02aed989) |
| TicketPurchased | 73097169 | 2026-11-19T23:40:03Z | qty=1, paid=10000000, ticketId=672, refundable=5000000, maxHedgeCost=1931000 | `receipt` | [0xa1ffead6…](https://explorer.testnet.arc.io/tx/0xa1ffead6dc7403426a47d91ff1c1b0cfa7fdf75278598dbf46cb744d13e34673) |
| HedgeCharged | 73097189 | 2026-11-19T23:40:14Z | amount=1881000, ticketId=672 | `receipt` | [0xe4b95ff9…](https://explorer.testnet.arc.io/tx/0xe4b95ff9de060b127459e3ebdb55568eb9e7e77a41deb66836bdae8db1077fe9) |
| CampaignSettled | 73119694 | 2026-11-20T02:50:52Z | outcome=1, merchantDue=0 | `receipt` | [0x408942bb…](https://explorer.testnet.arc.io/tx/0x408942bb054f3c5e8f897115c9031cd6c9dffd227a82ba08986fa2f599eec46f) |
| CampaignReleased | 73119699 | 2026-11-20T02:50:54Z | amount=53119000 | `streams` | [0xda8b02d1…](https://explorer.testnet.arc.io/tx/0xda8b02d15b410748575d144280aeb397268ee8da5f4510a5617374f90cce2216) |

Ticket 672 : 1 × payé 10.00 $, remboursable 5.00 $, statut `issued`.

### Promo 16 · Golden State wins

| Événement | Bloc | Heure du bloc (UTC) | Arguments | Écrit par | Transaction |
| --- | --- | --- | --- | --- | --- |
| CampaignCreated | 73104117 | 2026-11-20T00:38:54Z | budget=60000000, refundBps=5000, unitPrice=12000000, salesClose=1795136100 | `receipt` | [0x9dda0ad4…](https://explorer.testnet.arc.io/tx/0x9dda0ad42a7fa7264cb33adf7b57e9cf357010358ca392639be10319125c5ce8) |
| TicketPurchased | 73104247 | 2026-11-20T00:40:00Z | qty=1, paid=12000000, ticketId=673, refundable=6000000, maxHedgeCost=2194800 | `receipt` | [0x8adef5ae…](https://explorer.testnet.arc.io/tx/0x8adef5ae3891f10bb8d4eb5c99fe891c71230894ce7dd15977e8b5a9174309d1) |
| HedgeCharged | 73104265 | 2026-11-20T00:40:09Z | amount=2134800, ticketId=673 | `receipt` | [0x2309725c…](https://explorer.testnet.arc.io/tx/0x2309725c52d06477cd66911b3ec11eaacfd3d79ebaaf776aa987b523ba9a49f2) |
| CampaignSettled | 73124589 | 2026-11-20T03:32:20Z | outcome=1, merchantDue=0 | `receipt` | [0x0aecf75b…](https://explorer.testnet.arc.io/tx/0x0aecf75bb08c229651f7dd9b9784635d300a977a6933a5d7f446176eb8463b76) |
| CampaignReleased | 73124593 | 2026-11-20T03:32:22Z | amount=63865200 | `streams` | [0x7a52f69c…](https://explorer.testnet.arc.io/tx/0x7a52f69c504e31c2441ca880194ef9af841fbcb4bb0d29930a7f2063ea69a57f) |

Ticket 673 : 1 × payé 12.00 $, remboursable 6.00 $, statut `issued`.

### Promo 17 · Memphis wins by 15+

| Événement | Bloc | Heure du bloc (UTC) | Arguments | Écrit par | Transaction |
| --- | --- | --- | --- | --- | --- |
| CampaignCreated | 73104417 | 2026-11-20T00:41:26Z | budget=60000000, refundBps=5000, unitPrice=12000000, salesClose=1795136100 | `receipt` | [0x7fc46981…](https://explorer.testnet.arc.io/tx/0x7fc46981afd98150ca5aea73b1f14fc876ce5e6cdaa1d467db2ea15848fdf90c) |
| TicketPurchased | 73104554 | 2026-11-20T00:42:36Z | qty=2, paid=24000000, ticketId=674, refundable=12000000, maxHedgeCost=3278400 | `receipt` | [0x5477cd0d…](https://explorer.testnet.arc.io/tx/0x5477cd0dae70d0016efafbed17afa6fbf59168542c7cb9c6f2445371118ccc34) |
| HedgeCharged | 73104579 | 2026-11-20T00:42:48Z | amount=3158400, ticketId=674 | `receipt` | [0xee32b8ee…](https://explorer.testnet.arc.io/tx/0xee32b8eec024d7d1e8059929b7be7d635682a73650dd71535b76190b64dc45c6) |
| CampaignSettled | 73124593 | 2026-11-20T03:32:22Z | outcome=0, merchantDue=12000000 | `streams` | [0x310bed1d…](https://explorer.testnet.arc.io/tx/0x310bed1d85fd0c967875b03551075c2805ae078e6bfe69c462f1cda62e95a4d0) |
| TicketRefunded | 73124598 | 2026-11-20T03:32:25Z | amount=12000000, ticketId=674 | `streams` | [0xf704c9b6…](https://explorer.testnet.arc.io/tx/0xf704c9b68cfe44b9b5c8ccee44b3eeff5476b1c46bc7f5a6795fe50530449935) |
| MerchantPaid | 73124603 | 2026-11-20T03:32:27Z | amount=12000000 | `streams` | [0x479b0b3b…](https://explorer.testnet.arc.io/tx/0x479b0b3be6a110d9d2fc9556b40aef722ae82937b5aac764af8bf8cff133f3ef) |
| CampaignReleased | 73124609 | 2026-11-20T03:32:30Z | amount=56841600 | `streams` | [0xcb07030e…](https://explorer.testnet.arc.io/tx/0xcb07030e2ed524887c28d6a06cc7436ab997ef02b6c2e3248a39cf76d6c67253) |

Ticket 674 : 2 × payé 24.00 $, remboursable 12.00 $, statut `refunded`, remboursé 2026-11-20T03:32:25Z.

### Promo 18 · New York wins by 10+

| Événement | Bloc | Heure du bloc (UTC) | Arguments | Écrit par | Transaction |
| --- | --- | --- | --- | --- | --- |
| CampaignCreated | 73104624 | 2026-11-20T00:43:11Z | budget=60000000, refundBps=5000, unitPrice=12000000, salesClose=1795136100 | `receipt` | [0x14f8c050…](https://explorer.testnet.arc.io/tx/0x14f8c050c5db5a1ce8ae9370c4ee1c08f7895226d4b7fa33cfbf08fb04add196) |
| TicketPurchased | 73104776 | 2026-11-20T00:44:28Z | qty=1, paid=12000000, ticketId=675, refundable=6000000, maxHedgeCost=1701000 | `receipt` | [0x5859fadc…](https://explorer.testnet.arc.io/tx/0x5859fadc9557caedf61cfb4f392a8fdc05c8a797ad87890c54ada3fddcf07c98) |
| HedgeCharged | 73104805 | 2026-11-20T00:44:43Z | amount=1641000, ticketId=675 | `receipt` | [0xeff1242f…](https://explorer.testnet.arc.io/tx/0xeff1242f09b1fb90bb40cd9e8c4fb393958dc67d6265b56ac5f18d061c6b822c) |
| CampaignSettled | 73123774 | 2026-11-20T03:25:26Z | outcome=1, merchantDue=0 | `streams` | [0x60df923f…](https://explorer.testnet.arc.io/tx/0x60df923f45da36b8b5ca31896ef8b93a0f0e223cf4a94f3436d250035053bd65) |
| CampaignReleased | 73123788 | 2026-11-20T03:25:33Z | amount=64359000 | `receipt` | [0xd629b3ac…](https://explorer.testnet.arc.io/tx/0xd629b3ac0871be06c3a98967d7aadeb6032dfe37c5e2c86d23d436482234a571) |

Ticket 675 : 1 × payé 12.00 $, remboursable 6.00 $, statut `issued`.

### Promo 19 · Minnesota wins by 9+

| Événement | Bloc | Heure du bloc (UTC) | Arguments | Écrit par | Transaction |
| --- | --- | --- | --- | --- | --- |
| CampaignCreated | 73104875 | 2026-11-20T00:45:19Z | budget=60000000, refundBps=5000, unitPrice=12000000, salesClose=1795136100 | `receipt` | [0x99530a16…](https://explorer.testnet.arc.io/tx/0x99530a16f11f348549f974ee9b8bee23102adc22fc04701ef9562fa0210ba76d) |
| TicketPurchased | 73104974 | 2026-11-20T00:46:09Z | qty=1, paid=12000000, ticketId=676, refundable=6000000, maxHedgeCost=1762800 | `receipt` | [0xff4af9d8…](https://explorer.testnet.arc.io/tx/0xff4af9d81dfc8c405f0478738f1fdbc1d7d31b1fc2960770bd8efc7d23458c42) |
| HedgeCharged | 73105007 | 2026-11-20T00:46:26Z | amount=1702800, ticketId=676 | `receipt` | [0x573b4ee9…](https://explorer.testnet.arc.io/tx/0x573b4ee9fdc4ac6b43407ab0309825e91e31661d0275b974c03f7f1841a3cade) |
| CampaignSettled | 73123770 | 2026-11-20T03:25:24Z | outcome=1, merchantDue=0 | `receipt` | [0xb22ddd1a…](https://explorer.testnet.arc.io/tx/0xb22ddd1af806f7f79b0702ea1e67ad4d2236ab5054ee7a8fa42500151ac5354b) |
| CampaignReleased | 73123780 | 2026-11-20T03:25:29Z | amount=64297200 | `streams` | [0xd9903ec3…](https://explorer.testnet.arc.io/tx/0xd9903ec3ad126857b29ed10671dcc4ecbc6b129fb8cad0b6122c56655694b273) |

Ticket 676 : 1 × payé 12.00 $, remboursable 6.00 $, statut `issued`.

## QuickNode Streams

Le Stream (Arc testnet, jeu Logs, filtre sur l’adresse de l’escrow, destination `https://winz-nu.vercel.app/api/webhooks/quicknode`) a livré les événements des règlements. Huit d’entre eux ont été écrits par la livraison QuickNode avant le reçu du relayer (`source = streams` ci-dessus) : `select source, count(*) from chain_events group by source` donnait `streams 8, receipt 25, logs 2015` le 20 novembre à 04:45 UTC.

## Gemini sandbox : ordres réels (SPEC HE-10)

Preuve exécutée au démarrage du moteur (`APP_VENUE_CHECK_ON_BOOT=true`), lue sur le Hedge desk : `outcome = proven`, `2026-11-20T04:15:08.921Z`, lieu `gemini-sandbox`.

| Étape | Ordre Gemini | Instrument | Sens | Type | Prix | Quantité | Exécuté | Statut Gemini | Heure (UTC) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| placed_maker | 145853902324436356 | `GEMI-ETH2611200500-HI1720` | buy | maker | 1 % | 1 | 0 | open | 2026-11-20T04:15:05.237Z |
| cancelled | 145853902324436356 | `GEMI-ETH2611200500-HI1720` | buy | maker | 1 % | 1 | 0 | cancelled | 2026-11-20T04:15:08.453Z |
| filled | 145853902324436442 | `GEMI-ETH2611200500-HI1720` | buy | taker | 22 % | 1 | 1 | filled | 2026-11-20T04:15:08.920Z |

