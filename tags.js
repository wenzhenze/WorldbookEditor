// tags.js
// 词条标签（Entry Tag）核心工具模块。
//
// 设计取舍：
//  - 标签直接存放在词条对象自身的 `tags` 字段（string[]），而不是插件的 extensionSettings 里。
//    这样标签会随世界书 JSON 一起被 SillyTavern 保存 / 导出 / 导入，也不会因为 UID 变化、
//    世界书改名而丢失（SillyTavern 的世界书编辑器只逐字段覆写自己认识的属性，未知字段原样保留）。
//  - 为了向前兼容，读取时会兼容 `entry.extensions.tags` / `entry.extensions.wb_tags`。

export const MAX_TAGS_PER_ENTRY = 10;
export const MAX_TAG_LENGTH = 24;

/** 「无标签」伪标签，仅用于筛选，不会写进词条 */
export const UNTAGGED_TOKEN = '__UNTAGGED__';
export const UNTAGGED_LABEL = '无标签';

/** dataset 中多个标签的分隔符（不可见字符，避免与标签内容冲突） */
export const TAG_SEP = '\u0001';

/**
 * 规范化单个标签名：去首尾空白、压缩内部空白、去掉前导 #、截断超长内容。
 * @param {unknown} raw
 * @returns {string} 规范化后的标签名，非法输入返回空串
 */
export function normalizeTagName(raw) {
    if (typeof raw !== 'string' && typeof raw !== 'number') return '';
    let tag = String(raw).replace(/[\r\n\t]+/g, ' ').trim();
    tag = tag.replace(/\s+/g, ' ');
    tag = tag.replace(/^#+/, '').trim();
    if (!tag) return '';
    if (tag.length > MAX_TAG_LENGTH) tag = tag.slice(0, MAX_TAG_LENGTH);
    return tag;
}

/**
 * 解析用户输入的一串文本为标签数组。
 * 支持中英文逗号、顿号、分号、竖线、换行作为分隔符，并自动去重（忽略大小写）。
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseTagInput(raw) {
    if (typeof raw !== 'string' && typeof raw !== 'number') return [];
    const out = [];
    String(raw)
        .split(/[,，、;；|\n\r]+/)
        .forEach(part => {
            const tag = normalizeTagName(part);
            if (!tag) return;
            if (out.some(existing => existing.toLowerCase() === tag.toLowerCase())) return;
            out.push(tag);
        });
    return out;
}

/**
 * 读取词条的标签数组（永远返回新数组，不会泄漏内部引用）。
 * @param {{tags?: unknown, extensions?: Record<string, unknown>}} entry
 * @returns {string[]}
 */
export function getEntryTags(entry) {
    if (!entry || typeof entry !== 'object') return [];
    let raw = entry.tags;
    if (!Array.isArray(raw)) {
        // 向前兼容：早期版本或其它插件可能存放在 extensions 里
        const ext = entry.extensions;
        if (ext && typeof ext === 'object') {
            if (Array.isArray(ext.tags)) raw = ext.tags;
            else if (Array.isArray(ext.wb_tags)) raw = ext.wb_tags;
        }
    }
    if (!Array.isArray(raw)) return [];

    const out = [];
    raw.forEach(item => {
        const tag = normalizeTagName(item);
        if (!tag) return;
        if (out.some(existing => existing.toLowerCase() === tag.toLowerCase())) return;
        out.push(tag);
    });
    return out;
}

/**
 * 就地规范化 / 清理词条的 tags 字段。
 * 空数组会被删除，避免给未打标签的词条增加无意义的 JSON 体积。
 * @param {{tags?: unknown}} entry
 * @returns {boolean} 是否发生了变化
 */
export function normalizeEntryTags(entry) {
    if (!entry || typeof entry !== 'object') return false;

    const raw = entry.tags;
    const cleaned = getEntryTags(entry);

    if (cleaned.length === 0) {
        // 已经是干净的空数组就保持原样，否则删掉这个字段
        if (Array.isArray(raw) && raw.length === 0) return false;
        if (!(typeof raw === 'undefined')) {
            delete entry.tags;
            return true;
        }
        return false;
    }

    const changed = !Array.isArray(raw)
        || raw.length !== cleaned.length
        || cleaned.some((tag, i) => raw[i] !== tag);
    entry.tags = cleaned;
    return changed;
}

/**
 * 给词条添加标签（就地修改）
 * @param {{tags?: string[]}} entry
 * @param {unknown} rawInput 用户输入的原始文本（可含多个标签）
 * @returns {{added: string[], duplicate: string[], overflow: string[]}}
 */
export function addEntryTags(entry, rawInput) {
    const result = { added: [], duplicate: [], overflow: [] };
    if (!entry || typeof entry !== 'object') return result;

    const tags = getEntryTags(entry);
    parseTagInput(rawInput).forEach(tag => {
        if (tags.some(item => item.toLowerCase() === tag.toLowerCase())) {
            result.duplicate.push(tag);
            return;
        }
        if (tags.length >= MAX_TAGS_PER_ENTRY) {
            result.overflow.push(tag);
            return;
        }
        tags.push(tag);
        result.added.push(tag);
    });

    entry.tags = tags;
    return result;
}

/**
 * 删除词条上的某个标签（就地修改）
 * @returns {boolean} 是否真的删除了
 */
export function removeEntryTag(entry, tag) {
    if (!entry || typeof entry !== 'object') return false;
    const target = normalizeTagName(tag).toLowerCase();
    if (!target) return false;
    const tags = getEntryTags(entry);
    const next = tags.filter(item => item.toLowerCase() !== target);
    if (next.length === tags.length) return false;
    entry.tags = next;
    return true;
}

/**
 * 把词条上的 oldTag 改名为 newTag（就地修改）。
 * 若 newTag 已存在于该词条，则相当于合并（去重）。
 * @returns {boolean} 是否发生了变化
 */
export function replaceEntryTag(entry, oldTag, newTag) {
    if (!entry || typeof entry !== 'object') return false;
    const from = normalizeTagName(oldTag).toLowerCase();
    const to = normalizeTagName(newTag);
    if (!from || !to) return false;

    const tags = getEntryTags(entry);
    if (!tags.some(item => item.toLowerCase() === from)) return false;

    const next = [];
    tags.forEach(item => {
        const value = item.toLowerCase() === from ? to : item;
        if (!next.some(existing => existing.toLowerCase() === value.toLowerCase())) next.push(value);
    });

    const changed = next.length !== tags.length || next.some((tag, i) => tag !== tags[i]);
    if (changed) entry.tags = next;
    return changed;
}

/**
 * 按标签筛选词条
 * @param {object} entry
 * @param {Iterable<string>|string[]} selectedTags 选中的标签集合（可包含 UNTAGGED_TOKEN）
 * @param {'any'|'all'} mode any=任一标签命中；all=必须同时拥有全部选中标签
 * @returns {boolean}
 */
export function entryMatchesTagFilter(entry, selectedTags, mode = 'any') {
    const selected = Array.from(selectedTags || []);
    if (selected.length === 0) return true;

    const tags = getEntryTags(entry);
    const lower = tags.map(tag => tag.toLowerCase());

    const checks = selected.map(sel => {
        if (sel === UNTAGGED_TOKEN) return tags.length === 0;
        return lower.includes(normalizeTagName(sel).toLowerCase());
    });

    return mode === 'all' ? checks.every(Boolean) : checks.some(Boolean);
}

/**
 * 统计当前（某本世界书内的）标签使用情况
 * @param {object[]} entries
 * @returns {{tag: string, count: number}[]} 按使用次数降序、同次数按名称排序
 */
export function countEntryTags(entries) {
    const map = new Map();
    (Array.isArray(entries) ? entries : []).forEach(entry => {
        getEntryTags(entry).forEach(tag => {
            const key = tag.toLowerCase();
            const item = map.get(key);
            if (item) item.count++;
            else map.set(key, { tag, count: 1 });
        });
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * 统计没有任何标签的词条数量
 * @param {object[]} entries
 */
export function countUntaggedEntries(entries) {
    return (Array.isArray(entries) ? entries : []).filter(entry => getEntryTags(entry).length === 0).length;
}

/**
 * 解析编辑器搜索框内容，支持 `#标签` 语法。
 * 例如 `战斗 #主线 #角色` → { words: ['战斗'], tags: ['主线', '角色'] }
 * @param {string} text
 * @returns {{words: string[], tags: string[]}}
 */
export function parseSearchQuery(text) {
    const words = [];
    const tags = [];
    String(text || '').split(/\s+/).forEach(part => {
        if (!part) return;
        if (part.startsWith('#')) {
            const tag = normalizeTagName(part.slice(1)).toLowerCase();
            if (tag && !tags.includes(tag)) tags.push(tag);
            return;
        }
        const word = part.toLowerCase();
        if (!words.includes(word)) words.push(word);
    });
    return { words, tags };
}

/**
 * 词条的完整搜索文本（名称 + 内容 + 标签），小写
 * @param {object} entry
 */
export function buildEntrySearchText(entry) {
    const comment = entry?.comment || '';
    const content = entry?.content || '';
    const tags = getEntryTags(entry).join(' ');
    return `${comment} ${content} ${tags}`.toLowerCase();
}

/**
 * 词条的标签搜索文本（小写，用 TAG_SEP 连接，便于精确按标签匹配）
 * @param {object} entry
 */
export function buildEntryTagSearchText(entry) {
    return getEntryTags(entry).map(tag => tag.toLowerCase()).join(TAG_SEP);
}

/**
 * 判断词条是否命中搜索词（支持 `#标签` 语法）
 * @param {object} entry
 * @param {string} filterText
 */
export function entryMatchesSearch(entry, filterText) {
    const { words, tags } = parseSearchQuery(filterText);
    if (words.length === 0 && tags.length === 0) return true;

    const searchText = buildEntrySearchText(entry);
    const tagText = buildEntryTagSearchText(entry);
    const tagList = tagText ? tagText.split(TAG_SEP) : [];

    const tagsOk = tags.every(tag => tagList.some(item => item.includes(tag)));
    if (!tagsOk) return false;
    return words.every(word => searchText.includes(word));
}
