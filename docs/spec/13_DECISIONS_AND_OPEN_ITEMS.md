# Decisions and Open Items

## Decisions supplied by this bundle

| Decision | Proposed choice | State |
|---|---|---|
| Product structure | private studio plus public site | PROPOSED |
| Internal product name | Field Guide Studio | PROPOSED |
| Public brand | Leonida Field Guide — GTA VI Fan Channel | PROPOSED |
| Architecture | modular TypeScript full-stack + PostgreSQL | PROPOSED |
| AI posture | mock first, Anthropic provider later | PROPOSED |
| Publishing | manual/local first, integrations disabled | PROPOSED |
| Pilot | three long videos and nine Shorts | PROPOSED |

## Mike decisions required before public use

1. Approve or rename the public brand.
2. Approve the internal product name.
3. Approve repository creation/location.
4. Approve budget and build environment.
5. Approve production hosting/provider choices.
6. Approve authentication provider.
7. Approve use of the Anthropic API and spend limit.
8. Approve any YouTube or Google connection.
9. Approve contact with Take-Two or legal counsel.
10. Approve public deployment and publication.

## Technical decisions Claude may make reversibly

- package manager;
- exact stable framework and library versions;
- ORM;
- test libraries;
- component primitives;
- local authentication implementation;
- local storage implementation;
- code organization;
- naming of internal APIs.

Record the decision and reason in `docs/BUILD_DECISIONS.md`.

## Open risks

- monetized Rockstar footage rights;
- changing YouTube policies;
- changing GTA VI release/platform facts;
- trademark/handle/domain availability;
- in-game licensed music;
- launch-week capacity;
- AI output accuracy;
- external API permissions and costs.

## Assumptions for the first build

- one workspace;
- English language;
- one public brand;
- local/staging only;
- no real copyrighted media files;
- no real API credentials;
- manual analytics entry;
- manual publication record;
- small team;
- desktop-first studio with responsive support.
