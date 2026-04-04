# WebWaka Services (`webwaka-services`) QA Certification

**Prepared by:** Manus AI
**Date:** April 2026
**Target Repository:** `webwaka-services`

## 1. Audit Scope

This QA certification covers the implementation of the Dynamic Scheduling Engine, Multi-Staff Management, and AI Customer Support Bot in `webwaka-services`.

## 2. Acceptance Criteria

| ID | Feature | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- |
| QA-SRV-1 | Dynamic Scheduling | The scheduling engine successfully calculates available time slots, factoring in service duration, staff availability, and buffer times. | PENDING |
| QA-SRV-2 | Multi-Staff | The booking system correctly assigns appointments to specific staff members and prevents double-booking. | PENDING |
| QA-SRV-3 | AI Support Bot | `getAICompletion()` successfully answers common booking inquiries based on the business's FAQ and service list. | PENDING |
| QA-SRV-4 | Unit Tests | All new scheduling and support modules have passing unit tests in `src/**/*.test.ts`. | PENDING |

## 3. Offline Resilience Testing

- The services suite is a backend API; offline resilience applies to its clients (e.g., booking widgets).
- However, the service must gracefully handle upstream provider outages (e.g., AI platform 503s) by falling back to a standard "Please call us to book" message in the chatbot.

## 4. Security & RBAC Validation

- Verify that the staff management endpoints require a valid business owner JWT and the `manage:staff` permission.
- Ensure that customers cannot view the personal calendars or contact information of staff members.
- Confirm that the AI chatbot is rate-limited to prevent abuse and prompt injection attacks.

## 5. Regression Guards

- Run `npm run test` to ensure 100% pass rate.
- Run `npm run build` to ensure no TypeScript compilation errors.
- Verify that the existing basic booking logic still functions correctly and integrates with the new dynamic scheduling engine.
