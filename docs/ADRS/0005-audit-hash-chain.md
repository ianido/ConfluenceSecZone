# ADR-0005: Audit as a hash chain (tamper-evident, not immutable)

Status: accepted

Each audit record holds `prevHash` and `hash = sha256(prevHash | canonical(entry))`; the section keeps the head
hash. Verification returns OK, PARTIAL (older entries pruned by retention), or BROKEN. Audit metadata is an
allowlist of short scalar fields; content is never recorded. Denied access is recorded at most once per user and
section per day to prevent audit flooding.

We do not call the log immutable: Forge storage has no write-once guarantee. See docs/SECURITY.md section 6.
