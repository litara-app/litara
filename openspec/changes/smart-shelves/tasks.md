## 1. Database

- [x] 1.1 Add `logic String @default("AND")` field to `Shelf` model in `prisma/schema.prisma`
- [x] 1.2 Generate migration: `npx prisma migrate dev --name add_shelf_logic`

## 2. Backend — DTOs

- [x] 2.1 Create `apps/api/src/smart-shelves/dto/smart-shelf-rule.dto.ts` with `CreateSmartShelfRuleDto` (`field`, `operator`, `value`) including `@ApiProperty` and validation decorators; define `ALLOWED_FIELDS` and `ALLOWED_OPERATORS` constant arrays
- [x] 2.2 Create `apps/api/src/smart-shelves/dto/create-smart-shelf.dto.ts` with `name`, `logic` (`AND`|`OR`), and `rules: CreateSmartShelfRuleDto[]` (min length 1)
- [x] 2.3 Create `apps/api/src/smart-shelves/dto/update-smart-shelf.dto.ts` as partial of create DTO
- [x] 2.4 Create `apps/api/src/smart-shelves/dto/smart-shelf-summary.dto.ts` with `id`, `name`, `logic`, `ruleCount`
- [x] 2.5 Create `apps/api/src/smart-shelves/dto/smart-shelf-detail.dto.ts` with `id`, `name`, `logic`, and `rules` array (each with `id`, `field`, `operator`, `value`)

## 3. Backend — Rule Evaluator

- [x] 3.1 Create `apps/api/src/smart-shelves/smart-shelf-evaluator.ts` — a pure function `buildBookWhere(rules, logic)` that maps each rule's `field`/`operator`/`value` to a Prisma `Book` `where` fragment, returning a complete `AND`/`OR` composed filter; handle `publishedYear` by converting to a date range; skip invalid/empty rules silently

## 4. Backend — Service & Controller

- [x] 4.1 Create `apps/api/src/smart-shelves/smart-shelves.service.ts` with methods: `findAll(userId)`, `create(userId, dto)`, `findOne(userId, id)`, `update(userId, id, dto)`, `remove(userId, id)`, `getBooks(userId, id)` (uses evaluator, caps at 500, returns `{ books, total }`)
- [x] 4.2 Create `apps/api/src/smart-shelves/smart-shelves.controller.ts` with `@ApiBearerAuth()`, routes: `GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `GET /:id/books`; all routes guard-protected and scoped to the authenticated user
- [x] 4.3 Create `apps/api/src/smart-shelves/smart-shelves.module.ts` importing `DatabaseModule`; export nothing
- [x] 4.4 Register `SmartShelvesModule` in `apps/api/src/app.module.ts`

## 5. Frontend — Types & API

- [x] 5.1 Create `apps/web/src/types/smartShelf.ts` with `SmartShelfRule`, `SmartShelfSummary`, and `SmartShelfDetail` interfaces matching the backend DTOs

## 6. Frontend — Create/Edit Modal

- [x] 6.1 Create `apps/web/src/components/SmartShelfModal.tsx` — modal with: shelf name `TextInput`; AND/OR `SegmentedControl`; dynamic rule list (each row: field `Select`, operator `Select`, value `TextInput`, remove `ActionIcon`); "Add rule" button; Save/Cancel buttons; supports both create (no `shelf` prop) and edit (shelf prop pre-populates fields)

## 7. Frontend — Smart Shelf Detail Page

- [x] 7.1 Create `apps/web/src/pages/SmartShelfPage.tsx` — fetches `GET /smart-shelves/:id` and `GET /smart-shelves/:id/books`; shows shelf name, rule summary, edit button (opens modal), and a responsive book grid using the same book card pattern as other pages; shows total count

## 8. Frontend — Sidebar Integration

- [x] 8.1 Update `apps/web/src/components/AppLayout/AppLayout.tsx` to fetch `GET /smart-shelves` and render a "Smart Shelves" section below the manual shelves section; each entry links to `/smart-shelves/:id`; include an "Add" (`+`) icon button that opens `SmartShelfModal`
- [x] 8.2 Add route `smart-shelves/:id` pointing to `SmartShelfPage` in `apps/web/src/App.tsx` (or wherever routes are defined)

## 9. Validation

- [x] 9.1 Run `npx tsc -p apps/api/tsconfig.json --noEmit` and `npx tsc -p apps/web/tsconfig.app.json --noEmit` — fix all errors
- [x] 9.2 Run `npm run lint` from the repo root — fix any lint errors
