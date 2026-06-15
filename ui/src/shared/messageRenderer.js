/**
 * 消息富文本渲染器
 * 支持：
 *  - Discord emoji :name: -> 对应 Unicode emoji 或自定义表情
 *  - **粗体** / *斜体* / ~~删除线~~ / `代码` / ```代码块```
 *  - @mention 高亮
 *  - URL 自动链接
 *  - 换行 \n -> <br>
 */

// ─── Discord emoji 映射（常用子集） ───────────────────────────────────────────
const DISCORD_EMOJI_MAP = {
  // 笑脸
  grinning: '😀', grin: '😁', joy: '😂', rofl: '🤣', smile: '😊',
  blush: '😊', wink: '😉', heart_eyes: '😍', kissing: '😗', stuck_out_tongue: '😛',
  thinking: '🤔', neutral_face: '😐', expressionless: '😑', unamused: '😒',
  disappointed: '😞', worried: '😟', angry: '😠', rage: '😡', cry: '😢',
  sob: '😭', fearful: '😨', cold_sweat: '😰', flushed: '😳', dizzy_face: '😵',
  exploding_head: '🤯', sunglasses: '😎', nerd_face: '🤓', money_mouth_face: '🤑',
  zipper_mouth_face: '🤐', shushing_face: '🤫', face_with_raised_eyebrow: '🤨',
  clown_face: '🤡', skull: '💀', ghost: '👻', alien: '👽', robot: '🤖',
  poop: '💩', fire: '🔥', sparkles: '✨', star: '⭐', dizzy: '💫',
  heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚',
  blue_heart: '💙', purple_heart: '💜', black_heart: '🖤', broken_heart: '💔',
  // 手势
  thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎',
  clap: '👏', wave: '👋', ok_hand: '👌', v: '✌️', raised_hand: '✋',
  fist: '✊', punch: '👊', muscle: '💪', pray: '🙏', point_right: '👉',
  // 游戏/科技
  joystick: '🕹️', video_game: '🎮', computer: '💻', keyboard: '⌨️',
  headphones: '🎧', microphone: '🎤', speaker: '🔊', mute: '🔇',
  // 动物
  cat: '🐱', dog: '🐶', fox_face: '🦊', wolf: '🐺', bear: '🐻',
  panda_face: '🐼', koala: '🐨', tiger: '🐯', lion: '🦁',
  // 食物
  pizza: '🍕', hamburger: '🍔', fries: '🍟', hotdog: '🌭', taco: '🌮',
  sushi: '🍣', bento: '🍱', ramen: '🍜', rice: '🍚', tea: '🍵',
  coffee: '☕', beer: '🍺', wine_glass: '🍷', champagne: '🍾',
  // 符号
  white_check_mark: '✅', x: '❌', warning: '⚠️', no_entry: '⛔',
  information_source: 'ℹ️', question: '❓', exclamation: '❗',
  tada: '🎉', confetti_ball: '🎊', trophy: '🏆', medal: '🥇',
  // 天气
  sunny: '☀️', partly_sunny: '⛅', cloud: '☁️', rain: '🌧️', snowflake: '❄️',
  rainbow: '🌈', thunder: '⛈️', tornado: '🌪️',
  // 杂
  rocket: '🚀', airplane: '✈️', car: '🚗', train: '🚂',
  house: '🏠', office: '🏢', hospital: '🏥', school: '🏫',
  eyes: '👀', brain: '🧠', speech_balloon: '💬', thought_balloon: '💭',
  zzz: '💤', sleep: '😴', sweat_drops: '💦', boom: '💥',
  100: '💯', ok: '🆗', new: '🆕', up: '🆙', free: '🆓',
  egg: '🥚', hatching_chick: '🐣', chick: '🐥', bird: '🐦',
  penguin: '🐧', owl: '🦉', parrot: '🦜',
  salad: '🥗', broccoli: '🥦', carrot: '🥕', corn: '🌽',
  cherry_blossom: '🌸', rose: '🌹', tulip: '🌷', sunflower: '🌻',
  cactus: '🌵', four_leaf_clover: '🍀', seedling: '🌱', earth_asia: '🌏',
};

// ─── 工具 ────────────────────────────────────────────────────────────────────
/** 转义 HTML 特殊字符（防 XSS）。 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 将消息文本渲染为安全的富文本 HTML。
 * @param {string} rawText
 * @param {string[]} [mentionNames] - 当前频道内的成员昵称列表，用于高亮 @mention
 * @returns {string} 安全 HTML 字符串
 */
export function renderMessageContent(rawText, mentionNames = []) {
  if (!rawText) return '';

  let text = String(rawText);

  // 1. 提取并保护代码块（防止内部被其他规则替换）
  const codeBlocks = [];
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="msg-code-block"><code>${escapeHtml(code.trim())}</code></pre>`);
    return `\x00CODEBLOCK${idx}\x00`;
  });

  // 2. 提取并保护行内代码
  const inlineCodes = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code class="msg-inline-code">${escapeHtml(code)}</code>`);
    return `\x00INLINECODE${idx}\x00`;
  });

  // 3. 转义剩余文本（防 XSS）
  text = escapeHtml(text);

  // 4. Discord emoji :name:
  text = text.replace(/:([a-zA-Z0-9_+\-]+):/g, (match, name) => {
    const emoji = DISCORD_EMOJI_MAP[name] || DISCORD_EMOJI_MAP[name.toLowerCase()];
    if (emoji) return `<span class="msg-emoji" title=":${name}:">${emoji}</span>`;
    return match; // 未知 emoji 原样保留
  });

  // 5. @mention 高亮
  if (mentionNames.length > 0) {
    const escaped = mentionNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`@(${escaped.join('|')})`, 'g');
    text = text.replace(pattern, '<span class="msg-mention">@$1</span>');
  }
  // 未识别的 @mention 也加样式
  text = text.replace(/@([^\s<@]+)/g, (match, name) => {
    if (match.includes('msg-mention')) return match;
    return `<span class="msg-mention-weak">@${escapeHtml(name)}</span>`;
  });

  // 6. URL 自动链接（只匹配 http/https）
  text = text.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    '<a class="msg-link" href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  // 7. Markdown 格式（顺序很重要：粗斜体 > 粗体 > 斜体 > 删除线）
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>'); // ***粗斜体***
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');               // **粗体**
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');                           // *斜体*
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');                   // __粗体__
  text = text.replace(/_(.+?)_/g, '<em>$1</em>');                            // _斜体_
  text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');                         // ~~删除线~~
  text = text.replace(/\|\|(.+?)\|\|/g, '<span class="msg-spoiler">$1</span>'); // ||剧透||

  // 8. 换行
  text = text.replace(/\n/g, '<br>');

  // 9. 还原代码块和行内代码
  text = text.replace(/\x00INLINECODE(\d+)\x00/g, (_, i) => inlineCodes[Number(i)]);
  text = text.replace(/\x00CODEBLOCK(\d+)\x00/g, (_, i) => codeBlocks[Number(i)]);

  return text;
}

/** 所有可用的 Discord emoji（用于 emoji 选择器）。 */
export const EMOJI_LIST = Object.entries(DISCORD_EMOJI_MAP).map(([name, char]) => ({
  name,
  char,
  label: `:${name}:`,
}));

/** 快速 reaction emoji 列表（常见表情，用于气泡 hover 菜单）。 */
export const QUICK_REACTIONS = [
  { char: '👍', name: 'thumbsup' },
  { char: '❤️', name: 'heart' },
  { char: '😂', name: 'joy' },
  { char: '😮', name: 'open_mouth' },
  { char: '😢', name: 'cry' },
  { char: '😡', name: 'angry' },
  { char: '🎉', name: 'tada' },
  { char: '🔥', name: 'fire' },
];
