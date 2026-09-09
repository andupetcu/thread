---
type: Reference
title: Duplicate Transactions Metric
generated: { by: reference_agent/gemini-3.5-flash, at: '2026-07-10T23:15:47+00:00' }
sources:
  - id: gcp-blog
    resource: https://cloud.google.com/blog/topics/public-datasets/bitcoin-in-bigquery-blockchain-analytics-on-public-data
---

```sql
SELECT transaction_id, COUNT(*) FROM transactions GROUP BY transaction_id
```
