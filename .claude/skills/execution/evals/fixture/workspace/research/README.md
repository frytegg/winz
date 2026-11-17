# Research folder (rehearsal)

Private research of the Queue Clock rehearsal, outside every git work tree ({{p:private}}/research).

- Before T0 ({{t:t0}}), /frontend's research templates (FE-00 brief, FE-01 reference URLs, FE-02 references) may
  write their state under `{{p:private}}/frontend/`; no visual is made before T0 (event rule 1).
- `probes/` is fenced: agents may not read it (policy `fences.deny_read`). The rehearsal checks that the guard denies
  a read there and allows the neighbouring files.
