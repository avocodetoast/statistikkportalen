# API-funn

API-funnene er flyttet til én skill per kilde, slik at agenter får akkurat den
relevante dokumentasjonen lastet ved behov:

- **SSB (PxWebApi v2)** → [.claude/skills/api-ssb/SKILL.md](.claude/skills/api-ssb/SKILL.md)
- **Norges Bank (SDMX)** → [.claude/skills/api-norges-bank/SKILL.md](.claude/skills/api-norges-bank/SKILL.md)
- **FHI (JSON-Stat2)** → [.claude/skills/api-fhi/SKILL.md](.claude/skills/api-fhi/SKILL.md)

Nye funn føres inn i riktig kilde-skill (ny kilde → ny `api-<kilde>`-skill, se
`new-source`-skillen). Denne filen består kun som pekermål for eldre
kodekommentarer.
