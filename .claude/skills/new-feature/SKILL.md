---
name: new-feature
description: Implement a new feature in the application
disable-model-invocation: true
---

# Feature Implementation Checklist

1. Create/update NestJS DTOs with proper Swagger decorators (@ApiProperty, @ApiBearerAuth)
2. Implement service and controller methods
3. Add frontend components using Mantine v8 APIs (verify docs)
4. Run `npx tsc --noEmit` and `npm run build` before reporting done
5. Verify no CSP violations if adding scripts
