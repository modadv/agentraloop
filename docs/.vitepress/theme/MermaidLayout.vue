<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import { useRoute } from "vitepress";
import { nextTick, onMounted, onBeforeUnmount, watch } from "vue";

const route = useRoute();

let mutationObserver: MutationObserver | null = null;
let renderPass = 0;

function readTheme(): "dark" | "default" {
  return document.documentElement.classList.contains("dark") ? "dark" : "default";
}

function createDiagramId(index: number): string {
  const safePath = route.path
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const pageId = safePath.length > 0 ? safePath : "page";
  return `mermaid-${pageId}-${renderPass}-${index}`;
}

async function renderMermaid(): Promise<void> {
  const mermaidNodes = Array.from(
    document.querySelectorAll<HTMLElement>(".mermaid-block[data-mermaid-source]"),
  );

  if (mermaidNodes.length === 0) {
    return;
  }

  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: readTheme(),
  });

  renderPass += 1;
  let index = 0;
  for (const node of mermaidNodes) {
    const encoded = node.dataset.mermaidSource;
    if (!encoded) {
      continue;
    }

    const source = decodeURIComponent(encoded);
    try {
      const { svg, bindFunctions } = await mermaid.render(createDiagramId(index), source);
      node.innerHTML = svg;
      bindFunctions?.(node);
    } catch (error) {
      node.innerHTML = `<pre class="mermaid-error">${String(error)}</pre>`;
    }

    index += 1;
  }
}

async function rerenderMermaid(): Promise<void> {
  await nextTick();
  await renderMermaid();
}

onMounted(async () => {
  await rerenderMermaid();

  mutationObserver = new MutationObserver(() => {
    void rerenderMermaid();
  });

  mutationObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
});

onBeforeUnmount(() => {
  mutationObserver?.disconnect();
  mutationObserver = null;
});

watch(
  () => route.path,
  () => {
    void rerenderMermaid();
  },
);
</script>

<template>
  <DefaultTheme.Layout />
</template>
