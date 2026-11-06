# Changelog

## 0.6.0

- Node version 2 (new nodes). Existing workflows stay on version 1 and keep working unchanged.
- Post → Get Many and Conversation → Get Messages: Return All, or a Limit the node reaches by paging for you. Page is gone from the filters; Before moved into Options.
- Optional fields moved into collections: Account → Get Many Platform is under Filters; Schedule At, Wait for Delivery and Max Wait Time are under Additional Options on Post → Create.
- Post → Create never publishes twice on retry: it sends an External Reference per execution, run and item (or your own, in Additional Options), so n8n's Retry On Fail returns the post it already made.
- A failed status check while waiting for delivery no longer fails the node.
- The API key scopes the trigger needs are described on the credential.

## 0.5.0

- Threads and Bluesky: typed settings (Threads topic tag, reply permissions, poll, link card, share to Instagram Story; Bluesky caption) and both in the account filter.
- Conversation resource: list, get, read messages and reply to Instagram, Facebook and WhatsApp DMs.
- Chat33 Trigger: starts a workflow on Message Received or Lead Captured, with signature checks. Never overwrites a webhook another app saved.
- Usable as an AI agent tool.
- Published from GitHub Actions with npm provenance.
- New icon.
