# UX and Design System

## Product character

Editorial command center, field notebook, and evidence desk—not a game-themed control panel.

## Visual direction

- Deep navy for authority.
- Mangrove green for research and ecology.
- Coral/orange for action and warnings.
- Warm off-white for documents and reading.
- Pale aqua for observed/tested information.

Use design tokens rather than hard-coded one-off colors.

## Independence rule

Do not copy:

- Rockstar `R*`;
- GTA title typography;
- official `VI` logo;
- official cover composition;
- Rockstar channel banners;
- official UI;
- character collages that imply official status.

## UI patterns

### Status chip
Show label plus icon/text. Do not rely on color.

### Evidence card
- classification;
- claim;
- source;
- freshness;
- confidence;
- reviewer;
- conflict warning.

### Blocking banner
- exact blocker;
- affected transition;
- owner;
- next action.

### Approval panel
- scope;
- revision hash;
- approver;
- decision;
- notes;
- time;
- invalidation status.

### AI draft panel
- draft badge;
- provider;
- template version;
- source IDs;
- validation result;
- unsupported statements;
- accept/reject controls.

## Dashboard

Prioritize:

1. blocking issues;
2. approvals awaiting Mike;
3. stale evidence;
4. items due soon;
5. update-required published pages;
6. pilot metrics;
7. recent AI generations and quarantines.

## Content editor

Use a split or tabbed view:

- script/article editor;
- evidence sidebar;
- claim insertion;
- visual notes;
- comments;
- version history;
- preview.

## Empty states

Explain the next useful action. Do not fill the dashboard with decorative charts before data exists.

## Accessibility

- semantic labels;
- keyboard drag alternatives;
- focus management in dialogs;
- screen-reader announcements for workflow changes;
- accessible tables;
- error summaries;
- no color-only confidence scale.
