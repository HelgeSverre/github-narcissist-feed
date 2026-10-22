<script lang="ts">
  import { ICONS, type IconName } from "../lib/icons";
  let { name, cls = "", size = 16 }: { name: string; cls?: string; size?: number } = $props();
</script>

<svg class="ic {cls}" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true"><path d={ICONS[name as IconName] ?? ""} /></svg>
