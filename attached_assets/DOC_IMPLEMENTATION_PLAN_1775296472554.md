# WebWaka Platform Docs (`webwaka-platform-docs`) Implementation Plan

**Prepared by:** Manus AI
**Date:** April 2026
**Target Repository:** `webwaka-platform-docs`

## 1. Executive Summary

`webwaka-platform-docs` is the central repository for all architectural decisions, API documentation, and governance policies for the WebWaka ecosystem. This plan details the next phase of enhancements to support automated API reference generation, interactive tutorials, and multi-language support.

## 2. Current State vs. Target State

**Current State:**
- Static Markdown files for architecture and governance.
- Manual updates required for API changes.
- English-only documentation.

**Target State:**
- Automated OpenAPI (Swagger) generation from TypeScript interfaces.
- Interactive "Try it out" API explorer.
- Multi-language support (French, Swahili, Arabic) via AI translation.
- Versioned documentation for different API releases.

## 3. Enhancement Backlog (Top 20)

1. **Automated OpenAPI Generation:** Use `tsoa` or similar tools to automatically generate OpenAPI specs from the source code of all 15 repos.
2. **Interactive API Explorer:** Integrate Swagger UI or Redoc to allow developers to test API endpoints directly from the docs.
3. **AI Translation Pipeline:** Use `webwaka-ai-platform` to automatically translate Markdown files into French, Swahili, and Arabic.
4. **Versioned Documentation:** Support multiple versions of the docs (e.g., v1.x, v2.x) with a dropdown selector.
5. **Interactive Tutorials:** Step-by-step guides with embedded code editors (e.g., CodeSandbox) for building custom integrations.
6. **Global Search:** Implement Algolia DocSearch for fast, typo-tolerant searching across all documentation.
7. **Architecture Decision Records (ADRs):** Formalize the process for proposing and approving new architectural changes.
8. **Changelog Generator:** Automatically generate release notes from GitHub PR titles and commit messages.
9. **Tenant Onboarding Guide:** Comprehensive guide for new tenants setting up their storefronts or portals.
10. **Developer Portal:** Dedicated section for third-party developers building apps on the WebWaka Open API.
11. **Security & Compliance Hub:** Centralized documentation for NDPR, ISO 27001, and PCI-DSS compliance.
12. **Webhooks Reference:** Detailed documentation on all available event types and payload schemas.
13. **UI Component Library (Storybook):** Host the Storybook documentation for the `@webwaka/ui` React components.
14. **Error Code Glossary:** Comprehensive list of all API error codes and troubleshooting steps.
15. **Postman Collection Generator:** Automatically generate and host a downloadable Postman collection.
16. **SDK Documentation:** Dedicated docs for the official WebWaka Node.js, Python, and PHP SDKs.
17. **Contribution Guidelines:** Clear instructions for open-source contributors (e.g., code style, PR process).
18. **Platform Status Integration:** Embed the real-time platform status widget directly into the docs header.
19. **Feedback Widget:** Allow users to rate documentation pages (Thumbs Up/Down) and suggest improvements.
20. **Dark Mode Support:** Implement a toggle for dark/light themes across the documentation site.

## 4. Execution Phases

### Phase 1: API Reference & Automation
- Implement Automated OpenAPI Generation.
- Implement Interactive API Explorer.

### Phase 2: Search & Discovery
- Implement Global Search (Algolia).
- Implement Versioned Documentation.

### Phase 3: Localization & Community
- Implement AI Translation Pipeline.
- Implement Interactive Tutorials.

## 5. Replit Execution Prompts

**Prompt 1: Automated OpenAPI Generation**
```text
You are the Replit execution agent for `webwaka-platform-docs`.
Task: Implement Automated OpenAPI Generation.
1. Set up a GitHub Action workflow `.github/workflows/generate-openapi.yml`.
2. The workflow should clone all 15 repos, run `tsoa spec` or a custom AST parser to extract routes and types.
3. Merge the generated JSON files into a single `openapi.json` file.
4. Commit and push the updated `openapi.json` to the `main` branch.
```

**Prompt 2: Interactive API Explorer**
```text
You are the Replit execution agent for `webwaka-platform-docs`.
Task: Implement Interactive API Explorer.
1. Install `swagger-ui-react` in the documentation site (assuming Docusaurus or Next.js).
2. Create a new page `src/pages/api-reference.tsx`.
3. Load the generated `openapi.json` into the Swagger UI component.
4. Ensure the "Try it out" feature points to the staging API environment by default.
```
