# Tracker selection

## Resolve incomplete identity

When `gh issue view` or `gh pr view` omits an attached Project's owner, number,
or node ID, use paginated GraphQL to resolve the target's `projectItems`
connection and each item's Project identity.

## Discover candidates

When the target has no active tracker, discover live candidates from the
current repository instead of assuming an owner or number. Use paginated
GraphQL to read its `projectsV2` connection, including each Project's owner,
number, node ID, title, URL, and closed state. Read open milestones through the
REST API:

```sh
gh api graphql --paginate \
  -f owner=REPOSITORY_OWNER -f name=REPOSITORY_NAME \
  -f query='query($owner: String!, $name: String!, $endCursor: String) {
    repository(owner: $owner, name: $name) {
      projectsV2(first: 100, after: $endCursor) {
        nodes { id number title url closed owner { ... on User { login } ... on Organization { login } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }'
gh api --paginate 'repos/REPOSITORY_OWNER/REPOSITORY_NAME/milestones?state=open&per_page=100'
```

Present one numbered choice list containing open repository-linked Projects and
milestones, followed by `New Project` and `New Milestone`. Include tracker type,
owner or repository, title, and number in each choice. Ask one question so the
user can answer with a number. Retain the chosen tracker identity.

## Create a tracker

When the user selects `New Project` or `New Milestone`, interview about that
tracker before creating the work item. Resolve its title, purpose, owner or
repository, and minimum useful configuration.

For a Project, also resolve its initial Status options, create it under the
repository owner, and link it to the current repository. For a milestone,
resolve any useful description or due date. Create it only after the user
confirms those decisions, then return to the work-item workflow in `SKILL.md`.

Complete this branch only when the selected tracker's live identity is explicit
and any new tracker has been confirmed, created, and linked as required.
