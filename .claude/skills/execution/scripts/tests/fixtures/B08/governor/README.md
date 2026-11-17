# Governor reading fixtures (lane B08)

`ok.json` is the output of the governor's PowerShell readings script (`execlib.governor.readings_script`, run through
`governor._powershell_json`) captured on the owner's Windows 11 laptop on 2026-10-01 (on AC, network up, one battery).
`test_governor.py` derives every other case from it (low disk, low RAM, battery, no network, low commit charge, a
missing field) so each case changes exactly one reading.
