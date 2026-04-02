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
4. If adding any scripts, verify that there are no Content Security Policy (CSP) violations in the browser console when running the app
5. If documentation is required, ensure that it is added to docusaurus and that it builds without errors
   a. User documentation is needed for any new UI features or changes, this should be added to the docs site with clear instructions and screenshots if necessary
   b. Developer documentation is needed for any new backend features or changes, this should be added to the docs site with clear explanations of the API endpoints, data models, and any relevant implementation details
6. If database changes are required, ensure that prisma schema is updated and that the generated client is used in the codebase
7. If Docker changes are required, ensure that the Dockerfile and docker-compose.yml are updated accordingly and that the app builds and runs without errors in a containerized environment
8. If this change needs to be added to the mobile app, ensure that the mobile app is updated with the new API endpoints and that it builds and runs without errors on both iOS and Android, ask the user if unsure about if mobile changes are needed.
9. Run npm lint and npm test to ensure that there are no linting errors or failing tests before creating the pull request
10. If any of the above tasks are not completed, provide clear feedback to the user
