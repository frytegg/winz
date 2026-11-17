# Prêt pour /harden · {{project}}

Le build est prouvé complet et le dépôt est prêt pour /harden.

- Commit final : `{{final_sha}}` sur main (poussé).
- Contrôle de complétude (build) : ok, {{completion_at}} · {{completion_report}}
- Porte harden-ready H1-H14 : ok, {{harden_ready_at}} · {{harden_ready_report}}
- Temps restant pour /harden : jusqu'à {{harden_end_latest}} ({{minutes_left}} min) ; budget prévu {{harden_budget_min}} min.
- Disque libre : {{disk_free_gb}} Go (besoin estimé {{disk_need_gb}} Go).

## À faire maintenant
1. {{profile_step}}
2. Ouvre une nouvelle session à la racine du dépôt (`{{repo}}`), puis tape exactement :
   `{{type_this}}`
3. /harden ne fusionne et ne pousse jamais. Quand il a fini : relis `.harden/report.md`, fusionne la branche qu'il nomme dans son en-tête (« on branch harden/… », créée par /harden) dans main et pousse.
4. Puis tape `/execution --fix {{repo}}/.harden/report.md` : je te propose les correctifs, puis la suite (H3, enregistrement, /prose, captures du README en dernier).

{{scope_note}}
Ensuite, dans l'ordre : {{open_after_harden}}.
