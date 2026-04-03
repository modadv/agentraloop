import DefaultTheme from "vitepress/theme";
import MermaidLayout from "./MermaidLayout.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout: MermaidLayout,
};
