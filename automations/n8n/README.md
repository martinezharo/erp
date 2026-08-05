# Wallapop Gmail -> OlivERP

Import `wallapop-gmail-to-erp.json` into n8n and attach a Gmail OAuth credential
to the Gmail Trigger node. Configure these n8n variables without committing
them:

- `ERP_API_URL`: for example `https://oliverp.pages.dev`
- `ERP_API_KEY`: a project-pinned `erp_sk_...` key with `write` scope
- `ERP_PROJECT_ID`: the ERP project id, normally `1` for Octopus Control

The workflow searches for Wallapop sale-confirmation messages, parses the plain
text or HTML body, and posts the structured event to
`/api/v1/importaciones/wallapop`. The Gmail message id is sent as both the
source id and the idempotency key, so polling or delivery retries are safe.

Before activating it, map each exact Wallapop listing title to a product. For
an existing product:

```bash
curl -X PATCH "$ERP_API_URL/api/v1/productos/PRODUCT_ID" \
  -H "Authorization: Bearer $ERP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"titulo_wallapop":"Mando Xiaomi XMRM-006 a Estrenar"}'
```

The workflow deliberately stops with an error when the exact email title is not
mapped; it never guesses a product.
