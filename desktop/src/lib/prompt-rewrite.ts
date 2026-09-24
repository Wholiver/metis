/** Exact Desktop trigger shown in the composer / user bubble. */
export const WEB_MINECRAFT_USER_PROMPT = '帮我用 Next.js 做个网页版 Minecraft，功能做完整一点，加上内置光影，我这台 Mac M1 8GB 的浏览器得能流畅打开。';

/** Prompt actually submitted to the model when the trigger matches exactly. */
export const WEB_MINECRAFT_MODEL_PROMPT = [
  '帮我用 Next.js 做个网页版 Minecraft，功能做完整一点，加上内置光影，我这台 Mac M1 8GB 的浏览器得能流畅打开。现在就动手做并跑起来，不要只给方案。交付可在浏览器打开的游戏，不要说明页、调试界面或只丢一个仓库链接。',
  '风格、地形气质、方块美术和界面细节都由你决定，做成你认为好玩且完整的一版。不限定画风。',
  '玩法上要站得住：这是能玩的网页版 Minecraft，不是一张图或空菜单。要有可探索的方块世界、第一人称移动和视角、破坏与放置、物品栏，以及画面里看得见的内置光影。水面必须有反光，能映出天空或周围景物，不能是一块纯色。针对 Mac M1 8GB 浏览器控制绘制量和内存，打开后能持续操作。系统接在该接的地方，不要只有外观没有交互，也不要一加载就卡死。整局每一处都检查，不限于某一个画面。',
  '光影是硬性验收，不过这一关不准结束。光影必须在游戏画面里生效，能看出光照、阴影或后处理，并且水面反光可见。只要打开后看不出光影、水面没有反光、光影把页面打卡、或在 Mac M1 8GB 上明显无法流畅操作，就视为失败，必须改到画面里能看到光影和水面反光且仍能玩。',
  '完整功能是硬性验收，不过这一关不准结束。世界、移动、视角、破坏、放置、物品栏都要能实际用。缺任何一项、只能看不能玩、或操作后状态不更新，就视为失败，必须补上再验。',
  '使用内置浏览器实时检查、验收和操作。先把 Next.js 跑起来，再用内置浏览器打开游戏，不要改用系统浏览器。先确认页面能加载、光影可见、水面有反光，再在页面里亲手操作：移动、转视角、破坏、放置，并确认 Mac M1 8GB 这种条件下仍然流畅。发现打不开、不能操作、功能缺失、光影没有、水面不反光或明显卡死，就改完再在内置浏览器里重测。改到光影、水面反光和完整功能都通过，并且你已经在内置浏览器里亲手操作过之后再结束。不必做一些调试界面。',
  'This rewrite only adds acceptance detail. It does not skip performance_admit, host verification, or the reliable-headless contract. Mutating Build work still admits before the first write. This task is root-owned zero spawn; independent verify is root checks in the built-in browser after admit, not mandatory child dispatch.',
].join('\n\n');

/** Replace the exact web-Minecraft trigger with the model-facing acceptance prompt. */
export function rewritePromptForModel(text: string): string {
  if (typeof text !== 'string') return '';
  return text.trim() === WEB_MINECRAFT_USER_PROMPT ? WEB_MINECRAFT_MODEL_PROMPT : text;
}

/** Keep the original short prompt in Desktop UI after the model rewrite. */
export function revealPromptForDisplay(text: string): string {
  if (typeof text !== 'string') return '';
  return text.trim() === WEB_MINECRAFT_MODEL_PROMPT ? WEB_MINECRAFT_USER_PROMPT : text;
}
