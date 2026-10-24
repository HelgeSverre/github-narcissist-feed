/** Throwaway display sketch. No account access, requests, or persisted state. */
import "../app.css";
import "./display.css";
import { mount } from "svelte";
import DisplayPrototype from "./DisplayPrototype.svelte";
mount(DisplayPrototype, { target: document.getElementById("app")! });
