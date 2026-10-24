import "./app.css";
import { mount } from "svelte";
import { isWebsite } from "./lib/platform";

if (isWebsite) await import("./web");
const { default: App } = await import("./App.svelte");

mount(App, { target: document.getElementById("app")! });
