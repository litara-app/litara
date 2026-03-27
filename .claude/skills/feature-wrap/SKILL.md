---
name: feature-wrap
description: Ensure all required tasks are completed before pr is created
disable-model-invocation: true
---

# Feature Implementation Checklist

**Purpose**: This skill ensures that all required tasks for a feature implementation are completed before a pull request is created, this runs for any files in the git diff.

1. If backend has changed, ensure that NestJS DTOs are updated with proper Swagger decorators (@ApiProperty, @ApiBearerAuth)
2. Ensure that service and controller methods are implemented for any new API endpoints
3. If frontend has changed, ensure that new components are added using Mantine v8 APIs (verify with docs)
4. Run the tsc-web pre-commit hook and the tsc-api pre-commit hook to ensure that there are no TypeScript errors in the web and api projects respectively
5. If adding any scripts, verify that there are no Content Security Policy (CSP) violations in the browser console when running the app
6. If documentation is required, ensure that it is added to docusaurus and that it builds without errors
   a. User documentation is needed for any new UI features or changes, this should be added to the docs site with clear instructions and screenshots if necessary
   b. Developer documentation is needed for any new backend features or changes, this should be added to the docs site with clear explanations of the API endpoints, data models, and any relevant implementation details
7. If database changes are required, ensure that prisma schema is updated and that the generated client is used in the codebase
8. If Docker changes are required, ensure that the Dockerfile and docker-compose.yml are updated accordingly and that the app builds and runs without errors in a containerized environment
