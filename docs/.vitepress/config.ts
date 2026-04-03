import { defineConfig } from "vitepress";

const repo = "https://github.com/modadv/agentraloop";
const isGitHubActions = process.env.GITHUB_ACTIONS === "true";

export default defineConfig({
  title: "AgentraLoop",
  description: "Agent-centric runtime, orchestration model, and Web Studio documentation.",
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,
  base: process.env.DOCS_BASE ?? (isGitHubActions ? "/agentraloop/" : "/"),
  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }]],
  markdown: {
    config(md) {
      const fence = md.renderer.rules.fence;

      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token.info.trim() === "mermaid") {
          const source = encodeURIComponent(token.content);
          return `<div class="mermaid-block" data-mermaid-source="${source}"></div>`;
        }

        if (fence) {
          return fence(tokens, idx, options, env, self);
        }

        return self.renderToken(tokens, idx, options);
      };
    },
  },
  themeConfig: {
    nav: [
      { text: "Getting Started", link: "/getting-started" },
      { text: "API", link: "/api/" },
      { text: "Architecture", link: "/architecture/" },
      { text: "Design", link: "/design/" },
      { text: "Research", link: "/research/" },
    ],
    sidebar: {
      "/api/": [
        {
          text: "API",
          items: [
            { text: "Overview", link: "/api/" },
            { text: "REST API", link: "/api/rest-api" },
          ],
        },
      ],
      "/architecture/": [
        {
          text: "Architecture",
          items: [
            { text: "Overview", link: "/architecture/" },
            { text: "Agent-Centric Runtime", link: "/architecture/agent-centric-runtime" },
            { text: "Runtime and Orchestration", link: "/architecture/runtime-and-orchestration" },
            { text: "Task Queue", link: "/architecture/task-queue" },
            { text: "Providers", link: "/architecture/providers" },
            { text: "Web Studio", link: "/architecture/web-studio" },
          ],
        },
      ],
      "/design/": [
        {
          text: "Design",
          items: [
            { text: "Overview", link: "/design/" },
            { text: "System Concept", link: "/design/system-concept" },
            { text: "General Pipeline Design", link: "/design/general-pipeline" },
          ],
        },
      ],
      "/research/": [
        {
          text: "Research",
          items: [
            { text: "Overview", link: "/research/" },
            { text: "Paper Draft", link: "/research/paper-draft" },
            { text: "Paper Outline", link: "/research/paper-outline" },
            { text: "Paper Plan", link: "/research/paper-plan" },
            { text: "Working Bibliography", link: "/research/working-bibliography" },
          ],
        },
      ],
    },
    search: {
      provider: "local",
    },
    socialLinks: [{ icon: "github", link: repo }],
    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    outline: {
      level: [2, 3],
    },
    footer: {
      message: "Released under the ISC License.",
      copyright: "Copyright © 2026 AgentraLoop contributors",
    },
    docFooter: {
      prev: "Previous",
      next: "Next",
    },
  },
});
