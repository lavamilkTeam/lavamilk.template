<script setup>
import { computed } from 'vue';
import MarkdownIt from 'markdown-it';

const props = defineProps({ content: { type: String, required: true } });
// Model output is untrusted: escape HTML, reject unsafe links, and do not load images.
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true }).disable('image');
/** @type {import('markdown-it').RendererRule} */
const linkOpen = (tokens, index, options, _environment, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};
markdown.renderer.rules.link_open = linkOpen;
const rendered = computed(() => markdown.render(props.content));
</script>

<template>
  <div class="chat-markdown" v-html="rendered" />
</template>

<style scoped>
.chat-markdown { font-size: 15px; line-height: 1.85; overflow-wrap: anywhere; }
.chat-markdown :deep(> :first-child) { margin-top: 0; }
.chat-markdown :deep(> :last-child) { margin-bottom: 0; }
.chat-markdown :deep(p) { margin: 0 0 1em; }
.chat-markdown :deep(h1), .chat-markdown :deep(h2), .chat-markdown :deep(h3),
.chat-markdown :deep(h4), .chat-markdown :deep(h5), .chat-markdown :deep(h6) {
  margin: 1.7em 0 .65em; font-weight: 650; line-height: 1.45; letter-spacing: -.015em;
}
.chat-markdown :deep(h1) { font-size: 1.4em; }
.chat-markdown :deep(h2) { font-size: 1.25em; }
.chat-markdown :deep(h3) { font-size: 1.12em; }
.chat-markdown :deep(ul), .chat-markdown :deep(ol) { margin: .75em 0 1.25em; padding-left: 1.6em; }
.chat-markdown :deep(ul) { list-style: disc; }
.chat-markdown :deep(ol) { list-style: decimal; }
.chat-markdown :deep(li) { margin: .35em 0; padding-left: .15em; }
.chat-markdown :deep(li > p) { margin: .35em 0; }
.chat-markdown :deep(strong) { font-weight: 650; }
.chat-markdown :deep(a) { text-decoration: underline; text-underline-offset: 3px; }
.chat-markdown :deep(code) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .86em; border-radius: 4px; padding: .15em .35em; background: var(--ui-bg-elevated); }
.chat-markdown :deep(pre) { max-width: 100%; overflow-x: auto; margin: 1.25em 0; padding: 18px 20px; border: 1px solid var(--ui-border); border-radius: 10px; background: var(--ui-bg-muted); line-height: 1.65; }
.chat-markdown :deep(pre code) { padding: 0; border: 0; background: none; overflow-wrap: normal; }
.chat-markdown :deep(blockquote) { margin: 1em 0; padding-left: 1em; border-left: 2px solid var(--ui-border-accented); color: var(--ui-text-muted); }
.chat-markdown :deep(table) { display: block; width: max-content; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin: 1.25em 0; }
.chat-markdown :deep(th), .chat-markdown :deep(td) { padding: 8px 12px; border: 1px solid var(--ui-border); text-align: left; }
.chat-markdown :deep(hr) { margin: 1.75em 0; border-color: var(--ui-border); }
</style>
