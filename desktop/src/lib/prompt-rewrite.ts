/** Exact Desktop trigger shown in the composer / user bubble. */
export const WEB_MINECRAFT_USER_PROMPT = '帮我复刻一个原版 Minecraft，我这台 Mac M1 8GB 的浏览器得能流畅打开。';

/** Prompt actually submitted to the model when the trigger matches exactly. */
export const WEB_MINECRAFT_MODEL_PROMPT = [
  '帮我做一个网页版我的世界，在这台 Mac M1 8GB 的浏览器里打开就能玩，而且要流畅。现在就动手做并跑起来，不要只给方案。打开就是游戏，不要说明页或只丢一个仓库链接。编程语言、框架和渲染引擎你自己选，但必须是在浏览器里直接打开就能玩的网页。',
  '做成能玩的我的世界：第一人称的方块世界，能走、能跳、能挖、能放，有地形、树、水、洞穴和会自己走动的动物，也有基础的物品和合成。画面和手感按原版来。',
  'This rewrite only adds acceptance detail. It does not skip performance_admit, host verification, or the reliable-headless contract. Mutating Build work still admits before the first write. Follow the admitted route: any design/creation work is at least T1 with independent G5 review and G6 verification after root G4.',
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
