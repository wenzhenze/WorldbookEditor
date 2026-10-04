/**
 * WorldbookEditor 自动化测试（jsdom 无头环境）
 *
 * 本脚本把插件源码复制到一份与 SillyTavern 完全一致的目录结构里：
 *
 *   .harness/
 *     script.js                       ← 模拟 ST /script.js
 *     scripts/
 *       extensions.js                 ← 模拟 ST /scripts/extensions.js（getContext）
 *       world-info.js                 ← 模拟 ST /scripts/world-info.js
 *       utils.js                      ← 模拟 ST /scripts/utils.js
 *       extensions/third-party/WorldbookEditor/   ← 插件源码副本（原样复制）
 *
 * 这样模块里的 `../../../extensions.js`、`../../../../script.js` 等相对导入都能被正确解析，
 * 从而可以真正加载 ui.js / actions.js / api.js 并驱动真实的 DOM 事件。
 *
 * 运行： node tests/run-tests.mjs      （需要先在本目录 npm install）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* 1. 定位插件源码目录                                                  */
/* ------------------------------------------------------------------ */
const candidates = [
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '..', 'WorldbookEditor'),
    __dirname,
];
const PLUGIN_DIR = candidates.find(dir =>
    fs.existsSync(path.join(dir, 'manifest.json')) && fs.existsSync(path.join(dir, 'ui.js')));

if (!PLUGIN_DIR) {
    console.error('✗ 找不到插件源码目录（需要包含 manifest.json 与 ui.js）');
    process.exit(2);
}

/* ------------------------------------------------------------------ */
/* 2. 搭建与 SillyTavern 相同的目录结构                                  */
/* ------------------------------------------------------------------ */
const HARNESS = path.join(__dirname, '.harness');
const PLUGIN_COPY = path.join(HARNESS, 'scripts', 'extensions', 'third-party', 'WorldbookEditor');

fs.rmSync(HARNESS, { recursive: true, force: true });
fs.mkdirSync(path.join(HARNESS, 'scripts'), { recursive: true });
fs.mkdirSync(PLUGIN_COPY, { recursive: true });
fs.writeFileSync(path.join(HARNESS, 'package.json'), JSON.stringify({ type: 'module' }, null, 2), 'utf8');
fs.copyFileSync(path.join(__dirname, 'stubs', 'script.js'), path.join(HARNESS, 'script.js'));
fs.copyFileSync(path.join(__dirname, 'stubs', 'extensions.js'), path.join(HARNESS, 'scripts', 'extensions.js'));
fs.copyFileSync(path.join(__dirname, 'stubs', 'world-info.js'), path.join(HARNESS, 'scripts', 'world-info.js'));
fs.copyFileSync(path.join(__dirname, 'stubs', 'utils.js'), path.join(HARNESS, 'scripts', 'utils.js'));

const PLUGIN_FILES = fs.readdirSync(PLUGIN_DIR).filter(f => f.endsWith('.js'));
for (const file of PLUGIN_FILES) {
    fs.copyFileSync(path.join(PLUGIN_DIR, file), path.join(PLUGIN_COPY, file));
}
console.log(`插件源码: ${PLUGIN_DIR}`);
console.log(`测试副本: ${PLUGIN_FILES.join(', ')}\n`);

/* ------------------------------------------------------------------ */
/* 3. jsdom 环境                                                        */
/* ------------------------------------------------------------------ */
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
});
const { window } = dom;

const define = (name, value) => Object.defineProperty(globalThis, name, {
    value, configurable: true, writable: true,
});

define('window', window);
define('document', window.document);
define('navigator', window.navigator);
define('localStorage', window.localStorage);
define('HTMLElement', window.HTMLElement);
define('HTMLAnchorElement', window.HTMLAnchorElement);
define('Node', window.Node);
define('Event', window.Event);
define('CustomEvent', window.CustomEvent);
define('MouseEvent', window.MouseEvent);
define('KeyboardEvent', window.KeyboardEvent ?? window.Event);
define('getComputedStyle', window.getComputedStyle.bind(window));
define('requestAnimationFrame', window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : (cb => setTimeout(() => cb(Date.now()), 0)));
define('cancelAnimationFrame', window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : clearTimeout);

// 避免弹出「首次打开提示」弹窗
window.localStorage.setItem('[SiilyTavern]世界书管理器-首次打开', 'true');

/* ------------------------------------------------------------------ */
/* 4. 可编程的用户交互桩 + toastr                                        */
/* ------------------------------------------------------------------ */
const stub = {
    confirmReturn: true,
    promptReturn: null,
    toasts: [],
};

define('confirm', () => stub.confirmReturn);
define('prompt', () => stub.promptReturn);

const toastr = {
    success: (m) => stub.toasts.push(['success', String(m)]),
    warning: (m) => stub.toasts.push(['warning', String(m)]),
    error: (m) => stub.toasts.push(['error', String(m)]),
    info: (m) => stub.toasts.push(['info', String(m)]),
};
define('toastr', toastr);

/* ------------------------------------------------------------------ */
/* 5. 模拟 SillyTavern 上下文与磁盘上的世界书                            */
/* ------------------------------------------------------------------ */
const BOOKS = {};
const SAVES = [];
const CHAR_NAME = '测试角色';
const BOOK_A = '测试世界书';
const BOOK_B = '主世界书';

const makeEntry = (uid, comment, extra = {}) => ({
    uid,
    comment,
    content: `${comment} 的内容`,
    constant: false,
    key: [`k${uid}`],
    order: uid + 1,
    position: 1,
    depth: 4,
    disable: false,
    ...extra,
});

BOOKS[BOOK_A] = {
    entries: {
        0: makeEntry(0, '战斗系统', { tags: ['战斗', '系统'], order: 1 }),
        1: makeEntry(1, '世界观', { tags: ['世界观'], order: 2 }),
        2: makeEntry(2, '角色设定', { tags: ['角色', '战斗'], order: 3 }),
        3: makeEntry(3, '深度条目', { tags: ['世界观'], order: 1, position: 4, depth: 2 }),
        4: makeEntry(4, '无标签条目', { order: 4 }),
    },
};
BOOKS[BOOK_B] = { entries: { 0: makeEntry(0, '主书条目') } };

globalThis.__ST_CONTEXT__ = {
    characterId: 0,
    characters: [{
        name: CHAR_NAME,
        avatar: 'char.png',
        data: { extensions: { world: BOOK_A } },
    }],
    chatMetadata: {},
    extensionSettings: {},
    powerUserSettings: {},
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    saveSettingsDebounced: () => {},
    saveCharacterDebounced: () => {},
    saveMetadataDebounced: () => {},
    getCharacters: async () => {},
    loadWorldInfo: async (name) => (BOOKS[name] ? structuredClone(BOOKS[name]) : null),
    saveWorldInfo: async (name, data) => {
        BOOKS[name] = structuredClone(data);
        SAVES.push(name);
    },
    updateWorldInfoList: async () => {},
    getTokenCount: (text) => String(text || '').length,
    executeSlashCommands: async () => {},
};

/* ------------------------------------------------------------------ */
/* 6. 加载被测模块                                                      */
/* ------------------------------------------------------------------ */
// 注意：不要加查询串做 cache busting，否则会得到与插件内部不同的模块实例（STATE 不共享）
const url = (rel) => pathToFileURL(path.join(HARNESS, rel)).href;

const worldInfoStub = await import(url('scripts/world-info.js'));
worldInfoStub.world_names.push(BOOK_A, BOOK_B);

const tagsMod = await import(url('scripts/extensions/third-party/WorldbookEditor/tags.js'));
const stateMod = await import(url('scripts/extensions/third-party/WorldbookEditor/state.js'));
const apiMod = await import(url('scripts/extensions/third-party/WorldbookEditor/api.js'));
const actionsMod = await import(url('scripts/extensions/third-party/WorldbookEditor/actions.js'));
const uiMod = await import(url('scripts/extensions/third-party/WorldbookEditor/ui.js'));

const { STATE } = stateMod;
const { Actions } = actionsMod;
const { UI } = uiMod;
const { API } = apiMod;

/* ------------------------------------------------------------------ */
/* 7. 迷你测试框架                                                      */
/* ------------------------------------------------------------------ */
let passed = 0;
let failed = 0;
const failures = [];

function section(title) {
    console.log(`\n──── ${title} ────`);
}
function check(name, cond, detail) {
    if (cond) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        failures.push(name);
        console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
    }
}
function eq(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    check(name, a === e, `期望 ${e}，实际 ${a}`);
}
const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));

const entryTags = (book, uid) => (BOOKS[book]?.entries?.[uid]?.tags ?? null);
const visibleUids = () => [...document.querySelectorAll('#wb-entry-list .wb-card')]
    .filter(card => !card.classList.contains('hidden'))
    .map(card => Number(card.dataset.uid))
    .sort((a, b) => a - b);
const sortItemUids = () => [...document.querySelectorAll('#wb-sort-body .wb-sort-item')].map(el => Number(el.dataset.uid));

/* ================================================================== */
/* A. tags.js 纯函数单元测试                                           */
/* ================================================================== */
section('A. tags.js 工具函数');

eq('normalizeTagName 去空白与 # 前缀', tagsMod.normalizeTagName('  # 战斗  系统 '), '战斗 系统');
eq('normalizeTagName 非法输入', tagsMod.normalizeTagName(null), '');
eq('parseTagInput 支持中英文逗号/顿号', tagsMod.parseTagInput('战斗, 系统、主线；角色'), ['战斗', '系统', '主线', '角色']);
eq('parseTagInput 忽略大小写去重', tagsMod.parseTagInput('Plot, plot, PLOT'), ['Plot']);
eq('normalizeTagName 截断超长标签', tagsMod.normalizeTagName('x'.repeat(50)).length, tagsMod.MAX_TAG_LENGTH);

eq('getEntryTags 去重 + 清理', tagsMod.getEntryTags({ tags: ['a', 'A', ' b ', ''] }), ['a', 'b']);
eq('getEntryTags 读取 extensions 旧数据', tagsMod.getEntryTags({ extensions: { tags: ['旧'] } }), ['旧']);
eq('getEntryTags 容忍脏数据', tagsMod.getEntryTags({ tags: 'not-an-array' }), []);

{
    const e = {};
    const res = tagsMod.addEntryTags(e, '战斗, 系统');
    eq('addEntryTags 添加', res.added, ['战斗', '系统']);
    eq('addEntryTags 写回词条', e.tags, ['战斗', '系统']);
    const dup = tagsMod.addEntryTags(e, '战斗');
    eq('addEntryTags 重复检测', dup.duplicate, ['战斗']);
}
{
    const e = { tags: Array.from({ length: 10 }, (_, i) => `t${i}`) };
    const res = tagsMod.addEntryTags(e, '溢出');
    eq('addEntryTags 上限 10 个', res.overflow, ['溢出']);
    eq('addEntryTags 上限不写入', e.tags.length, 10);
}
{
    const e = { tags: ['a', 'b'] };
    eq('removeEntryTag 命中', tagsMod.removeEntryTag(e, 'A'), true);
    eq('removeEntryTag 结果', e.tags, ['b']);
    eq('removeEntryTag 未命中', tagsMod.removeEntryTag(e, 'zzz'), false);
}
{
    const e = { tags: ['a', 'b'] };
    eq('replaceEntryTag 合并同名词条内标签', tagsMod.replaceEntryTag(e, 'a', 'b'), true);
    eq('replaceEntryTag 结果', e.tags, ['b']);
}

{
    const e0 = { tags: ['战斗', '系统'] };
    const e1 = { tags: ['世界观'] };
    const e2 = {};
    check('筛选：任一命中', tagsMod.entryMatchesTagFilter(e0, ['战斗', '世界观'], 'any'));
    check('筛选：全部满足为假', !tagsMod.entryMatchesTagFilter(e0, ['战斗', '世界观'], 'all'));
    check('筛选：全部满足为真', tagsMod.entryMatchesTagFilter(e0, ['战斗', '系统'], 'all'));
    check('筛选：空条件放行', tagsMod.entryMatchesTagFilter(e2, [], 'any'));
    check('筛选：无标签伪标签命中', tagsMod.entryMatchesTagFilter(e2, [tagsMod.UNTAGGED_TOKEN], 'any'));
    check('筛选：无标签伪标签对有标签条目不命中', !tagsMod.entryMatchesTagFilter(e1, [tagsMod.UNTAGGED_TOKEN], 'any'));
    check('筛选：忽略大小写', tagsMod.entryMatchesTagFilter({ tags: ['Plot'] }, ['plot'], 'any'));
}

eq('parseSearchQuery 识别 #标签', tagsMod.parseSearchQuery('战斗 #主线 #角色'), { words: ['战斗'], tags: ['主线', '角色'] });
check('entryMatchesSearch：普通词匹配标签', tagsMod.entryMatchesSearch({ comment: 'x', content: 'y', tags: ['战斗'] }, '战斗'));
check('entryMatchesSearch：#标签匹配', tagsMod.entryMatchesSearch({ comment: 'x', content: 'y', tags: ['战斗'] }, '#战斗'));
check('entryMatchesSearch：#标签不匹配正文', !tagsMod.entryMatchesSearch({ comment: '战斗', content: '' }, '#战斗'));

eq('countEntryTags 统计与排序', tagsMod.countEntryTags([{ tags: ['a'] }, { tags: ['a', 'b'] }]), [{ tag: 'a', count: 2 }, { tag: 'b', count: 1 }]);
eq('countUntaggedEntries', tagsMod.countUntaggedEntries([{ tags: ['a'] }, {}, { tags: [] }]), 2);

/* ================================================================== */
/* B. order 重排算法（筛选态拖动）                                       */
/* ================================================================== */
section('B. 筛选态拖动排序算法 applyVisibleOrder');
{
    const snapshot = STATE.entries;
    STATE.entries = [
        { uid: 0, order: 1 }, { uid: 1, order: 2 }, { uid: 2, order: 3 }, { uid: 3, order: 4 },
    ];
    Actions.applyVisibleOrder([0, 1, 2, 3], [2, 0]);
    eq('可见条目互换后，未显示的条目保持原来的相对位置',
        [STATE.entries[2].order, STATE.entries[1].order, STATE.entries[0].order, STATE.entries[3].order],
        [1, 2, 3, 4]);
    STATE.entries = snapshot;
}

/* ================================================================== */
/* C. API 层：标签的读写与兼容                                          */
/* ================================================================== */
section('C. API 层读写标签');
{
    const loaded = await API.loadBook(BOOK_A);
    const e0 = loaded.find(e => e.uid === 0);
    eq('loadBook 保留已有标签', e0.tags, ['战斗', '系统']);

    BOOKS[BOOK_A].entries['9'] = { uid: 9, comment: '脏标签', tags: ['好', '好', '  ', '坏'] };
    const loaded2 = await API.loadBook(BOOK_A);
    eq('loadBook 规范化脏标签数据', loaded2.find(e => e.uid === 9).tags, ['好', '坏']);
    delete BOOKS[BOOK_A].entries['9'];

    // SillyTavern 原生编辑器只覆写自己认识的字段
    BOOKS[BOOK_A].entries[1].comment = 'ST 原生编辑器改过的标题';
    const loaded3 = await API.loadBook(BOOK_A);
    eq('ST 原生编辑器改动后标签仍在', loaded3.find(e => e.uid === 1).tags, ['世界观']);
    BOOKS[BOOK_A].entries[1].comment = '世界观';
}

/* ================================================================== */
/* D. 编辑器视图：给词条打标签 / 删标签                                  */
/* ================================================================== */
section('D. 编辑器视图标签交互');
await UI.open();
await tick(50);
await Actions.loadBook(BOOK_A);
await tick(20);

{
    const card = document.querySelector('.wb-card[data-uid="0"]');
    check('面板已渲染词条卡片', !!card);
    const chips = [...card.querySelectorAll('.wb-tag-chip')].map(c => c.dataset.tag);
    eq('卡片渲染已有标签', chips, ['战斗', '系统']);
    check('卡片记录了标签搜索缓存', (card.dataset.tagList || '').includes('战斗'));
    const untaggedCard = document.querySelector('.wb-card[data-uid="4"]');
    check('无标签词条显示占位文案', !!untaggedCard.querySelector('.wb-tag-empty'));
}

{
    const card = document.querySelector('.wb-card[data-uid="4"]');
    card.querySelector('.wb-tag-add').click();
    let wrap = card.querySelector('.wb-tag-input-wrap');
    check('点击「+ 标签」展开输入框', !wrap.classList.contains('wb-hidden'));

    const input = card.querySelector('.wb-tag-input');
    input.value = '主线, 高优先级';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick(60);

    eq('STATE 中写入多个标签', STATE.entries.find(e => e.uid === 4).tags, ['主线', '高优先级']);
    eq('标签已持久化到世界书', entryTags(BOOK_A, 4), ['主线', '高优先级']);

    const refreshed = document.querySelector('.wb-card[data-uid="4"]');
    eq('卡片标签行立即刷新', [...refreshed.querySelectorAll('.wb-tag-chip')].map(c => c.dataset.tag), ['主线', '高优先级']);
    wrap = refreshed.querySelector('.wb-tag-input-wrap');
    check('提交后收起输入框', wrap.classList.contains('wb-hidden'));
    check('标签写入后出现成功提示', stub.toasts.some(([type]) => type === 'success'));
}

{
    // ESC 取消不应写入
    const card = document.querySelector('.wb-card[data-uid="4"]');
    card.querySelector('.wb-tag-add').click();
    const input = card.querySelector('.wb-tag-input');
    input.value = '不应写入';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(40);
    check('ESC 取消不写入标签', !(STATE.entries.find(e => e.uid === 4).tags || []).includes('不应写入'));
}

{
    const card = document.querySelector('.wb-card[data-uid="4"]');
    card.querySelector('.wb-tag-chip[data-tag="主线"] .wb-tag-remove').click();
    await tick(60);
    eq('点 × 删除标签（STATE）', STATE.entries.find(e => e.uid === 4).tags, ['高优先级']);
    eq('点 × 删除标签（已持久化）', entryTags(BOOK_A, 4), ['高优先级']);
}

{
    // 删掉最后一个标签后应写回空数组，避免旧标签残留
    const card = document.querySelector('.wb-card[data-uid="4"]');
    card.querySelector('.wb-tag-chip[data-tag="高优先级"] .wb-tag-remove').click();
    await tick(60);
    eq('删除最后一个标签后磁盘上为空数组', entryTags(BOOK_A, 4), []);
    const refreshed = document.querySelector('.wb-card[data-uid="4"]');
    check('回到「未打标签」占位', !!refreshed.querySelector('.wb-tag-empty'));
}

{
    stub.toasts.length = 0;
    const card = document.querySelector('.wb-card[data-uid="0"]');
    card.querySelector('.wb-tag-add').click();
    const input = card.querySelector('.wb-tag-input');
    input.value = '战斗';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick(40);
    check('重复标签被拒绝', stub.toasts.some(([type, msg]) => type === 'warning' && msg.includes('已存在')));
    check('重复标签只提示一次（回车与失焦不会重复提交）',
        stub.toasts.filter(([type, msg]) => type === 'warning' && msg.includes('已存在')).length === 1,
        JSON.stringify(stub.toasts));
    eq('重复标签不重复写入', entryTags(BOOK_A, 0), ['战斗', '系统']);
}

/* ================================================================== */
/* E. 编辑器搜索框的 #标签 语法                                          */
/* ================================================================== */
section('E. 搜索框 #标签 语法');
{
    const search = document.getElementById('wb-search-entry');
    search.value = '#战斗';
    UI.renderList(search.value);
    eq('按 #战斗 筛选词条', visibleUids(), [0, 2]);

    search.value = '#世界观';
    UI.renderList(search.value);
    eq('#世界观 跨分组命中', visibleUids(), [1, 3]);

    search.value = '无标签';
    UI.renderList(search.value);
    eq('普通关键词仍可搜索（正文/标题）', visibleUids(), [4]);

    search.value = '#不存在的标签';
    UI.renderList(search.value);
    eq('无命中时全部隐藏', visibleUids(), []);

    search.value = '';
    UI.renderList('');
    eq('清空搜索恢复全部', visibleUids(), [0, 1, 2, 3, 4]);
}

/* ================================================================== */
/* F. 分组排序管理：按标签筛选                                           */
/* ================================================================== */
section('F. 「分组排序管理」标签筛选');
UI.openSortingModal();
await tick(20);

{
    const chips = [...document.querySelectorAll('#wb-sort-filter-chips .wb-sort-tag-chip')];
    const chipMap = Object.fromEntries(chips.map(c => [c.dataset.tag, c]));
    check('存在筛选条', !!document.querySelector('#wb-sort-filter'));
    eq('渲染出全部标签 + 无标签伪标签',
        Object.keys(chipMap).sort(),
        [tagsMod.UNTAGGED_TOKEN, '战斗', '系统', '世界观', '角色'].sort());
    eq('#战斗 计数', chipMap['战斗'].querySelector('.wb-sort-tag-count').textContent, '2');
    eq('#角色 计数', chipMap['角色'].querySelector('.wb-sort-tag-count').textContent, '1');
    eq('无标签计数', chipMap[tagsMod.UNTAGGED_TOKEN].querySelector('.wb-sort-tag-count').textContent, '1');
    eq('未筛选时展示全部条目', sortItemUids().length, 5);
    check('未筛选时没有筛选提示', !document.querySelector('.wb-sort-filter-hint'));
}

{
    // 单选标签 -> OR 筛选
    document.querySelector(`.wb-sort-tag-chip[data-tag="战斗"]`).click();
    await tick(10);
    eq('按 #战斗 筛选出 2 个条目', sortItemUids().sort((a, b) => a - b), [0, 2]);
    check('分组标题显示 已筛选/总数', [...document.querySelectorAll('.wb-sort-group-title')].some(t => t.textContent.includes('(2/4)')));
    check('显示筛选提示', !!document.querySelector('.wb-sort-filter-hint'));
    check('筛选中条目显示自身标签', [...document.querySelectorAll('.wb-sort-item[data-uid="0"] .wb-sort-item-tag')].length === 2);
    check('分组标题计数为 2/4',
        [...document.querySelectorAll('.wb-sort-group-title')].some(t => t.textContent.includes('(2/4)')));
}

{
    // 再选一个标签 -> OR；切到 AND 后应为空
    document.querySelector('.wb-sort-tag-chip[data-tag="世界观"]').click();
    await tick(10);
    eq('OR 模式：战斗 + 世界观', sortItemUids().sort((a, b) => a - b), [0, 1, 2, 3]);

    document.getElementById('wb-sort-mode-btn').click();
    await tick(10);
    eq('AND 模式下无条目同时满足', sortItemUids(), []);
    check('AND 模式空结果显示提示', !!document.querySelector('#wb-sort-body .wb-sort-empty'));

    document.getElementById('wb-sort-mode-btn').click();
    await tick(10);
    eq('切回 OR 模式恢复结果', sortItemUids().sort((a, b) => a - b), [0, 1, 2, 3]);
}

{
    // 筛选结果批量打标签
    stub.promptReturn = '重点';
    document.getElementById('wb-sort-batch-tag').click();
    await tick(80);
    stub.promptReturn = null;
    check('批量打标签写入词条 0', (entryTags(BOOK_A, 0) || []).includes('重点'));
    check('批量打标签写入词条 2', (entryTags(BOOK_A, 2) || []).includes('重点'));
    check('批量打标签写入词条 1', (entryTags(BOOK_A, 1) || []).includes('重点'));
    check('批量打标签写入词条 3', (entryTags(BOOK_A, 3) || []).includes('重点'));
    check('批量打标签不越界到未筛选条目', !(entryTags(BOOK_A, 4) || []).includes('重点'));
    check('批量打标签不会覆盖已有标签', JSON.stringify(entryTags(BOOK_A, 0)).includes('战斗'));
    check('新增标签后筛选条出现 #重点', [...document.querySelectorAll('#wb-sort-filter-chips .wb-sort-tag-chip')].some(c => c.dataset.tag === '重点'));
}

{
    // 清空筛选
    document.getElementById('wb-sort-filter-clear').click();
    await tick(10);
    eq('清空后展示全部条目', sortItemUids().length, 5);
    check('清空后筛选提示消失', !document.querySelector('.wb-sort-filter-hint'));
    check('清空后无激活标签', document.querySelectorAll('#wb-sort-filter-chips .wb-sort-tag-chip.active').length === 0);
}

{
    // 无标签伪标签筛选
    document.querySelector(`.wb-sort-tag-chip[data-tag="${tagsMod.UNTAGGED_TOKEN}"]`).click();
    await tick(10);
    eq('「无标签」筛选只显示未打标签条目', sortItemUids(), [4]);
    document.getElementById('wb-sort-filter-clear').click();
    await tick(10);
}

/* ================================================================== */
/* G. 筛选状态下的拖动排序（DOM 级集成）                                 */
/* ================================================================== */
section('G. 筛选状态下拖动排序');
{
    document.querySelector('.wb-sort-tag-chip[data-tag="战斗"]').click();
    await tick(10);

    const list = document.querySelector('#wb-sort-body .wb-sort-group-list');
    const items = [...list.querySelectorAll('.wb-sort-item')];
    eq('筛选后同组可见条目', items.map(el => Number(el.dataset.uid)), [0, 2]);

    // 记录拖动前未显示条目的 order，稍后验证它们没有被挪位
    const beforeOrders = Object.fromEntries(STATE.entries.map(e => [e.uid, e.order]));

    // 模拟把 uid=2 拖到 uid=0 前面（DOM 顺序变化 + dragend 触发重排）
    const dragStart = new window.Event('dragstart', { bubbles: true });
    dragStart.dataTransfer = { effectAllowed: '', setData: () => {}, getData: () => '' };
    items[1].dispatchEvent(dragStart);
    list.insertBefore(items[1], items[0]);
    items[1].dispatchEvent(new window.Event('dragend', { bubbles: true }));

    const orderOf = (uid) => STATE.entries.find(e => e.uid === uid).order;
    eq('被拖动条目排到最前', orderOf(2) < orderOf(0), true);
    check('未显示条目（uid1）仍位于被拖动条目的后方槽位', orderOf(1) < orderOf(0),
        `uid1=${orderOf(1)}, uid0=${orderOf(0)}`);
    eq('未显示条目 uid3（其它分组）不受影响', orderOf(3), beforeOrders[3]);
    eq('重排后组内 order 连续', [orderOf(2), orderOf(1), orderOf(0), orderOf(4)], [1, 2, 3, 4]);
    eq('拖动后的序号标签已更新', [...list.querySelectorAll('.wb-sort-item')].map(el => el.querySelector('.wb-sort-item-order').textContent), ['1', '3']);
}

{
    // 保存按钮：把当前顺序写盘
    const before = SAVES.length;
    document.getElementById('wb-sort-save').click();
    await tick(80);
    check('点击保存后写入世界书', SAVES.length > before);
    check('排序弹窗已关闭', !document.querySelector('#wb-sort-body'));
    const saved = BOOKS[BOOK_A].entries[2];
    check('保存的 order 与内存一致', saved.order === STATE.entries.find(e => e.uid === 2).order,
        `磁盘 ${saved.order} / 内存 ${STATE.entries.find(e => e.uid === 2).order}`);
}

/* ================================================================== */
/* H. 标签管理弹窗：重命名 / 合并 / 删除                                 */
/* ================================================================== */
section('H. 词条标签管理');
UI.openEntryTagManagerModal();
await tick(20);

{
    const rows = [...document.querySelectorAll('.wb-tagmgr-row')];
    check('列出所有标签', rows.length >= 5);
    const row = rows.find(r => r.dataset.tag === '系统');
    check('显示标签使用数量', /1 个条目/.test(row.querySelector('.wb-tagmgr-count').textContent));

    stub.promptReturn = '战斗';
    row.querySelector('[data-act="rename"]').click();
    await tick(80);
    stub.promptReturn = null;

    eq('重命名后与原标签合并去重', entryTags(BOOK_A, 0), ['战斗', '重点']);
    check('合并后 #系统 消失', ![...document.querySelectorAll('.wb-tagmgr-row')].some(r => r.dataset.tag === '系统'));

    const row2 = [...document.querySelectorAll('.wb-tagmgr-row')].find(r => r.dataset.tag === '重点');
    stub.confirmReturn = true;
    row2.querySelector('[data-act="delete"]').click();
    await tick(120);
    check('删除标签后词条 0 不再包含它', !(entryTags(BOOK_A, 0) || []).includes('重点'));
    check('删除标签后词条 2 不再包含它', !(entryTags(BOOK_A, 2) || []).includes('重点'));
    check('删除后编辑器卡片同步刷新',
        ![...document.querySelectorAll('.wb-card[data-uid="0"] .wb-tag-chip')].some(c => c.dataset.tag === '重点'));

    document.querySelector('.wb-tagmgr-close').click();
}

/* ================================================================== */
/* I. 导出：JSON 保留标签 / TXT 可选附带标签                             */
/* ================================================================== */
section('I. 导出');
{
    const loaded = await API.loadBook(BOOK_A);
    check('JSON 导出数据包含标签字段', Array.isArray(loaded.find(e => e.uid === 0).tags));
}

{
    let captured = '';
    const OrigBlob = globalThis.Blob;
    globalThis.Blob = class extends OrigBlob {
        constructor(parts, opts) {
            super(parts, opts);
            captured = String(parts[0]);
        }
    };
    const origClick = window.HTMLAnchorElement.prototype.click;
    window.HTMLAnchorElement.prototype.click = function () {};

    await Actions.actionExportTxt();
    const toggle = document.querySelector('.wb-export-tags-toggle');
    check('TXT 导出弹窗有附带标签选项', !!toggle);

    toggle.checked = true;
    document.querySelector('.wb-export-btn[data-type="all-title"]').click();
    check('勾选后标题行附带 #标签', captured.includes('#### 战斗系统 #战斗'), captured.slice(0, 160));

    await Actions.actionExportTxt();
    document.querySelector('.wb-export-tags-toggle').checked = false;
    document.querySelector('.wb-export-btn[data-type="all-title"]').click();
    check('未勾选时不附带标签', !captured.includes('#战斗'), captured.slice(0, 160));

    window.HTMLAnchorElement.prototype.click = origClick;
    globalThis.Blob = OrigBlob;
}

/* ================================================================== */
/* J. 回归：原有功能未被破坏                                             */
/* ================================================================== */
section('J. 回归检查');
{
    eq('词条数量未变', STATE.entries.length, 5);
    check('卡片标题输入框仍在', !!document.querySelector('.wb-card[data-uid="0"] .inp-name'));
    check('位置下拉框仍在', !!document.querySelector('.wb-card[data-uid="0"] .inp-pos'));
    check('Token 显示仍在', !!document.querySelector('.wb-card[data-uid="0"] .wb-token-display'));
    check('搜索框占位提示已更新', document.getElementById('wb-search-entry').placeholder.includes('#标签'));

    // 无标签筛选能力时（空世界书）不应报错
    BOOKS['空书'] = { entries: {} };
    await Actions.loadBook('空书');
    await tick(20);
    UI.openSortingModal();
    await tick(10);
    check('空世界书也能打开排序弹窗', !!document.querySelector('#wb-sort-body'));
    check('空世界书显示无标签提示', document.querySelector('#wb-sort-filter-chips').textContent.includes('还没有任何词条标签'));
    document.getElementById('wb-sort-close').click();
}

/* ================================================================== */
/* K. 筛选状态与数据变化的同步                                           */
/* ================================================================== */
section('K. 筛选状态同步（标签被删除 / 切换世界书）');
{
    await Actions.loadBook(BOOK_A);
    await tick(20);
    UI.openSortingModal();
    await tick(20);
    document.getElementById('wb-sort-filter-clear').click();
    await tick(10);
    document.querySelector('.wb-sort-tag-chip[data-tag="角色"]').click();
    await tick(10);
    eq('筛选前命中 #角色 的条目', sortItemUids(), [2]);

    // 在排序弹窗里打开标签管理并删除该标签
    document.getElementById('wb-sort-tag-manage').click();
    await tick(20);
    const row = [...document.querySelectorAll('.wb-tagmgr-row')].find(r => r.dataset.tag === '角色');
    check('标签管理弹窗可从筛选条打开', !!row);
    stub.confirmReturn = true;
    row.querySelector('[data-act="delete"]').click();
    await tick(120);

    check('标签被删除后筛选条件自动清理', !(STATE.entryTagFilter.tags || []).includes('角色'));
    check('筛选条不再显示已删除的标签', ![...document.querySelectorAll('#wb-sort-filter-chips .wb-sort-tag-chip')].some(c => c.dataset.tag === '角色'));
    eq('条件清理后恢复展示全部条目', sortItemUids().length, 5);
    check('被删除标签已从词条上移除', !(entryTags(BOOK_A, 2) || []).includes('角色'));

    document.querySelector('.wb-tagmgr-close').click();
    document.getElementById('wb-sort-close').click();
}

{
    // 选中「无标签」后关闭弹窗 —— 筛选条件应被保留，切换世界书后才重置
    UI.openSortingModal();
    await tick(20);
    document.getElementById('wb-sort-filter-clear').click();
    await tick(10);
    document.querySelector(`.wb-sort-tag-chip[data-tag="${tagsMod.UNTAGGED_TOKEN}"]`).click();
    await tick(10);
    document.getElementById('wb-sort-close').click();
    eq('关闭弹窗后保留筛选条件', STATE.entryTagFilter.tags, [tagsMod.UNTAGGED_TOKEN]);

    document.getElementById('wb-search-entry').value = '';
    await Actions.loadBook('空书');
    await tick(20);
    eq('切换世界书后重置标签筛选', STATE.entryTagFilter.tags, []);

    await Actions.loadBook(BOOK_A);
    await tick(20);
    eq('切回原世界书仍无残留筛选', STATE.entryTagFilter.tags, []);
    eq('切回后条目数量正确', STATE.entries.length, 5);
}

/* ================================================================== */
/* L.（可选）导出可视化预览 HTML，便于人工核对样式                        */
/* ================================================================== */
const WANT_PREVIEW = process.env.WB_PREVIEW === '1' || process.argv.includes('--preview');
if (WANT_PREVIEW) {
    section('L. 生成可视化预览');
    const css = fs.readFileSync(path.join(PLUGIN_DIR, 'style.css'), 'utf8');

    await Actions.loadBook(BOOK_A);
    await tick(20);

    // 排序弹窗 + 标签筛选（选中 #战斗）
    UI.openSortingModal();
    await tick(20);
    document.getElementById('wb-sort-filter-clear').click();   // 清掉上一节残留的筛选状态
    await tick(10);
    document.querySelector('.wb-sort-tag-chip[data-tag="战斗"]').click();
    await tick(20);
    const sortModal = document.querySelector('.wb-sort-modal-overlay').outerHTML;
    document.querySelector('#wb-sort-close').click();

    // 标签管理弹窗
    UI.openEntryTagManagerModal();
    await tick(20);
    const tagMgr = document.querySelector('.wb-tagmgr-overlay').outerHTML;
    document.querySelector('.wb-tagmgr-close').click();

    // TXT 导出弹窗
    await Actions.actionExportTxt();
    await tick(10);
    const exportToggle = document.querySelector('.wb-export-tags-toggle');
    exportToggle.checked = true;
    exportToggle.setAttribute('checked', 'checked');   // outerHTML 只反映属性
    const exportCard = document.querySelector('.wb-export-card').outerHTML;
    document.querySelector('.wb-export-card').closest('.wb-sort-modal-overlay').remove();

    // 编辑器面板（词条卡片 + 标签行）
    const panel = document.querySelector('#enhanced-wb-panel-v6').outerHTML;

    const page = (theme, body) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>WorldbookEditor 词条标签预览</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<style>
${css}
body { margin: 0; background: #eef0f4; font-family: "Microsoft YaHei", system-ui, sans-serif; }
.wb-preview-wrap { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.wb-preview-title { font-weight: 700; color: #374151; font-size: 15px; }
.wb-preview-stage { position: relative; background: #fff; border: 1px solid #dfe3e8; border-radius: 10px; padding: 14px; }
.wb-preview-stage .wb-sort-modal-overlay { position: static !important; inset: auto !important; background: transparent !important; display: block !important; }
.wb-preview-stage .wb-sort-modal { position: static !important; margin: 0 !important; top: auto !important; left: auto !important; transform: none !important; box-shadow: none !important; max-height: none !important; width: 620px !important; }
#enhanced-wb-panel-v6 { position: static !important; width: 100% !important; height: auto !important; inset: auto !important; max-height: none !important; }
#enhanced-wb-panel-v6 .wb-content { height: auto !important; }
#enhanced-wb-panel-v6 .wb-view-section { display: block !important; }
</style></head>
<body data-theme="${theme}">
<div class="wb-preview-wrap">
${body}
</div>
<script>document.querySelectorAll('.wb-tab').forEach(function (el) { el.onclick = null; });</script>
</body></html>`;

    const files = {
        'preview-1-editor.html': page('light', `
            <div class="wb-preview-title">编辑器视图：词条卡片上的标签行（已有标签 / 未打标签 / hover 可删）</div>
            <div class="wb-preview-stage">${panel}</div>`),
        'preview-2-sort.html': page('light', `
            <div class="wb-preview-title">分组排序管理：按标签筛选（已选中 #战斗 → 2/4 计数 + 拖动提示）</div>
            <div class="wb-preview-stage">${sortModal}</div>`),
        'preview-3-manager.html': page('light', `
            <div class="wb-preview-title">词条标签管理：重命名 / 合并 / 删除</div>
            <div class="wb-preview-stage">${tagMgr}</div>
            <div class="wb-preview-title">TXT 导出：标题行附带标签选项</div>
            <div class="wb-preview-stage">${exportCard}</div>`),
        'preview-4-sort-dark.html': page('dark', `
            <div class="wb-preview-title">分组排序管理（暗色主题）</div>
            <div class="wb-preview-stage">${sortModal}</div>`),
        'preview-5-export.html': page('light', `
            <div class="wb-preview-title">TXT 导出：标题行附带标签选项</div>
            <div class="wb-preview-stage">${exportCard}</div>`),
        'preview-6-manager-dark.html': page('dark', `
            <div class="wb-preview-title">词条标签管理（暗色主题）</div>
            <div class="wb-preview-stage">${tagMgr}</div>`),
    };

    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(__dirname, name), content, 'utf8');
        console.log(`  ✓ 已生成 ${name}`);
    }
}

/* ------------------------------------------------------------------ */
console.log(`\n${'='.repeat(48)}`);
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) {
    console.log('\n失败用例：');
    failures.forEach(name => console.log(`  - ${name}`));
}
console.log('='.repeat(48));
process.exit(failed > 0 ? 1 : 0);
