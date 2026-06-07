---
name: project-services
description: Current Hello Moving service lineup after June 2026 restructure
metadata: 
  node_type: memory
  type: project
  originSessionId: 1a767379-5f62-4db2-b6c7-bbbd79e93c80
---

Services removed: オフィス・法人移転, 外国人向け引越し

Current 6 services (order matters — Emergency is first, full-width featured card):
1. 当日・お急ぎ引越しプラン — FEATURED (grid-column: 1/-1, amber styling, CTA buttons embedded)
2. 単身引越し
3. カップル・ご夫婦引越し
4. 学生・新生活引越し
5. 不用品回収・処分サービス
6. 家具組立・分解

**Why:** Brief requested removal of Family/International Moving, emphasis on Emergency as #1 conversion driver.

**How to apply:** Keep Emergency first in HTML order. The .service-card-featured class spans 3 columns via grid-column:1/-1 on a repeat(3,1fr) grid. Form dropdown and footer links must match this list.
