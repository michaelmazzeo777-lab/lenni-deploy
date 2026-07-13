# Data Model

Names are conceptual. Claude may adjust field names while preserving invariants.

## Identity

### User
- id
- displayName
- email
- status
- createdAt
- updatedAt

### RoleAssignment
- userId
- role
- workspaceId
- createdBy
- createdAt

## Workspace and taxonomy

### Workspace
- id
- name
- slug
- status
- disclaimer
- timezone

### TaxonomyTerm
- id
- type
- label
- slug
- parentId
- active

## Content

### ContentItem
- id
- workspaceId
- type
- pillar
- workingTitle
- publicTitle
- slug
- status
- priority
- urgency
- difficulty
- searchValue
- longTermValue
- audienceIntent
- viewerPromise
- searchQuery
- browsePromise
- spoilerLevel
- platformScope
- targetLength
- ownerId
- dueAt
- notBeforeAt
- updateTrigger
- createdAt
- updatedAt
- deletedAt

### ContentRelation
- fromContentId
- toContentId
- relationType

### ContentStatusHistory
- contentId
- fromStatus
- toStatus
- actorId
- reason
- createdAt

## Research

### Source
- id
- workspaceId
- title
- publisher
- url
- sourceClass
- sourceType
- publicationDate
- retrievalDate
- factualAsOfDate
- inspectedLocation
- supportNotes
- archiveReference
- status
- staleAfter
- createdBy
- createdAt
- updatedAt

### Claim
- id
- workspaceId
- statement
- classification
- confidence
- status
- publicWording
- contradictionGroupId
- lastReviewedAt
- createdBy
- createdAt
- updatedAt

### ClaimSource
- claimId
- sourceId
- supportType
- supportText
- exactLocation
- reviewedBy
- reviewedAt

### ContentClaim
- contentId
- claimId
- usage
- required
- sortOrder

### ResearchPacket
- id
- contentId
- title
- status
- version
- createdBy
- createdAt

## Editorial

### ContentBrief
- id
- contentId
- version
- objective
- audience
- angle
- allowedClaimIds
- prohibitedAssertions
- structure
- callToAction
- visualPlan
- rightsNotes
- successMetric
- createdBy
- createdAt

### ScriptVersion
- id
- contentId
- version
- body
- structuredBodyJson
- wordCount
- estimatedDuration
- authorType
- createdBy
- generationId
- createdAt

### ReviewComment
- id
- entityType
- entityId
- body
- status
- authorId
- createdAt
- resolvedAt

## AI

### PromptTemplate
- id
- key
- version
- systemText
- userTemplate
- outputSchema
- active
- createdAt

### AIGeneration
- id
- workspaceId
- contentId
- taskType
- provider
- model
- promptTemplateId
- promptTemplateVersion
- inputHash
- sourceIds
- claimIds
- requestJson
- responseJson
- validationStatus
- quarantineReason
- tokenUsage
- estimatedCost
- createdBy
- createdAt
- reviewedBy
- reviewedAt
- reviewDecision

## Assets and rights

### Asset
- id
- contentId
- name
- mediaType
- location
- ownership
- ownerName
- sourceUrl
- intendedUse
- licenseBasis
- amountUsed
- transformation
- containsMusic
- spoilerLevel
- status
- createdBy
- createdAt

### RightsReview
- id
- assetId
- riskLevel
- decision
- notes
- reviewerId
- reviewedAt
- expiresAt

## Packaging

### TitleVariant
- id
- contentId
- text
- strategy
- classificationBadge
- deceptionCheck
- status
- createdBy
- createdAt

### ThumbnailVariant
- id
- contentId
- name
- brief
- imageLocation
- strategy
- mobileCheck
- deceptionCheck
- trademarkCheck
- status
- createdBy
- createdAt

## Approval and publication

### Approval
- id
- contentId
- scope
- decision
- notes
- actorId
- contentRevisionHash
- createdAt
- revokedAt
- revokedBy

### Publication
- id
- contentId
- channel
- status
- publicUrl
- externalId
- scheduledAt
- publishedAt
- recordedBy
- createdAt

### PublicArticleRevision
- id
- contentId
- revision
- title
- slug
- summary
- body
- sourceSnapshot
- claimSnapshot
- disclaimer
- spoilerLevel
- lastVerifiedAt
- approvedBy
- approvedAt
- publishedAt

## Corrections and updates

### Correction
- id
- contentId
- severity
- originalText
- correctedText
- reason
- sourceId
- publicNotice
- status
- createdBy
- resolvedBy
- createdAt
- resolvedAt

### UpdateTask
- id
- contentId
- triggerType
- triggerReference
- dueAt
- status
- ownerId
- createdAt

## Analytics

### AnalyticsSnapshot
- id
- contentId
- platform
- snapshotAt
- impressions
- views
- ctr
- firstThirtySecondRetention
- averagePercentageViewed
- watchHours
- subscribersGained
- shortsToLongClicks
- trafficSourcesJson
- revenueJson
- importedBy
- createdAt

### PackagingExperiment
- id
- contentId
- hypothesis
- variantAId
- variantBId
- startAt
- endAt
- result
- conclusion
- createdBy

## Audit

### AuditEvent
- id
- workspaceId
- actorId
- actorType
- action
- entityType
- entityId
- beforeJson
- afterJson
- metadataJson
- requestId
- createdAt

## Critical constraints

- A `CONFIRMED` claim must have at least one active official source before editorial approval.
- `LEAKED` claims cannot be linked to a publishable content revision.
- `READY` requires current scoped approvals and no blocking rights review.
- Public revisions are immutable snapshots.
- Material content edits invalidate prior approvals.
- Audit events cannot be edited through the application.
