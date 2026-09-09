---
type: Attested Computation
title: Revenue for a fiscal year
runtime: bigquery
parameters:
  - { name: year, type: integer, required: true }
executor: { resource: ../skills/run-on-bq.md, receipt: [job_id, executed_sql, result] }
attester: { resource: ../attesters/sql_equality.py }
verified: { by: human:jsmith@acme, at: 2026-07-01T09:00:00Z }
---

# Computation

```sql
SELECT SUM(net_amount) FROM orders WHERE year = @year
```
