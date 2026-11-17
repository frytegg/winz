<callout color="{{zone_colour}}_bg">
	**{{zone_label}}** · fin de build P80 {{p80_build_complete}}
	P90 {{p90_build_complete}}
	{{one_line_status}}
</callout>
## Fait
{{#fait}}- {{task_id}} · {{title}} — {{landed}}{{verdict_fr}}{{/fait}}
## Prouvé
{{#prouve}}- {{task_id}} · {{title}} — {{proof_fr}} · {{proof_ref}} · vérifiée par {{verifier}} ({{run_id}}){{/prouve}}
## Ouvert
- {{n_failed}} en échec, {{n_blocked}} bloquées, {{n_ready}} prêtes, {{n_planned}} prévues
{{*incoh}}- incohérence : {{task_id}} marquée prouvée sans reçu valide{{/incoh}}
{{*ouvert}}- {{task_id}} · {{title}} — {{open_reason_fr}}{{/ouvert}}
## Ta prochaine action
{{#actions|Rien à faire pour l'instant.}}{{n}}. {{ref}} · {{what_fr}} — {{when_where}}{{/actions}}
## Zone et P80
{{*deadlines}}- Échéance {{deadline_label}} : {{deadline_display}}{{/deadlines}}
- {{on_time_line}}
- Fin de build P50 : {{p50}}
- Fin de build P80 : {{p80}}
- Fin de build P90 : {{p90}}
- Chemin critique : {{critical_path_ids}}
## Pouls
- Disque libre {{disk_free}} (plancher {{disk_floor}}) · RAM libre {{ram_free}}
- Quota 5 h : {{five_hour}}, remise {{five_hour_resets}}
- Quota semaine : {{seven_day}}, remise {{seven_day_resets}}
- Relevé du quota il y a {{snapshot_age}}
- Dernier tick : {{last_tick}}
- Vague {{wave}} : {{agents}}, {{reruns}} relances, durée {{wave_duration}}
{{*pulse_extra}}- {{text}}{{/pulse_extra}}
