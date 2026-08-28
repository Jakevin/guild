export type CatalogSkill = {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  body: string;
  featured?: boolean;
};

export const CATALOG_SKILLS: CatalogSkill[] = [
  {
    slug: "frontend-design",
    name: "Frontend Design",
    description: "產出有生產品質的前端介面，避開常見 AI 審美。",
    tags: ["development", "design"],
    featured: true,
    body: "Use this skill when building or restyling UI. Prefer distinctive layout, type, and color. Avoid generic purple-gradient cards.",
  },
  {
    slug: "code-review",
    name: "Code Review",
    description: "審查正確性、安全、回歸與缺測，給可執行的修法。",
    tags: ["code-review", "development"],
    featured: true,
    body: "Review like an owner. Lead with concrete findings, file refs, and a fix. Skip style-only nits unless they hide a bug.",
  },
  {
    slug: "tdd",
    name: "Test-Driven Development",
    description: "先寫失敗測試，再寫最小實作，最後重構。",
    tags: ["testing", "development"],
    featured: true,
    body: "Write a failing test first. Implement the smallest change that passes. Do not add features without coverage.",
  },
  {
    slug: "browser-automation",
    name: "Browser Automation",
    description: "導覽網頁、填表、截圖、擷取資料。",
    tags: ["browser", "testing"],
    body: "Use the browser tool (action=open/snapshot/click/type). Prefer snapshot refs (@e1) over raw HTML. Default profile has no logins; the user enables GUILD_BROWSER_REAL_PROFILE=1 to snapshot last_used Chrome cookies into ~/.guild/browser-profile/chrome (never the live profile).",
  },
  {
    slug: "web-research",
    name: "Web Research",
    description: "多來源搜尋、交叉驗證，輸出帶引用的研究筆記。",
    tags: ["research"],
    featured: true,
    body: "Search widely, verify across sources, and cite. Distinguish fact, inference, and unknown.",
  },
  {
    slug: "git-pr",
    name: "Git & Pull Requests",
    description: "分支、提交訊息、PR 描述與 review 迴圈。",
    tags: ["development", "git"],
    body: "Keep commits small. Write Conventional Commit subjects. Open PRs with intent, test plan, and risk.",
  },
  {
    slug: "security-review",
    name: "Security Review",
    description: "找注入、祕密外洩、權限提升與不安全預設。",
    tags: ["security", "code-review"],
    body: "Hunt for injection, secret leakage, authz gaps, and unsafe defaults. Report severity and a concrete fix.",
  },
  {
    slug: "docs-writer",
    name: "Documentation",
    description: "寫 README、API 說明與操作手冊，先講怎麼用。",
    tags: ["document"],
    body: "Document how to use it first. Include commands, examples, and failure modes. Keep it short.",
  },
  {
    slug: "api-design",
    name: "API Design",
    description: "設計 REST/JSON 契約：錯誤、冪等、版本。",
    tags: ["api", "development"],
    body: "Design explicit resources, error bodies, and idempotency. Prefer boring JSON over cleverness.",
  },
  {
    slug: "debugger",
    name: "Debugger",
    description: "用 repro、log、二分法追根因，禁止亂猜補丁。",
    tags: ["development"],
    body: "Reproduce first. Bisect. Read logs. Do not shotgun-patch. State the failing observation before the fix.",
  },
  {
    slug: "product-spec",
    name: "Product Spec",
    description: "把含糊需求收成目標、非目標與驗收條件。",
    tags: ["product"],
    body: "Write goals, non-goals, and testable acceptance. Ask one clarifying question only when a decision is blocked.",
  },
  {
    slug: "copy-editing",
    name: "Copy Editing",
    description: "潤稿、校對、讓語氣一致且可讀。",
    tags: ["document", "communication"],
    body: "Edit for clarity and voice. Cut filler. Keep the author's intent. Do not invent claims.",
  },
  {
    slug: "data-analysis",
    name: "Data Analysis",
    description: "整理數據、找出趨勢，給可檢查的結論。",
    tags: ["data-analysis"],
    body: "State the question, the data, the method, and the uncertainty. Show the numbers that support the claim.",
  },
  {
    slug: "qa-repro",
    name: "QA Reproduction",
    description: "寫 repro 步驟、期望/實際、環境，並驗證修復。",
    tags: ["testing", "qa"],
    body: "Write numbered repro steps, expected vs actual, and environment. Verify a fix with the same steps.",
  },
  {
    slug: "planner",
    name: "Implementation Planner",
    description: "把工作拆成可指派的步驟，標依賴與風險。",
    tags: ["product", "development"],
    featured: true,
    body: "Break work into ordered steps with owners, dependencies, and risks. Do not start coding in plan mode.",
  },
  {
    slug: "accessibility",
    name: "Accessibility",
    description: "依 WCAG 檢查鍵盤、對比、語意與螢幕閱讀器。",
    tags: ["development", "testing"],
    body: "Check keyboard paths, contrast, semantics, and screen-reader names. Cite WCAG when you flag an issue.",
  },
];
