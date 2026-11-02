# ADR-0008: Tiptap for editing, our own validator and renderer for trust

Status: accepted

Tiptap 3 (ProseMirror) is the editor. It is never trusted: the shared allowlist validator runs on the client
before save, on the server before storing and after loading from storage, and rendering for viewers uses React
elements built from the validated JSON (no HTML parsing). Extensions disabled: images, underline, autolink and
link-on-paste (to avoid surprise links); link URIs are filtered with `isSafeHref`. Tables are included (stable
extension) without resizing.

Alternatives rejected: Atlaskit editor (heavier, not designed for isolated storage), contenteditable with
sanitiser (more custom attack surface).

Risk: Custom UI runs in a sandboxed iframe; clipboard, IME and focus behaviour inside the Forge iframe is spike
S6 (verified only in headless Chromium with the harness).
