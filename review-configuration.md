# Independent review source configuration

Set server-only `WAVEWORLD_REVIEW_ISSUE_URL` to one operator-approved canonical
HTTPS issue URL, e.g. `https://forge.example.invalid/research/evidence/issues/46`.
Never put real operational comments, review evidence or credentials in examples.

The configured URL has exactly `/owner/repository/issues/positive-number`, without
userinfo, query or fragment. Missing/invalid configuration returns503. The legacy
`giteaIssue46CommentUrl` payload name is unchanged: it must match the same exact
origin/repository/issue and canonical spelling, without query/userinfo; only
optional `#issuecomment-N` is accepted. Unknown fields remain tolerated. All OIDC,
authenticated reviewer/non-owner, digest, semantic and tamper guards remain.
This does not fetch comments, copy private evidence, migrate users or modify
the original private deployment. See the retained route in the Host OpenAPI.
