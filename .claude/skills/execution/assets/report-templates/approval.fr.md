# Plan à approuver · {{project}}

Plan v{{plan_version}} : {{n_tasks}} tâches ({{n_agent}} pour les agents, {{n_manual}} manuelles, {{n_decisions}} décisions).
- Fin de build P50 : {{p50}}
- Fin de build P80 : {{p80}}
- Fin de build P90 : {{p90}}
- Chemin critique : {{critical_path}}
## Tes tâches manuelles
{{#manual_tasks}}- {{task_id}} · {{title}} — au plus tard {{latest}}{{/manual_tasks}}
## Décisions prévues
{{#decision_gates}}- {{task_id}} · {{title}}{{/decision_gates}}
## Risques
{{#risks}}- {{text}}{{/risks}}
## Pour répondre
- Décision {{decision_id}} : tape `approve` pour lancer le build, ou `revise` avec ce qu'il faut changer.
- Recommandé : {{recommended}}. Une seule approbation couvre toutes les vagues du plan.
