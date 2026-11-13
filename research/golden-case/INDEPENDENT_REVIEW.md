# Independent review protocol

This protocol is for a reviewer who did not implement the golden case. It is deliberately self-contained: do not accept verbal context, unpublished files, or credentials from an implementer as evidence.

## Preconditions

1. Sign in to the operator-selected WaveWorld origin with your own OIDC account.
   The server must configure `WAVEWORLD_REVIEW_ISSUE_URL` as described in
   `../../review-configuration.md`; missing/invalid configuration returns503.
2. Record the public `/api/health` build ID. It must equal the source commit declared in the review record.
3. Obtain the golden publication through its production Publication download endpoint. Record the Project, Job, Comparison, Artifact and Publication IDs shown by the system.
4. Work in a new empty directory outside the WaveWorld repository. Do not use repository dependencies.

## Offline verification

Copy only the downloaded `.wwpub.json`, `verify-publication-bundle.mjs`, and `verify-golden-publication.mjs` into the empty directory, then run:

```bash
node verify-publication-bundle.mjs golden.wwpub.json
node verify-golden-publication.mjs golden.wwpub.json
```

Both commands must exit zero. Record their complete stdout, stderr, exit status, elapsed time and SHA-256 of every copied file.

## Required negative test

Make a disposable copy of the bundle, alter one numeric RK4 prediction, recompute only the generic manifest/entry hashes, and run both verifiers again. The generic bundle verifier may pass the re-signed container, but the golden semantic verifier must exit non-zero. Delete the disposable copy after recording its SHA-256 and error output.

Do not change the original downloaded bundle. Do not paste session cookies, bearer tokens, OIDC claims, Agent tokens, or private source data into the review record.

## Scientific questions

Answer without consulting an implementer:

1. What real dataset and two experimental conditions are represented?
2. Did the preregistered primary hypothesis pass, fail, or remain uncertain?
3. Did the workflow fail, or did the declared models fail the scientific fit gate?
4. Does the evidence justify an absolute singlet-oxygen, clinical, or causal claim?
5. Did the CPU/GPU state-level v1 tolerance pass? Did that numerical result change the scientific decision?

Expected interpretation is not supplied here; it must be derived from the embedded preregistration, evidence and decision artifacts.

## Feedback and attestation

Copy `independent-review.template.json`, set `status` to `completed`, fill every `REQUIRED` value, and attach it to a comment on the exact configured issue from your own authenticated forge account. Include usability problems and every manual step, even if the final decision is correct. The reviewer account, Issue comment URL and production account identifier must be independently attributable and must not belong to an implementer.

Finally open `/independent-review?publication=<PUBLICATION_ID>` on that same operator-selected WaveWorld origin while signed in with the same W-ID and submit the exact JSON attached to the configured issue. WaveWorld rejects a publication owner's self-review, requires a W-ID session, re-runs generic and golden semantic verification, performs an additional server-side re-signed prediction tamper exercise, and writes a digest-bound immutable review record. Record the returned Review ID and record SHA-256 in a follow-up comment on that configured issue.

This document specifies the procedure but is not itself evidence that an independent review occurred.
