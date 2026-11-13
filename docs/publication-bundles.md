# Verifiable research publication bundles

`POST /api/v1/publications` freezes one or more succeeded `path-experiment` jobs into an immutable, versioned publication. Every selected job must have a ready audit manifest and all jobs must have the same project scope. A personal job owner or project owner/editor may publish; project viewers cannot. Set `public: true` only when anonymous, immutable download is intended. Private publications remain readable by their creator and project members.

Example request:

```json
{
  "title": "Ir ultrasound triplet/ROS comparison",
  "jobIds": ["job-id-a", "job-id-b"],
  "public": false,
  "evidencePolicies": {
    "evidence-id": { "mode": "embed" },
    "restricted-evidence-id": {
      "mode": "exclude",
      "reason": "Participant consent prohibits redistribution."
    }
  }
}
```

Evidence bytes can be embedded only when their immutable metadata contains `redistributionAllowed: true`. Otherwise use `external` with a recorded DOI/URL/citation/source locator, or `exclude` with an explicit reason. The bundle still records the evidence digest, so an independently obtained source can be matched without redistributing it.

Download `GET /api/v1/publications/{publicId}/download?version=1`, then verify without a running WaveWorld server or third-party packages:

```bash
node scripts/verify-publication-bundle.mjs pub_xxx-v1.wwpub.json
```

The verifier checks the canonical manifest digest, exact one-to-one entry inventory, decoded byte lengths and SHA-256 hashes, plus evidence disposition invariants. A successful result prints the stable public ID, version, bundle digest, manifest digest, and entry count. Keep the complete downloaded file: excluded/external evidence is intentionally not self-contained and is explicitly identified in its manifest.
